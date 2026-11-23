<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

class Ppms_record_service
{
    private $store;
    private $auth;
    private $validator;
    private $trace;
    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->library(array('ppms_auth_service', 'ppms_form_validator', 'ppms_trace_service', 'ppms_device_service'));
        $this->store = $ci->ppms_store;
        $this->auth = $ci->ppms_auth_service;
        $this->validator = $ci->ppms_form_validator;
        $this->trace = $ci->ppms_trace_service;
    }
    public function find($id)
    {
        $record = $this->store->row('SELECT r.*,a.ppmFormId FROM PpmRecord r JOIN AreaPpmAssignment a ON a.id=r.areaPpmAssignmentId WHERE r.id=?', array($id));
        if (!$record) { throw new Ppms_problem('RECORD_NOT_FOUND', 404); }
        return $record;
    }
    /** Compact current projection used by every feed; history is paginated. */
    public function projection($actor, $id, $authorize = TRUE)
    {
        $record = $this->find($id);
        if ($authorize) { $this->auth->access($actor, $record['ppmFormId']); }
        $revision = $this->revision($record);
        $review = $this->store->row('SELECT * FROM ReviewReference WHERE recordId=?', array($id));
        if ($review) { $review['version'] = (int) $review['version']; $review['isCurrent'] = (int) $review['reviewedRevisionNo'] === $record['currentRevisionNo']; }
        $impacts = $this->revalidations($actor, $record['ppmFormId'], $id, $authorize);
        return array('record' => $record, 'revision' => $revision,
            'traceLinks' => $this->store->rows('SELECT * FROM PpmTraceLink WHERE downstreamRevisionId=? ORDER BY downstreamInputKey,id', array($revision['id'])),
            'revalidations' => $impacts['items'], 'revalidationTotal' => $impacts['total'],
            'pendingRevalidationCount' => $impacts['pending'],
            'openConflictCount' => (int) $this->store->row("SELECT COUNT(*) AS n FROM SyncConflict WHERE recordId=? AND status='OPEN'", array($id))['n'],
            'reviewReference' => $review ?: array('recordId' => $id, 'reviewerUserId' => NULL, 'reviewerName' => '', 'reviewerPosition' => '',
                'status' => 'PENDING_REVIEW', 'reviewedAt' => NULL, 'remarks' => NULL, 'version' => 0, 'reviewedRevisionNo' => NULL, 'isCurrent' => FALSE),
            'deleted' => $record['archivedAt'] !== NULL);
    }
    public function view($actor, $id)
    {
        $result = $this->projection($actor, $id);
        $history = $this->history($actor, $id, array('page' => 1, 'limit' => 50));
        $result['revisions'] = array_reverse($history['items']);
        $result['historyTotal'] = $history['total'];
        $result['historyHasMore'] = $history['total'] > count($history['items']);
        return $result;
    }
    public function history($actor, $id, $query = array())
    {
        $record = $this->find($id);
        $this->auth->access($actor, $record['ppmFormId']);
        $page = max(1, min(1000000, (int) ($query['page'] ?? 1)));
        $limit = max(1, min(100, (int) ($query['limit'] ?? 50)));
        $total = (int) $this->store->row('SELECT COUNT(*) AS n FROM PpmRecordRevision WHERE recordId=?', array($id))['n'];
        $rows = $this->store->rows('SELECT * FROM PpmRecordRevision WHERE recordId=? ORDER BY revisionNo DESC LIMIT ? OFFSET ?', array($id, $limit, ($page - 1) * $limit));
        return array('items' => $rows, 'page' => $page, 'limit' => $limit, 'total' => $total);
    }
    public function listing($actor, $query = array())
    {
        $requested = $query['ppmFormId'] ?? $query['formId'] ?? NULL;
        $forms = array();
        if ($requested) { $this->auth->access($actor, $requested); $forms[] = $requested; }
        else {
            foreach ($this->store->rows('SELECT id FROM PpmForm ORDER BY id') as $form) {
                try { $this->auth->access($actor, $form['id']); $forms[] = $form['id']; }
                catch (Ppms_problem $error) { if ($error->status !== 403) { throw $error; } }
            }
        }
        $page = max(1, min(1000000, (int) ($query['page'] ?? 1)));
        $limit = max(1, min(100, (int) ($query['limit'] ?? 25)));
        if (!$forms) { return array('items' => array(), 'page' => $page, 'limit' => $limit, 'total' => 0); }
        $text = trim((string) ($query['q'] ?? ''));
        if (mb_strlen($text) > 191) { throw new Ppms_problem('INVALID_SEARCH'); }
        $where = ' FROM PpmRecord r JOIN AreaPpmAssignment a ON a.id=r.areaPpmAssignmentId LEFT JOIN ReviewReference w ON w.recordId=r.id WHERE a.ppmFormId IN ('.implode(',', array_fill(0, count($forms), '?')).')';
        $args = $forms;
        if (($query['includeDeleted'] ?? '') !== 'true') { $where .= ' AND r.archivedAt IS NULL'; }
        if ($text !== '') {
            $where .= " AND (LOCATE(?,r.id)>0 OR LOCATE(?,COALESCE(r.recordCode,''))>0 OR LOCATE(?,COALESCE(r.batchNo,''))>0 OR LOCATE(?,COALESCE(r.lotNo,''))>0)";
            $args = array_merge($args, array($text, $text, $text, $text));
        }
        if (!empty($query['status'])) { $where .= ' AND r.status=?'; $args[] = Ppms_values::text($query, 'status'); }
        if (!empty($query['reviewStatus'])) { $where .= " AND COALESCE(w.status,'PENDING_REVIEW')=?"; $args[] = Ppms_values::text($query, 'reviewStatus'); }
        foreach (array('from' => '>=', 'to' => '<=') as $key => $operator) {
            if (!empty($query[$key])) { $where .= ' AND r.productionDate'.$operator.'?'; $args[] = Ppms_values::date($query[$key]).($key === 'to' ? ' 23:59:59.999' : ' 00:00:00'); }
        }
        $total = (int) $this->store->row('SELECT COUNT(*) AS n'.$where, $args)['n'];
        $rows = $this->store->rows('SELECT r.id'.$where.' ORDER BY r.updatedAt DESC,r.id LIMIT ? OFFSET ?', array_merge($args, array($limit, ($page - 1) * $limit)));
        $items = array();
        foreach ($rows as $row) { $items[] = $this->projection($actor, $row['id']); }
        return array('items' => $items, 'page' => $page, 'limit' => $limit, 'total' => $total);
    }
    public function revalidations($actor, $form, $recordId = NULL, $authorize = TRUE, $query = array())
    {
        if ($authorize) { $this->auth->access($actor, $form); }
        $page = max(1, min(1000000, (int) ($query['page'] ?? 1)));
        $limit = max(1, min(250, (int) ($query['limit'] ?? 100)));
        $from = ' FROM TraceRevalidationItem i JOIN TraceRevalidation h ON h.id=i.revalidationId JOIN PpmTraceLink l ON l.id=i.traceLinkId
            JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId JOIN PpmRecord r ON r.id=v.recordId
            JOIN AreaPpmAssignment a ON a.id=r.areaPpmAssignmentId WHERE a.ppmFormId=? AND (? IS NULL OR r.id=?)';
        $args = array($form, $recordId, $recordId);
        $counts = $this->store->row("SELECT COUNT(*) AS total,COALESCE(SUM(i.status<>'RESOLVED'),0) AS pending".$from, $args);
        $items = $this->store->rows("SELECT i.*,v.recordId,l.downstreamInputKey,l.sourceTraceOutputId,
            h.triggerRevisionId,h.reason,h.status AS revalidationStatus,h.createdAt AS triggeredAt".$from.
            " ORDER BY (i.status='RESOLVED'),h.createdAt DESC,i.id LIMIT ? OFFSET ?", array_merge($args, array($limit, ($page - 1) * $limit)));
        return array('items' => $items, 'page' => $page, 'limit' => $limit, 'total' => (int) $counts['total'], 'pending' => (int) $counts['pending']);
    }
    public function conflicts($actor, $id, $query = array())
    {
        $record = $this->find($id);
        $this->auth->access($actor, $record['ppmFormId']);
        $page = max(1, min(1000000, (int) ($query['page'] ?? 1)));
        $limit = max(1, min(100, (int) ($query['limit'] ?? 25)));
        $status = $query['status'] ?? 'OPEN';
        if (!in_array($status, array('OPEN','RESOLVED','DISMISSED'), TRUE)) { throw new Ppms_problem('INVALID_CONFLICT_STATUS'); }
        $total = (int) $this->store->row('SELECT COUNT(*) AS n FROM SyncConflict WHERE recordId=? AND status=?', array($id, $status))['n'];
        $items = $this->store->rows('SELECT * FROM SyncConflict WHERE recordId=? AND status=? ORDER BY createdAt DESC,id LIMIT ? OFFSET ?', array($id, $status, $limit, ($page - 1) * $limit));
        return array('items' => $items, 'page' => $page, 'limit' => $limit, 'total' => $total);
    }
    public function revision($record)
    {
        return $this->store->row('SELECT * FROM PpmRecordRevision WHERE recordId=? AND revisionNo=?', array($record['id'], $record['currentRevisionNo']));
    }
    /** Caller holds the form lock and owns the transaction and mutation receipt. */
    public function apply($actor, $form, $mutation, $context, $correctionReason = NULL)
    {
        $operation = $mutation['operationType'];
        if (!in_array($operation, array('CREATE_DRAFT','UPDATE_DRAFT','QUEUE_SUBMIT','CONFLICT_RESOLUTION','DELETE_RECORD'), TRUE)) { throw new Ppms_problem('UNSUPPORTED_MUTATION'); }
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
                AND (effectiveFrom IS NULL OR effectiveFrom<=UTC_TIMESTAMP(3))', array($templateId, $form));
            if (!$template) { throw new Ppms_problem('TEMPLATE_STALE_OR_UNPUBLISHED', 409); }
            $assignment = $this->store->row('SELECT a.id FROM AreaPpmAssignment a JOIN ProductionArea p ON p.id=a.areaId
                WHERE a.id=? AND a.ppmFormId=? AND a.isActive=1 AND p.status=\'ACTIVE\'
                AND a.effectiveFrom<? AND (a.effectiveTo IS NULL OR a.effectiveTo>?)', array($assignmentId, $form, $date.' 23:59:59.999', $date.' 00:00:00'));
            if (!$assignment) { throw new Ppms_problem('AREA_ASSIGNMENT_INVALID', 403); }
            $data = $mutation['dataJson'] ?? new stdClass();
            $serverPaths = $this->trace->populate($actor, $form, $data, $template['definitionJson'], $mutation['traceSelections'] ?? array(), $id);
            $data = $this->validator->payload($template['definitionJson'], $data, FALSE, NULL, $serverPaths);
            $this->store->insert('PpmRecord', array('id' => $id, 'areaPpmAssignmentId' => $assignmentId,
                'templateVersionId' => $templateId, 'recordCode' => $id, 'productionDate' => $date.' 00:00:00',
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
            if ($record['archivedAt']) { throw new Ppms_problem('RECORD_NOT_EDITABLE', 409); }
            if (isset($mutation['templateVersionId']) && $mutation['templateVersionId'] !== $record['templateVersionId']) { throw new Ppms_problem('RECORD_TEMPLATE_PINNED', 409); }
            $previous = $this->revision($record);
            $data = in_array($operation, array('QUEUE_SUBMIT','DELETE_RECORD'), TRUE) ? $previous['dataJson'] : ($mutation['dataJson'] ?? NULL);
            $template = $this->store->row('SELECT * FROM PpmTemplateVersion WHERE id=? AND publishedAt IS NOT NULL', array($record['templateVersionId']));
            if (!$template) { throw new Ppms_problem('TEMPLATE_UNAVAILABLE', 409); }
            if ($operation !== 'DELETE_RECORD') {
                $serverPaths = $this->trace->populate($actor, $form, $data, $template['definitionJson'], $mutation['traceSelections'] ?? array(), $id);
                $data = $this->validator->payload($template['definitionJson'], $data, $operation === 'QUEUE_SUBMIT', $previous['dataJson'], $serverPaths);
            }
            $revisionNo = $record['currentRevisionNo'] + 1;
        }
        $revisionId = Ppms_values::id();
        $submitted = $operation === 'QUEUE_SUBMIT';
        $deleted = $operation === 'DELETE_RECORD';
        if ($deleted && $correctionReason === NULL) { $correctionReason = isset($mutation['reason']) ? Ppms_values::text($mutation, 'reason', 2000) : 'Record deleted'; }
        $this->store->insert('PpmRecordRevision', array('id' => $revisionId, 'recordId' => $id, 'revisionNo' => $revisionNo,
            'status' => $deleted ? 'CLOSED' : ($submitted ? 'SUBMITTED' : ($correctionReason !== NULL ? 'CORRECTED' : 'DRAFT')), 'dataJson' => Ppms_values::json($data),
            'correctionReason' => $correctionReason,
            'dataHash' => Ppms_values::hash($data), 'createdById' => $actor['id'], 'submittedAt' => $submitted ? Ppms_values::now() : NULL));
        $context['recordId'] = $id;
        if (!$deleted) { $this->trace->link($actor, $form, $revisionId, $data, $template['definitionJson'], $mutation['traceSelections'] ?? array(), $previous['id'] ?? NULL, $context); }
        if ($previous) {
            if ($deleted || Ppms_values::hash($previous['dataJson']) !== Ppms_values::hash($data)
                || Ppms_values::hash($this->trace->provenance($previous['id'])) !== Ppms_values::hash($this->trace->provenance($revisionId))) {
                if ($this->trace->retire($actor, $record, $revisionId, $correctionReason ?? 'Trace source data changed', $context)) {
                    $this->store->execute('UPDATE PpmRecordRevision SET isTraceCritical=1 WHERE id=?', array($revisionId));
                }
            }
            foreach ($this->changes($previous['dataJson'], $data) as $change) {
                $this->store->insert('RevisionChange', array('id' => Ppms_values::id(), 'oldRevisionId' => $previous['id'], 'newRevisionId' => $revisionId,
                    'fieldPath' => $change['path'], 'beforeValueJson' => Ppms_values::json($change['before']),
                    'afterValueJson' => Ppms_values::json($change['after']), 'reason' => 'Synchronized record revision'));
            }
        }
        $this->store->execute('UPDATE PpmRecord SET currentRevisionNo=?,status=?,updatedAt=UTC_TIMESTAMP(3),submittedAt=? WHERE id=?',
            array($revisionNo, $deleted ? 'CLOSED' : ($submitted ? 'SUBMITTED' : 'ACTIVE'), $submitted ? Ppms_values::now() : NULL, $id));
        if ($deleted) {
            $this->store->execute('UPDATE PpmRecord SET archivedAt=UTC_TIMESTAMP(3),closedAt=UTC_TIMESTAMP(3) WHERE id=?', array($id));
        } else {
            $this->store->execute("UPDATE ReviewReference SET status='PENDING_REVIEW',reviewedAt=NULL,reviewedRevisionNo=NULL,version=version+1,updatedBy=?,updatedAt=UTC_TIMESTAMP(3) WHERE recordId=? AND status<>'PENDING_REVIEW'", array($actor['id'], $id));
        }
        if ($submitted) {
            $this->store->insert('WorkflowEvent', array('id' => Ppms_values::id(), 'recordId' => $id, 'revisionId' => $revisionId, 'action' => 'SUBMIT', 'actorId' => $actor['id']));
        }
        $result = array('status' => 'APPLIED', 'recordId' => $id, 'revisionId' => $revisionId, 'revisionNo' => $revisionNo);
        $context['recordId'] = $id;
        $this->store->audit($actor, 'SYNC_APPLIED', 'PpmRecord', $id, $result, $context);
        if (empty($context['deferRecordEvent'])) { $this->store->event($form, $deleted ? 'RECORD_DELETED' : 'RECORD_REVISION', $this->projection($actor, $id), $id, $revisionId); }
        return $result;
    }
    public function correct($actor, $id, $input)
    {
        $form = $this->find($id)['ppmFormId'];
        return $this->store->transaction(function () use ($actor, $id, $input, $form) {
            $this->store->lockForm($form);
            $ci =& get_instance();
            $deviceId = isset($input['deviceId']) ? Ppms_values::text($input, 'deviceId') : NULL;
            if ($deviceId !== NULL) { $ci->ppms_device_service->lease($form, $deviceId, Ppms_values::integer($input, 'leaseVersion', 1)); }
            $reason = Ppms_values::text($input, 'reason', 2000);
            $base = Ppms_values::integer($input, 'baseRevisionNo', 1);
            $record = $this->find($id);
            if ($record['currentRevisionNo'] !== $base) { throw new Ppms_problem('REVISION_CHANGED', 409); }
            return $this->apply($actor, $record['ppmFormId'], array('operationType' => 'UPDATE_DRAFT', 'recordId' => $id,
                'baseRevisionNo' => $base, 'dataJson' => $input['dataJson'] ?? NULL, 'traceSelections' => $input['traceSelections'] ?? array()),
                array('deviceId' => $deviceId, 'ppmFormId' => $record['ppmFormId'], 'baseRevisionNo' => $base), $reason);
        });
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
        $snapshot = $this->projection($actor, $record['id']);
        $this->store->event($record['ppmFormId'], 'RECORD_REVISION', $snapshot, $record['id'], $snapshot['revision']['id']);
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
            $context['deferRecordEvent'] = TRUE;
            $result = $this->apply($actor, $form, $command, $context, $reason);
        }
        $this->store->execute('UPDATE SyncConflict SET status=\'RESOLVED\',resolutionType=?,resolutionJson=?,resolvedById=?,resolvedAt=UTC_TIMESTAMP(3) WHERE id=?',
            array($type, Ppms_values::json(array('reason' => $reason, 'result' => $result)), $actor['id'], $id));
        $context['recordId'] = $record['id'];
        $this->store->audit($actor, 'SYNC_CONFLICT_RESOLVED', 'SyncConflict', $id, array('resolutionType' => $type, 'reason' => $reason), $context);
        $this->store->event($form, 'CONFLICT_RESOLVED', $this->projection($actor, $record['id']), $record['id'], $result['revisionId']);
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
