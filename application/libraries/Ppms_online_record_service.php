<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

/** Online transport adapter. Record validation/conflicts remain in one service. */
class Ppms_online_record_service
{
    private $store;
    private $auth;
    private $records;
    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->library(array('ppms_auth_service','ppms_record_service'));
        $this->store = $ci->ppms_store;
        $this->auth = $ci->ppms_auth_service;
        $this->records = $ci->ppms_record_service;
    }
    public function write($actor, $id, $operation, $input)
    {
        $clientId = Ppms_values::text($input, 'clientMutationId');
        $id = $id ?? Ppms_values::text($input, 'recordId');
        $form = $operation === 'CREATE_DRAFT' ? Ppms_values::text($input, 'ppmFormId') : $this->records->find($id)['ppmFormId'];
        $base = Ppms_values::integer($input, 'baseRevisionNo', 0, 2147483647);
        $this->auth->access($actor, $form, $operation === 'CREATE_DRAFT' ? 'canCreate' : 'canEdit');
        $mutation = array_merge($input, array('recordId' => $id, 'operationType' => $operation,
            'baseRevisionNo' => $base, 'userId' => $actor['id']));
        unset($mutation['authorProof'], $mutation['deviceId'], $mutation['leaseVersion']);
        $hash = Ppms_values::hash((object) $mutation);
        $device = 'online-'.substr(hash('sha256', $actor['id']), 0, 40);
        $lock = 'ppms-mutation-'.substr(hash('sha256', $clientId), 0, 40);
        if ((int) $this->store->row('SELECT GET_LOCK(?,10) AS acquired', array($lock))['acquired'] !== 1) { throw new Ppms_problem('MUTATION_BUSY', 409); }
        try {
            $result = $this->store->transaction(function () use ($actor, $id, $form, $operation, $base, $clientId, $device, $hash, $mutation) {
                $this->store->lockForm($form);
                $this->auth->access($actor, $form, $operation === 'CREATE_DRAFT' ? 'canCreate' : 'canEdit');
                $existing = $this->store->row('SELECT * FROM SyncMutationReceipt WHERE clientMutationId=?', array($clientId));
                if ($existing) {
                    if ($existing['payloadHash'] !== $hash || $existing['userId'] !== $actor['id'] || $existing['deviceId'] !== $device || $existing['ppmFormId'] !== $form) {
                        throw new Ppms_problem('MUTATION_ID_REUSED', 409);
                    }
                    return (array) $existing['resultJson'];
                }
                $this->store->execute('INSERT IGNORE INTO ClientDevice (id,userId,deviceUuid,displayName,platform)
                    VALUES (?,?,?,?,?)', array($device, $actor['id'], 'web-api:'.hash('sha256', $actor['id']), 'Online web session', 'WEB_API'));
                $receipt = Ppms_values::id();
                $context = array('receiptId' => $receipt, 'deviceId' => $device, 'ppmFormId' => $form,
                    'clientMutationId' => $clientId, 'baseRevisionNo' => $base);
                $this->store->insert('SyncMutationReceipt', array('id' => $receipt, 'clientMutationId' => $clientId,
                    'deviceId' => $device, 'userId' => $actor['id'], 'ppmFormId' => $form, 'operationType' => $operation,
                    'baseRevisionNo' => $base, 'status' => 'REJECTED', 'payloadHash' => $hash));
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
                $exists = $this->store->row('SELECT r.id FROM PpmRecord r JOIN AreaPpmAssignment a ON a.id=r.areaPpmAssignmentId WHERE r.id=? AND a.ppmFormId=?', array($id, $form));
                $this->store->execute('UPDATE SyncMutationReceipt SET recordId=?,status=?,resultRevisionNo=?,resultJson=?,appliedAt=? WHERE id=?',
                    array($exists ? $id : NULL, $result['status'], $result['revisionNo'] ?? NULL, Ppms_values::json($result),
                        $result['status'] === 'APPLIED' ? Ppms_values::now() : NULL, $receipt));
                return $result;
            });
            $view = $this->store->row('SELECT r.id FROM PpmRecord r JOIN AreaPpmAssignment a ON a.id=r.areaPpmAssignmentId WHERE r.id=? AND a.ppmFormId=?', array($id, $form))
                ? $this->records->view($actor, $id) : NULL;
            return array('result' => $result, 'record' => $view);
        } finally { $this->store->row('SELECT RELEASE_LOCK(?) AS released', array($lock)); }
    }
}
