<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

/** Shared CLI provisioning and authenticated account administration. */
class Ppms_account_service
{
    private $store;
    private $auth;
    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->library('ppms_auth_service');
        $this->store = $ci->ppms_store;
        $this->auth = $ci->ppms_auth_service;
    }
    public function create($input, $actor = NULL)
    {
        if ($actor !== NULL) { $this->auth->admin($actor); }
        $username = Ppms_values::text($input, 'username');
        $email = Ppms_values::text($input, 'email');
        $name = Ppms_values::text($input, 'displayName', 512);
        $role = Ppms_values::text($input, 'role');
        $password = $input['password'] ?? NULL;
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !in_array($role, array('ADMIN','PERSONNEL','FSQA','SUPERVISOR','PLANT_MANAGER'), TRUE)) { throw new Ppms_problem('INVALID_ACCOUNT'); }
        if (!is_string($password) || strlen($password) < 12 || strlen($password) > 72) { throw new Ppms_problem('PASSWORD_REQUIRES_12_TO_72_BYTES'); }
        $store = $this->store;
        return $store->transaction(function () use ($store, $username, $email, $name, $role, $password, $actor) {
            if ($store->row('SELECT id FROM User WHERE username=? OR email=? LIMIT 1', array($username, $email))) { throw new Ppms_problem('ACCOUNT_ALREADY_EXISTS', 409); }
            $id = Ppms_values::id();
            $store->insert('User', array('id' => $id, 'username' => $username, 'email' => $email, 'displayName' => $name,
                'role' => $role, 'passwordHash' => password_hash($password, PASSWORD_DEFAULT), 'updatedAt' => Ppms_values::now()));
            $store->audit($actor ?? array('id' => $id), 'CREATE', 'User', $id,
                array('method' => $actor ? 'ADMIN_API' : 'LOCAL_CLI_PROVISIONING', 'role' => $role));
            return array('id' => $id, 'username' => $username, 'role' => $role);
        });
    }
    public function listing($actor, $query = array())
    {
        $this->auth->admin($actor);
        $page = max(1, min(100000, (int) ($query['page'] ?? 1)));
        $limit = max(1, min(100, (int) ($query['limit'] ?? 50)));
        $search = '%'.mb_substr((string) ($query['q'] ?? ''), 0, 191).'%';
        $where = ' WHERE username LIKE ? OR displayName LIKE ? OR email LIKE ?';
        $parameters = array($search, $search, $search);
        $total = (int) $this->store->row('SELECT COUNT(*) AS total FROM User'.$where, $parameters)['total'];
        return array('items' => $this->store->rows('SELECT id,username,email,displayName,role,accountStatus,createdAt,updatedAt FROM User'.$where.
            ' ORDER BY username LIMIT ? OFFSET ?', array_merge($parameters, array($limit, ($page - 1) * $limit))), 'page' => $page, 'limit' => $limit, 'total' => $total);
    }
    public function update($actor, $id, $input)
    {
        $this->auth->admin($actor);
        return $this->store->transaction(function () use ($actor, $id, $input) {
            $admins = $this->store->rows('SELECT id FROM User WHERE role=\'ADMIN\' AND accountStatus=\'ACTIVE\' ORDER BY id FOR UPDATE');
            $user = $this->store->row('SELECT * FROM User WHERE id=? FOR UPDATE', array($id));
            if (!$user) { throw new Ppms_problem('USER_NOT_FOUND', 404); }
            $role = isset($input['role']) ? Ppms_values::text($input, 'role') : $user['role'];
            $status = isset($input['accountStatus']) ? Ppms_values::text($input, 'accountStatus') : $user['accountStatus'];
            if (!in_array($role, array('ADMIN','PERSONNEL','FSQA','SUPERVISOR','PLANT_MANAGER'), TRUE)
                || !in_array($status, array('ACTIVE','INACTIVE','LOCKED'), TRUE)) { throw new Ppms_problem('INVALID_ACCOUNT'); }
            if ($user['role'] === 'ADMIN' && $user['accountStatus'] === 'ACTIVE' && count($admins) <= 1
                && ($role !== 'ADMIN' || $status !== 'ACTIVE')) { throw new Ppms_problem('LAST_ACTIVE_ADMIN_REQUIRED', 409); }
            $name = isset($input['displayName']) ? Ppms_values::text($input, 'displayName', 512) : $user['displayName'];
            $email = isset($input['email']) ? Ppms_values::text($input, 'email') : $user['email'];
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { throw new Ppms_problem('INVALID_EMAIL'); }
            if ($this->store->row('SELECT id FROM User WHERE email=? AND id<>?', array($email, $id))) { throw new Ppms_problem('ACCOUNT_ALREADY_EXISTS', 409); }
            $this->store->execute('UPDATE User SET displayName=?,email=?,role=?,accountStatus=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array($name, $email, $role, $status, $id));
            if ($role !== $user['role'] || $status !== $user['accountStatus']) { $this->revoke($actor, $id); }
            $this->store->audit($actor, 'PERMISSION_CHANGE', 'User', $id, array('role' => $role, 'accountStatus' => $status));
            return array('id' => $id, 'username' => $user['username'], 'displayName' => $name, 'email' => $email, 'role' => $role, 'accountStatus' => $status);
        });
    }
    public function password($actor, $input, $userId = NULL)
    {
        $adminReset = $userId !== NULL;
        if ($adminReset) { $this->auth->admin($actor); } else { $userId = $actor['id']; }
        $password = $input['newPassword'] ?? $input['password'] ?? NULL;
        if (!is_string($password) || strlen($password) < 12 || strlen($password) > 72) { throw new Ppms_problem('PASSWORD_REQUIRES_12_TO_72_BYTES'); }
        return $this->store->transaction(function () use ($actor, $input, $userId, $password, $adminReset) {
            $user = $this->store->row('SELECT * FROM User WHERE id=? FOR UPDATE', array($userId));
            if (!$user) { throw new Ppms_problem('USER_NOT_FOUND', 404); }
            if (!$adminReset && (!is_string($input['currentPassword'] ?? NULL) || !password_verify($input['currentPassword'], $user['passwordHash']))) {
                throw new Ppms_problem('CURRENT_PASSWORD_INCORRECT', 403);
            }
            $this->store->execute('UPDATE User SET passwordHash=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array(password_hash($password, PASSWORD_DEFAULT), $userId));
            $this->revoke($actor, $userId);
            $this->store->audit($actor, 'PASSWORD_CHANGED', 'User', $userId, array('adminReset' => $adminReset));
            return array('status' => 'password_changed', 'sessionsRevoked' => TRUE);
        });
    }
    public function revokeSessions($actor, $id)
    {
        $this->auth->admin($actor);
        return $this->store->transaction(function () use ($actor, $id) {
            if (!$this->store->row('SELECT id FROM User WHERE id=? FOR UPDATE', array($id))) { throw new Ppms_problem('USER_NOT_FOUND', 404); }
            $this->revoke($actor, $id);
            return array('status' => 'sessions_revoked', 'userId' => $id);
        });
    }
    private function revoke($actor, $id)
    {
        $this->store->execute('UPDATE AuthSession SET revokedAt=UTC_TIMESTAMP(3) WHERE userId=? AND revokedAt IS NULL', array($id));
        $this->store->execute('UPDATE User SET authVersion=authVersion+1,updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array($id));
        $this->store->audit($actor, 'SESSION_REVOKED', 'User', $id);
    }
}
