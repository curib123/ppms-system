<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Setup extends CI_Controller
{
    public function __construct()
    {
        parent::__construct();
        if (!is_cli()) {
            show_404();
        }
        $this->load->library('ppms_database');
    }

    public function index()
    {
        echo "Usage: php index.php setup [check|install|verify|migrate]".PHP_EOL;
    }

    public function check()
    {
        $this->run('check');
    }

    public function install()
    {
        $this->run('install');
    }

    public function verify()
    {
        $this->run('verify');
    }

    public function migrate()
    {
        $this->load->library('ppms_schema_upgrades');
        try {
            echo json_encode($this->ppms_schema_upgrades->migrate()).PHP_EOL;
        } catch (Throwable $error) {
            fwrite(STDERR, ($error instanceof mysqli_sql_exception
                ? 'Database migration failed. Check schema compatibility and database permissions.'
                : $error->getMessage()).PHP_EOL);
            exit(1);
        }
    }

    private function run($command)
    {
        try {
            echo json_encode($this->ppms_database->$command(), JSON_UNESCAPED_SLASHES).PHP_EOL;
        } catch (Throwable $error) {
            // MySQLi exception strings can include connection details; don't print them.
            $message = $error instanceof mysqli_sql_exception
                ? 'Database operation failed. Check schema compatibility and database permissions.'
                : $error->getMessage();
            fwrite(STDERR, $message.PHP_EOL);
            exit(1);
        }
    }
}
