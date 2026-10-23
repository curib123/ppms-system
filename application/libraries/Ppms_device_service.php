<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

class Ppms_device_service
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
    public function register($actor, $input)
    {
        $uuid = Ppms_values::text($input, 'deviceUuid');
        $name = Ppms_values::text($input, 'displayName');
        return $this->store->transaction(function () use ($actor, $uuid, $name) {
            $existing = $this->store->row('SELECT * FROM ClientDevice WHERE deviceUuid=? ORDER BY registeredAt LIMIT 1 FOR UPDATE', array($uuid));
            if ($existing) {
                if ($existing['userId'] !== $actor['id'] && $actor['role'] !== 'ADMIN') { throw new Ppms_problem('DEVICE_ALREADY_REGISTERED', 409); }
                if ($existing['revokedAt']) { throw new Ppms_problem('DEVICE_REVOKED', 403); }
                return array('id' => $existing['id'], 'deviceUuid' => $uuid);
            }
            $id = Ppms_values::id();
            $this->store->insert('ClientDevice', array('id' => $id, 'userId' => $actor['id'], 'deviceUuid' => $uuid, 'displayName' => $name));
            $this->store->audit($actor, 'DEVICE_REGISTERED', 'ClientDevice', $id);
            return array('id' => $id, 'deviceUuid' => $uuid);
        });
    }
    public function assignUser($actor, $form, $userId, $input)
    {
        $this->auth->admin($actor);
        $values = array();
        foreach (array('canView', 'canCreate', 'canEdit', 'canPublish') as $key) {
            if (isset($input[$key]) && !is_bool($input[$key])) { throw new Ppms_problem('PERMISSION_MUST_BE_BOOLEAN'); }
            $values[$key] = (int) ($input[$key] ?? FALSE);
        }
        return $this->store->transaction(function () use ($actor, $form, $userId, $values) {
            $this->store->lockForm($form);
            $this->auth->user($userId);
            $this->store->execute('INSERT INTO PersonnelPpmAssignment (id,userId,ppmFormId,isActive,canView,canCreate,canEdit,canPublish,updatedAt)
                VALUES (?,?,?,1,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE isActive=1,canView=VALUES(canView),canCreate=VALUES(canCreate),canEdit=VALUES(canEdit),canPublish=VALUES(canPublish),updatedAt=UTC_TIMESTAMP(3)',
                array(Ppms_values::id(), $userId, $form, $values['canView'], $values['canCreate'], $values['canEdit'], $values['canPublish']));
            $this->store->audit($actor, 'PERMISSION_CHANGE', 'PersonnelPpmAssignment', $userId, $values, array('ppmFormId' => $form));
            return array('userId' => $userId, 'ppmFormId' => $form) + $values;
        });
    }
    public function assignLease($actor, $form, $input)
    {
        $this->auth->admin($actor);
        $deviceId = Ppms_values::text($input, 'deviceId');
        $expected = Ppms_values::integer($input, 'expectedLeaseVersion');
        return $this->store->transaction(function () use ($actor, $form, $input, $deviceId, $expected) {
            $this->store->lockForm($form);
            $old = $this->store->row('SELECT * FROM PpmFormDeviceLease WHERE ppmFormId=? FOR UPDATE', array($form));
            if (($old ? $old['leaseVersion'] : 0) !== $expected) { throw new Ppms_problem('LEASE_VERSION_CHANGED', 409); }
            if ($old) {
                if (($input['reconciled'] ?? FALSE) !== TRUE) { throw new Ppms_problem('RECONCILIATION_REQUIRED', 409); }
                Ppms_values::text($input, 'reason', 2000);
                if ($this->store->row("SELECT id FROM SyncDailyBatch WHERE ppmFormId=? AND status='PUSHING' LIMIT 1", array($form))) {
                    throw new Ppms_problem('SYNC_BATCH_IN_PROGRESS', 409);
                }
            }
            $device = $this->store->row('SELECT id FROM ClientDevice WHERE id=? AND revokedAt IS NULL FOR UPDATE', array($deviceId));
            if (!$device) { throw new Ppms_problem('DEVICE_UNAVAILABLE', 403); }
            if ($this->store->row('SELECT ppmFormId FROM PpmFormDeviceLease WHERE deviceId=? AND ppmFormId<>?', array($deviceId, $form))) {
                throw new Ppms_problem('DEVICE_ASSIGNED_TO_ANOTHER_FORM', 409);
            }
            $version = $expected + 1;
            $this->store->execute('INSERT INTO PpmFormDeviceLease (ppmFormId,deviceId,leaseVersion,updatedAt)
                VALUES (?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE deviceId=VALUES(deviceId),leaseVersion=VALUES(leaseVersion),revokedAt=NULL,assignedAt=UTC_TIMESTAMP(3),updatedAt=UTC_TIMESTAMP(3)', array($form, $deviceId, $version));
            $this->store->execute('DELETE FROM SyncPullCursor WHERE deviceId=?', array($deviceId));
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmFormDeviceLease', $form,
                array('deviceId' => $deviceId, 'leaseVersion' => $version, 'reason' => $input['reason'] ?? 'Initial assignment'), array('ppmFormId' => $form, 'deviceId' => $deviceId));
            return array('ppmFormId' => $form, 'deviceId' => $deviceId, 'leaseVersion' => $version);
        });
    }
    public function lease($form, $deviceId, $version)
    {
        $lease = $this->store->row('SELECT l.* FROM PpmFormDeviceLease l JOIN ClientDevice d ON d.id=l.deviceId
            WHERE l.ppmFormId=? AND l.deviceId=? AND l.revokedAt IS NULL AND d.revokedAt IS NULL', array($form, $deviceId));
        if (!$lease || $lease['leaseVersion'] !== $version) { throw new Ppms_problem('DEVICE_LEASE_INVALID', 403); }
        return $lease;
    }
    public function grant($actor, $input)
    {
        $form = Ppms_values::text($input, 'ppmFormId');
        $device = Ppms_values::text($input, 'deviceId');
        $version = Ppms_values::integer($input, 'leaseVersion', 1);
        return $this->store->transaction(function () use ($actor, $form, $device, $version) {
            $this->store->lockForm($form);
            $this->auth->access($actor, $form);
            $this->lease($form, $device, $version);
            if ($this->store->setting('offline.enabled', TRUE) !== TRUE) { throw new Ppms_problem('OFFLINE_ACCESS_DISABLED', 403); }
            $hours = max(1, min(168, (int) $this->store->setting('offline.maxAccessHours', 24)));
            $claims = array('kind' => 'author', 'userId' => $actor['id'], 'ppmFormId' => $form, 'deviceId' => $device,
                'leaseVersion' => $version, 'issuedAt' => time(), 'expiresAt' => time() + $hours * 3600);
            $proof = $this->sign($claims);
            $this->store->execute('UPDATE ClientDevice SET offlineAccessIssuedAt=UTC_TIMESTAMP(3),offlineAccessExpiresAt=?,lastSeenAt=UTC_TIMESTAMP(3) WHERE id=?', array(gmdate('Y-m-d H:i:s', $claims['expiresAt']), $device));
            return $claims + array('authorProof' => $proof);
        });
    }
    public function author($uploader, $mutation, $form, $device, $version)
    {
        $id = Ppms_values::text($mutation, 'userId');
        if (isset($mutation['authorProof'])) {
            $claims = $this->verify($mutation['authorProof'], 'author');
            if (($claims['userId'] ?? NULL) !== $id || ($claims['ppmFormId'] ?? NULL) !== $form
                || ($claims['deviceId'] ?? NULL) !== $device || ($claims['leaseVersion'] ?? NULL) !== $version) {
                throw new Ppms_problem('AUTHOR_PROOF_MISMATCH', 403);
            }
        } elseif ($id !== $uploader['id']) {
            throw new Ppms_problem('AUTHOR_PROOF_REQUIRED', 403);
        }
        return $this->auth->user($id);
    }
    public function sign($claims)
    {
        $key = ppms_config('APP_ENCRYPTION_KEY');
        if (strlen($key) < 32) { throw new Ppms_problem('SIGNING_KEY_NOT_CONFIGURED', 503); }
        $payload = rtrim(strtr(base64_encode(Ppms_values::json($claims)), '+/', '-_'), '=');
        return $payload.'.'.hash_hmac('sha256', $payload, $key);
    }
    public function verify($token, $kind)
    {
        if (!is_string($token) || strlen($token) > 4096) { throw new Ppms_problem('INVALID_PROOF', 403); }
        $parts = explode('.', $token);
        $key = ppms_config('APP_ENCRYPTION_KEY');
        if (strlen($key) < 32 || count($parts) !== 2 || !hash_equals(hash_hmac('sha256', $parts[0], $key), $parts[1])) {
            throw new Ppms_problem('INVALID_PROOF', 403);
        }
        $claims = json_decode(base64_decode(strtr($parts[0], '-_', '+/'), TRUE), TRUE);
        if (!is_array($claims) || ($claims['kind'] ?? NULL) !== $kind || ($claims['expiresAt'] ?? 0) <= time()) {
            throw new Ppms_problem('PROOF_EXPIRED_OR_INVALID', 403);
        }
        return $claims;
    }
}
