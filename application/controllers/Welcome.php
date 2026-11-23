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
        // The operational clients require sign-in. The historical reference
        // register is available only when an operator deliberately enables it.
        if (!filter_var(ppms_config('PPMS_PUBLIC_REGISTER', FALSE), FILTER_VALIDATE_BOOLEAN)) { show_404(); return; }
        $data = array('connected' => FALSE, 'counts' => array(), 'forms' => array());
        try {
            $this->load->model('Ppms_reference_model', 'reference');
            $data['counts'] = $this->reference->summary();
            $data['forms'] = $this->reference->forms();
            $data['connected'] = TRUE;
        } catch (Throwable $error) {
            // Optional setup guidance stays available without a database.
        }
        $this->output->set_header('Cache-Control: no-store');
        $this->load->view('setup_status', $data);
	}
}
