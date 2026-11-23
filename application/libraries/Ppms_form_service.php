<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

class Ppms_form_service
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
    public function listing($actor)
    {
        $forms = $this->store->rows('SELECT * FROM PpmForm ORDER BY sortOrder,ppmCode');
        $leases = array();
        foreach ($this->store->rows('SELECT l.ppmFormId,l.deviceId,l.leaseVersion,l.revokedAt AS leaseRevokedAt
            FROM PpmFormDeviceLease l JOIN ClientDevice d ON d.id=l.deviceId
            WHERE l.revokedAt IS NULL AND d.revokedAt IS NULL ORDER BY l.ppmFormId,l.deviceId') as $lease) {
            $leases[$lease['ppmFormId']][] = $lease;
        }
        $items = array();
        foreach ($forms as $form) {
            // Concurrent devices share form definitions, never a last-writer
            // pointer. Clients select their own device's versioned membership.
            $form['leases'] = $leases[$form['id']] ?? array();
            $single = count($form['leases']) === 1 ? $form['leases'][0] : NULL;
            $form['deviceId'] = $single['deviceId'] ?? NULL;
            $form['leaseVersion'] = $single['leaseVersion'] ?? NULL;
            $form['leaseRevokedAt'] = NULL;
            try {
                $this->auth->access($actor, $form['id']);
                $form['permissions'] = array('canView' => TRUE);
                foreach (array('canCreate','canEdit','canPublish') as $permission) {
                    try { $this->auth->access($actor, $form['id'], $permission); $form['permissions'][$permission] = TRUE; }
                    catch (Ppms_problem $error) { if ($error->status !== 403) { throw $error; } $form['permissions'][$permission] = FALSE; }
                }
                $form['assignments'] = $this->store->rows("SELECT a.*,p.name AS areaName,p.code AS areaCode FROM AreaPpmAssignment a JOIN ProductionArea p ON p.id=a.areaId
                    WHERE a.ppmFormId=? AND a.isActive=1 AND p.status='ACTIVE' AND a.effectiveFrom<=UTC_TIMESTAMP(3)
                    AND (a.effectiveTo IS NULL OR a.effectiveTo>UTC_TIMESTAMP(3)) ORDER BY p.code", array($form['id']));
                $active = $this->store->row('SELECT id FROM PpmTemplateVersion WHERE ppmFormId=? AND isActive=1 AND publishedAt IS NOT NULL', array($form['id']));
                $form['activeTemplateId'] = $active['id'] ?? NULL;
                $items[] = $form;
            } catch (Ppms_problem $error) {
                if ($error->status !== 403) { throw $error; }
                if ($actor['role'] === 'ADMIN') { $items[] = $form; }
            }
        }
        return array('items' => $items);
    }
    public function update($actor, $id, $input)
    {
        $this->auth->admin($actor);
        return $this->store->transaction(function () use ($actor, $id, $input) {
            $old = $this->store->lockForm($id);
            if (($input['expectedUpdatedAt'] ?? NULL) !== $old['updatedAt']) { throw new Ppms_problem('FORM_CHANGED', 409); }
            $title = isset($input['title']) ? Ppms_values::text($input, 'title', 512) : $old['title'];
            $status = $input['status'] ?? $old['status'];
            if (!in_array($status, array('ACTIVE','INACTIVE','RESERVED'), TRUE)) { throw new Ppms_problem('INVALID_FORM_STATUS'); }
            $description = array_key_exists('description', $input) ? ($input['description'] === NULL || $input['description'] === '' ? NULL : Ppms_values::text($input, 'description', 4000)) : $old['description'];
            $sort = isset($input['sortOrder']) ? Ppms_values::integer($input, 'sortOrder', 0, 1000000) : $old['sortOrder'];
            $this->store->execute('UPDATE PpmForm SET title=?,status=?,description=?,sortOrder=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array($title, $status, $description, $sort, $id));
            $result = $this->store->row('SELECT * FROM PpmForm WHERE id=?', array($id));
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmForm', $id, $result, array('ppmFormId' => $id));
            return $result;
        });
    }
    public function create($actor, $input)
    {
        $this->auth->admin($actor);
        $code = Ppms_values::text($input, 'ppmCode');
        $title = Ppms_values::text($input, 'title', 512);
        $area = Ppms_values::text($input, 'areaId');
        return $this->store->transaction(function () use ($actor, $code, $title, $area) {
            if ($this->store->row('SELECT id FROM PpmForm WHERE ppmCode=?', array($code))) { throw new Ppms_problem('FORM_CODE_EXISTS', 409); }
            if (!$this->store->row('SELECT id FROM ProductionArea WHERE id=? AND status=\'ACTIVE\'', array($area))) { throw new Ppms_problem('AREA_UNAVAILABLE', 403); }
            $id = Ppms_values::id();
            $this->store->insert('PpmForm', array('id' => $id, 'ppmCode' => $code, 'title' => $title, 'updatedAt' => Ppms_values::now()));
            $this->store->insert('AreaPpmAssignment', array('id' => Ppms_values::id(), 'areaId' => $area, 'ppmFormId' => $id, 'updatedAt' => Ppms_values::now()));
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmForm', $id, array('ppmCode' => $code, 'areaId' => $area), array('ppmFormId' => $id));
            return $this->store->row('SELECT * FROM PpmForm WHERE id=?', array($id));
        });
    }
    public function assignArea($actor, $form, $area, $input)
    {
        $this->auth->admin($actor);
        $from = Ppms_values::date($input['effectiveFrom'] ?? NULL).' 00:00:00';
        $to = isset($input['effectiveTo']) ? Ppms_values::date($input['effectiveTo']).' 00:00:00' : NULL;
        if ($to !== NULL && $to <= $from) { throw new Ppms_problem('INVALID_EFFECTIVE_PERIOD'); }
        return $this->store->transaction(function () use ($actor, $form, $area, $from, $to) {
            $this->store->lockForm($form);
            if (!$this->store->row('SELECT id FROM ProductionArea WHERE id=? AND status=\'ACTIVE\'', array($area))) { throw new Ppms_problem('AREA_UNAVAILABLE', 403); }
            if ($this->store->row('SELECT id FROM AreaPpmAssignment WHERE ppmFormId=? AND areaId=? AND isActive=1
                AND (effectiveTo IS NULL OR effectiveTo>?) AND (? IS NULL OR effectiveFrom<?) LIMIT 1', array($form, $area, $from, $to, $to))) { throw new Ppms_problem('AREA_ASSIGNMENT_OVERLAPS', 409); }
            $id = Ppms_values::id();
            $this->store->insert('AreaPpmAssignment', array('id' => $id, 'areaId' => $area, 'ppmFormId' => $form, 'effectiveFrom' => $from, 'effectiveTo' => $to, 'updatedAt' => Ppms_values::now()));
            $this->store->audit($actor, 'CONFIG_CHANGE', 'AreaPpmAssignment', $id, array('areaId' => $area, 'effectiveFrom' => $from, 'effectiveTo' => $to), array('ppmFormId' => $form));
            return $this->store->row('SELECT * FROM AreaPpmAssignment WHERE id=?', array($id));
        });
    }
}
