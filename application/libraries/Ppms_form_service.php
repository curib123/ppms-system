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
        $forms = $this->store->rows('SELECT f.*,l.deviceId,l.leaseVersion,l.revokedAt AS leaseRevokedAt FROM PpmForm f
            LEFT JOIN PpmFormDeviceLease l ON l.ppmFormId=f.id ORDER BY f.sortOrder,f.ppmCode');
        $items = array();
        foreach ($forms as $form) {
            try {
                $this->auth->access($actor, $form['id']);
                $items[] = $form;
            } catch (Ppms_problem $error) {
                if ($error->status !== 403) { throw $error; }
                if ($actor['role'] === 'ADMIN') { $items[] = $form; }
            }
        }
        return array('items' => $items);
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
