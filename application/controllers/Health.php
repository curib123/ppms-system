<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Health extends CI_Controller
{
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
