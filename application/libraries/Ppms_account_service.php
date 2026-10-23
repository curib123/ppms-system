<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

/** Provisioning is called only by the local, CLI-only Accounts controller. */
class Ppms_account_service
{
    public function create($input)
    {
        $username = Ppms_values::text($input, 'username');
        $email = Ppms_values::text($input, 'email');
        $name = Ppms_values::text($input, 'displayName', 512);
        $role = Ppms_values::text($input, 'role');
        $password = $input['password'] ?? NULL;
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !in_array($role, array('ADMIN','PERSONNEL','FSQA','SUPERVISOR','PLANT_MANAGER'), TRUE)) { throw new Ppms_problem('INVALID_ACCOUNT'); }
        if (!is_string($password) || strlen($password) < 12 || strlen($password) > 72) { throw new Ppms_problem('PASSWORD_REQUIRES_12_TO_72_BYTES'); }
        $ci =& get_instance();
        $ci->load->model('Ppms_store_model', 'ppms_store');
        $store = $ci->ppms_store;
        return $store->transaction(function () use ($store, $username, $email, $name, $role, $password) {
            if ($store->row('SELECT id FROM User WHERE username=? OR email=? LIMIT 1', array($username, $email))) { throw new Ppms_problem('ACCOUNT_ALREADY_EXISTS', 409); }
            $id = Ppms_values::id();
            $store->insert('User', array('id' => $id, 'username' => $username, 'email' => $email, 'displayName' => $name,
                'role' => $role, 'passwordHash' => password_hash($password, PASSWORD_DEFAULT), 'updatedAt' => Ppms_values::now()));
            $store->audit(array('id' => $id), 'CREATE', 'User', $id, array('method' => 'LOCAL_CLI_PROVISIONING', 'role' => $role));
            return array('id' => $id, 'username' => $username, 'role' => $role);
        });
    }
}
