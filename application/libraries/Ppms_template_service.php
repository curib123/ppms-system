<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

class Ppms_template_service
{
    private $store;
    private $auth;
    private $validator;
    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->library(array('ppms_auth_service', 'ppms_form_validator'));
        $this->store = $ci->ppms_store;
        $this->auth = $ci->ppms_auth_service;
        $this->validator = $ci->ppms_form_validator;
    }
    public function versions($actor, $form)
    {
        $this->auth->access($actor, $form);
        $rows = $this->store->rows('SELECT * FROM PpmTemplateVersion WHERE ppmFormId=? AND (publishedAt IS NOT NULL OR ?=\'ADMIN\') ORDER BY versionNo DESC', array($form, $actor['role']));
        return array('items' => array_map(array($this, 'view'), $rows));
    }
    public function create($actor, $form, $input)
    {
        $this->auth->admin($actor);
        $definition = $this->validator->definition($input['definitionJson'] ?? NULL);
        return $this->store->transaction(function () use ($actor, $form, $definition, $input) {
            $this->store->lockForm($form);
            $next = (int) $this->store->row('SELECT COALESCE(MAX(versionNo),0)+1 AS n FROM PpmTemplateVersion WHERE ppmFormId=?', array($form))['n'];
            $id = Ppms_values::id();
            $this->store->insert('PpmTemplateVersion', array('id' => $id, 'ppmFormId' => $form, 'versionNo' => $next,
                'versionLabel' => isset($input['versionLabel']) ? Ppms_values::text($input, 'versionLabel') : NULL,
                'definitionJson' => Ppms_values::json($definition), 'updatedAt' => Ppms_values::now()));
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmTemplateVersion', $id, array('versionNo' => $next), array('ppmFormId' => $form));
            return $this->view($this->find($id));
        });
    }
    public function update($actor, $id, $input)
    {
        $this->auth->admin($actor);
        $definition = $this->validator->definition($input['definitionJson'] ?? NULL);
        return $this->store->transaction(function () use ($actor, $id, $input, $definition) {
            $old = $this->find($id);
            $this->store->lockForm($old['ppmFormId']);
            $old = $this->find($id);
            if ($old['publishedAt']) { throw new Ppms_problem('PUBLISHED_TEMPLATE_IMMUTABLE', 409); }
            if (($input['expectedDefinitionHash'] ?? NULL) !== Ppms_values::hash($old['definitionJson'])) { throw new Ppms_problem('TEMPLATE_CHANGED', 409); }
            $this->store->execute('UPDATE PpmTemplateVersion SET definitionJson=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array(Ppms_values::json($definition), $id));
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmTemplateVersion', $id, array('definitionHash' => Ppms_values::hash($definition)), array('ppmFormId' => $old['ppmFormId']));
            return $this->view($this->find($id));
        });
    }
    public function publish($actor, $id)
    {
        $this->auth->admin($actor);
        return $this->store->transaction(function () use ($actor, $id) {
            $template = $this->find($id);
            $this->store->lockForm($template['ppmFormId']);
            $template = $this->find($id);
            if ($template['publishedAt']) { throw new Ppms_problem('PUBLISHED_TEMPLATE_IMMUTABLE', 409); }
            $this->validator->definition($template['definitionJson']);
            $this->store->execute('UPDATE PpmTemplateVersion SET isActive=0,effectiveTo=UTC_TIMESTAMP(3) WHERE ppmFormId=? AND isActive=1', array($template['ppmFormId']));
            $this->store->execute('UPDATE PpmTemplateVersion SET isActive=1,publishedAt=UTC_TIMESTAMP(3),effectiveFrom=UTC_TIMESTAMP(3),updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array($id));
            $result = $this->view($this->find($id));
            $this->store->event($template['ppmFormId'], 'TEMPLATE_PUBLISHED', $result);
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmTemplateVersion', $id, array('published' => TRUE), array('ppmFormId' => $template['ppmFormId']));
            return $result;
        });
    }
    public function find($id)
    {
        $row = $this->store->row('SELECT * FROM PpmTemplateVersion WHERE id=?', array($id));
        if (!$row) { throw new Ppms_problem('TEMPLATE_NOT_FOUND', 404); }
        return $row;
    }
    public function view($row)
    {
        unset($row['activePpmFormId']);
        $row['isActive'] = (bool) $row['isActive'];
        $row['definitionHash'] = Ppms_values::hash($row['definitionJson']);
        return $row;
    }
}
