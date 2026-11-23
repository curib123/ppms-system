<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

/** Bounded administrative reads and audited configuration changes. */
class Ppms_admin_service
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
    public function assignments($actor, $form)
    {
        $this->auth->access($actor, $form);
        $admin = $this->auth->user($actor['id'])['role'] === 'ADMIN';
        $areas = $this->store->rows('SELECT a.*,p.code,p.name,p.status AS areaStatus FROM AreaPpmAssignment a
            JOIN ProductionArea p ON p.id=a.areaId WHERE a.ppmFormId=? ORDER BY p.code,a.effectiveFrom', array($form));
        if (!$admin) { $areas = array_values(array_filter($areas, function ($row) {
            return (int) $row['isActive'] === 1 && $row['areaStatus'] === 'ACTIVE' && $row['effectiveFrom'] <= Ppms_values::now()
                && (!$row['effectiveTo'] || $row['effectiveTo'] > Ppms_values::now());
        })); }
        $personnel = $this->store->rows('SELECT p.*,u.username,u.displayName FROM PersonnelPpmAssignment p JOIN User u ON u.id=p.userId
            WHERE p.ppmFormId=?'.($admin ? '' : ' AND p.userId=?').' ORDER BY u.username', $admin ? array($form) : array($form, $actor['id']));
        $leases = $this->store->rows('SELECT ppmFormId,deviceId,leaseVersion,revokedAt FROM PpmFormDeviceLease WHERE ppmFormId=? ORDER BY deviceId', array($form));
        return array('areas' => $areas, 'personnel' => $personnel, 'leases' => $leases,
            'lease' => count($leases) === 1 ? $leases[0] : NULL);
    }
    public function userArea($actor, $userId, $areaId, $input)
    {
        $this->auth->admin($actor);
        if (!is_bool($input['isActive'] ?? NULL)) { throw new Ppms_problem('INVALID_ACTIVE_FLAG'); }
        return $this->store->transaction(function () use ($actor, $userId, $areaId, $input) {
            if (!$this->store->row('SELECT id FROM User WHERE id=? FOR UPDATE', array($userId))
                || !$this->store->row('SELECT id FROM ProductionArea WHERE id=?', array($areaId))) { throw new Ppms_problem('ASSIGNMENT_TARGET_NOT_FOUND', 404); }
            $this->store->execute('INSERT INTO UserAreaAssignment (id,userId,areaId,isActive,updatedAt) VALUES (?,?,?,?,UTC_TIMESTAMP(3))
                ON DUPLICATE KEY UPDATE isActive=VALUES(isActive),updatedAt=UTC_TIMESTAMP(3)', array(Ppms_values::id(), $userId, $areaId, (int) $input['isActive']));
            $this->store->audit($actor, 'PERMISSION_CHANGE', 'UserAreaAssignment', $userId, array('areaId' => $areaId, 'isActive' => $input['isActive']));
            return array('userId' => $userId, 'areaId' => $areaId, 'isActive' => $input['isActive']);
        });
    }
    public function settings($actor)
    {
        $this->auth->admin($actor);
        return array('items' => $this->store->rows('SELECT `key`,valueJson,valueType,description,updatedAt FROM SystemSetting WHERE isSensitive=0 ORDER BY `key`'));
    }
    public function saveSettings($actor, $input)
    {
        $this->auth->admin($actor);
        $items = $input['items'] ?? array((object) $input);
        if (!is_array($items) || !$items || count($items) > 100) { throw new Ppms_problem('INVALID_SETTINGS'); }
        return $this->store->transaction(function () use ($actor, $items) {
            $keys = array();
            foreach ($items as $raw) {
                $item = (array) $raw;
                $key = Ppms_values::text($item, 'key');
                if (isset($keys[$key])) { throw new Ppms_problem('DUPLICATE_SETTING'); }
                $keys[$key] = TRUE;
                $old = $this->store->row('SELECT * FROM SystemSetting WHERE `key`=? AND isSensitive=0 FOR UPDATE', array($key));
                if (!$old) { throw new Ppms_problem('SETTING_NOT_FOUND', 404); }
                if (($item['expectedUpdatedAt'] ?? NULL) !== $old['updatedAt']) { throw new Ppms_problem('SETTING_CHANGED', 409, array('key' => $key)); }
                if (!array_key_exists('valueJson', $item)) { throw new Ppms_problem('SETTING_VALUE_REQUIRED'); }
                $value = $item['valueJson'];
                if (($old['valueType'] === 'BOOLEAN' && !is_bool($value)) || ($old['valueType'] === 'INTEGER' && !is_int($value))
                    || ($old['valueType'] === 'STRING' && !is_string($value)) || strlen(Ppms_values::json($value)) > 16384) { throw new Ppms_problem('INVALID_SETTING_TYPE'); }
                if ($key === 'offline.maxAccessHours' && ($value < 1 || $value > 168)) { throw new Ppms_problem('INVALID_SETTING_RANGE'); }
                if ($key === 'retention.mode' && $value !== 'ARCHIVE_ONLY') { throw new Ppms_problem('DESTRUCTIVE_RETENTION_UNSUPPORTED'); }
                if ($key === 'retention.years' && ($value < 1 || $value > 100)) { throw new Ppms_problem('INVALID_SETTING_RANGE'); }
                $this->store->execute('UPDATE SystemSetting SET valueJson=?,updatedById=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array(Ppms_values::json($value), $actor['id'], $old['id']));
                $this->store->audit($actor, 'SETTINGS_CHANGE', 'SystemSetting', $old['id'], array('key' => $key, 'valueJson' => $value));
            }
            return $this->settings($actor);
        });
    }
    public function audit($actor, $query)
    {
        $this->auth->admin($actor);
        list($page, $limit) = $this->page($query);
        $where = array(); $parameters = array();
        foreach (array('recordId' => 'recordId', 'formId' => 'ppmFormId', 'action' => 'action') as $key => $column) {
            if (!empty($query[$key])) { $where[] = $column.'=?'; $parameters[] = Ppms_values::text($query, $key); }
        }
        $clause = $where ? ' WHERE '.implode(' AND ', $where) : '';
        $total = (int) $this->store->row('SELECT COUNT(*) AS total FROM AuditLog'.$clause, $parameters)['total'];
        return array('items' => $this->store->rows('SELECT * FROM AuditLog'.$clause.' ORDER BY createdAt DESC,id DESC LIMIT ? OFFSET ?',
            array_merge($parameters, array($limit, ($page - 1) * $limit))), 'page' => $page, 'limit' => $limit, 'total' => $total);
    }
    public function notifications($actor, $query)
    {
        list($page, $limit) = $this->page($query);
        return array('items' => $this->store->rows('SELECT id,type,severity,title,message,entityType,entityId,readAt,createdAt FROM Notification
            WHERE recipientId=? AND archivedAt IS NULL ORDER BY createdAt DESC,id DESC LIMIT ? OFFSET ?', array($actor['id'], $limit, ($page - 1) * $limit)),
            'page' => $page, 'limit' => $limit);
    }
    public function readNotification($actor, $id)
    {
        $this->store->execute('UPDATE Notification SET readAt=COALESCE(readAt,UTC_TIMESTAMP(3)) WHERE id=? AND recipientId=?', array($id, $actor['id']));
        return array('status' => 'read');
    }
    public function preferences($actor, $input = NULL)
    {
        if ($input !== NULL) {
            $appearance = $input['appearanceMode'] ?? 'SYSTEM';
            $view = $input['listViewMode'] ?? 'TABLE';
            $preferences = $input['preferencesJson'] ?? new stdClass();
            if (!in_array($appearance, array('SYSTEM','LIGHT','DARK'), TRUE) || !in_array($view, array('TABLE','CARDS'), TRUE)
                || !$preferences instanceof stdClass || strlen(Ppms_values::json($preferences)) > 16384) { throw new Ppms_problem('INVALID_PREFERENCES'); }
            $this->store->execute('INSERT INTO UserPreference (id,userId,appearanceMode,listViewMode,preferencesJson,updatedAt)
                VALUES (?,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE appearanceMode=VALUES(appearanceMode),listViewMode=VALUES(listViewMode),
                preferencesJson=VALUES(preferencesJson),updatedAt=UTC_TIMESTAMP(3)', array(Ppms_values::id(), $actor['id'], $appearance, $view, Ppms_values::json($preferences)));
        }
        return $this->store->row('SELECT appearanceMode,listViewMode,preferencesJson,updatedAt FROM UserPreference WHERE userId=?', array($actor['id']))
            ?? array('appearanceMode' => 'SYSTEM', 'listViewMode' => 'TABLE', 'preferencesJson' => new stdClass());
    }
    public function jobs($actor, $query)
    {
        $this->auth->admin($actor);
        list($page, $limit) = $this->page($query);
        return array('items' => $this->store->rows('SELECT id,jobType,status,startedAt,completedAt,artifactName,artifactChecksum,errorCode,createdAt
            FROM SystemJobRun ORDER BY createdAt DESC,id DESC LIMIT ? OFFSET ?', array($limit, ($page - 1) * $limit)), 'page' => $page, 'limit' => $limit);
    }
    private function page($query)
    {
        return array(max(1, min(100000, (int) ($query['page'] ?? 1))), max(1, min(100, (int) ($query['limit'] ?? 50))));
    }
}
