<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

class Ppms_sync_service
{
    private $store;
    private $auth;
    private $devices;
    private $records;
    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->library(array('ppms_auth_service', 'ppms_device_service', 'ppms_record_service'));
        $this->store = $ci->ppms_store;
        $this->auth = $ci->ppms_auth_service;
        $this->devices = $ci->ppms_device_service;
        $this->records = $ci->ppms_record_service;
    }
    public function push($actor, $input)
    {
        $id = Ppms_values::text($input, 'id');
        $form = Ppms_values::text($input, 'ppmFormId');
        $device = Ppms_values::text($input, 'deviceId');
        $version = Ppms_values::integer($input, 'leaseVersion', 1);
        $requestedDate = isset($input['businessDate']) ? Ppms_values::date($input['businessDate']) : NULL;
        $mutations = $input['mutations'] ?? NULL;
        $limit = max(1, min(500, (int) $this->store->setting('sync.batchSize', 50)));
        if (!is_array($mutations) || !$mutations || count($mutations) > 500) {
            throw new Ppms_problem('INVALID_BATCH_SIZE', 422, array('maxBatchSize' => $limit, 'accepted' => FALSE));
        }
        $normalized = array();
        foreach ($mutations as $mutation) {
            $value = (array) Ppms_values::object($mutation);
            unset($value['authorProof']);
            $normalized[] = (object) $value;
        }
        $lock = 'ppms-batch-'.substr(hash('sha256', $id), 0, 40);
        if ((int) $this->store->row('SELECT GET_LOCK(?,5) AS acquired', array($lock))['acquired'] !== 1) { throw new Ppms_problem('BATCH_BUSY', 409); }
        try {
            $batch = $this->store->transaction(function () use ($actor, $form, $device, $version, $id, $requestedDate, $mutations, $normalized, $limit) {
                $this->store->lockForm($form);
                $this->auth->access($actor, $form);
                $this->devices->lease($form, $device, $version);
                $existing = $this->store->row('SELECT * FROM SyncDailyBatch WHERE id=?', array($id));
                // Default the date once. The identical omitted-date request retains its identity across midnight.
                $date = $requestedDate ?? ($existing['businessDate'] ?? (new DateTimeImmutable('now',
                    new DateTimeZone(ppms_config('PLANT_TIMEZONE', 'Asia/Manila'))))->format('Y-m-d'));
                $hash = Ppms_values::hash((object) array('id' => $id, 'ppmFormId' => $form, 'deviceId' => $device,
                    'leaseVersion' => $version, 'businessDate' => $date, 'mutations' => $normalized));
                if ($existing) {
                    if ($existing['payloadHash'] !== $hash || $existing['userId'] !== $actor['id'] || $existing['deviceId'] !== $device) { throw new Ppms_problem('BATCH_ID_REUSED', 409); }
                    return $existing;
                }
                // Configuration changes cannot invalidate an already accepted immutable request.
                // This definitive rejection happens before a batch header or mutation receipt exists.
                if (count($mutations) > $limit) {
                    throw new Ppms_problem('INVALID_BATCH_SIZE', 422, array('maxBatchSize' => $limit, 'accepted' => FALSE));
                }
                $manifest = array();
                foreach ($normalized as $mutation) {
                    $manifest[] = array('clientMutationId' => $mutation->clientMutationId ?? NULL,
                        'userId' => $mutation->userId ?? NULL, 'recordId' => $mutation->recordId ?? NULL,
                        'operationType' => $mutation->operationType ?? NULL, 'payloadHash' => Ppms_values::hash($mutation));
                }
                $number = (int) $this->store->row('SELECT COALESCE(MAX(batchNo),0)+1 AS n FROM SyncDailyBatch WHERE ppmFormId=? AND businessDate=?', array($form, $date))['n'];
                $this->store->insert('SyncDailyBatch', array('id' => $id, 'ppmFormId' => $form, 'deviceId' => $device,
                    'userId' => $actor['id'], 'leaseVersion' => $version, 'businessDate' => $date, 'batchNo' => $number,
                    'status' => 'PUSHING', 'payloadHash' => $hash, 'manifestJson' => Ppms_values::json($manifest), 'mutationCount' => count($mutations), 'pushedAt' => Ppms_values::now()));
                return $this->store->row('SELECT * FROM SyncDailyBatch WHERE id=?', array($id));
            });
            if ($batch['resultJson'] !== NULL) { return $batch['resultJson']; }
            $results = array();
            $counts = array('APPLIED' => 0, 'CONFLICT' => 0, 'REJECTED' => 0);
            foreach ($mutations as $raw) {
                $result = $this->process($actor, $form, $device, $version, $id, (array) $raw);
                $results[] = $result;
                $counts[$result['status']]++;
            }
            $status = $counts['APPLIED'] === count($mutations) ? 'ACCEPTED'
                : ($counts['REJECTED'] === count($mutations) ? 'REJECTED' : ($counts['CONFLICT'] === count($mutations) ? 'CONFLICTED' : 'PARTIAL'));
            $response = array('id' => $id, 'batchNo' => (int) $batch['batchNo'], 'businessDate' => $batch['businessDate'], 'status' => $status,
                'acceptedCount' => $counts['APPLIED'], 'conflictCount' => $counts['CONFLICT'], 'rejectedCount' => $counts['REJECTED'], 'results' => $results);
            $this->store->execute('UPDATE SyncDailyBatch SET status=?,acceptedCount=?,conflictCount=?,rejectedCount=?,resultJson=?,completedAt=UTC_TIMESTAMP(3) WHERE id=?',
                array($status, $counts['APPLIED'], $counts['CONFLICT'], $counts['REJECTED'], Ppms_values::json($response), $id));
            return $response;
        } finally {
            $this->store->row('SELECT RELEASE_LOCK(?) AS released', array($lock));
        }
    }
    /** Read durable outcomes even after a device lease is rotated; this never accepts new work. */
    public function status($actor, $id)
    {
        $batch = $this->store->row('SELECT * FROM SyncDailyBatch WHERE id=?', array($id));
        if (!$batch) { throw new Ppms_problem('BATCH_NOT_FOUND', 404); }
        $this->auth->access($actor, $batch['ppmFormId']);
        if ($actor['role'] !== 'ADMIN' && $actor['id'] !== $batch['userId']) { throw new Ppms_problem('BATCH_ACCESS_DENIED', 403); }
        unset($batch['manifestJson']);
        $batch['batchNo'] = (int) $batch['batchNo'];
        return $batch;
    }
    public function listing($actor, $input = array())
    {
        $this->auth->admin($actor);
        $limit = min(100, max(1, (int) ($input['limit'] ?? 25)));
        $where = array('id>?');
        $parameters = array((string) ($input['afterId'] ?? ''));
        if (!empty($input['ppmFormId'])) { $where[] = 'ppmFormId=?'; $parameters[] = Ppms_values::text($input, 'ppmFormId'); }
        if (!empty($input['status'])) {
            if (!in_array($input['status'], array('PUSHING','PARTIAL','ACCEPTED','CONFLICTED','REJECTED'), TRUE)) { throw new Ppms_problem('INVALID_BATCH_STATUS'); }
            $where[] = 'status=?'; $parameters[] = $input['status'];
        }
        $parameters[] = $limit + 1;
        $items = $this->store->rows('SELECT id,ppmFormId,userId,deviceId,businessDate,batchNo,status,payloadHash,mutationCount,acceptedCount,conflictCount,rejectedCount,createdAt,completedAt FROM SyncDailyBatch WHERE '.implode(' AND ', $where).' ORDER BY id LIMIT ?', $parameters);
        $more = count($items) > $limit;
        if ($more) { array_pop($items); }
        foreach ($items as &$item) { $item['batchNo'] = (int) $item['batchNo']; }
        unset($item);
        return array('items' => $items, 'nextAfterId' => $more ? end($items)['id'] : NULL, 'hasMore' => $more);
    }
    /** Explicit administrative disposition after a worker failure. Applied receipts remain immutable. */
    public function recover($actor, $id, $input)
    {
        $this->auth->admin($actor);
        $reason = Ppms_values::text($input, 'reason', 2000);
        $hash = Ppms_values::text($input, 'expectedPayloadHash', 64);
        if (($input['action'] ?? NULL) !== 'FINALIZE') { throw new Ppms_problem('INVALID_RECOVERY_ACTION'); }
        $lock = 'ppms-batch-'.substr(hash('sha256', $id), 0, 40);
        if ((int) $this->store->row('SELECT GET_LOCK(?,0) AS acquired', array($lock))['acquired'] !== 1) { throw new Ppms_problem('BATCH_BUSY', 409); }
        try {
            return $this->store->transaction(function () use ($actor, $id, $reason, $hash) {
                $initial = $this->store->row('SELECT ppmFormId FROM SyncDailyBatch WHERE id=?', array($id));
                if (!$initial) { throw new Ppms_problem('BATCH_NOT_FOUND', 404); }
                $this->store->lockForm($initial['ppmFormId']);
                $batch = $this->store->row('SELECT * FROM SyncDailyBatch WHERE id=? FOR UPDATE', array($id));
                if (!hash_equals($batch['payloadHash'], $hash)) { throw new Ppms_problem('BATCH_CHANGED', 409); }
                if ($batch['resultJson'] !== NULL) { return $batch['resultJson']; }
                if ($batch['status'] !== 'PUSHING') { throw new Ppms_problem('BATCH_NOT_RECOVERABLE', 409); }
                $results = array(); $unprocessed = 0;
                $counts = array('APPLIED' => 0, 'CONFLICT' => 0, 'REJECTED' => 0);
                $manifest = $batch['manifestJson'] ?? NULL;
                if (is_array($manifest)) {
                    foreach ($manifest as $entry) {
                        $entry = (array) $entry;
                        $receipt = is_string($entry['clientMutationId'] ?? NULL)
                            ? $this->store->row('SELECT * FROM SyncMutationReceipt WHERE clientMutationId=?', array($entry['clientMutationId'])) : NULL;
                        if ($receipt && $receipt['payloadHash'] === ($entry['payloadHash'] ?? NULL)
                            && $receipt['userId'] === ($entry['userId'] ?? NULL) && $receipt['deviceId'] === $batch['deviceId']
                            && $receipt['ppmFormId'] === $batch['ppmFormId'] && $receipt['resultJson'] !== NULL) {
                            $result = (array) $receipt['resultJson'];
                        } else {
                            $unprocessed++;
                            $result = array('clientMutationId' => $entry['clientMutationId'] ?? NULL, 'status' => 'REJECTED',
                                'error' => 'RECOVERY_NOT_PROCESSED', 'requiresReconciliation' => TRUE);
                        }
                        $results[] = $result;
                        $counts[$result['status']]++;
                    }
                } else {
                    // Old batches did not retain a manifest. Report unknown work explicitly, never guess success.
                    foreach ($this->store->rows('SELECT resultJson FROM SyncMutationReceipt WHERE batchId=? AND resultJson IS NOT NULL ORDER BY receivedAt,id', array($id)) as $receipt) {
                        $result = (array) $receipt['resultJson']; $results[] = $result; $counts[$result['status']]++;
                    }
                    $unprocessed = max(0, (int) $batch['mutationCount'] - count($results));
                    $counts['REJECTED'] += $unprocessed;
                }
                $status = (int) $batch['mutationCount'] > 0 && $counts['APPLIED'] === (int) $batch['mutationCount'] ? 'ACCEPTED'
                    : ($counts['REJECTED'] === (int) $batch['mutationCount'] ? 'REJECTED'
                    : ($counts['CONFLICT'] === (int) $batch['mutationCount'] ? 'CONFLICTED' : 'PARTIAL'));
                $response = array('id' => $id, 'batchNo' => (int) $batch['batchNo'], 'businessDate' => $batch['businessDate'],
                    'status' => $status, 'acceptedCount' => $counts['APPLIED'], 'conflictCount' => $counts['CONFLICT'],
                    'rejectedCount' => $counts['REJECTED'], 'results' => $results, 'recovered' => TRUE,
                    'unresolvedCount' => $unprocessed, 'manifestAvailable' => is_array($manifest),
                    'requiresReconciliation' => $unprocessed > 0 || !is_array($manifest));
                $this->store->execute('UPDATE SyncDailyBatch SET status=?,acceptedCount=?,conflictCount=?,rejectedCount=?,resultJson=?,completedAt=UTC_TIMESTAMP(3) WHERE id=?',
                    array($status, $counts['APPLIED'], $counts['CONFLICT'], $counts['REJECTED'], Ppms_values::json($response), $id));
                $this->store->audit($actor, 'CONFIG_CHANGE', 'SyncDailyBatch', $id,
                    array('action' => 'RECOVER_BATCH', 'reason' => $reason, 'result' => $response),
                    array('ppmFormId' => $batch['ppmFormId'], 'deviceId' => $batch['deviceId'], 'batchId' => $id));
                return $response;
            });
        } finally { $this->store->row('SELECT RELEASE_LOCK(?) AS released', array($lock)); }
    }
    private function recoveryMetadata($actor, $form, $mutation)
    {
        if (!isset($mutation['recoveryOfMutationId'])) { return NULL; }
        $prior = Ppms_values::text($mutation, 'recoveryOfMutationId');
        $reason = Ppms_values::text($mutation, 'recoveryReason', 2000);
        $metadata = array('action' => 'RECONCILIATION_REQUEUED', 'recoveryOfMutationId' => $prior, 'reason' => $reason);
        if (isset($mutation['recoveryOfBatchId'])) {
            $batchId = Ppms_values::text($mutation, 'recoveryOfBatchId');
            $batch = $this->store->row('SELECT * FROM SyncDailyBatch WHERE id=?', array($batchId));
            if (!$batch || $batch['ppmFormId'] !== $form || $batch['resultJson'] === NULL) { throw new Ppms_problem('RECOVERY_REFERENCE_INVALID', 409); }
            $rejected = FALSE; $authored = FALSE;
            foreach (($batch['resultJson']->results ?? array()) as $outcome) {
                if (($outcome->clientMutationId ?? NULL) === $prior && ($outcome->status ?? NULL) === 'REJECTED') { $rejected = TRUE; }
            }
            foreach (($batch['manifestJson'] ?? array()) as $entry) {
                if (($entry->clientMutationId ?? NULL) === $prior && ($entry->userId ?? NULL) === $actor['id']
                    && ($entry->recordId ?? NULL) === ($mutation['recordId'] ?? NULL)) { $authored = TRUE; }
            }
            if (!$authored && $batch['manifestJson'] === NULL) {
                $authored = (bool) $this->store->row('SELECT id FROM SyncMutationReceipt WHERE clientMutationId=? AND userId=? AND ppmFormId=? AND recordId=? AND status=\'REJECTED\'',
                    array($prior, $actor['id'], $form, $mutation['recordId']));
            }
            if (!$rejected || !$authored) { throw new Ppms_problem('RECOVERY_REFERENCE_INVALID', 409); }
            $metadata['recoveryOfBatchId'] = $batchId; $metadata['source'] = 'VERIFIED_REJECTION';
        } else {
            if (($mutation['recoverySource'] ?? NULL) !== 'LOCAL_UNATTEMPTED') { throw new Ppms_problem('RECOVERY_REFERENCE_INVALID', 409); }
            $metadata['source'] = 'CLIENT_DECLARED_UNATTEMPTED';
        }
        return $metadata;
    }
    private function process($uploader, $form, $device, $version, $batchId, $mutation)
    {
        $clientId = NULL;
        $mutationLock = NULL;
        $locked = FALSE;
        try {
            $clientId = Ppms_values::text($mutation, 'clientMutationId');
            $recordId = Ppms_values::text($mutation, 'recordId');
            $operation = Ppms_values::text($mutation, 'operationType');
            if (!in_array($operation, array('CREATE_DRAFT','UPDATE_DRAFT','QUEUE_SUBMIT','CONFLICT_RESOLUTION','DELETE_RECORD'), TRUE)) { throw new Ppms_problem('UNSUPPORTED_MUTATION'); }
            Ppms_values::integer($mutation, 'baseRevisionNo', 0, 2147483647);
            // Receipt identity is global, so different form locks cannot protect
            // two simultaneous uses of the same mutation ID by themselves.
            $mutationLock = 'ppms-mutation-'.substr(hash('sha256', $clientId), 0, 40);
            $locked = (int) $this->store->row('SELECT GET_LOCK(?,10) AS acquired', array($mutationLock))['acquired'] === 1;
            if (!$locked) { throw new RuntimeException('Mutation processing is busy; retry the batch.'); }
            return $this->store->transaction(function () use ($uploader, $form, $device, $version, $batchId, $mutation, $clientId, $recordId, $operation) {
                $this->store->lockForm($form);
                $this->auth->access($uploader, $form);
                $this->devices->lease($form, $device, $version);
                $owner = Ppms_values::text($mutation, 'userId');
                $logical = $mutation;
                unset($logical['authorProof']);
                $hash = Ppms_values::hash((object) $logical);
                $existing = $this->store->row('SELECT * FROM SyncMutationReceipt WHERE clientMutationId=?', array($clientId));
                if ($existing) {
                    if ($existing['payloadHash'] !== $hash || $existing['userId'] !== $owner || $existing['deviceId'] !== $device || $existing['ppmFormId'] !== $form) { throw new Ppms_problem('MUTATION_ID_REUSED', 409); }
                    return (array) $existing['resultJson'];
                }
                // Replaying a committed receipt is a read. Only new operations
                // require an unexpired author grant and current write permission.
                $actor = $this->devices->author($uploader, $mutation, $form, $device, $version);
                $this->auth->access($actor, $form, $operation === 'CREATE_DRAFT' ? 'canCreate' : 'canEdit');
                $mutation = $logical;
                $receipt = Ppms_values::id();
                $context = array('receiptId' => $receipt, 'deviceId' => $device, 'batchId' => $batchId,
                    'ppmFormId' => $form, 'clientMutationId' => $clientId, 'baseRevisionNo' => $mutation['baseRevisionNo']);
                $this->store->insert('SyncMutationReceipt', array('id' => $receipt, 'clientMutationId' => $clientId,
                    'deviceId' => $device, 'userId' => $actor['id'], 'ppmFormId' => $form, 'batchId' => $batchId,
                    'leaseVersion' => $version, 'operationType' => $operation, 'baseRevisionNo' => $mutation['baseRevisionNo'],
                    'status' => 'REJECTED', 'payloadHash' => $hash));
                $this->store->mutationSavepoint();
                $recovery = NULL;
                try {
                    $recovery = $this->recoveryMetadata($actor, $form, $mutation);
                    if (isset($mutation['dependsOnMutationId'])) {
                        $dependencyId = Ppms_values::text($mutation, 'dependsOnMutationId');
                        $dependency = $this->store->row('SELECT * FROM SyncMutationReceipt WHERE clientMutationId=?', array($dependencyId));
                        if (!$dependency || $dependency['status'] !== 'APPLIED' || $dependency['recordId'] !== $recordId
                            || $dependency['ppmFormId'] !== $form || $dependency['deviceId'] !== $device
                            || $dependency['userId'] !== $actor['id'] || (int) $dependency['resultRevisionNo'] !== $mutation['baseRevisionNo']) {
                            throw new Ppms_problem('DEPENDENCY_NOT_APPLIED', 409);
                        }
                    }
                    $result = $this->records->apply($actor, $form, $mutation, $context);
                } catch (Ppms_problem $error) {
                    $this->store->mutationSavepoint(TRUE);
                    $result = array('status' => 'REJECTED', 'error' => $error->getMessage(), 'details' => (object) $error->details);
                    $this->store->audit($actor, 'SYNC_REJECTED', 'SyncMutationReceipt', $receipt, $result, $context);
                }
                if ($recovery !== NULL) {
                    $this->store->audit($actor, 'CONFIG_CHANGE', 'SyncMutationReceipt', $receipt, $recovery + array('outcome' => $result['status']), $context);
                }
                $result['clientMutationId'] = $clientId;
                $result['receiptId'] = $receipt;
                $existingRecord = $this->store->row('SELECT r.id FROM PpmRecord r JOIN AreaPpmAssignment a ON a.id=r.areaPpmAssignmentId WHERE r.id=? AND a.ppmFormId=?', array($recordId, $form));
                $this->store->execute('UPDATE SyncMutationReceipt SET recordId=?,status=?,resultRevisionNo=?,resultJson=?,appliedAt=? WHERE id=?',
                    array($existingRecord ? $recordId : NULL, $result['status'], $result['revisionNo'] ?? NULL,
                        Ppms_values::json($result), $result['status'] === 'APPLIED' ? Ppms_values::now() : NULL, $receipt));
                return $result;
            });
        } catch (Ppms_problem $error) {
            $this->store->audit($uploader, 'SYNC_REJECTED', 'SyncMutationReceipt', $clientId ?? $batchId,
                array('error' => $error->getMessage()), array('ppmFormId' => $form, 'deviceId' => $device,
                    'batchId' => $batchId, 'clientMutationId' => $clientId));
            return array('status' => 'REJECTED', 'clientMutationId' => $mutation['clientMutationId'] ?? NULL,
                'error' => $error->getMessage(), 'details' => (object) $error->details);
        } finally {
            if ($locked) { $this->store->row('SELECT RELEASE_LOCK(?) AS released', array($mutationLock)); }
        }
    }
}
