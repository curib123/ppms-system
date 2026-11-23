<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

/** Online review decisions and explicit downstream impact decisions. */
class Ppms_workflow_service
{
    private $store;
    private $auth;
    private $devices;
    private $records;
    private $trace;
    private $validator;
    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->library(array('ppms_auth_service','ppms_device_service','ppms_record_service','ppms_trace_service','ppms_form_validator'));
        $this->store = $ci->ppms_store;
        $this->auth = $ci->ppms_auth_service;
        $this->devices = $ci->ppms_device_service;
        $this->records = $ci->ppms_record_service;
        $this->trace = $ci->ppms_trace_service;
        $this->validator = $ci->ppms_form_validator;
    }
    /** Review references describe a decision; they never lock record editing. */
    public function review($actor, $id, $input)
    {
        $status = $input['status'] ?? (($input['action'] ?? '') === 'APPROVE' ? 'APPROVED' : (($input['action'] ?? '') === 'RETURN' ? 'RETURNED_FOR_REVISION' : NULL));
        if (!in_array($status, array('PENDING_REVIEW','UNDER_REVIEW','APPROVED','RETURNED_FOR_REVISION'), TRUE)) { throw new Ppms_problem('INVALID_REVIEW_STATUS'); }
        $form = $this->records->find($id)['ppmFormId'];
        return $this->store->transaction(function () use ($actor, $id, $input, $status, $form) {
            $lockedForm = $this->store->lockForm($form);
            if ($lockedForm['status'] !== 'ACTIVE') { throw new Ppms_problem('FORM_UNAVAILABLE', 403); }
            $this->auth->access($actor, $form);
            $user = $this->auth->user($actor['id']);
            if (!in_array($user['role'], array('ADMIN','FSQA','SUPERVISOR','PLANT_MANAGER'), TRUE)) { throw new Ppms_problem('REVIEW_ROLE_REQUIRED', 403); }
            $record = $this->records->find($id);
            if ($record['archivedAt']) { throw new Ppms_problem('RECORD_ARCHIVED', 409); }
            $base = Ppms_values::integer(array('base' => $input['expectedRevisionNo'] ?? $input['baseRevisionNo'] ?? NULL), 'base', 1);
            if ($record['currentRevisionNo'] !== $base) { throw new Ppms_problem('REVISION_CHANGED', 409); }
            $old = $this->store->row('SELECT * FROM ReviewReference WHERE recordId=? FOR UPDATE', array($id));
            $expected = Ppms_values::integer(array('version' => $input['expectedReviewVersion'] ?? 0), 'version', 0);
            if ($expected !== (int) ($old['version'] ?? 0)) { throw new Ppms_problem('REVIEW_CHANGED', 409); }
            $reviewerId = $input['reviewerUserId'] ?? $actor['id'];
            if ($reviewerId !== $actor['id']) { $this->auth->admin($actor); }
            $reviewer = $this->auth->user($reviewerId);
            if (!in_array($reviewer['role'], array('ADMIN','FSQA','SUPERVISOR','PLANT_MANAGER'), TRUE)) { throw new Ppms_problem('REVIEW_ROLE_REQUIRED', 403); }
            $this->auth->access($reviewer, $form);
            $name = isset($input['reviewerName']) ? Ppms_values::text($input, 'reviewerName') : mb_substr($reviewer['displayName'], 0, 191);
            $position = isset($input['reviewerPosition']) && $input['reviewerPosition'] !== '' ? Ppms_values::text($input, 'reviewerPosition') : $reviewer['role'];
            $remarks = $input['remarks'] ?? $input['reason'] ?? '';
            if (!is_string($remarks) || mb_strlen($remarks) > 2000) { throw new Ppms_problem('INVALID_REVIEW_REMARKS'); }
            $reviewed = in_array($status, array('APPROVED','RETURNED_FOR_REVISION'), TRUE) ? Ppms_values::now() : NULL;
            $version = $expected + 1;
            $this->store->execute('INSERT INTO ReviewReference (recordId,reviewerUserId,reviewerName,reviewerPosition,status,reviewedAt,remarks,version,reviewedRevisionNo,updatedBy)
                VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE reviewerUserId=VALUES(reviewerUserId),reviewerName=VALUES(reviewerName),
                reviewerPosition=VALUES(reviewerPosition),status=VALUES(status),reviewedAt=VALUES(reviewedAt),remarks=VALUES(remarks),
                version=VALUES(version),reviewedRevisionNo=VALUES(reviewedRevisionNo),updatedBy=VALUES(updatedBy),updatedAt=UTC_TIMESTAMP(3)',
                array($id, $reviewerId, $name, $position, $status, $reviewed, $remarks, $version, $base, $actor['id']));
            $action = $status === 'APPROVED' ? 'APPROVE' : ($status === 'RETURNED_FOR_REVISION' ? 'RETURN' : 'UPDATE');
            if ($action !== 'UPDATE') {
                $this->store->insert('WorkflowEvent', array('id' => Ppms_values::id(), 'recordId' => $id,
                    'revisionId' => $this->records->revision($record)['id'], 'action' => $action, 'actorId' => $actor['id'], 'reason' => $remarks));
            }
            $this->store->audit($actor, $action, 'ReviewReference', $id, array('reviewerUserId' => $reviewerId,
                'reviewerName' => $name, 'reviewerPosition' => $position, 'status' => $status, 'remarks' => $remarks,
                'version' => $version, 'reviewedRevisionNo' => $base), array('recordId' => $id, 'ppmFormId' => $form, 'baseRevisionNo' => $base));
            if ($record['createdById'] !== $actor['id']) {
                $this->store->insert('Notification', array('id' => Ppms_values::id(), 'recipientId' => $record['createdById'],
                    'type' => 'WORKFLOW', 'severity' => 'INFO', 'title' => 'Form review updated',
                    'message' => $name.' marked the review '.strtolower(str_replace('_', ' ', $status)).'.',
                    'entityType' => 'PpmRecord', 'entityId' => $id, 'dedupeKey' => 'review:'.$id.':'.$version));
            }
            $view = $this->records->view($actor, $id);
            $this->store->event($form, 'RECORD_REVISION', $this->records->projection($actor, $id), $id, $view['revision']['id']);
            return $view;
        });
    }
    public function resolveItem($actor, $itemId, $input)
    {
        $notes = Ppms_values::text($input, 'notes', 2000);
        $decision = Ppms_values::text($input, 'decision');
        $item = $this->store->row('SELECT i.*,l.sourceTraceOutputId,l.downstreamInputKey,v.recordId FROM TraceRevalidationItem i
                JOIN PpmTraceLink l ON l.id=i.traceLinkId JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId WHERE i.id=?', array($itemId));
        if (!$item) { throw new Ppms_problem('REVALIDATION_ITEM_NOT_FOUND', 404); }
        $form = $this->records->find($item['recordId'])['ppmFormId'];
        return $this->store->transaction(function () use ($actor, $itemId, $input, $notes, $decision, $item, $form) {
            $this->store->row('SELECT id FROM TraceRevalidation WHERE id=? FOR UPDATE', array($item['revalidationId']));
            $lockedForm = $this->store->lockForm($form);
            if ($lockedForm['status'] !== 'ACTIVE') { throw new Ppms_problem('FORM_UNAVAILABLE', 403); }
            $this->auth->access($actor, $form);
            $role = $this->auth->user($actor['id'])['role'];
            if (!in_array($role, array('ADMIN','FSQA','SUPERVISOR','PLANT_MANAGER'), TRUE)) { throw new Ppms_problem('REVALIDATION_REVIEWER_REQUIRED', 403); }
            $device = $input['deviceId'] ?? NULL;
            if ($device !== NULL) { $this->devices->lease($form, $device, Ppms_values::integer($input, 'leaseVersion', 1)); }
            $currentItem = $this->store->row('SELECT status FROM TraceRevalidationItem WHERE id=? FOR UPDATE', array($itemId));
            if ($currentItem['status'] === 'RESOLVED') { throw new Ppms_problem('REVALIDATION_ALREADY_RESOLVED', 409); }
            $record = $this->records->find($item['recordId']);
            if ($record['currentRevisionNo'] !== Ppms_values::integer($input, 'baseRevisionNo', 1)) { throw new Ppms_problem('REVISION_CHANGED', 409); }
            if ($decision === 'ACCEPT_HISTORICAL') {
                if ($record['status'] === 'ACTIVE') { throw new Ppms_problem('HISTORICAL_ACCEPTANCE_REQUIRES_SUBMITTED_RECORD', 409); }
            } elseif ($decision === 'REPLACED_SOURCE') {
                $replacement = $this->store->row('SELECT o.id FROM PpmTraceLink l JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId
                    JOIN PpmTraceOutput o ON o.id=l.sourceTraceOutputId JOIN PpmTraceConnection c ON c.id=l.connectionId
                    JOIN PpmRecord s ON s.id=o.recordId WHERE v.recordId=? AND v.revisionNo=? AND l.downstreamInputKey=? AND o.id<>?
                    AND o.status IN (\'PUBLISHED\',\'LINKED_DOWNSTREAM\') AND c.status=\'ACTIVE\' AND s.archivedAt IS NULL
                    LIMIT 1',
                    array($record['id'], $record['currentRevisionNo'], $item['downstreamInputKey'], $item['sourceTraceOutputId']));
                if (!$replacement) { throw new Ppms_problem('ELIGIBLE_REPLACEMENT_REQUIRED', 409); }
            } else { throw new Ppms_problem('INVALID_REVALIDATION_DECISION'); }
            $this->store->execute('UPDATE TraceRevalidationItem SET status=\'RESOLVED\',notes=?,resolvedAt=UTC_TIMESTAMP(3) WHERE id=?', array($decision.': '.$notes, $itemId));
            $pending = $this->store->rows('SELECT id FROM TraceRevalidationItem WHERE revalidationId=? AND status<>\'RESOLVED\' FOR UPDATE', array($item['revalidationId']));
            if (!$pending) {
                $this->store->execute('UPDATE TraceRevalidation SET status=\'RESOLVED\',resolvedAt=UTC_TIMESTAMP(3),resolvedById=?,resolutionNotes=? WHERE id=?', array($actor['id'], $notes, $item['revalidationId']));
            }
            $this->store->audit($actor, 'REVALIDATION_RESOLVED', 'TraceRevalidationItem', $itemId, array('decision' => $decision, 'notes' => $notes),
                array('recordId' => $record['id'], 'ppmFormId' => $record['ppmFormId'], 'deviceId' => $device, 'baseRevisionNo' => $record['currentRevisionNo']));
            $view = $this->records->view($actor, $record['id']);
            $this->store->event($form, 'RECORD_REVISION', $this->records->projection($actor, $record['id']), $record['id'], $view['revision']['id']);
            return array('id' => $itemId, 'status' => 'RESOLVED');
        });
    }
}
