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
        $date = isset($input['businessDate']) ? Ppms_values::date($input['businessDate'])
            : (new DateTimeImmutable('now', new DateTimeZone(ppms_config('PLANT_TIMEZONE', 'Asia/Manila'))))->format('Y-m-d');
        $mutations = $input['mutations'] ?? NULL;
        $limit = max(1, min(500, (int) $this->store->setting('sync.batchSize', 50)));
        if (!is_array($mutations) || !$mutations || count($mutations) > $limit) { throw new Ppms_problem('INVALID_BATCH_SIZE'); }
        $normalized = array();
        foreach ($mutations as $mutation) {
            $value = (array) Ppms_values::object($mutation);
            unset($value['authorProof']);
            $normalized[] = (object) $value;
        }
        $hash = Ppms_values::hash((object) array('id' => $id, 'ppmFormId' => $form, 'deviceId' => $device,
            'leaseVersion' => $version, 'businessDate' => $date, 'mutations' => $normalized));
        $lock = 'ppms-batch-'.substr(hash('sha256', $id), 0, 40);
        if ((int) $this->store->row('SELECT GET_LOCK(?,5) AS acquired', array($lock))['acquired'] !== 1) { throw new Ppms_problem('BATCH_BUSY', 409); }
        try {
            $batch = $this->store->transaction(function () use ($actor, $form, $device, $version, $id, $hash, $date, $mutations) {
                $this->store->lockForm($form);
                $this->auth->access($actor, $form);
                $this->devices->lease($form, $device, $version);
                $existing = $this->store->row('SELECT * FROM SyncDailyBatch WHERE id=?', array($id));
                if ($existing) {
                    if ($existing['payloadHash'] !== $hash || $existing['userId'] !== $actor['id'] || $existing['deviceId'] !== $device) { throw new Ppms_problem('BATCH_ID_REUSED', 409); }
                    return $existing;
                }
                $number = (int) $this->store->row('SELECT COALESCE(MAX(batchNo),0)+1 AS n FROM SyncDailyBatch WHERE ppmFormId=? AND businessDate=?', array($form, $date))['n'];
                $this->store->insert('SyncDailyBatch', array('id' => $id, 'ppmFormId' => $form, 'deviceId' => $device,
                    'userId' => $actor['id'], 'leaseVersion' => $version, 'businessDate' => $date, 'batchNo' => $number,
                    'status' => 'PUSHING', 'payloadHash' => $hash, 'mutationCount' => count($mutations), 'pushedAt' => Ppms_values::now()));
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
            $response = array('id' => $id, 'batchNo' => $batch['batchNo'], 'businessDate' => $date, 'status' => $status,
                'acceptedCount' => $counts['APPLIED'], 'conflictCount' => $counts['CONFLICT'], 'rejectedCount' => $counts['REJECTED'], 'results' => $results);
            $this->store->execute('UPDATE SyncDailyBatch SET status=?,acceptedCount=?,conflictCount=?,rejectedCount=?,resultJson=?,completedAt=UTC_TIMESTAMP(3) WHERE id=?',
                array($status, $counts['APPLIED'], $counts['CONFLICT'], $counts['REJECTED'], Ppms_values::json($response), $id));
            return $response;
        } finally {
            $this->store->row('SELECT RELEASE_LOCK(?) AS released', array($lock));
        }
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
            if (!in_array($operation, array('CREATE_DRAFT','UPDATE_DRAFT','QUEUE_SUBMIT','CONFLICT_RESOLUTION'), TRUE)) { throw new Ppms_problem('UNSUPPORTED_MUTATION'); }
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
                $actor = $this->devices->author($uploader, $mutation, $form, $device, $version);
                $this->auth->access($actor, $form, $operation === 'CREATE_DRAFT' ? 'canCreate' : 'canEdit');
                unset($mutation['authorProof']);
                $hash = Ppms_values::hash((object) $mutation);
                $existing = $this->store->row('SELECT * FROM SyncMutationReceipt WHERE clientMutationId=?', array($clientId));
                if ($existing) {
                    if ($existing['payloadHash'] !== $hash || $existing['userId'] !== $actor['id'] || $existing['deviceId'] !== $device || $existing['ppmFormId'] !== $form) { throw new Ppms_problem('MUTATION_ID_REUSED', 409); }
                    return (array) $existing['resultJson'];
                }
                $receipt = Ppms_values::id();
                $context = array('receiptId' => $receipt, 'deviceId' => $device, 'batchId' => $batchId,
                    'ppmFormId' => $form, 'clientMutationId' => $clientId, 'baseRevisionNo' => $mutation['baseRevisionNo']);
                $this->store->insert('SyncMutationReceipt', array('id' => $receipt, 'clientMutationId' => $clientId,
                    'deviceId' => $device, 'userId' => $actor['id'], 'ppmFormId' => $form, 'batchId' => $batchId,
                    'leaseVersion' => $version, 'operationType' => $operation, 'baseRevisionNo' => $mutation['baseRevisionNo'],
                    'status' => 'REJECTED', 'payloadHash' => $hash));
                $this->store->mutationSavepoint();
                try {
                    $result = $this->records->apply($actor, $form, $mutation, $context);
                } catch (Ppms_problem $error) {
                    $this->store->mutationSavepoint(TRUE);
                    $result = array('status' => 'REJECTED', 'error' => $error->getMessage(), 'details' => (object) $error->details);
                    $this->store->audit($actor, 'SYNC_REJECTED', 'SyncMutationReceipt', $receipt, $result, $context);
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
