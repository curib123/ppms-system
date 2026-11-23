<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once APPPATH.'core/MY_Admin_controller.php';

/** Online admin sign-in and shared page shell. */
class Admin extends MY_Admin_controller
{
    protected $publicActions = array('login');

    public function index()
    {
        if ($this->input->method(TRUE) !== 'GET') { $this->methodNotAllowed('GET'); }
        $this->renderAdmin('admin/home', 'Overview');
    }

    public function login()
    {
        $method = $this->input->method(TRUE);
        if (!in_array($method, array('GET', 'POST'), TRUE)) { $this->methodNotAllowed('GET, POST'); }
        if ($this->actor !== NULL) { redirect(base_url('admin'), 'location', 303); }
        if ($method === 'GET') { $this->renderAdmin('admin/login', 'Sign in'); return; }
        $input = array('username' => $this->input->post('username', FALSE), 'password' => $this->input->post('password', FALSE));
        try {
            $this->ppms_admin_session->login($input, $this->input->ip_address());
            if ($this->wantsJson()) { $this->json(200, array('redirect' => base_url('admin'))); }
            redirect(base_url('admin'), 'location', 303);
        } catch (Ppms_problem $error) {
            $message = $error->status === 403 ? 'This account uses the personnel mobile app. Admin panel access is not available.'
                : ($error->status === 422 ? 'Enter your username and password.' : 'The username or password is incorrect. Please try again.');
            if ($this->wantsJson()) { $this->json($error->status, array('error' => $error->getMessage(), 'message' => $message)); }
            $username = is_string($input['username']) ? mb_substr($input['username'], 0, 191) : '';
            $this->renderAdmin('admin/login', 'Sign in', array('error' => $message, 'username' => $username), $error->status);
        } catch (Throwable $error) {
            $this->unavailable($error);
        }
    }

    public function logout()
    {
        if ($this->input->method(TRUE) !== 'POST') { $this->methodNotAllowed('POST'); }
        try {
            $this->ppms_admin_session->logout();
            if ($this->wantsJson()) { $this->json(200, array('redirect' => base_url('admin/login'))); }
            redirect(base_url('admin/login'), 'location', 303);
        } catch (Throwable $error) {
            $this->unavailable($error);
        }
    }
}
