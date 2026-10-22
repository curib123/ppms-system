<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Database setup is explicit; normal web startup never imports or seeds data. */
class Ppms_database
{
    public function connection()
    {
        if (!extension_loaded('pdo_pgsql')) {
            throw new RuntimeException('PostgreSQL connection requires the PHP pdo_pgsql extension.');
        }
        $ci =& get_instance();
        $ci->load->database();
        if (!$ci->db->conn_id instanceof PDO) {
            throw new RuntimeException('PostgreSQL connection failed. Check the local database settings.');
        }
        $ci->db->conn_id->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        return $ci->db->conn_id;
    }

    public function manifest()
    {
        $path = dirname(APPPATH).'/database/manifest.json';
        $manifest = json_decode(file_get_contents($path), TRUE);
        if (!is_array($manifest) || !isset($manifest['tableCounts'], $manifest['tableDataSha256'])) {
            throw new RuntimeException('The database manifest is invalid.');
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

        $pdo = $this->connection();
        if ((int) $pdo->query('SHOW server_version_num')->fetchColumn() < 170000) {
            throw new RuntimeException('Database installation requires PostgreSQL 17 or newer.');
        }

        $pdo->beginTransaction();
        try {
            // Serialize installers before checking for existing schema objects.
            $pdo->query('SELECT pg_advisory_xact_lock(170013, 20261022)');
            $objects = $pdo->query("SELECT count(*) FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                UNION ALL
                SELECT count(*) FROM pg_catalog.pg_type t
                JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                WHERE n.nspname = 'public'
                UNION ALL
                SELECT count(*) FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public'")->fetchAll(PDO::FETCH_COLUMN);
            if (array_sum($objects) > 0) {
                throw new RuntimeException('Installation requires an empty public schema; existing data was preserved.');
            }
            foreach ($scripts as $sql) {
                $pdo->exec($sql);
            }
            $this->verify();
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $error;
        }
        return array('status' => 'installed', 'tables' => count($manifest['tableCounts']));
    }

    public function verify()
    {
        $manifest = $this->manifest();
        $pdo = $this->connection();
        foreach ($manifest['tableCounts'] as $table => $expected) {
            // Identifiers come exclusively from the checked-in manifest.
            $identifier = 'public."'.str_replace('"', '""', $table).'"';
            $actual = (int) $pdo->query('SELECT count(*) FROM '.$identifier)->fetchColumn();
            $data = $pdo->query("SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb)::text FROM ".$identifier.' t')->fetchColumn();
            if ($actual !== $expected || hash('sha256', $data) !== $manifest['tableDataSha256'][$table]) {
                throw new RuntimeException('Default data differs from the canonical baseline in '.$table.'.');
            }
        }
        return array('status' => 'verified', 'tables' => count($manifest['tableCounts']));
    }

    public function check()
    {
        $pdo = $this->connection();
        $query = $pdo->query("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'");
        return array('status' => 'ok', 'database' => 'connected', 'tables' => (int) $query->fetchColumn());
    }
}
