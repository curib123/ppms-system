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
    public function review($actor, $id, $input)
    {
        $action = Ppms_values::text($input, 'action');
        $reason = Ppms_values::text($input, 'reason', 2000);
        if (!in_array($action, array('APPROVE','RETURN'), TRUE)) { throw new Ppms_problem('INVALID_REVIEW_ACTION'); }
        $form = $this->records->find($id)['ppmFormId'];
        return $this->store->transaction(function () use ($actor, $id, $input, $action, $reason, $form) {
            $this->store->lockForm($form);
            $this->auth->access($actor, $form);
            $device = Ppms_values::text($input, 'deviceId');
            $this->devices->lease($form, $device, Ppms_values::integer($input, 'leaseVersion', 1));
            $record = $this->records->find($id);
            $base = Ppms_values::integer($input, 'baseRevisionNo', 1);
            if ($record['currentRevisionNo'] !== $base) { throw new Ppms_problem('REVISION_CHANGED', 409); }
            $steps = array('SUBMITTED' => array('FSQA','FSQA_REVIEW','FSQA_APPROVED','ACTIVE'),
                'RETURNED_TO_FSQA' => array('FSQA','FSQA_REVIEW','FSQA_APPROVED','ACTIVE'),
                'FSQA_APPROVED' => array('SUPERVISOR','SUPERVISOR_REVIEW','SUPERVISOR_APPROVED','RETURNED_TO_FSQA'),
                'SUPERVISOR_APPROVED' => array('PLANT_MANAGER','PLANT_MANAGER_REVIEW','CLOSED','FSQA_APPROVED'));
            $step = $steps[$record['status']] ?? NULL;
            if (!$step || $record['archivedAt']) { throw new Ppms_problem('RECORD_NOT_REVIEWABLE', 409); }
            $user = $this->auth->user($actor['id']);
            if ($user['role'] !== 'ADMIN' && $user['role'] !== $step[0]) { throw new Ppms_problem('REVIEW_ROLE_REQUIRED', 403); }
            $old = $this->records->revision($record);
            $template = $this->store->row('SELECT definitionJson FROM PpmTemplateVersion WHERE id=?', array($record['templateVersionId']));
            if ($action === 'APPROVE') {
                $this->validator->payload($template['definitionJson'], $old['dataJson'], TRUE);
                if ($this->store->row('SELECT i.id FROM TraceRevalidationItem i JOIN PpmTraceLink l ON l.id=i.traceLinkId
                    JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId WHERE v.recordId=? AND i.status<>\'RESOLVED\' LIMIT 1', array($id))) { throw new Ppms_problem('REVALIDATION_REQUIRED', 409); }
            }
            $status = $step[$action === 'APPROVE' ? 2 : 3];
            $revisionId = Ppms_values::id();
            $this->store->insert('PpmRecordRevision', array('id' => $revisionId, 'recordId' => $id, 'revisionNo' => $base + 1,
                'status' => $action === 'APPROVE' ? ($status === 'CLOSED' ? 'CLOSED' : 'APPROVED') : 'CORRECTED',
                'dataJson' => Ppms_values::json($old['dataJson']), 'dataHash' => $old['dataHash'],
                'createdById' => $actor['id'], 'correctionReason' => $action === 'RETURN' ? $reason : NULL,
                'approvedAt' => $action === 'APPROVE' ? Ppms_values::now() : NULL));
            $context = array('deviceId' => $device, 'recordId' => $id, 'ppmFormId' => $record['ppmFormId'], 'baseRevisionNo' => $base);
            if ($action === 'APPROVE') {
                $this->trace->link($actor, $record['ppmFormId'], $revisionId, $old['dataJson'], $template['definitionJson'], array(), $old['id'], $context);
            } else {
                // A returned record retains historical source links for correction;
                // the normal submit path must validate its next source selections.
                foreach ($this->store->rows('SELECT * FROM PpmTraceLink WHERE downstreamRevisionId=?', array($old['id'])) as $link) {
                    $this->store->insert('PpmTraceLink', array('id' => Ppms_values::id(), 'connectionId' => $link['connectionId'],
                        'sourceTraceOutputId' => $link['sourceTraceOutputId'], 'downstreamRevisionId' => $revisionId,
                        'downstreamInputKey' => $link['downstreamInputKey'], 'selectedById' => $actor['id']));
                }
                $this->trace->retire($actor, $record, $revisionId, $reason, $context);
            }
            $this->store->execute('UPDATE PpmRecord SET currentRevisionNo=?,status=?,closedAt=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?', array($base + 1, $status, $status === 'CLOSED' ? Ppms_values::now() : NULL, $id));
            $eventAction = $status === 'CLOSED' ? 'CLOSE' : $action;
            $this->store->insert('WorkflowEvent', array('id' => Ppms_values::id(), 'recordId' => $id, 'revisionId' => $revisionId,
                'step' => $step[1], 'action' => $eventAction, 'actorId' => $actor['id'], 'reason' => $reason));
            $this->store->audit($actor, $eventAction, 'PpmRecord', $id, array('status' => $status, 'reason' => $reason), $context);
            $view = $this->records->view($actor, $id);
            $this->store->event($record['ppmFormId'], 'RECORD_REVISION', $view, $id, $revisionId);
            // Approval can make an existing exact-revision output newly eligible.
            if ($action === 'APPROVE') {
                foreach ($this->store->rows('SELECT * FROM PpmTraceOutput WHERE recordId=? AND status IN (\'PUBLISHED\',\'LINKED_DOWNSTREAM\')', array($id)) as $output) {
                    $this->store->event($record['ppmFormId'], 'TRACE_OUTPUT_PUBLISHED', $this->trace->outputView($output), $id, $output['revisionId'], $output['outputKey']);
                }
            }
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
            $this->store->lockForm($form);
            $this->auth->access($actor, $form);
            $role = $this->auth->user($actor['id'])['role'];
            if (!in_array($role, array('ADMIN','FSQA','SUPERVISOR','PLANT_MANAGER'), TRUE)) { throw new Ppms_problem('REVALIDATION_REVIEWER_REQUIRED', 403); }
            $device = Ppms_values::text($input, 'deviceId');
            $this->devices->lease($form, $device, Ppms_values::integer($input, 'leaseVersion', 1));
            $record = $this->records->find($item['recordId']);
            if ($record['currentRevisionNo'] !== Ppms_values::integer($input, 'baseRevisionNo', 1)) { throw new Ppms_problem('REVISION_CHANGED', 409); }
            if ($decision === 'ACCEPT_HISTORICAL') {
                if ($record['status'] !== 'CLOSED') { throw new Ppms_problem('HISTORICAL_ACCEPTANCE_REQUIRES_CLOSED_RECORD', 409); }
            } elseif ($decision === 'REPLACED_SOURCE') {
                $replacement = $this->store->row('SELECT o.id FROM PpmTraceLink l JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId
                    JOIN PpmTraceOutput o ON o.id=l.sourceTraceOutputId JOIN PpmTraceConnection c ON c.id=l.connectionId
                    JOIN PpmRecord s ON s.id=o.recordId WHERE v.recordId=? AND v.revisionNo=? AND l.downstreamInputKey=? AND o.id<>?
                    AND o.status IN (\'PUBLISHED\',\'LINKED_DOWNSTREAM\') AND c.status=\'ACTIVE\' AND s.archivedAt IS NULL
                    AND (c.requiresApprovalBeforeUse=0 OR s.status IN (\'FSQA_APPROVED\',\'SUPERVISOR_APPROVED\',\'CLOSED\')) LIMIT 1',
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
            return array('id' => $itemId, 'status' => 'RESOLVED');
        });
    }
}
