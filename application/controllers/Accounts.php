<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Accounts extends CI_Controller
{
    public function __construct()
    {
        parent::__construct();
        if (!is_cli()) { show_404(); }
    }
    public function create()
    {
        try {
            $this->load->library('ppms_account_service');
            $raw = stream_get_contents(STDIN, 16385);
            if (strlen($raw) > 16384) { throw new Ppms_problem('ACCOUNT_INPUT_TOO_LARGE'); }
            $input = (array) Ppms_values::object(json_decode($raw, FALSE, 32, JSON_THROW_ON_ERROR));
            echo json_encode($this->ppms_account_service->create($input), JSON_THROW_ON_ERROR).PHP_EOL;
        } catch (Throwable $error) {
            // Never print the request, password, hash, connection string or SQL error.
            fwrite(STDERR, ($error instanceof Ppms_problem ? $error->getMessage() : 'ACCOUNT_PROVISIONING_FAILED').PHP_EOL);
            exit(1);
        }
    }
}
