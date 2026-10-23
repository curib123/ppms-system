<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

class Ppms_record_service
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
    public function find($id)
    {
        $record = $this->store->row('SELECT r.*,a.ppmFormId FROM PpmRecord r JOIN AreaPpmAssignment a ON a.id=r.areaPpmAssignmentId WHERE r.id=?', array($id));
        if (!$record) { throw new Ppms_problem('RECORD_NOT_FOUND', 404); }
        return $record;
    }
    public function view($actor, $id)
    {
        $record = $this->find($id);
        $this->auth->access($actor, $record['ppmFormId']);
        return array('record' => $record, 'revision' => $this->revision($record),
            'revisions' => $this->store->rows('SELECT * FROM PpmRecordRevision WHERE recordId=? ORDER BY revisionNo', array($id)),
            'traceLinks' => $this->store->rows('SELECT l.* FROM PpmTraceLink l JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId WHERE v.recordId=? ORDER BY v.revisionNo,l.id', array($id)));
    }
    public function revision($record)
    {
        return $this->store->row('SELECT * FROM PpmRecordRevision WHERE recordId=? AND revisionNo=?', array($record['id'], $record['currentRevisionNo']));
    }
    /** Caller holds the form lock and owns the transaction and mutation receipt. */
    public function apply($actor, $form, $mutation, $context)
    {
        $operation = $mutation['operationType'];
        $id = $mutation['recordId'];
        $base = $mutation['baseRevisionNo'];
        $this->auth->access($actor, $form, $operation === 'CREATE_DRAFT' ? 'canCreate' : 'canEdit');
        if ($operation === 'CONFLICT_RESOLUTION') { return $this->resolve($actor, $form, $mutation, $context); }
        if ($operation === 'CREATE_DRAFT') {
            if ($base !== 0) { throw new Ppms_problem('NEW_RECORD_BASE_MUST_BE_ZERO'); }
            if ($this->store->row('SELECT id FROM PpmRecord WHERE id=?', array($id))) { throw new Ppms_problem('RECORD_ALREADY_EXISTS', 409); }
            $templateId = Ppms_values::text($mutation, 'templateVersionId');
            $assignmentId = Ppms_values::text($mutation, 'areaPpmAssignmentId');
            $date = Ppms_values::date($mutation['productionDate'] ?? NULL);
            $template = $this->store->row('SELECT * FROM PpmTemplateVersion WHERE id=? AND ppmFormId=? AND publishedAt IS NOT NULL
                AND isActive=1 AND (effectiveFrom IS NULL OR effectiveFrom<=UTC_TIMESTAMP(3)) AND (effectiveTo IS NULL OR effectiveTo>UTC_TIMESTAMP(3))', array($templateId, $form));
            if (!$template) { throw new Ppms_problem('TEMPLATE_STALE_OR_UNPUBLISHED', 409); }
            $assignment = $this->store->row('SELECT a.id FROM AreaPpmAssignment a JOIN ProductionArea p ON p.id=a.areaId
                WHERE a.id=? AND a.ppmFormId=? AND a.isActive=1 AND p.status=\'ACTIVE\'
                AND a.effectiveFrom<? AND (a.effectiveTo IS NULL OR a.effectiveTo>?)', array($assignmentId, $form, $date.' 23:59:59.999', $date.' 00:00:00'));
            if (!$assignment) { throw new Ppms_problem('AREA_ASSIGNMENT_INVALID', 403); }
            $data = $mutation['dataJson'] ?? new stdClass();
            $this->validator->payload($template['definitionJson'], $data);
            $this->store->insert('PpmRecord', array('id' => $id, 'areaPpmAssignmentId' => $assignmentId,
                'templateVersionId' => $templateId, 'productionDate' => $date.' 00:00:00',
                'shiftCode' => isset($mutation['shiftCode']) ? Ppms_values::text($mutation, 'shiftCode') : NULL,
                'batchNo' => isset($mutation['batchNo']) ? Ppms_values::text($mutation, 'batchNo') : NULL,
                'lotNo' => isset($mutation['lotNo']) ? Ppms_values::text($mutation, 'lotNo') : NULL,
                'createdById' => $actor['id'], 'updatedAt' => Ppms_values::now()));
            $previous = NULL;
            $revisionNo = 1;
        } else {
            $record = $this->find($id);
            if ($record['ppmFormId'] !== $form) { throw new Ppms_problem('RECORD_FORM_MISMATCH', 403); }
            if ($base !== $record['currentRevisionNo']) {
                return $this->conflict($actor, $record, $mutation, $context);
            }
            if ($record['status'] !== 'ACTIVE' || $record['archivedAt']) { throw new Ppms_problem('RECORD_NOT_EDITABLE', 409); }
            if (isset($mutation['templateVersionId']) && $mutation['templateVersionId'] !== $record['templateVersionId']) { throw new Ppms_problem('RECORD_TEMPLATE_PINNED', 409); }
            $previous = $this->revision($record);
            $data = $operation === 'QUEUE_SUBMIT' ? $previous['dataJson'] : ($mutation['dataJson'] ?? NULL);
            $template = $this->store->row('SELECT * FROM PpmTemplateVersion WHERE id=? AND publishedAt IS NOT NULL', array($record['templateVersionId']));
            if (!$template) { throw new Ppms_problem('TEMPLATE_UNAVAILABLE', 409); }
            $this->validator->payload($template['definitionJson'], $data, $operation === 'QUEUE_SUBMIT', $previous['dataJson']);
            $revisionNo = $record['currentRevisionNo'] + 1;
        }
        $revisionId = Ppms_values::id();
        $submitted = $operation === 'QUEUE_SUBMIT';
        $this->store->insert('PpmRecordRevision', array('id' => $revisionId, 'recordId' => $id, 'revisionNo' => $revisionNo,
            'status' => $submitted ? 'SUBMITTED' : 'DRAFT', 'dataJson' => Ppms_values::json($data),
            'dataHash' => Ppms_values::hash($data), 'createdById' => $actor['id'], 'submittedAt' => $submitted ? Ppms_values::now() : NULL));
        if ($previous) {
            foreach ($this->changes($previous['dataJson'], $data) as $change) {
                $this->store->insert('RevisionChange', array('id' => Ppms_values::id(), 'oldRevisionId' => $previous['id'], 'newRevisionId' => $revisionId,
                    'fieldPath' => $change['path'], 'beforeValueJson' => Ppms_values::json($change['before']),
                    'afterValueJson' => Ppms_values::json($change['after']), 'reason' => 'Synchronized record revision'));
            }
        }
        $this->store->execute('UPDATE PpmRecord SET currentRevisionNo=?,status=?,updatedAt=UTC_TIMESTAMP(3),submittedAt=? WHERE id=?',
            array($revisionNo, $submitted ? 'SUBMITTED' : 'ACTIVE', $submitted ? Ppms_values::now() : NULL, $id));
        if ($submitted) {
            $this->store->insert('WorkflowEvent', array('id' => Ppms_values::id(), 'recordId' => $id, 'revisionId' => $revisionId, 'action' => 'SUBMIT', 'actorId' => $actor['id']));
        }
        $result = array('status' => 'APPLIED', 'recordId' => $id, 'revisionId' => $revisionId, 'revisionNo' => $revisionNo);
        $context['recordId'] = $id;
        $this->store->audit($actor, 'SYNC_APPLIED', 'PpmRecord', $id, $result, $context);
        $this->store->event($form, 'RECORD_REVISION', $this->view($actor, $id), $id, $revisionId);
        return $result;
    }
    private function conflict($actor, $record, $mutation, $context)
    {
        $conflictId = Ppms_values::id();
        $data = $mutation['dataJson'] ?? new stdClass();
        $changes = $this->changes($this->revision($record)['dataJson'], $data);
        $this->store->insert('SyncConflict', array('id' => $conflictId, 'mutationReceiptId' => $context['receiptId'],
            'recordId' => $record['id'], 'baseRevisionNo' => $mutation['baseRevisionNo'], 'serverRevisionNo' => $record['currentRevisionNo'],
            'localPatchJson' => Ppms_values::json($mutation), 'localPayloadHash' => Ppms_values::hash($mutation),
            'changedPathsJson' => Ppms_values::json(array_column($changes, 'path')), 'isTraceCritical' => 1));
        $result = array('status' => 'CONFLICT', 'recordId' => $record['id'], 'conflictId' => $conflictId, 'serverRevisionNo' => $record['currentRevisionNo']);
        $context['recordId'] = $record['id'];
        $this->store->audit($actor, 'SYNC_CONFLICT_CREATED', 'SyncConflict', $conflictId, $result, $context);
        return $result;
    }
    private function resolve($actor, $form, $mutation, $context)
    {
        $record = $this->find($mutation['recordId']);
        if ($record['ppmFormId'] !== $form) { throw new Ppms_problem('RECORD_FORM_MISMATCH', 403); }
        if ($mutation['baseRevisionNo'] !== $record['currentRevisionNo']) { throw new Ppms_problem('RESOLUTION_BASE_CHANGED', 409); }
        $id = Ppms_values::text($mutation, 'conflictId');
        $reason = Ppms_values::text($mutation, 'reason', 2000);
        $type = Ppms_values::text($mutation, 'resolutionType');
        if (!in_array($type, array('KEEP_SERVER','APPLY_LOCAL_AS_NEW_REVISION','MANUAL_MERGE'), TRUE)) { throw new Ppms_problem('INVALID_RESOLUTION_TYPE'); }
        $conflict = $this->store->row('SELECT * FROM SyncConflict WHERE id=? AND recordId=? FOR UPDATE', array($id, $record['id']));
        if (!$conflict || $conflict['status'] !== 'OPEN') { throw new Ppms_problem('CONFLICT_NOT_OPEN', 409); }
        if ($type === 'KEEP_SERVER') {
            $result = array('status' => 'APPLIED', 'recordId' => $record['id'], 'revisionId' => $this->revision($record)['id'], 'revisionNo' => $record['currentRevisionNo']);
        } else {
            // Reuse the normal command path: status, pinned schema and trace rules all apply.
            $command = (array) $conflict['localPatchJson'];
            if ($type === 'MANUAL_MERGE') {
                $command['operationType'] = 'UPDATE_DRAFT';
                $command['dataJson'] = $mutation['dataJson'] ?? NULL;
                $command['traceSelections'] = $mutation['traceSelections'] ?? array();
            }
            $command['baseRevisionNo'] = $record['currentRevisionNo'];
            $result = $this->apply($actor, $form, $command, $context);
            $this->store->execute('UPDATE PpmRecordRevision SET correctionReason=? WHERE id=?', array($reason, $result['revisionId']));
        }
        $this->store->execute('UPDATE SyncConflict SET status=\'RESOLVED\',resolutionType=?,resolutionJson=?,resolvedById=?,resolvedAt=UTC_TIMESTAMP(3) WHERE id=?',
            array($type, Ppms_values::json(array('reason' => $reason, 'result' => $result)), $actor['id'], $id));
        $context['recordId'] = $record['id'];
        $this->store->audit($actor, 'SYNC_CONFLICT_RESOLVED', 'SyncConflict', $id, array('resolutionType' => $type, 'reason' => $reason), $context);
        return $result + array('conflictId' => $id, 'resolutionType' => $type);
    }
    public function changes($before, $after, $path = '')
    {
        if (Ppms_values::hash($before) === Ppms_values::hash($after)) { return array(); }
        if ((is_object($before) && is_object($after)) || (is_array($before) && is_array($after))) {
            $old = (array) $before;
            $new = (array) $after;
            $result = array();
            foreach (array_unique(array_merge(array_keys($old), array_keys($new))) as $key) {
                $result = array_merge($result, $this->changes($old[$key] ?? NULL, $new[$key] ?? NULL, $path === '' ? (string) $key : $path.'.'.$key));
            }
            return $result;
        }
        return array(array('path' => $path, 'before' => $before, 'after' => $after));
    }
}
