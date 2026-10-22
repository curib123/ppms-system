<?php
defined('BASEPATH') OR exit('No direct script access allowed');

class Welcome extends CI_Controller {

	/**
	 * Index Page for this controller.
	 *
	 * Maps to the following URL
	 * 		http://example.com/index.php/welcome
	 *	- or -
	 * 		http://example.com/index.php/welcome/index
	 *	- or -
	 * Since this controller is set as the default controller in
	 * config/routes.php, it's displayed at http://example.com/
	 *
	 * So any other public methods not prefixed with an underscore will
	 * map to /index.php/welcome/<method_name>
	 * @see https://codeigniter.com/userguide3/general/urls.html
	 */
	public function index()
	{
        $data = array('connected' => FALSE, 'counts' => array(), 'forms' => array());
        try {
            $this->load->model('Ppms_reference_model', 'reference');
            $data['counts'] = $this->reference->summary();
            $data['forms'] = $this->reference->forms();
            $data['connected'] = TRUE;
        } catch (Throwable $error) {
            // Setup guidance stays available when PostgreSQL is not configured.
        }
        $this->output->set_header('Cache-Control: no-store');
        $this->load->view('setup_status', $data);
	}
}
