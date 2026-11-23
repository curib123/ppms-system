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
    public function versions($actor, $form, $query = array())
    {
        if ($actor['role'] === 'ADMIN') { $this->auth->admin($actor); } else { $this->auth->access($actor, $form); }
        $page = max(1, min(1000000, (int) ($query['page'] ?? 1)));
        $limit = max(1, min(20, (int) ($query['limit'] ?? 10)));
        $summary = ($query['summary'] ?? '') === 'true';
        $where = " WHERE ppmFormId=? AND (publishedAt IS NOT NULL OR ?='ADMIN')";
        $parameters = array($form, $actor['role']);
        $total = (int) $this->store->row('SELECT COUNT(*) AS n FROM PpmTemplateVersion'.$where, $parameters)['n'];
        $columns = $summary ? 'id,ppmFormId,versionNo,versionLabel,documentNumber,revisionNumber,seriesNumber,pageNumber,isActive,publishedAt,effectiveFrom,effectiveTo,createdAt,updatedAt' : '*';
        $rows = $this->store->rows('SELECT '.$columns.' FROM PpmTemplateVersion'.$where.' ORDER BY versionNo DESC LIMIT ? OFFSET ?', array_merge($parameters, array($limit, ($page - 1) * $limit)));
        $items = array();
        foreach ($rows as $row) {
            if ($summary) { $row['isActive'] = (bool) $row['isActive']; $items[] = $row; }
            else { $items[] = $this->view($row); }
        }
        return array('items' => $items, 'page' => $page, 'limit' => $limit, 'total' => $total, 'hasMore' => $page * $limit < $total);
    }
    public function get($actor, $id)
    {
        $row = $this->find($id);
        if ($actor['role'] === 'ADMIN') { $this->auth->admin($actor); }
        else {
            $this->auth->access($actor, $row['ppmFormId']);
            if (!$row['publishedAt']) { throw new Ppms_problem('TEMPLATE_NOT_FOUND', 404); }
        }
        return $this->store->transaction(function () use ($id, $row) {
            $this->store->lockForm($row['ppmFormId']);
            return $this->view($this->find($id));
        });
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
                'definitionJson' => Ppms_values::json($definition), 'updatedAt' => Ppms_values::now()) + $this->metadata($input));
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmTemplateVersion', $id, array('versionNo' => $next), array('ppmFormId' => $form));
            return $this->view($this->find($id));
        });
    }
    public function update($actor, $id, $input)
    {
        $this->auth->admin($actor);
        $definition = $this->validator->definition($input['definitionJson'] ?? NULL);
        $form = $this->find($id)['ppmFormId'];
        return $this->store->transaction(function () use ($actor, $id, $input, $definition, $form) {
            $this->store->lockForm($form);
            $old = $this->find($id);
            if ($old['publishedAt']) { throw new Ppms_problem('PUBLISHED_TEMPLATE_IMMUTABLE', 409); }
            $this->assertEditHash($old, $input);
            $values = array('definitionJson' => Ppms_values::json($definition)) + $this->metadata($input);
            if (array_key_exists('versionLabel', $input)) { $values['versionLabel'] = $input['versionLabel'] === NULL ? NULL : Ppms_values::text($input, 'versionLabel'); }
            $sets = array();
            foreach (array_keys($values) as $column) { $sets[] = '`'.$column.'`=?'; }
            $this->store->execute('UPDATE PpmTemplateVersion SET '.implode(',', $sets).',updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array_merge(array_values($values), array($id)));
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmTemplateVersion', $id, array('definitionHash' => Ppms_values::hash($definition)), array('ppmFormId' => $old['ppmFormId']));
            return $this->view($this->find($id));
        });
    }
    public function publish($actor, $id, $input = array())
    {
        $this->auth->admin($actor);
        $form = $this->find($id)['ppmFormId'];
        return $this->store->transaction(function () use ($actor, $id, $form, $input) {
            $this->store->lockForm($form);
            $template = $this->find($id);
            if ($template['publishedAt']) { throw new Ppms_problem('PUBLISHED_TEMPLATE_IMMUTABLE', 409); }
            $this->assertEditHash($template, $input);
            $this->validator->definition($template['definitionJson']);
            $ci =& get_instance();
            $ci->load->library('ppms_trace_service');
            $ci->ppms_trace_service->validateTemplateRules($id, $template['definitionJson']);
            $ci->ppms_trace_service->validateTemplateConnections($form, $template['definitionJson'], $id);
            $this->store->execute('UPDATE PpmTemplateVersion SET isActive=0,effectiveTo=UTC_TIMESTAMP(3) WHERE ppmFormId=? AND isActive=1', array($template['ppmFormId']));
            $this->store->execute('UPDATE PpmTemplateVersion SET isActive=1,publishedAt=UTC_TIMESTAMP(3),effectiveFrom=UTC_TIMESTAMP(3),updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array($id));
            $result = $this->view($this->find($id));
            $this->store->event($template['ppmFormId'], 'TEMPLATE_PUBLISHED', $result);
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmTemplateVersion', $id, array('published' => TRUE), array('ppmFormId' => $template['ppmFormId']));
            return $result;
        });
    }
    public function duplicate($actor, $id, $input = array())
    {
        $this->auth->admin($actor);
        $source = $this->find($id);
        $form = isset($input['ppmFormId']) ? Ppms_values::text($input, 'ppmFormId') : $source['ppmFormId'];
        return $this->store->transaction(function () use ($actor, $source, $form, $input) {
            $this->store->lockForm($form);
            $next = (int) $this->store->row('SELECT COALESCE(MAX(versionNo),0)+1 AS n FROM PpmTemplateVersion WHERE ppmFormId=?', array($form))['n'];
            $id = Ppms_values::id();
            $metadata = $this->metadata($source);
            $metadata = array_replace($metadata, $this->metadata($input));
            $this->store->insert('PpmTemplateVersion', array('id' => $id, 'ppmFormId' => $form, 'versionNo' => $next,
                'versionLabel' => isset($input['versionLabel']) ? Ppms_values::text($input, 'versionLabel') : 'Copy of version '.$source['versionNo'],
                'definitionJson' => Ppms_values::json($source['definitionJson']), 'updatedAt' => Ppms_values::now()) + $metadata);
            foreach ($this->store->rows('SELECT * FROM TraceCodeRule WHERE templateVersionId=?', array($source['id'])) as $rule) {
                $rule['id'] = Ppms_values::id();
                $rule['templateVersionId'] = $id;
                $rule['configurationJson'] = Ppms_values::json($rule['configurationJson']);
                unset($rule['createdAt']);
                $rule['updatedAt'] = Ppms_values::now();
                $this->store->insert('TraceCodeRule', $rule);
            }
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmTemplateVersion', $id, array('copiedFrom' => $source['id'], 'versionNo' => $next), array('ppmFormId' => $form));
            return $this->view($this->find($id));
        });
    }
    private function metadata($input)
    {
        $values = array();
        foreach (array('documentNumber','revisionNumber','seriesNumber','pageNumber','sourceFileName','sourceFileHash') as $key) {
            if (!array_key_exists($key, $input)) { continue; }
            $value = $input[$key];
            $values[$key] = $value === NULL || $value === '' ? NULL : Ppms_values::text($input, $key, 512);
            if ($key === 'sourceFileHash' && $values[$key] !== NULL && !preg_match('/^[a-fA-F0-9]{64}$/D', $values[$key])) { throw new Ppms_problem('INVALID_SOURCE_FILE_HASH'); }
        }
        return $values;
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
        $row['editHash'] = $this->editHash($row);
        return $row;
    }
    /** Compare the whole reviewed draft while the caller holds its form lock. */
    public function assertEditHash($row, $input)
    {
        $expected = $input['expectedEditHash'] ?? NULL;
        if (!is_string($expected) || !preg_match('/^[a-f0-9]{64}$/D', $expected)) {
            throw new Ppms_problem('TEMPLATE_PRECONDITION_REQUIRED', 428, array('field' => 'expectedEditHash'));
        }
        if (!hash_equals($this->editHash($row), $expected)) {
            throw new Ppms_problem('TEMPLATE_CHANGED', 409, array('templateId' => $row['id']));
        }
    }
    /** Definition hashes remain schema-only; edit hashes also protect metadata and rules. */
    public function editHash($row, $rules = NULL)
    {
        $values = array();
        foreach (array('id','ppmFormId','versionNo','definitionJson','versionLabel','documentNumber','revisionNumber','seriesNumber','pageNumber','sourceFileName','sourceFileHash') as $key) {
            $values[$key] = $row[$key] ?? NULL;
        }
        if ($rules === NULL) {
            $rules = $this->store->rows('SELECT * FROM TraceCodeRule WHERE templateVersionId=? ORDER BY outputKey', array($row['id']));
        }
        $values['rules'] = array();
        foreach ($rules as $rule) {
            $content = array();
            foreach (array('outputKey','outputLabel','status','sourceType','formulaTemplate','resetPeriod','sequencePadding','requiresUniqueBusinessCode','configurationJson') as $key) {
                $content[$key] = $rule[$key] ?? NULL;
            }
            $values['rules'][] = $content;
        }
        return Ppms_values::hash($values);
    }
}
