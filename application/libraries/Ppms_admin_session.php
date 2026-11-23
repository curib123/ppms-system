<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Browser identity uses the existing authentication service, stored only on the server. */
class Ppms_admin_session
{
    private $session;
    private $auth;
    private $roles = array('ADMIN', 'FSQA', 'SUPERVISOR', 'PLANT_MANAGER');

    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->library(array('session', 'ppms_auth_service'));
        $this->session = $ci->session;
        $this->auth = $ci->ppms_auth_service;
    }

    public function login($input, $ip)
    {
        $result = $this->auth->login($input, $ip);
        $actor = $this->auth->authenticate('Bearer '.$result['token']);
        if (!in_array($actor['role'], $this->roles, TRUE)) {
            $this->auth->logout($actor);
            throw new Ppms_problem('ADMIN_PANEL_ACCESS_REQUIRED', 403);
        }
        $this->revoke();
        $this->session->sess_regenerate(TRUE);
        $this->session->set_userdata(array('ppms_admin_token' => $result['token'],
            'ppms_admin_identity' => array('id' => $actor['id'], 'sessionId' => $actor['sessionId'])));
        return $this->auth->publicUser($actor);
    }

    public function actor()
    {
        $token = $this->session->userdata('ppms_admin_token');
        if (!is_string($token) || $token === '') { return NULL; }
        try {
            $actor = $this->auth->authenticate('Bearer '.$token);
            if (in_array($actor['role'], $this->roles, TRUE)) { return $actor; }
        } catch (Ppms_problem $error) {
            if (!in_array($error->status, array(401, 403), TRUE)) { throw $error; }
        }
        $this->revoke();
        $this->session->sess_regenerate(TRUE);
        return NULL;
    }

    public function logout()
    {
        $this->revoke();
        $this->session->sess_destroy();
    }

    private function revoke()
    {
        // This snapshot is only for revocation; authorization always authenticates afresh.
        $identity = $this->session->userdata('ppms_admin_identity');
        if (is_array($identity) && isset($identity['id'], $identity['sessionId'])) {
            $this->auth->logout($identity);
        }
        $this->session->unset_userdata(array('ppms_admin_token', 'ppms_admin_identity'));
    }
}
