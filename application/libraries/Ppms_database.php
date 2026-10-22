<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Explicit MySQLi setup; normal web startup only reads data. */
class Ppms_database
{
    public function connection()
    {
        if (!extension_loaded('mysqli')) {
            throw new RuntimeException('MySQL connection requires the PHP mysqli extension.');
        }
        $ci =& get_instance();
        // CI3 handles connection failure as FALSE; suppress raw PHP connection warnings.
        mysqli_report(MYSQLI_REPORT_OFF);
        @$ci->load->database();
        if (!$ci->db->conn_id instanceof mysqli) {
            throw new RuntimeException('MySQL connection failed. Check the local database settings.');
        }
        mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
        return $ci->db->conn_id;
    }

    public function manifest()
    {
        $path = dirname(APPPATH).'/database/manifest.json';
        $manifest = json_decode(file_get_contents($path), TRUE);
        if (!is_array($manifest) || ($manifest['databaseDriver'] ?? '') !== 'mysqli'
            || !isset($manifest['tableCounts'], $manifest['tableDataSha256'], $manifest['columnTypes'])) {
            throw new RuntimeException('The MySQL database manifest is invalid.');
        }
        return $manifest;
    }

    public function install()
    {
        $manifest = $this->manifest();
        $directory = dirname(APPPATH).'/database/';
        $scripts = array();
        foreach (array('schema.sql', 'default_data.sql') as $name) {
            $scripts[] = file_get_contents($directory.$name);
            if (hash('sha256', end($scripts)) !== $manifest['sha256'][$name]) {
                throw new RuntimeException('Database SQL integrity check failed: '.$name);
            }
        }
        $connection = $this->connection();
        $version = $connection->server_info;
        $maria = strpos($version, 'MariaDB') !== FALSE;
        if ($maria && preg_match('/(\d+\.\d+\.\d+)(?=-MariaDB)/', $version, $match)) {
            $version = $match[1];
        }
        if (version_compare($version, $maria ? '10.4.0' : '8.0.16', '<')) {
            throw new RuntimeException('Installation requires MySQL 8.0.16+ or MariaDB 10.4+.');
        }
        $database = $connection->query('SELECT DATABASE()')->fetch_row()[0];
        $lock = 'ppms-install-'.substr(hash('sha256', $database), 0, 40);
        if ((int) $connection->query("SELECT GET_LOCK('".$lock."', 10)")->fetch_row()[0] !== 1) {
            throw new RuntimeException('Another database installation is running.');
        }
        $ownsSchema = FALSE;
        try {
            $objects = $connection->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
                UNION ALL SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema=DATABASE()
                UNION ALL SELECT COUNT(*) FROM information_schema.events WHERE event_schema=DATABASE()");
            $count = 0;
            while ($row = $objects->fetch_row()) { $count += (int) $row[0]; }
            if ($count > 0) {
                throw new RuntimeException('Installation requires an empty database; existing data was preserved.');
            }
            $ownsSchema = TRUE;
            // MySQL DDL implicitly commits; only the seed phase is transactional.
            $this->runSql($connection, $scripts[0]);
            $connection->begin_transaction();
            $this->runSql($connection, $scripts[1]);
            $this->verify();
            $connection->commit();
        } catch (Throwable $error) {
            if ($ownsSchema) {
                $connection->rollback();
                // Only this install's known tables may be removed, after the empty check.
                try {
                    $connection->query('SET FOREIGN_KEY_CHECKS=0');
                    foreach (array_reverse(array_keys($manifest['tableCounts'])) as $table) {
                        $connection->query('DROP TABLE IF EXISTS '.$this->identifier($table));
                    }
                } finally {
                    $connection->query('SET FOREIGN_KEY_CHECKS=1');
                }
            }
            throw $error;
        } finally {
            $connection->query("SELECT RELEASE_LOCK('".$lock."')");
        }
        return array('status' => 'installed', 'tables' => count($manifest['tableCounts']));
    }

    public function verify()
    {
        $manifest = $this->manifest();
        $connection = $this->connection();
        foreach ($manifest['tableCounts'] as $table => $expected) {
            $result = $connection->query('SELECT * FROM '.$this->identifier($table));
            $rows = array();
            while ($row = $result->fetch_assoc()) {
                foreach ($manifest['columnTypes'][$table] as $column => $type) {
                    if ($row[$column] === NULL) { continue; }
                    if ($type === 'json') {
                        $row[$column] = $this->canonicalJson(json_decode($row[$column], FALSE, 512, JSON_THROW_ON_ERROR));
                    } elseif ($type === 'datetime') {
                        $parts = explode('.', $row[$column], 2);
                        $row[$column] = $parts[0].'.'.substr(($parts[1] ?? '').'000', 0, 3);
                    } elseif ($type === 'decimal') {
                        $row[$column] = rtrim(rtrim($row[$column], '0'), '.');
                    } else {
                        $row[$column] = (string) $row[$column];
                    }
                }
                ksort($row, SORT_STRING);
                $rows[] = json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
            }
            sort($rows, SORT_STRING);
            if (count($rows) !== $expected || hash('sha256', implode("\n", $rows)) !== $manifest['tableDataSha256'][$table]) {
                throw new RuntimeException('Default data differs from the canonical baseline in '.$table.'.');
            }
        }
        return array('status' => 'verified', 'tables' => count($manifest['tableCounts']));
    }

    public function check()
    {
        $connection = $this->connection();
        $query = $connection->query("SELECT count(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE'");
        return array('status' => 'ok', 'database' => 'connected', 'tables' => (int) $query->fetch_row()[0]);
    }

    private function identifier($value)
    {
        return '`'.str_replace('`', '``', $value).'`';
    }

    private function canonicalJson($value)
    {
        if (is_object($value)) {
            $properties = get_object_vars($value);
            ksort($properties, SORT_STRING);
            $result = new stdClass();
            foreach ($properties as $key => $child) { $result->$key = $this->canonicalJson($child); }
            return $result;
        }
        if (is_array($value)) { return array_map(array($this, 'canonicalJson'), $value); }
        if (is_string($value)) { return '~string:'.$value; }
        if (is_int($value) || is_float($value)) {
            $number = is_int($value) ? (string) $value : sprintf('%.17g', $value);
            return '~number:'.preg_replace('/e\+?(-?)0*(\d+)/', 'e$1$2', $number);
        }
        return $value;
    }

    private function runSql($connection, $sql)
    {
        $connection->multi_query($sql);
        do {
            $result = $connection->store_result();
            if ($result instanceof mysqli_result) { $result->free(); }
            if (!$connection->more_results()) { break; }
            $connection->next_result();
        } while (TRUE);
    }
}
