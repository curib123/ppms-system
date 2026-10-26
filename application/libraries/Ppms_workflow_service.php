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
    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->library(array('ppms_auth_service','ppms_device_service','ppms_record_service'));
        $this->store = $ci->ppms_store;
        $this->auth = $ci->ppms_auth_service;
        $this->devices = $ci->ppms_device_service;
        $this->records = $ci->ppms_record_service;
    }
    public function review($actor, $id, $input)
    {
        $eventId = Ppms_values::text($input, 'eventId');
        $base = Ppms_values::integer($input, 'baseRevisionNo', 1);
        $action = Ppms_values::text($input, 'action');
        if (!in_array($action, array('APPROVE','RETURN'), TRUE)) { throw new Ppms_problem('INVALID_REVIEW_ACTION'); }
        $reason = isset($input['reason']) ? Ppms_values::text($input, 'reason', 2000) : NULL;
        if ($action === 'RETURN' && $reason === NULL) { Ppms_values::text($input, 'reason', 2000); }
        $form = $this->records->find($id)['ppmFormId'];
        // Event IDs are global; two form locks cannot serialize reuse across forms.
        $lock = 'ppms-review-'.substr(hash('sha256', $eventId), 0, 40);
        if ((int) $this->store->row('SELECT GET_LOCK(?,10) AS acquired', array($lock))['acquired'] !== 1) {
            throw new Ppms_problem('REVIEW_BUSY', 409);
        }
        try {
            return $this->store->transaction(function () use ($actor, $id, $input, $eventId, $base, $action, $reason, $form) {
                $this->store->lockForm($form);
                $this->auth->access($actor, $form);
                $role = $this->auth->user($actor['id'])['role'];
                $steps = array('FSQA_REVIEW' => 'FSQA', 'SUPERVISOR_REVIEW' => 'SUPERVISOR', 'PLANT_MANAGER_REVIEW' => 'PLANT_MANAGER');
                if ($role !== 'ADMIN' && !in_array($role, $steps, TRUE)) { throw new Ppms_problem('REVIEW_ROLE_REQUIRED', 403); }
                if (!array_key_exists('step', $input)) {
                    if ($role === 'ADMIN') { throw new Ppms_problem('REVIEW_STEP_REQUIRED', 422); }
                    $step = array_search($role, $steps, TRUE);
                } else {
                    $step = Ppms_values::text($input, 'step');
                }
                if (!isset($steps[$step])) { throw new Ppms_problem('INVALID_REVIEW_STEP', 422); }
                if ($role !== 'ADMIN' && $steps[$step] !== $role) { throw new Ppms_problem('REVIEW_ROLE_REQUIRED', 403); }
                $device = $this->optionalDevice($form, $input);
                $existing = $this->store->row('SELECT e.*,v.revisionNo AS reviewedRevisionNo FROM WorkflowEvent e
                    LEFT JOIN PpmRecordRevision v ON v.id=e.revisionId WHERE e.id=?', array($eventId));
                if ($existing) {
                    if ($existing['recordId'] !== $id || $existing['actorId'] !== $actor['id']
                        || (int) $existing['reviewedRevisionNo'] !== $base || $existing['step'] !== $step
                        || $existing['action'] !== $action || $existing['reason'] !== $reason) {
                        throw new Ppms_problem('REVIEW_EVENT_REUSED', 409);
                    }
                    unset($existing['reviewedRevisionNo']);
                    // A lost-response retry reads its original decision even after correction.
                    return $this->records->view($actor, $id) + array('reviewEvent' => $existing);
                }
                $record = $this->records->find($id);
                if ($record['currentRevisionNo'] !== $base) { throw new Ppms_problem('REVISION_CHANGED', 409); }
                if ($record['archivedAt'] || !in_array($record['status'], array('SUBMITTED','FSQA_APPROVED','SUPERVISOR_APPROVED','RETURNED_TO_FSQA'), TRUE)) {
                    throw new Ppms_problem('RECORD_NOT_REVIEWABLE', 409);
                }
                $revision = $this->records->revision($record);
                $time = $this->store->row('SELECT GREATEST(UTC_TIMESTAMP(3),
                    COALESCE(DATE_ADD(MAX(createdAt),INTERVAL 1000 MICROSECOND),UTC_TIMESTAMP(3))) AS createdAt
                    FROM WorkflowEvent WHERE recordId=? AND step=?', array($id, $step))['createdAt'];
                $this->store->insert('WorkflowEvent', array('id' => $eventId, 'recordId' => $id, 'revisionId' => $revision['id'],
                    'step' => $step, 'action' => $action, 'actorId' => $actor['id'], 'reason' => $reason, 'createdAt' => $time));
                $event = $this->store->row('SELECT * FROM WorkflowEvent WHERE id=?', array($eventId));
                $context = array('deviceId' => $device, 'recordId' => $id, 'ppmFormId' => $form, 'baseRevisionNo' => $base);
                $this->store->audit($actor, $action, 'WorkflowEvent', $eventId, $event, $context);
                $view = $this->records->view($actor, $id);
                // Guidance refreshes by feed sequence; the content revision stays unchanged.
                $this->store->event($form, 'RECORD_REVISION', $view, $id, $revision['id']);
                return $view + array('reviewEvent' => $event);
            });
        } finally {
            $this->store->row('SELECT RELEASE_LOCK(?) AS released', array($lock));
        }
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
            $device = $this->optionalDevice($form, $input);
            $currentItem = $this->store->row('SELECT status FROM TraceRevalidationItem WHERE id=? FOR UPDATE', array($itemId));
            if ($currentItem['status'] === 'RESOLVED') { throw new Ppms_problem('REVALIDATION_ALREADY_RESOLVED', 409); }
            $record = $this->records->find($item['recordId']);
            if ($record['currentRevisionNo'] !== Ppms_values::integer($input, 'baseRevisionNo', 1)) { throw new Ppms_problem('REVISION_CHANGED', 409); }
            if ($decision === 'ACCEPT_HISTORICAL') {
                if ($record['status'] !== 'CLOSED') { throw new Ppms_problem('HISTORICAL_ACCEPTANCE_REQUIRES_CLOSED_RECORD', 409); }
            } elseif ($decision === 'REPLACED_SOURCE') {
                $replacement = $this->store->row('SELECT o.id FROM PpmTraceLink l JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId
                    JOIN PpmTraceOutput o ON o.id=l.sourceTraceOutputId JOIN PpmTraceConnection c ON c.id=l.connectionId
                    JOIN PpmRecord s ON s.id=o.recordId WHERE v.recordId=? AND v.revisionNo=? AND l.downstreamInputKey=? AND o.id<>?
                    AND o.status IN (\'PUBLISHED\',\'LINKED_DOWNSTREAM\') AND c.status=\'ACTIVE\' AND s.archivedAt IS NULL LIMIT 1',
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
    /** Online reviewers may omit mobile context; supplied context still proves possession. */
    private function optionalDevice($form, $input)
    {
        if (!array_key_exists('deviceId', $input) && !array_key_exists('leaseVersion', $input)) { return NULL; }
        $device = Ppms_values::text($input, 'deviceId');
        $this->devices->lease($form, $device, Ppms_values::integer($input, 'leaseVersion', 1));
        return $device;
    }
}
