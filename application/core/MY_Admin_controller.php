<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Shared browser boundary; subclasses keep domain rules in the existing services. */
class MY_Admin_controller extends CI_Controller
{
    protected $actor;
    protected $publicActions = array();

    public function __construct()
    {
        parent::__construct();
        $this->load->helper('url');
        $this->output->set_header('Cache-Control: no-store')
            ->set_header('X-Content-Type-Options: nosniff')->set_header('X-Frame-Options: DENY')
            ->set_header('Referrer-Policy: same-origin');
        try {
            $this->load->library('ppms_admin_session');
            $this->actor = $this->ppms_admin_session->actor();
        } catch (Throwable $error) {
            $this->unavailable($error);
        }
        if ($this->actor === NULL && !in_array($this->router->fetch_method(), $this->publicActions, TRUE)) {
            if ($this->wantsJson()) {
                $this->json(401, array('error' => 'AUTHENTICATION_REQUIRED', 'redirect' => base_url('admin/login')));
            }
            redirect(base_url('admin/login'), 'location', 303);
        }
    }

    protected function wantsJson()
    {
        return $this->input->is_ajax_request()
            || stripos((string) $this->input->get_request_header('Accept'), 'application/json') !== FALSE;
    }

    protected function csrf()
    {
        return array('name' => $this->security->get_csrf_token_name(), 'hash' => $this->security->get_csrf_hash());
    }

    protected function renderAdmin($contentView, $pageTitle, $extra = array(), $status = 200)
    {
        $this->output->set_status_header($status);
        $this->load->view('admin/layout', $extra + array('pageTitle' => $pageTitle,
            'actor' => $this->actor, 'error' => NULL, 'username' => '', 'csrf' => $this->csrf(),
            'contentView' => $contentView, 'urls' => array('home' => base_url('admin'),
                'login' => base_url('admin/login'), 'logout' => base_url('admin/logout'),
                'css' => base_url('assets/css/admin.css'), 'jquery' => base_url('assets/vendor/jquery.min.js'),
                'js' => base_url('assets/js/admin.js'))));
    }

    protected function json($status, $payload)
    {
        $this->output->set_status_header($status)->set_content_type('application/json')
            ->set_output(json_encode($payload + array('csrf' => $this->csrf()), JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR))->_display();
        exit;
    }

    protected function methodNotAllowed($allow)
    {
        $this->output->set_header('Allow: '.$allow);
        if ($this->wantsJson()) { $this->json(405, array('error' => 'METHOD_NOT_ALLOWED')); }
        show_error('This action does not support that request method.', 405);
    }

    protected function unavailable($error)
    {
        log_message('error', 'PPMS admin failure: '.get_class($error).' code '.(int) $error->getCode());
        if ($this->wantsJson()) { $this->json(503, array('error' => 'SERVICE_UNAVAILABLE')); }
        show_error('PPMS is temporarily unavailable. Please try again shortly.', 503);
    }
}
