<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Public application shell. Every data operation uses the authenticated API. */
class App extends CI_Controller
{
    public function index($mode = 'admin')
    {
        $mode = $mode === 'mobile' ? 'mobile' : 'admin';
        $base = rtrim((string) parse_url($this->config->item('base_url'), PHP_URL_PATH), '/');
        $this->output->set_header('Cache-Control: no-cache')
            ->set_header('X-Content-Type-Options: nosniff')
            ->set_header('Referrer-Policy: same-origin')
            ->set_header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'");
        $this->load->view('ppms_app', array('mode' => $mode, 'app_base' => $base));
    }
}
