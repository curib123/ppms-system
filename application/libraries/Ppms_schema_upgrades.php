<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Version one is sealed; subsequent SQL versions have independent checksums. */
class Ppms_schema_upgrades
{
    public function migrate()
    {
        $ci =& get_instance();
        $ci->load->library(array('ppms_migrations','ppms_database'));
        $result = $ci->ppms_migrations->migrate();
        $connection = $ci->ppms_database->connection();
        $database = $connection->query('SELECT DATABASE()')->fetch_row()[0];
        $lock = 'ppms-install-'.substr(hash('sha256', $database), 0, 40);
        if ((int) $connection->query("SELECT GET_LOCK('".$lock."',10)")->fetch_row()[0] !== 1) { throw new RuntimeException('Another database migration is running.'); }
        try {
            $paths = glob(dirname(APPPATH).'/database/migrations/*.sql');
            sort($paths, SORT_STRING);
            foreach ($paths as $path) {
                $version = basename($path, '.sql');
                if ($version === '202610230001_offline_sync') { continue; }
                $sql = file_get_contents($path);
                $checksum = hash('sha256', $sql);
                $statement = $connection->prepare('SELECT checksum FROM PpmsSchemaMigration WHERE version=?');
                $statement->bind_param('s', $version);
                $statement->execute();
                $applied = $statement->get_result()->fetch_assoc();
                if ($applied) {
                    if (!hash_equals($applied['checksum'], $checksum)) { throw new RuntimeException('Applied migration checksum differs: '.$version); }
                } else {
                    $connection->multi_query($sql);
                    do {
                        $query = $connection->store_result();
                        if ($query instanceof mysqli_result) { $query->free(); }
                        if (!$connection->more_results()) { break; }
                        $connection->next_result();
                    } while (TRUE);
                    $statement = $connection->prepare('INSERT INTO PpmsSchemaMigration (version,checksum) VALUES (?,?)');
                    $statement->bind_param('ss', $version, $checksum);
                    $statement->execute();
                }
                $result['version'] = $version;
            }
            return $result;
        } finally { $connection->query("SELECT RELEASE_LOCK('".$lock."')"); }
    }
}
