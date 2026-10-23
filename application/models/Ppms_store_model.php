<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once APPPATH.'libraries/Ppms_values.php';

/** Bound MySQLi persistence shared by the application services. */
class Ppms_store_model extends CI_Model
{
    private $connection;

    public function __construct()
    {
        parent::__construct();
        $this->load->library('ppms_database');
        $this->connection = $this->ppms_database->connection();
        $this->connection->query("SET time_zone='+00:00'");
    }

    public function execute($sql, $parameters = array())
    {
        $statement = $this->connection->prepare($sql);
        if ($parameters) {
            $types = '';
            foreach ($parameters as $value) { $types .= is_int($value) ? 'i' : (is_float($value) ? 'd' : 's'); }
            $statement->bind_param($types, ...$parameters);
        }
        $statement->execute();
        return $statement;
    }
    public function rows($sql, $parameters = array())
    {
        return array_map(array('Ppms_values', 'decode'), $this->execute($sql, $parameters)->get_result()->fetch_all(MYSQLI_ASSOC));
    }
    public function row($sql, $parameters = array())
    {
        return Ppms_values::decode($this->execute($sql, $parameters)->get_result()->fetch_assoc());
    }
    public function insert($table, $values)
    {
        $columns = array_map(array($this, 'identifier'), array_keys($values));
        $this->execute('INSERT INTO '.$this->identifier($table).' ('.implode(',', $columns).') VALUES ('.implode(',', array_fill(0, count($values), '?')).')', array_values($values));
    }
    public function transaction(callable $work)
    {
        $this->connection->begin_transaction();
        try {
            $result = $work();
            $this->connection->commit();
            return $result;
        } catch (Throwable $error) {
            $this->connection->rollback();
            throw $error;
        }
    }
    public function lockForm($formId)
    {
        $form = $this->row('SELECT * FROM PpmForm WHERE id=? FOR UPDATE', array($formId));
        if (!$form) { throw new Ppms_problem('FORM_NOT_FOUND', 404); }
        return $form;
    }
    public function audit($actor, $action, $entityType, $entityId, $after = array(), $context = array())
    {
        $this->insert('AuditLog', array(
            'id' => Ppms_values::id(), 'actorId' => $actor['id'], 'action' => $action,
            'entityType' => $entityType, 'entityId' => $entityId, 'message' => $action.' '.$entityType,
            'recordId' => $context['recordId'] ?? NULL, 'ppmFormId' => $context['ppmFormId'] ?? NULL,
            'batchId' => $context['batchId'] ?? NULL, 'clientDeviceId' => $context['deviceId'] ?? NULL,
            'clientMutationId' => $context['clientMutationId'] ?? NULL,
            'baseRevisionNo' => $context['baseRevisionNo'] ?? NULL, 'afterJson' => Ppms_values::json($after)
        ));
    }
    public function event($formId, $type, $payload, $recordId = NULL, $revisionId = NULL, $outputKey = NULL)
    {
        $this->insert('SyncChangeEvent', array('ppmFormId' => $formId, 'eventType' => $type,
            'payloadJson' => Ppms_values::json($payload), 'recordId' => $recordId,
            'revisionId' => $revisionId, 'outputKey' => $outputKey));
    }
    public function setting($key, $default)
    {
        $row = $this->row('SELECT valueJson FROM SystemSetting WHERE `key`=?', array($key));
        return $row ? $row['valueJson'] : $default;
    }
    private function identifier($value)
    {
        if (!preg_match('/^[A-Za-z][A-Za-z0-9_]*$/D', $value)) { throw new LogicException('Invalid internal SQL identifier.'); }
        return '`'.$value.'`';
    }
}
