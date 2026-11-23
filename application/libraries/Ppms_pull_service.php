<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

/** Authorized snapshots and a per-device feed. Reads never acknowledge data. */
class Ppms_pull_service
{
    private $store;
    private $auth;
    private $devices;
    private $records;
    private $trace;
    public function __construct()
    {
        $ci =& get_instance();
        $ci->load->library(array('ppms_auth_service','ppms_device_service','ppms_record_service','ppms_trace_service'));
        $this->store = $ci->ppms_store;
        $this->auth = $ci->ppms_auth_service;
        $this->devices = $ci->ppms_device_service;
        $this->records = $ci->ppms_record_service;
        $this->trace = $ci->ppms_trace_service;
    }
    private function context($actor, $input, $write = FALSE)
    {
        $form = Ppms_values::text($input, 'ppmFormId');
        $device = Ppms_values::text($input, 'deviceId');
        $version = Ppms_values::integer($input, 'leaseVersion', 1);
        if ($write) { $this->store->lockForm($form); }
        $this->auth->access($actor, $form);
        $this->devices->lease($form, $device, $version);
        return array('ppmFormId' => $form, 'deviceId' => $device, 'leaseVersion' => $version);
    }
    public function bootstrap($actor, $input)
    {
        return $this->store->transaction(function () use ($actor, $input) {
            $context = $this->context($actor, $input);
            $form = $context['ppmFormId'];
            $connections = $this->connections($form);
            $zone = ppms_config('PLANT_TIMEZONE', 'Asia/Manila');
            $limit = isset($input['limit']) ? Ppms_values::integer($input, 'limit', 1, 200) : 100;
            $budget = isset($input['maxBytes']) ? Ppms_values::integer($input, 'maxBytes', 16384, 4194304) : 1048576;
            if (isset($input['pageToken'])) {
                $state = $this->devices->verify($input['pageToken'], 'bootstrap');
                foreach ($context + array('userId' => $actor['id']) as $key => $value) {
                    if (($state[$key] ?? NULL) !== $value) { throw new Ppms_problem('BOOTSTRAP_PROOF_MISMATCH', 403); }
                }
                foreach ($state['streams'] as $stream) { $this->sourceAccess($form, $stream['id']); }
            } else {
                $days = max(1, min(365, (int) $this->store->setting('offline.maxCachedRecordDays', 7)));
                $cutoff = (new DateTimeImmutable('today', new DateTimeZone($zone)))->modify('-'.$days.' days')->format('Y-m-d');
                $streams = array();
                foreach (array_unique(array_merge(array_column($connections, 'sourcePpmFormId'), array($form))) as $source) {
                    $sequence = (string) $this->store->row('SELECT COALESCE(MAX(sequence),0) AS n FROM SyncChangeEvent WHERE ppmFormId=?', array($source))['n'];
                    $streams[] = array('id' => $source, 'sequence' => $sequence, 'after' => '', 'done' => FALSE);
                }
                $state = $context + array('kind' => 'bootstrap', 'userId' => $actor['id'], 'cutoff' => $cutoff,
                    'recordsAfter' => '', 'recordsDone' => FALSE, 'templatesAfter' => '', 'templatesDone' => FALSE,
                    'streams' => $streams, 'expiresAt' => time() + 3600);
            }
            $records = array(); $templates = array(); $outputs = array(); $count = 0; $bytes = 0; $full = FALSE;
            $append = function ($item, &$destination) use (&$count, &$bytes, &$full, $limit, $budget) {
                $size = strlen(Ppms_values::json($item));
                if ($size > 4194304) { throw new Ppms_problem('SYNC_ITEM_TOO_LARGE', 413); }
                if ($count >= $limit || ($count > 0 && $bytes + $size > $budget)) { $full = TRUE; return FALSE; }
                $destination[] = $item; $count++; $bytes += $size; return TRUE;
            };
            if (!$state['recordsDone']) {
                $rows = $this->store->rows('SELECT r.id FROM PpmRecord r JOIN AreaPpmAssignment a ON a.id=r.areaPpmAssignmentId
                    WHERE a.ppmFormId=? AND r.productionDate>=? AND r.id>? ORDER BY r.id LIMIT ?',
                    array($form, $state['cutoff'], $state['recordsAfter'], $limit + 1));
                foreach ($rows as $row) {
                    if (!$append($this->records->projection($actor, $row['id']), $records)) { break; }
                    $state['recordsAfter'] = $row['id'];
                }
                if (!$full) { $state['recordsDone'] = TRUE; }
            }
            if (!$full && !$state['templatesDone']) {
                $rows = $this->store->rows('SELECT id FROM PpmTemplateVersion WHERE ppmFormId=? AND publishedAt IS NOT NULL AND id>? ORDER BY id LIMIT ?',
                    array($form, $state['templatesAfter'], $limit + 1));
                foreach ($rows as $row) {
                    $template = $this->store->row('SELECT * FROM PpmTemplateVersion WHERE id=?', array($row['id']));
                    unset($template['activePpmFormId']);
                    if (!$append($template, $templates)) { break; }
                    $state['templatesAfter'] = $template['id'];
                }
                if (!$full) { $state['templatesDone'] = TRUE; }
            }
            foreach ($state['streams'] as &$stream) {
                $outputs[$stream['id']] = array();
                if ($full || $stream['done']) { continue; }
                $rows = $this->eligibleOutputs($form, $stream['id'], $stream['after'], $limit + 1);
                foreach ($rows as $row) {
                    if (!$append($this->trace->outputView($row), $outputs[$stream['id']])) { break; }
                    $stream['after'] = $row['id'];
                }
                if (!$full) { $stream['done'] = TRUE; }
            }
            unset($stream);
            $complete = $state['recordsDone'] && $state['templatesDone'];
            foreach ($state['streams'] as $stream) { $complete = $complete && $stream['done']; }
            $sources = array();
            foreach ($state['streams'] as $stream) {
                $source = array('sourcePpmFormId' => $stream['id'], 'outputs' => $outputs[$stream['id']] ?? array(), 'sequence' => $stream['sequence']);
                // A partial page is never an acknowledgement of a complete snapshot.
                if ($complete) { $source['cursorToken'] = $this->cursorToken($context, $stream['id'], $stream['sequence']); }
                $sources[] = $source;
            }
            $nextPageToken = $complete ? NULL : $this->devices->sign($state);
            if ($nextPageToken !== NULL && strlen($nextPageToken) > 65536) { throw new Ppms_problem('SYNC_CONFIGURATION_TOO_LARGE', 422); }
            $formView = $this->store->row('SELECT * FROM PpmForm WHERE id=?', array($form));
            $formView['permissions'] = array('canView' => TRUE);
            foreach (array('canCreate','canEdit','canPublish') as $permission) {
                try { $this->auth->access($actor, $form, $permission); $formView['permissions'][$permission] = TRUE; }
                catch (Ppms_problem $error) { if ($error->status !== 403) { throw $error; } $formView['permissions'][$permission] = FALSE; }
            }
            return $context + array('plantTimezone' => $zone, 'recordCacheFrom' => $state['cutoff'],
                'maxBatchSize' => max(1, min(500, (int) $this->store->setting('sync.batchSize', 50))),
                'form' => $formView,
                'areaAssignments' => $this->store->rows('SELECT * FROM AreaPpmAssignment WHERE ppmFormId=? AND isActive=1 ORDER BY id LIMIT 200', array($form)),
                'personnel' => $this->store->rows('SELECT u.id,u.displayName,u.role,p.canView,p.canCreate,p.canEdit,p.canPublish FROM PersonnelPpmAssignment p
                    JOIN User u ON u.id=p.userId WHERE p.ppmFormId=? AND p.isActive=1 AND u.accountStatus=\'ACTIVE\' ORDER BY u.id LIMIT 200', array($form)),
                'templates' => $templates, 'records' => $records, 'connections' => $connections, 'sources' => $sources,
                'hasMore' => !$complete, 'pageToken' => $nextPageToken,
                'offlineMaxAccessHours' => (int) $this->store->setting('offline.maxAccessHours', 24));
        });
    }
    public function pull($actor, $input)
    {
        return $this->store->transaction(function () use ($actor, $input) {
            $context = $this->context($actor, $input);
            $source = Ppms_values::text($input, 'sourcePpmFormId');
            $this->sourceAccess($context['ppmFormId'], $source);
            $cursor = $this->store->row('SELECT lastEventSequence FROM SyncFormPullCursor WHERE deviceId=? AND ppmFormId=? AND sourcePpmFormId=?', array($context['deviceId'], $context['ppmFormId'], $source));
            $acknowledged = (string) ($cursor['lastEventSequence'] ?? '0');
            $after = $this->sequence($input['afterSequence'] ?? $acknowledged);
            if ((int) $after > (int) $acknowledged) { throw new Ppms_problem('CURSOR_NOT_ACKNOWLEDGED', 409); }
            $limit = isset($input['limit']) ? Ppms_values::integer($input, 'limit', 1, 500) : 100;
            $budget = isset($input['maxBytes']) ? Ppms_values::integer($input, 'maxBytes', 16384, 4194304) : 1048576;
            // Fetch bounded metadata first; never allocate hundreds of full record histories.
            $rows = $this->store->rows('SELECT sequence,ppmFormId,eventType,recordId,revisionId,outputKey,createdAt,
                OCTET_LENGTH(payloadJson) AS payloadBytes,JSON_CONTAINS_PATH(payloadJson,\'one\',\'$.revisions\') AS legacyHistory
                FROM SyncChangeEvent WHERE ppmFormId=? AND sequence>? ORDER BY sequence LIMIT ?', array($source, $after, $limit + 1));
            $more = count($rows) > $limit;
            if ($more) { array_pop($rows); }
            $next = $after; $bytes = 0; $events = array();
            $own = $source === $context['ppmFormId'];
            $allowedKeys = array();
            foreach ($this->connections($context['ppmFormId']) as $connection) {
                if ($connection['sourcePpmFormId'] === $source) { $allowedKeys[] = $connection['sourceOutputKey']; }
            }
            foreach ($rows as $row) {
                $row['sequence'] = (string) $row['sequence'];
                if (!$own && (!in_array($row['outputKey'], $allowedKeys, TRUE)
                    || !in_array($row['eventType'], array('TRACE_OUTPUT_PUBLISHED','TRACE_OUTPUT_RETIRED'), TRUE))) {
                    $next = $row['sequence']; continue;
                }
                if ($own && (int) $row['legacyHistory'] && $row['recordId']) {
                    // Legacy stored events remain immutable; their wire representation is a compact current projection.
                    $payload = $this->records->projection($actor, $row['recordId']);
                } else {
                    if ((int) $row['payloadBytes'] > 4194304) { throw new Ppms_problem('SYNC_ITEM_TOO_LARGE', 413); }
                    $payload = $this->store->row('SELECT payloadJson FROM SyncChangeEvent WHERE sequence=?', array($row['sequence']))['payloadJson'];
                }
                if (!$own) {
                    $outputId = $payload->id ?? NULL;
                    if ($row['eventType'] === 'TRACE_OUTPUT_PUBLISHED') {
                        $eligible = $this->eligibleOutputs($context['ppmFormId'], $source, '', 1, $outputId);
                        if (!$eligible) { $next = $row['sequence']; continue; }
                        $payload = $this->trace->outputView($eligible[0]);
                    } else {
                        $payload = array('id' => $outputId, 'status' => $payload->status ?? 'SUPERSEDED', 'outputKey' => $row['outputKey']);
                    }
                }
                unset($row['payloadBytes'], $row['legacyHistory']);
                $row['payloadJson'] = $payload;
                $size = strlen(Ppms_values::json($row));
                if ($size > 4194304) { throw new Ppms_problem('SYNC_ITEM_TOO_LARGE', 413); }
                if ($events && $bytes + $size > $budget) { $more = TRUE; break; }
                $events[] = $row; $bytes += $size; $next = $row['sequence'];
            }
            return array('events' => $events, 'sourcePpmFormId' => $source, 'nextSequence' => $next,
                'hasMore' => $more, 'cursorToken' => $this->cursorToken($context, $source, $next));
        });
    }
    public function acknowledge($actor, $input)
    {
        return $this->store->transaction(function () use ($actor, $input) {
            $context = $this->context($actor, $input, TRUE);
            $claims = $this->devices->verify($input['cursorToken'] ?? NULL, 'cursor');
            foreach ($context as $key => $value) {
                if (($claims[$key] ?? NULL) !== $value) { throw new Ppms_problem('CURSOR_PROOF_MISMATCH', 403); }
            }
            $source = $claims['sourcePpmFormId'];
            $this->sourceAccess($context['ppmFormId'], $source);
            $sequence = $this->sequence($claims['sequence']);
            $this->store->execute('INSERT INTO SyncFormPullCursor (deviceId,ppmFormId,sourcePpmFormId,lastEventSequence,updatedAt) VALUES (?,?,?,?,UTC_TIMESTAMP(3))
                ON DUPLICATE KEY UPDATE lastEventSequence=GREATEST(lastEventSequence,VALUES(lastEventSequence)),updatedAt=UTC_TIMESTAMP(3)', array($context['deviceId'], $context['ppmFormId'], $source, $sequence));
            $cursor = $this->store->row('SELECT lastEventSequence FROM SyncFormPullCursor WHERE deviceId=? AND ppmFormId=? AND sourcePpmFormId=?', array($context['deviceId'], $context['ppmFormId'], $source));
            return array('sourcePpmFormId' => $source, 'lastEventSequence' => (string) $cursor['lastEventSequence']);
        });
    }
    private function connections($target)
    {
        $rows = $this->store->rows('SELECT c.* FROM PpmTraceConnection c JOIN PpmForm f ON f.id=c.sourcePpmFormId WHERE c.targetPpmFormId=? AND c.status=\'ACTIVE\' AND f.status=\'ACTIVE\' ORDER BY c.sourcePpmFormId,c.id LIMIT 65', array($target));
        if (count($rows) > 64) { throw new Ppms_problem('SYNC_CONNECTION_LIMIT_EXCEEDED', 422); }
        return $rows;
    }
    private function sourceAccess($target, $source)
    {
        if ($source === $target) { return; }
        foreach ($this->connections($target) as $connection) { if ($connection['sourcePpmFormId'] === $source) { return; } }
        throw new Ppms_problem('SYNC_SOURCE_NOT_AUTHORIZED', 403);
    }
    private function eligibleOutputs($target, $source, $after = '', $limit = 101, $id = NULL)
    {
        $extra = ' AND o.id>?'.($id !== NULL ? ' AND o.id=?' : '').' ';
        $paging = array($after);
        if ($id !== NULL) { $paging[] = $id; }
        $paging[] = $limit;
        if ($target === $source) {
            return $this->store->rows('SELECT o.* FROM PpmTraceOutput o JOIN PpmRecord r ON r.id=o.recordId JOIN PpmTemplateVersion t ON t.id=r.templateVersionId
                WHERE t.ppmFormId=? '.$extra.' AND o.status IN (\'PUBLISHED\',\'LINKED_DOWNSTREAM\') AND r.archivedAt IS NULL
                AND NOT EXISTS (SELECT 1 FROM TraceRevalidationItem i JOIN PpmTraceLink l ON l.id=i.traceLinkId JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId
                    WHERE v.recordId=r.id AND i.status<>\'RESOLVED\') ORDER BY o.id LIMIT ?', array_merge(array($source), $paging));
        }
        return $this->store->rows('SELECT DISTINCT o.* FROM PpmTraceOutput o JOIN PpmRecord r ON r.id=o.recordId JOIN PpmTemplateVersion t ON t.id=r.templateVersionId
            JOIN PpmTraceConnection c ON c.sourcePpmFormId=t.ppmFormId AND c.sourceOutputKey=o.outputKey
            WHERE c.targetPpmFormId=? AND c.sourcePpmFormId=? '.$extra.' AND c.status=\'ACTIVE\' AND o.status IN (\'PUBLISHED\',\'LINKED_DOWNSTREAM\') AND r.archivedAt IS NULL
            AND NOT EXISTS (SELECT 1 FROM TraceRevalidationItem i JOIN PpmTraceLink l ON l.id=i.traceLinkId JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId
                WHERE v.recordId=r.id AND i.status<>\'RESOLVED\') ORDER BY o.id LIMIT ?', array_merge(array($target, $source), $paging));
    }
    private function cursorToken($context, $source, $sequence)
    {
        return $this->devices->sign($context + array('kind' => 'cursor', 'sourcePpmFormId' => $source, 'sequence' => (string) $sequence, 'expiresAt' => time() + 86400));
    }
    private function sequence($value)
    {
        if ((!is_string($value) && !is_int($value)) || !preg_match('/^(0|[1-9]\d{0,18})$/D', (string) $value) || strlen((string) $value) > strlen((string) PHP_INT_MAX)
            || (strlen((string) $value) === strlen((string) PHP_INT_MAX) && strcmp((string) $value, (string) PHP_INT_MAX) > 0)) { throw new Ppms_problem('INVALID_EVENT_SEQUENCE'); }
        return (string) $value;
    }
}
