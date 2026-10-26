<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

/** Configured, revision-specific trace relationships and publication. */
class Ppms_trace_service
{
    private $store;
    private $auth;
    private $devices;
    private $validator;
    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->library(array('ppms_auth_service','ppms_device_service','ppms_form_validator'));
        $this->store = $ci->ppms_store;
        $this->auth = $ci->ppms_auth_service;
        $this->devices = $ci->ppms_device_service;
        $this->validator = $ci->ppms_form_validator;
    }
    public function rules($actor, $templateId, $input)
    {
        $this->auth->admin($actor);
        $rules = $input['rules'] ?? NULL;
        if (!is_array($rules) || count($rules) > 100) { throw new Ppms_problem('INVALID_TRACE_RULES'); }
        $initial = $this->store->row('SELECT ppmFormId FROM PpmTemplateVersion WHERE id=?', array($templateId));
        if (!$initial) { throw new Ppms_problem('TEMPLATE_NOT_FOUND', 404); }
        return $this->store->transaction(function () use ($actor, $templateId, $rules, $initial) {
            $this->store->lockForm($initial['ppmFormId']);
            $template = $this->store->row('SELECT * FROM PpmTemplateVersion WHERE id=?', array($templateId));
            if ($template['publishedAt']) { throw new Ppms_problem('PUBLISHED_TEMPLATE_IMMUTABLE', 409); }
            $this->store->execute('DELETE FROM TraceCodeRule WHERE templateVersionId=?', array($templateId));
            $keys = array();
            foreach ($rules as $raw) {
                $rule = (array) Ppms_values::object($raw);
                $key = Ppms_values::text($rule, 'outputKey', 128);
                if (!preg_match('/^[A-Za-z][A-Za-z0-9_-]*$/D', $key) || isset($keys[$key])) { throw new Ppms_problem('INVALID_OUTPUT_KEY'); }
                $keys[$key] = TRUE;
                $source = Ppms_values::text($rule, 'sourceType');
                $status = Ppms_values::text($rule, 'status');
                $period = $rule['resetPeriod'] ?? 'NONE';
                if (!in_array($source, array('SYSTEM_GENERATED','MANUAL_EXTERNAL','SCAN_EXTERNAL','UPSTREAM_LOOKUP','PENDING_RULE'), TRUE)
                    || !in_array($status, array('ACTIVE','RESERVED','PENDING_VALIDATION','DISABLED'), TRUE)
                    || !in_array($period, array('NONE','DAILY','MONTHLY','YEARLY'), TRUE)) { throw new Ppms_problem('INVALID_TRACE_RULE'); }
                if ($status === 'ACTIVE' && $source === 'PENDING_RULE') { throw new Ppms_problem('PENDING_RULE_CANNOT_BE_ACTIVE'); }
                $config = $rule['configurationJson'] ?? new stdClass();
                $this->configuration($config);
                if ($source === 'SYSTEM_GENERATED') { Ppms_values::text($rule, 'formulaTemplate', 2000); }
                $padding = $rule['sequencePadding'] ?? 0;
                if (!is_int($padding) || $padding < 0 || $padding > 12) { throw new Ppms_problem('INVALID_SEQUENCE_PADDING'); }
                if (isset($rule['requiresUniqueBusinessCode']) && !is_bool($rule['requiresUniqueBusinessCode'])) { throw new Ppms_problem('INVALID_UNIQUENESS_FLAG'); }
                $this->store->insert('TraceCodeRule', array('id' => Ppms_values::id(), 'templateVersionId' => $templateId,
                    'outputKey' => $key, 'outputLabel' => Ppms_values::text($rule, 'outputLabel', 512), 'status' => $status,
                    'sourceType' => $source, 'formulaTemplate' => $rule['formulaTemplate'] ?? NULL, 'resetPeriod' => $period,
                    'sequencePadding' => $padding, 'requiresUniqueBusinessCode' => (int) ($rule['requiresUniqueBusinessCode'] ?? FALSE),
                    'configurationJson' => Ppms_values::json($config), 'updatedAt' => Ppms_values::now()));
            }
            $this->store->audit($actor, 'CONFIG_CHANGE', 'TraceCodeRule', $templateId, array('outputKeys' => array_keys($keys)), array('ppmFormId' => $template['ppmFormId']));
            return array('items' => $this->store->rows('SELECT * FROM TraceCodeRule WHERE templateVersionId=? ORDER BY outputKey', array($templateId)));
        });
    }
    public function connection($actor, $target, $input)
    {
        $this->auth->admin($actor);
        $source = Ppms_values::text($input, 'sourcePpmFormId');
        $output = Ppms_values::text($input, 'sourceOutputKey', 128);
        $field = Ppms_values::text($input, 'targetInputKey', 191);
        $name = Ppms_values::text($input, 'connectionName', 512);
        $status = Ppms_values::text($input, 'status');
        $approval = $input['requiresApprovalBeforeUse'] ?? FALSE;
        if (!is_bool($approval) || !in_array($status, array('ACTIVE','RESERVED','PENDING_VALIDATION','DISABLED'), TRUE)) { throw new Ppms_problem('INVALID_CONNECTION'); }
        $this->safePath($field);
        return $this->store->transaction(function () use ($actor, $target, $source, $output, $field, $name, $status, $approval) {
            // Stable form ordering avoids opposite-edge configuration deadlocks.
            $forms = array_unique(array($source, $target)); sort($forms, SORT_STRING);
            foreach ($forms as $form) { $this->store->lockForm($form); }
            if ($status === 'ACTIVE') {
                $template = $this->store->row('SELECT definitionJson FROM PpmTemplateVersion WHERE ppmFormId=? AND isActive=1 AND publishedAt IS NOT NULL', array($target));
                $paths = $template ? $this->fieldPaths($this->validator->fields($template['definitionJson'])) : array();
                if (!in_array($field, $paths, TRUE)) { throw new Ppms_problem('TARGET_INPUT_NOT_DEFINED'); }
                if (!$this->store->row('SELECT r.id FROM TraceCodeRule r JOIN PpmTemplateVersion t ON t.id=r.templateVersionId WHERE t.ppmFormId=? AND t.isActive=1 AND r.outputKey=? AND r.status=\'ACTIVE\'', array($source, $output))) { throw new Ppms_problem('SOURCE_OUTPUT_NOT_DEFINED'); }
            }
            $id = Ppms_values::id();
            $this->store->execute('INSERT INTO PpmTraceConnection (id,sourcePpmFormId,sourceOutputKey,targetPpmFormId,targetInputKey,connectionName,status,requiresApprovalBeforeUse,updatedAt)
                VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE connectionName=VALUES(connectionName),status=VALUES(status),requiresApprovalBeforeUse=VALUES(requiresApprovalBeforeUse),updatedAt=UTC_TIMESTAMP(3)',
                array($id, $source, $output, $target, $field, $name, $status, (int) $approval));
            $row = $this->store->row('SELECT * FROM PpmTraceConnection WHERE sourcePpmFormId=? AND sourceOutputKey=? AND targetPpmFormId=? AND targetInputKey=?', array($source, $output, $target, $field));
            $this->store->audit($actor, 'CONFIG_CHANGE', 'PpmTraceConnection', $row['id'], $row, array('ppmFormId' => $target));
            return $row;
        });
    }
    public function link($actor, $form, $revisionId, $data, $definition, $selections, $previousRevisionId, $context, $write = TRUE)
    {
        if (!is_array($selections) || count($selections) > 1000) { throw new Ppms_problem('INVALID_TRACE_SELECTIONS'); }
        $connections = $this->store->rows('SELECT * FROM PpmTraceConnection WHERE targetPpmFormId=? AND status=\'ACTIVE\' ORDER BY id', array($form));
        $required = $this->fieldPaths($this->validator->fields($definition), '', TRUE);
        foreach ($connections as $connection) { $required[] = $connection['targetInputKey']; }
        $chosen = array();
        foreach ($selections as $raw) {
            $selection = (array) Ppms_values::object($raw);
            $path = Ppms_values::text($selection, 'inputPath');
            $this->safePath($path);
            if (isset($chosen[$path])) { throw new Ppms_problem('DUPLICATE_TRACE_SELECTION'); }
            $chosen[$path] = $selection;
        }
        if ($previousRevisionId) {
            foreach ($this->store->rows('SELECT * FROM PpmTraceLink WHERE downstreamRevisionId=? AND isActive=1', array($previousRevisionId)) as $old) {
                if (!isset($chosen[$old['downstreamInputKey']])) {
                    $chosen[$old['downstreamInputKey']] = array('connectionId' => $old['connectionId'], 'sourceTraceOutputId' => $old['sourceTraceOutputId'], 'inputPath' => $old['downstreamInputKey']);
                }
            }
        }
        $paths = array();
        foreach (array_unique($required) as $pattern) { $paths = array_merge($paths, $this->paths($data, $pattern)); }
        foreach ($chosen as $path => $selection) {
            if ($this->read($data, $path) !== NULL && !in_array($path, $paths, TRUE)) { throw new Ppms_problem('TRACE_INPUT_NOT_CONFIGURED'); }
        }
        foreach (array_unique($paths) as $path) {
            $value = $this->read($data, $path);
            if ($value === NULL || $value === '') { continue; }
            if (!isset($chosen[$path])) { throw new Ppms_problem('TRACE_SELECTION_REQUIRED', 422, array('field' => $path)); }
            $selection = $chosen[$path];
            $connection = $this->store->row('SELECT * FROM PpmTraceConnection WHERE id=? AND targetPpmFormId=? AND status=\'ACTIVE\'', array(Ppms_values::text($selection, 'connectionId'), $form));
            $pattern = preg_replace('/\.\d+(?=\.|$)/', '[]', $path);
            if (!$connection || $connection['targetInputKey'] !== $pattern) { throw new Ppms_problem('TRACE_CONNECTION_INVALID'); }
            // Review status and legacy approval flags are advisory metadata.
            $output = $this->store->row('SELECT o.*,t.ppmFormId,r.archivedAt,f.status AS formStatus
                FROM PpmTraceOutput o JOIN PpmRecord r ON r.id=o.recordId JOIN PpmTemplateVersion t ON t.id=r.templateVersionId
                JOIN PpmForm f ON f.id=t.ppmFormId WHERE o.id=? FOR UPDATE', array(Ppms_values::text($selection, 'sourceTraceOutputId')));
            if (!$output || !in_array($output['status'], array('PUBLISHED','LINKED_DOWNSTREAM'), TRUE) || $output['archivedAt'] || $output['formStatus'] !== 'ACTIVE'
                || $output['recordId'] === ($context['recordId'] ?? NULL) || $this->hasPendingImpact($output['recordId'])
                || $output['ppmFormId'] !== $connection['sourcePpmFormId'] || $output['outputKey'] !== $connection['sourceOutputKey']
                || $output['outputCode'] !== $value) {
                throw new Ppms_problem('TRACE_OUTPUT_INELIGIBLE');
            }
            if (!$write) { continue; }
            $id = Ppms_values::id();
            $this->store->insert('PpmTraceLink', array('id' => $id, 'connectionId' => $connection['id'], 'sourceTraceOutputId' => $output['id'],
                'downstreamRevisionId' => $revisionId, 'downstreamInputKey' => $path, 'selectedById' => $actor['id']));
            $this->store->execute('UPDATE PpmTraceOutput SET status=\'LINKED_DOWNSTREAM\' WHERE id=?', array($output['id']));
            $this->store->audit($actor, 'CREATE_TRACE_LINK', 'PpmTraceLink', $id, array('sourceTraceOutputId' => $output['id'], 'sourceRevisionId' => $output['revisionId'], 'inputPath' => $path), $context);
        }
    }
    public function publish($actor, $recordId, $input)
    {
        $initial = $this->store->row('SELECT t.ppmFormId FROM PpmRecord r JOIN PpmTemplateVersion t ON t.id=r.templateVersionId WHERE r.id=?', array($recordId));
        if (!$initial) { throw new Ppms_problem('RECORD_NOT_FOUND', 404); }
        return $this->store->transaction(function () use ($actor, $recordId, $input, $initial) {
            $this->store->lockForm($initial['ppmFormId']);
            $this->auth->access($actor, $initial['ppmFormId'], 'canPublish');
            $this->devices->lease($initial['ppmFormId'], Ppms_values::text($input, 'deviceId'), Ppms_values::integer($input, 'leaseVersion', 1));
            $record = $this->store->row('SELECT * FROM PpmRecord WHERE id=?', array($recordId)) + $initial;
            if ($record['currentRevisionNo'] !== Ppms_values::integer($input, 'baseRevisionNo', 1)) { throw new Ppms_problem('REVISION_CHANGED', 409); }
            if ($record['archivedAt'] || !in_array($record['status'], array('SUBMITTED','FSQA_APPROVED','SUPERVISOR_APPROVED','CLOSED'), TRUE)) { throw new Ppms_problem('RECORD_NOT_PUBLISHABLE', 409); }
            if ($this->hasPendingImpact($recordId)) { throw new Ppms_problem('REVALIDATION_REQUIRED', 409); }
            $revision = $this->store->row('SELECT * FROM PpmRecordRevision WHERE recordId=? AND revisionNo=?', array($recordId, $record['currentRevisionNo']));
            $definition = $this->store->row('SELECT definitionJson FROM PpmTemplateVersion WHERE id=?', array($record['templateVersionId']))['definitionJson'];
            $this->validator->payload($definition, $revision['dataJson'], TRUE);
            $this->link($actor, $record['ppmFormId'], $revision['id'], $revision['dataJson'], $definition, array(), $revision['id'],
                array('recordId' => $recordId), FALSE);
            $existing = $this->store->rows('SELECT * FROM PpmTraceOutput WHERE revisionId=? ORDER BY outputKey,sourcePath', array($revision['id']));
            if ($existing) { return array('outputs' => $existing); }
            $rules = $this->store->rows('SELECT * FROM TraceCodeRule WHERE templateVersionId=? AND status=\'ACTIVE\' ORDER BY outputKey', array($record['templateVersionId']));
            if (!$rules) { throw new Ppms_problem('NO_ACTIVE_TRACE_RULE'); }
            foreach ($rules as $rule) { $this->publishRule($actor, $record, $revision, $rule, $input); }
            return array('outputs' => $this->store->rows('SELECT * FROM PpmTraceOutput WHERE revisionId=? ORDER BY outputKey,sourcePath', array($revision['id'])));
        });
    }
    private function publishRule($actor, $record, $revision, $rule, $input)
    {
        $config = $rule['configurationJson'] ?? new stdClass();
        $this->configuration($config);
        if ($rule['sourceType'] === 'PENDING_RULE') { throw new Ppms_problem('TRACE_RULE_NOT_PUBLISHABLE'); }
        $pattern = $config->outputPath ?? $rule['outputKey'];
        $paths = strpos($pattern, '[]') === FALSE && $rule['sourceType'] === 'SYSTEM_GENERATED' ? array('$') : $this->paths($revision['dataJson'], $pattern);
        if (!$paths) { throw new Ppms_problem('TRACE_RULE_OUTPUT_MISSING'); }
        foreach ($paths as $path) {
            $sequence = NULL;
            $bindings = $config->bindings ?? new stdClass();
            if ($rule['sourceType'] === 'SYSTEM_GENERATED') {
                $formula = $rule['formulaTemplate'];
                if (!is_string($formula) || $formula === '') { throw new Ppms_problem('INVALID_TRACE_FORMULA'); }
                $values = array();
                $code = preg_replace_callback('/\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/', function ($match) use (&$values, &$sequence, $bindings, $record, $revision, $rule, $pattern, $path) {
                    $token = $match[1];
                    if (isset($values[$token])) { return $values[$token]; }
                    $binding = $bindings->$token ?? new stdClass();
                    if (is_string($binding)) { $binding = (object) array('source' => 'DATA', 'path' => $binding); }
                    $source = $binding->source ?? ($token === 'sequence' ? 'SEQUENCE' : (strpos($token, 'record.') === 0 ? 'RECORD' : 'DATA'));
                    if ($source === 'SEQUENCE') {
                        if ($sequence === NULL) { $sequence = $this->sequence($rule, substr($record['productionDate'], 0, 10)); }
                        return $values[$token] = str_pad((string) $sequence, (int) ($rule['sequencePadding'] ?? 0), '0', STR_PAD_LEFT);
                    }
                    $bindingPath = $binding->path ?? preg_replace('/^(record|data)\./', '', $token);
                    $bindingPath = $this->aligned($bindingPath, $path);
                    if ($source === 'RECORD' && !in_array($bindingPath, array('id','productionDate','shiftCode','batchNo','lotNo'), TRUE)) { throw new Ppms_problem('INVALID_RECORD_BINDING'); }
                    $value = $source === 'LITERAL' ? ($binding->value ?? NULL) : $this->read($source === 'RECORD' ? (object) $record : $revision['dataJson'], $bindingPath);
                    if (isset($binding->dateOffsetDays) || isset($binding->dateOffsetMonths)) {
                        $date = $this->parseDate($value);
                        $value = $date->modify(sprintf('%+d months %+d days', $binding->dateOffsetMonths ?? 0, $binding->dateOffsetDays ?? 0))->format('Y-m-d');
                    }
                    return $values[$token] = $this->render($value, $binding->format ?? 'RAW');
                }, $formula);
                if (strpos($code, '{{') !== FALSE || strpos($code, '}}') !== FALSE) { throw new Ppms_problem('INVALID_TRACE_FORMULA'); }
            } else {
                $code = $this->render($this->read($revision['dataJson'], $path), $config->outputFormat ?? 'RAW');
                if ($rule['sourceType'] === 'UPSTREAM_LOOKUP' && !$this->store->row('SELECT id FROM PpmTraceLink WHERE downstreamRevisionId=? AND downstreamInputKey=?', array($revision['id'], $path))) { throw new Ppms_problem('UPSTREAM_TRACE_LINK_REQUIRED'); }
            }
            $code = trim($code);
            if ($code === '' || mb_strlen($code) > 191) { throw new Ppms_problem('TRACE_CODE_INVALID'); }
            if ((int) $rule['requiresUniqueBusinessCode'] && $this->store->row('SELECT o.id FROM PpmTraceOutput o JOIN PpmRecord r ON r.id=o.recordId JOIN PpmTemplateVersion t ON t.id=r.templateVersionId
                WHERE t.ppmFormId=? AND o.outputKey=? AND o.outputCode=? AND (o.recordId<>? OR (o.revisionId=? AND o.sourcePath<>?)) LIMIT 1',
                array($record['ppmFormId'], $rule['outputKey'], $code, $record['id'], $revision['id'], $path))) { throw new Ppms_problem('TRACE_CODE_ALREADY_USED', 409); }
            $quantity = isset($config->quantityPath) ? $this->read($revision['dataJson'], $this->aligned($config->quantityPath, $path)) : NULL;
            if (isset($config->quantityPath) && ((!is_int($quantity) && !is_float($quantity)) || !is_finite((float) $quantity) || $quantity < 0)) { throw new Ppms_problem('INVALID_TRACE_QUANTITY'); }
            $unit = isset($config->unitPath) ? $this->render($this->read($revision['dataJson'], $this->aligned($config->unitPath, $path)), 'RAW') : ($config->unit ?? NULL);
            $id = Ppms_values::id();
            $this->store->insert('PpmTraceOutput', array('id' => $id, 'recordId' => $record['id'], 'revisionId' => $revision['id'], 'codeRuleId' => $rule['id'],
                'outputKey' => $rule['outputKey'], 'outputCode' => $code, 'sourcePath' => $path, 'quantity' => $quantity, 'unit' => $unit,
                'outputType' => $config->outputType ?? $rule['sourceType'], 'createdById' => $actor['id'],
                'sourceSnapshotJson' => Ppms_values::json(array('dataHash' => $revision['dataHash'], 'sequence' => $sequence, 'sourcePath' => $path))));
            $output = $this->store->row('SELECT * FROM PpmTraceOutput WHERE id=?', array($id));
            $this->store->event($record['ppmFormId'], 'TRACE_OUTPUT_PUBLISHED', $this->outputView($output), $record['id'], $revision['id'], $rule['outputKey']);
            $this->store->audit($actor, 'PUBLISH_CODE', 'PpmTraceOutput', $id, $this->outputView($output), array('recordId' => $record['id'], 'ppmFormId' => $record['ppmFormId'], 'deviceId' => $input['deviceId'], 'baseRevisionNo' => $record['currentRevisionNo']));
        }
    }
    public function retire($actor, $record, $newRevisionId, $reason, $context)
    {
        $queue = array($record);
        $visited = array();
        $rootHadOutputs = FALSE;
        while ($queue) {
            $current = array_shift($queue);
            if (isset($visited[$current['id']])) { continue; }
            $visited[$current['id']] = TRUE;
            // Every form's feed sequence is allocated while holding its form lock.
            // InnoDB deadlocks from competing dependency traversals are retried.
            $this->store->lockForm($current['ppmFormId']);
            $outputs = $this->store->rows('SELECT * FROM PpmTraceOutput WHERE recordId=? AND status IN (\'PUBLISHED\',\'LINKED_DOWNSTREAM\') FOR UPDATE', array($current['id']));
            if ($current['id'] === $record['id']) { $rootHadOutputs = (bool) $outputs; }
            $affected = array();
            foreach ($outputs as $output) {
                $this->store->execute('UPDATE PpmTraceOutput SET status=\'SUPERSEDED\' WHERE id=?', array($output['id']));
                $output['status'] = 'SUPERSEDED';
                $this->store->event($current['ppmFormId'], 'TRACE_OUTPUT_RETIRED', $this->outputView($output), $current['id'], $output['revisionId'], $output['outputKey']);
                // Locking reads see links committed by a transaction we waited for.
                $links = $this->store->rows('SELECT l.id,r.id AS recordId,a.ppmFormId FROM PpmTraceLink l JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId
                    JOIN PpmRecord r ON r.id=v.recordId AND r.currentRevisionNo=v.revisionNo JOIN AreaPpmAssignment a ON a.id=r.areaPpmAssignmentId
                    WHERE l.sourceTraceOutputId=? AND l.isActive=1 FOR UPDATE', array($output['id']));
                foreach ($links as $link) {
                    $affected[] = $link['id'];
                    if (!isset($visited[$link['recordId']])) { $queue[] = array('id' => $link['recordId'], 'ppmFormId' => $link['ppmFormId']); }
                }
            }
            if ($affected) {
                $id = Ppms_values::id();
                $this->store->insert('TraceRevalidation', array('id' => $id, 'triggerRevisionId' => $newRevisionId, 'reason' => $reason));
                foreach (array_unique($affected) as $link) { $this->store->insert('TraceRevalidationItem', array('id' => Ppms_values::id(), 'revalidationId' => $id, 'traceLinkId' => $link)); }
                $this->store->audit($actor, 'REVALIDATION_CREATED', 'TraceRevalidation', $id, array('affectedLinks' => count($affected), 'reason' => $reason), $context);
            }
        }
        return $rootHadOutputs;
    }
    public function hasPendingImpact($recordId)
    {
        return (bool) $this->store->row('SELECT i.id FROM TraceRevalidationItem i JOIN PpmTraceLink l ON l.id=i.traceLinkId
            JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId WHERE v.recordId=? AND i.status<>\'RESOLVED\' LIMIT 1', array($recordId));
    }
    public function outputView($row)
    {
        return array_intersect_key($row, array_flip(array('id','recordId','revisionId','outputKey','outputCode','sourcePath','outputType','quantity','unit','status','publishedAt')));
    }
    public function fieldPaths($fields, $prefix = '', $traceOnly = FALSE)
    {
        $result = array();
        foreach ($fields as $field) {
            $path = $prefix.$field->key;
            if (in_array($field->type, array('repeatable','table','group'), TRUE)) {
                $result = array_merge($result, $this->fieldPaths($field->fields, $path.($field->type === 'group' ? '.' : '[].'), $traceOnly));
            } elseif (!$traceOnly || $field->type === 'trace-code') { $result[] = $path; }
        }
        return $result;
    }
    public function paths($data, $pattern)
    {
        $this->safePath($pattern);
        $position = strpos($pattern, '[]');
        if ($position === FALSE) { return array($pattern); }
        $prefix = substr($pattern, 0, $position);
        $rows = $this->read($data, $prefix);
        $result = array();
        if (is_array($rows)) {
            foreach (array_keys($rows) as $index) {
                $concrete = $prefix.'.'.$index.substr($pattern, $position + 2);
                $result = array_merge($result, $this->paths($data, $concrete));
            }
        }
        return $result;
    }
    public function read($data, $path)
    {
        $this->safePath($path);
        foreach (explode('.', $path) as $part) {
            if (is_object($data)) { $data = $data->$part ?? NULL; }
            elseif (is_array($data) && ctype_digit($part)) { $data = $data[(int) $part] ?? NULL; }
            else { return NULL; }
        }
        return $data;
    }
    private function safePath($path)
    {
        if (!is_string($path) || strlen($path) > 191 || !preg_match('/^[A-Za-z][A-Za-z0-9_-]*(?:(?:\[\])|\.(?:[A-Za-z][A-Za-z0-9_-]*|\d+))*$/D', $path)) { throw new Ppms_problem('INVALID_DATA_PATH'); }
    }
    private function aligned($pattern, $concrete)
    {
        preg_match_all('/\.(\d+)(?=\.|$)/', $concrete, $matches);
        $indexes = $matches[1];
        return preg_replace_callback('/\[\]/', function () use (&$indexes) { return '.'.array_shift($indexes); }, $pattern);
    }
    private function configuration($config)
    {
        Ppms_values::object($config);
        foreach (array('outputPath','quantityPath','unitPath') as $key) { if (isset($config->$key)) { $this->safePath($config->$key); } }
        $bindings = $config->bindings ?? new stdClass();
        Ppms_values::object($bindings);
        foreach (get_object_vars($bindings) as $binding) {
            if (is_string($binding)) { $this->safePath($binding); continue; }
            Ppms_values::object($binding);
            if (isset($binding->path)) { $this->safePath($binding->path); }
            if (isset($binding->source) && !in_array($binding->source, array('DATA','RECORD','LITERAL','SEQUENCE'), TRUE)) { throw new Ppms_problem('INVALID_TRACE_BINDING'); }
            if (isset($binding->format)) { $this->render('2026-01-01', $binding->format); }
            foreach (array('dateOffsetDays' => 3660, 'dateOffsetMonths' => 120) as $key => $max) {
                if (isset($binding->$key) && (!is_int($binding->$key) || abs($binding->$key) > $max)) { throw new Ppms_problem('INVALID_DATE_OFFSET'); }
            }
        }
    }
    private function sequence($rule, $date)
    {
        $period = array('NONE' => 'ALL', 'DAILY' => $date, 'MONTHLY' => substr($date, 0, 7), 'YEARLY' => substr($date, 0, 4))[$rule['resetPeriod']];
        $this->store->execute('INSERT IGNORE INTO CodeSequence (id,codeRuleId,periodKey,currentValue,updatedAt) VALUES (?,?,?,0,UTC_TIMESTAMP(3))', array(Ppms_values::id(), $rule['id'], $period));
        $row = $this->store->row('SELECT * FROM CodeSequence WHERE codeRuleId=? AND periodKey=? FOR UPDATE', array($rule['id'], $period));
        $next = (int) $row['currentValue'] + 1;
        $this->store->execute('UPDATE CodeSequence SET currentValue=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array($next, $row['id']));
        return $next;
    }
    private function parseDate($value)
    {
        if (!is_string($value)) { throw new Ppms_problem('INVALID_TRACE_DATE'); }
        Ppms_values::date(substr($value, 0, 10));
        return new DateTimeImmutable(substr($value, 0, 10), new DateTimeZone('UTC'));
    }
    private function render($value, $format)
    {
        if ($value === NULL || !is_scalar($value) || $value === '') { throw new Ppms_problem('TRACE_RULE_INPUT_MISSING'); }
        $text = is_bool($value) ? ($value ? 'true' : 'false') : (string) $value;
        switch ($format) {
            case 'RAW': return $text;
            case 'TRIM': return trim($text);
            case 'UPPERCASE': return mb_strtoupper(trim($text));
            case 'LOWERCASE': return mb_strtolower(trim($text));
            case 'INITIAL': return mb_strtoupper(mb_substr(trim($text), 0, 1));
            case 'YYYYMMDD': return $this->parseDate($value)->format('Ymd');
            case 'DDMMYY': return $this->parseDate($value)->format('dmy');
            case 'MMDDYY': return $this->parseDate($value)->format('mdy');
            case 'DDMMMYY': return strtoupper($this->parseDate($value)->format('dMy'));
            default: throw new Ppms_problem('INVALID_TRACE_FORMAT');
        }
    }
}
