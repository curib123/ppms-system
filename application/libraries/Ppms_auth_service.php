<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

class Ppms_auth_service
{
    private $store;
    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->model('Ppms_store_model', 'ppms_store');
        $this->store = $ci->ppms_store;
    }
    public function login($input, $ip)
    {
        $username = Ppms_values::text($input, 'username');
        $password = $input['password'] ?? NULL;
        if (!is_string($password) || $password === '' || strlen($password) > 72) { throw new Ppms_problem('INVALID_CREDENTIALS', 401); }
        // Username identity is case-sensitive, exactly like utf8mb4_bin in User.
        $scopes = array(hash('sha256', 'ip|'.$ip) => 60,
            hash('sha256', 'account|'.$username) => 15, hash('sha256', $username.'|'.$ip) => 5);
        $result = $this->store->transaction(function () use ($username, $password, $scopes, $ip) {
            // Bounded cleanup and IP-first locking prevent arbitrary unknown names
            // from creating unlimited rows after an IP has exhausted its budget.
            $this->store->execute('DELETE FROM AuthLoginDefense WHERE lastFailedAt<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)
                AND (lockedUntil IS NULL OR lockedUntil<UTC_TIMESTAMP(3)) LIMIT 100');
            $defenses = array();
            foreach ($scopes as $key => $threshold) {
                $this->store->execute('INSERT IGNORE INTO AuthLoginDefense (id,identifierHash,failureCount) VALUES (?,?,0)', array(Ppms_values::id(), $key));
                $defense = $this->store->row('SELECT * FROM AuthLoginDefense WHERE identifierHash=? FOR UPDATE', array($key));
                if ($defense['lockedUntil'] && $defense['lockedUntil'] > Ppms_values::now()) { return NULL; }
                $expired = $defense['lockedUntil'] !== NULL || strtotime($defense['lastFailedAt'].' UTC') <= time() - 900;
                if ($expired) {
                    $defense['failureCount'] = 0;
                    $this->store->execute('UPDATE AuthLoginDefense SET failureCount=0,lockedUntil=NULL WHERE id=?', array($defense['id']));
                }
                $defenses[] = array($defense, $threshold);
            }
            // Serialize credential verification/session issuance with password
            // reset, suspension and revoke-all, which lock this same user row.
            $user = $this->store->row('SELECT * FROM User WHERE username=? FOR UPDATE', array($username));
            if (!$user || !password_verify($password, $user['passwordHash']) || $user['accountStatus'] !== 'ACTIVE') {
                $locked = FALSE;
                foreach ($defenses as list($defense, $threshold)) {
                    $failures = (int) $defense['failureCount'] + 1;
                    $until = $failures >= $threshold ? gmdate('Y-m-d H:i:s', time() + 900) : NULL;
                    $locked = $locked || $until !== NULL;
                    $this->store->execute('UPDATE AuthLoginDefense SET failureCount=?,lastFailedAt=UTC_TIMESTAMP(3),lockedUntil=? WHERE id=?', array($failures, $until, $defense['id']));
                }
                $this->store->audit(array('id' => $user['id'] ?? NULL), $locked ? 'LOGIN_LOCKED' : 'LOGIN_FAILED', 'User', $user['id'] ?? NULL,
                    array('reason' => 'INVALID_CREDENTIALS', 'networkHash' => hash('sha256', $ip)));
                return NULL;
            }
            foreach (array_slice($defenses, 1) as list($defense, $threshold)) {
                $this->store->execute('UPDATE AuthLoginDefense SET failureCount=0,lockedUntil=NULL WHERE id=?', array($defense['id']));
            }
            $token = bin2hex(random_bytes(32));
            $expires = gmdate('Y-m-d H:i:s', time() + 12 * 3600);
            $this->store->insert('AuthSession', array('id' => Ppms_values::id(), 'userId' => $user['id'],
                'refreshTokenHash' => hash('sha256', $token), 'expiresAt' => $expires,
                'idleExpiresAt' => gmdate('Y-m-d H:i:s', time() + 1800), 'ipAddress' => $ip));
            $this->store->audit($user, 'LOGIN', 'User', $user['id']);
            return array('token' => $token, 'expiresAt' => str_replace(' ', 'T', $expires).'Z', 'user' => $this->publicUser($user));
        });
        if (!$result) { throw new Ppms_problem('INVALID_CREDENTIALS', 401); }
        return $result;
    }
    public function authenticate($header)
    {
        if (!is_string($header) || !preg_match('/^Bearer ([a-f0-9]{64})$/D', $header, $matches)) {
            throw new Ppms_problem('AUTHENTICATION_REQUIRED', 401);
        }
        $user = $this->store->row('SELECT u.id,u.username,u.displayName,u.role,u.accountStatus,u.authVersion,s.id AS sessionId
            FROM AuthSession s JOIN User u ON u.id=s.userId WHERE s.refreshTokenHash=? AND s.revokedAt IS NULL
            AND s.expiresAt>UTC_TIMESTAMP(3) AND (s.idleExpiresAt IS NULL OR s.idleExpiresAt>UTC_TIMESTAMP(3)) AND u.accountStatus=\'ACTIVE\'', array(hash('sha256', $matches[1])));
        if (!$user) { throw new Ppms_problem('SESSION_EXPIRED_OR_REVOKED', 401); }
        $this->store->execute('UPDATE AuthSession SET lastSeenAt=UTC_TIMESTAMP(3),
            idleExpiresAt=LEAST(expiresAt,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE)) WHERE id=?', array($user['sessionId']));
        return $user;
    }
    public function logout($actor)
    {
        $this->store->transaction(function () use ($actor) {
            $this->store->execute('UPDATE AuthSession SET revokedAt=UTC_TIMESTAMP(3) WHERE id=?', array($actor['sessionId']));
            $this->store->audit($actor, 'LOGOUT', 'AuthSession', $actor['sessionId']);
        });
        return array('status' => 'logged_out');
    }
    public function user($id)
    {
        $user = $this->store->row('SELECT id,username,displayName,role,accountStatus,authVersion FROM User WHERE id=?', array($id));
        if (!$user || $user['accountStatus'] !== 'ACTIVE') { throw new Ppms_problem('USER_ACCESS_REVOKED', 403); }
        return $user;
    }
    public function admin($actor)
    {
        if ($this->user($actor['id'])['role'] !== 'ADMIN') { throw new Ppms_problem('ADMIN_REQUIRED', 403); }
    }
    public function access($actor, $formId, $permission = 'canView')
    {
        if (!in_array($permission, array('canView', 'canCreate', 'canEdit', 'canPublish'), TRUE)) { throw new LogicException('Unknown permission'); }
        $user = $this->user($actor['id']);
        $form = $this->store->row('SELECT status FROM PpmForm WHERE id=?', array($formId));
        // Retired form definitions retain their record/audit history. This
        // exception grants read access only; all data-write permissions below
        // still require an active form.
        if ($form && $user['role'] === 'ADMIN' && $permission === 'canView') { return; }
        if (!$form || $form['status'] !== 'ACTIVE') { throw new Ppms_problem('FORM_UNAVAILABLE', 403); }
        if ($user['role'] === 'ADMIN') { return; }
        $assignment = $this->store->row('SELECT * FROM PersonnelPpmAssignment WHERE userId=? AND ppmFormId=? AND isActive=1', array($actor['id'], $formId));
        if ($assignment && (int) $assignment['canView'] === 1 && (int) $assignment[$permission] === 1) { return; }
        if ($permission === 'canView' && in_array($user['role'], array('FSQA', 'SUPERVISOR', 'PLANT_MANAGER'), TRUE)) {
            $area = $this->store->row('SELECT ua.id FROM UserAreaAssignment ua JOIN AreaPpmAssignment pa ON pa.areaId=ua.areaId
                JOIN ProductionArea a ON a.id=pa.areaId WHERE ua.userId=? AND ua.isActive=1 AND pa.ppmFormId=? AND pa.isActive=1
                AND a.status=\'ACTIVE\' AND pa.effectiveFrom<=UTC_TIMESTAMP(3)
                AND (pa.effectiveTo IS NULL OR pa.effectiveTo>UTC_TIMESTAMP(3)) LIMIT 1', array($actor['id'], $formId));
            if ($area) { return; }
        }
        throw new Ppms_problem('FORM_PERMISSION_DENIED', 403, array('permission' => $permission));
    }
    public function publicUser($user)
    {
        return array_intersect_key($user, array_flip(array('id', 'username', 'displayName', 'role')));
    }
}
