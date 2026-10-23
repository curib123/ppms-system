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
    private function context($actor, $input)
    {
        $form = Ppms_values::text($input, 'ppmFormId');
        $device = Ppms_values::text($input, 'deviceId');
        $version = Ppms_values::integer($input, 'leaseVersion', 1);
        $this->store->lockForm($form);
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
            $sources = array();
            foreach (array_unique(array_merge(array($form), array_column($connections, 'sourcePpmFormId'))) as $source) {
                $sequence = (string) $this->store->row('SELECT COALESCE(MAX(sequence),0) AS n FROM SyncChangeEvent WHERE ppmFormId=?', array($source))['n'];
                $outputs = array_map(array($this->trace, 'outputView'), $this->eligibleOutputs($form, $source));
                $sources[] = array('sourcePpmFormId' => $source, 'outputs' => $outputs, 'sequence' => $sequence,
                    'cursorToken' => $this->cursorToken($context, $source, $sequence));
            }
            // Upstream projections first, own stream last; only own records/templates are exposed.
            usort($sources, function ($left, $right) use ($form) {
                return ($left['sourcePpmFormId'] === $form ? 1 : 0) <=> ($right['sourcePpmFormId'] === $form ? 1 : 0);
            });
            $days = max(1, min(365, (int) $this->store->setting('offline.maxCachedRecordDays', 7)));
            $zone = ppms_config('PLANT_TIMEZONE', 'Asia/Manila');
            $cutoff = (new DateTimeImmutable('today', new DateTimeZone($zone)))->modify('-'.$days.' days')->format('Y-m-d');
            $ids = $this->store->rows('SELECT r.id FROM PpmRecord r JOIN AreaPpmAssignment a ON a.id=r.areaPpmAssignmentId
                WHERE a.ppmFormId=? AND r.archivedAt IS NULL AND r.productionDate>=? ORDER BY r.productionDate,r.id', array($form, $cutoff));
            $records = array();
            foreach ($ids as $row) { $records[] = $this->records->view($actor, $row['id']); }
            $templates = $this->store->rows('SELECT * FROM PpmTemplateVersion WHERE ppmFormId=? AND publishedAt IS NOT NULL ORDER BY versionNo', array($form));
            foreach ($templates as &$template) { unset($template['activePpmFormId']); }
            unset($template);
            return $context + array('plantTimezone' => $zone, 'recordCacheFrom' => $cutoff,
                'form' => $this->store->row('SELECT * FROM PpmForm WHERE id=?', array($form)),
                'areaAssignments' => $this->store->rows('SELECT * FROM AreaPpmAssignment WHERE ppmFormId=? AND isActive=1', array($form)),
                'personnel' => $this->store->rows('SELECT u.id,u.displayName,u.role,p.canView,p.canCreate,p.canEdit,p.canPublish FROM PersonnelPpmAssignment p
                    JOIN User u ON u.id=p.userId WHERE p.ppmFormId=? AND p.isActive=1 AND u.accountStatus=\'ACTIVE\'', array($form)),
                'templates' => $templates, 'records' => $records, 'connections' => $connections, 'sources' => $sources,
                'offlineMaxAccessHours' => (int) $this->store->setting('offline.maxAccessHours', 24));
        });
    }
    public function pull($actor, $input)
    {
        return $this->store->transaction(function () use ($actor, $input) {
            $context = $this->context($actor, $input);
            $source = Ppms_values::text($input, 'sourcePpmFormId');
            $this->sourceAccess($context['ppmFormId'], $source);
            $cursor = $this->store->row('SELECT lastEventSequence FROM SyncPullCursor WHERE deviceId=? AND sourcePpmFormId=?', array($context['deviceId'], $source));
            $acknowledged = (string) ($cursor['lastEventSequence'] ?? '0');
            $after = $this->sequence($input['afterSequence'] ?? $acknowledged);
            if ((int) $after > (int) $acknowledged) { throw new Ppms_problem('CURSOR_NOT_ACKNOWLEDGED', 409); }
            $limit = isset($input['limit']) ? Ppms_values::integer($input, 'limit', 1, 500) : 100;
            $rows = $this->store->rows('SELECT * FROM SyncChangeEvent WHERE ppmFormId=? AND sequence>? ORDER BY sequence LIMIT ?', array($source, $after, $limit + 1));
            $more = count($rows) > $limit;
            if ($more) { array_pop($rows); }
            $next = $rows ? (string) end($rows)['sequence'] : $after;
            $events = array();
            $own = $source === $context['ppmFormId'];
            $eligible = array();
            foreach ($this->eligibleOutputs($context['ppmFormId'], $source) as $output) { $eligible[$output['id']] = $output; }
            $allowedKeys = array();
            foreach ($this->connections($context['ppmFormId']) as $connection) {
                if ($connection['sourcePpmFormId'] === $source) { $allowedKeys[] = $connection['sourceOutputKey']; }
            }
            foreach ($rows as $row) {
                $row['sequence'] = (string) $row['sequence'];
                if ($own) { $events[] = $row; continue; }
                if (!in_array($row['outputKey'], $allowedKeys, TRUE) || !in_array($row['eventType'], array('TRACE_OUTPUT_PUBLISHED','TRACE_OUTPUT_RETIRED'), TRUE)) { continue; }
                $outputId = $row['payloadJson']->id ?? NULL;
                if ($row['eventType'] === 'TRACE_OUTPUT_PUBLISHED') {
                    if (!isset($eligible[$outputId])) { continue; }
                    $row['payloadJson'] = $this->trace->outputView($eligible[$outputId]);
                } else {
                    $row['payloadJson'] = array('id' => $outputId, 'status' => $row['payloadJson']->status ?? 'SUPERSEDED', 'outputKey' => $row['outputKey']);
                }
                $events[] = $row;
            }
            return array('events' => $events, 'sourcePpmFormId' => $source, 'nextSequence' => $next,
                'hasMore' => $more, 'cursorToken' => $this->cursorToken($context, $source, $next));
        });
    }
    public function acknowledge($actor, $input)
    {
        return $this->store->transaction(function () use ($actor, $input) {
            $context = $this->context($actor, $input);
            $claims = $this->devices->verify($input['cursorToken'] ?? NULL, 'cursor');
            foreach ($context as $key => $value) {
                if (($claims[$key] ?? NULL) !== $value) { throw new Ppms_problem('CURSOR_PROOF_MISMATCH', 403); }
            }
            $source = $claims['sourcePpmFormId'];
            $this->sourceAccess($context['ppmFormId'], $source);
            $sequence = $this->sequence($claims['sequence']);
            $this->store->execute('INSERT INTO SyncPullCursor (deviceId,sourcePpmFormId,lastEventSequence,updatedAt) VALUES (?,?,?,UTC_TIMESTAMP(3))
                ON DUPLICATE KEY UPDATE lastEventSequence=GREATEST(lastEventSequence,VALUES(lastEventSequence)),updatedAt=UTC_TIMESTAMP(3)', array($context['deviceId'], $source, $sequence));
            $cursor = $this->store->row('SELECT lastEventSequence FROM SyncPullCursor WHERE deviceId=? AND sourcePpmFormId=?', array($context['deviceId'], $source));
            return array('sourcePpmFormId' => $source, 'lastEventSequence' => (string) $cursor['lastEventSequence']);
        });
    }
    private function connections($target)
    {
        return $this->store->rows('SELECT c.* FROM PpmTraceConnection c JOIN PpmForm f ON f.id=c.sourcePpmFormId WHERE c.targetPpmFormId=? AND c.status=\'ACTIVE\' AND f.status=\'ACTIVE\' ORDER BY c.sourcePpmFormId,c.id', array($target));
    }
    private function sourceAccess($target, $source)
    {
        if ($source === $target) { return; }
        foreach ($this->connections($target) as $connection) { if ($connection['sourcePpmFormId'] === $source) { return; } }
        throw new Ppms_problem('SYNC_SOURCE_NOT_AUTHORIZED', 403);
    }
    private function eligibleOutputs($target, $source)
    {
        if ($target === $source) {
            return $this->store->rows('SELECT o.* FROM PpmTraceOutput o JOIN PpmRecord r ON r.id=o.recordId JOIN PpmTemplateVersion t ON t.id=r.templateVersionId
                WHERE t.ppmFormId=? AND o.status IN (\'PUBLISHED\',\'LINKED_DOWNSTREAM\') AND r.archivedAt IS NULL
                AND NOT EXISTS (SELECT 1 FROM TraceRevalidationItem i JOIN PpmTraceLink l ON l.id=i.traceLinkId JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId
                    WHERE v.recordId=r.id AND i.status<>\'RESOLVED\') ORDER BY o.id', array($source));
        }
        return $this->store->rows('SELECT DISTINCT o.* FROM PpmTraceOutput o JOIN PpmRecord r ON r.id=o.recordId JOIN PpmTemplateVersion t ON t.id=r.templateVersionId
            JOIN PpmTraceConnection c ON c.sourcePpmFormId=t.ppmFormId AND c.sourceOutputKey=o.outputKey
            WHERE c.targetPpmFormId=? AND c.sourcePpmFormId=? AND c.status=\'ACTIVE\' AND o.status IN (\'PUBLISHED\',\'LINKED_DOWNSTREAM\') AND r.archivedAt IS NULL
            AND (c.requiresApprovalBeforeUse=0 OR r.status IN (\'FSQA_APPROVED\',\'SUPERVISOR_APPROVED\',\'CLOSED\'))
            AND NOT EXISTS (SELECT 1 FROM TraceRevalidationItem i JOIN PpmTraceLink l ON l.id=i.traceLinkId JOIN PpmRecordRevision v ON v.id=l.downstreamRevisionId
                WHERE v.recordId=r.id AND i.status<>\'RESOLVED\') ORDER BY o.id', array($target, $source));
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
