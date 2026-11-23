<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Health extends CI_Controller
{
    public function ready()
    {
        $checks = array('database' => FALSE, 'schema' => FALSE, 'signing' => FALSE, 'timezone' => FALSE);
        try {
            $this->load->library('ppms_database');
            $db = $this->ppms_database->connection();
            $db->query('SELECT 1');
            $checks['database'] = TRUE;
            $applied = array();
            $rows = $db->query('SELECT version,checksum FROM PpmsSchemaMigration');
            while ($row = $rows->fetch_assoc()) { $applied[$row['version']] = $row['checksum']; }
            $checks['schema'] = TRUE;
            foreach (glob(dirname(APPPATH).'/database/migrations/*.sql') as $path) {
                $version = basename($path, '.sql');
                $source = file_get_contents($path);
                if ($version === '202610230001_offline_sync') { $source .= file_get_contents(APPPATH.'libraries/Ppms_migrations.php'); }
                if (!isset($applied[$version]) || !hash_equals(hash('sha256', $source), $applied[$version])) { $checks['schema'] = FALSE; }
            }
            $checks['signing'] = strlen((string) ppms_config('APP_ENCRYPTION_KEY')) >= 32;
            new DateTimeZone(ppms_config('PLANT_TIMEZONE', 'Asia/Manila'));
            $checks['timezone'] = TRUE;
        } catch (Throwable $error) { /* A readiness response never exposes SQL or secrets. */ }
        $ready = !in_array(FALSE, $checks, TRUE);
        $this->output->set_status_header($ready ? 200 : 503)->set_header('Cache-Control: no-store')
            ->set_header('X-Content-Type-Options: nosniff')->set_content_type('application/json')
            ->set_output(json_encode(array('status' => $ready ? 'ready' : 'not_ready', 'checks' => $checks)));
    }

    public function index()
    {
        try {
            $this->load->model('Ppms_reference_model', 'reference');
            $this->reference->summary();
            $status = 200;
            $result = array('status' => 'ok', 'database' => 'connected');
        } catch (Throwable $error) {
            $status = 503;
            $result = array('status' => 'error', 'database' => 'unavailable');
        }

        $this->output->set_status_header($status)
            ->set_header('Cache-Control: no-store')
            ->set_content_type('application/json')
            ->set_output(json_encode($result));
    }
}
