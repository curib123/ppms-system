"""Focused HTTP/database regressions for retry identity, recovery, dependency guards and bounded feeds."""
import hashlib
import json
import secrets
import subprocess
import unittest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import api_integration as harness
from integration import PHP, ROOT, sql


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def quote(value):
    return "'" + value.replace("'", "''") + "'"


class SyncRegressions(unittest.TestCase):
    api = harness.PpmApiIntegration.api
    template_change = harness.PpmApiIntegration.template_change
    login = harness.PpmApiIntegration.login
    stop_server = harness.PpmApiIntegration.__dict__['stop_server']

    @classmethod
    def setUpClass(cls):
        harness.PpmApiIntegration.setUpClass.__func__(cls)
        case = cls()
        for user in ('admin', 'alice', 'bob', 'outsider'):
            case.login(user)
        cls.today = datetime.now(ZoneInfo('Asia/Manila')).date().isoformat()
        cls.area = case.api('GET', '/areas')['items'][0]['id']

    def context(self, trace=False):
        form = self.api('POST', '/forms', {'ppmCode': 'SYNC-' + secrets.token_hex(5), 'title': 'Sync regression', 'areaId': self.area})
        template = self.api('POST', '/forms/' + form['id'] + '/templates', {'definitionJson': {'fields': [
            {'key': 'value', 'label': 'Value', 'type': 'text', 'validation': {'maxLength': 16384}}]}})
        if trace:
            self.template_change('PUT', '/templates/' + template['id'] + '/rules', {'rules': [{'outputKey': 'code', 'outputLabel': 'Code', 'sourceType': 'MANUAL_EXTERNAL', 'status': 'ACTIVE', 'requiresUniqueBusinessCode': False, 'configurationJson': {'outputPath': 'value'}}]})
        self.template_change('POST', '/templates/' + template['id'] + '/publish', {})
        device = self.api('POST', '/devices', {'deviceUuid': secrets.token_hex(16), 'displayName': 'Disposable test device'}, user='alice')
        self.api('PUT', '/forms/' + form['id'] + '/lease', {'deviceId': device['id'], 'expectedLeaseVersion': 0})
        for user in ('alice', 'bob'):
            self.api('PUT', '/forms/' + form['id'] + '/access/test-' + user, {'canView': True, 'canCreate': True, 'canEdit': True})
        context = {'ppmFormId': form['id'], 'deviceId': device['id'], 'leaseVersion': 1}
        grant = self.api('POST', '/sync/grants', context, user='alice')
        assignment = sql('SELECT id FROM AreaPpmAssignment WHERE ppmFormId=' + quote(form['id']) + ' LIMIT 1')
        return context, {'templateVersionId': template['id'], 'areaPpmAssignmentId': assignment, 'productionDate': self.today}, grant['authorProof']

    def mutation(self, record, extra, proof, operation='CREATE_DRAFT', base=0, value='value'):
        return dict(extra, recordId=record, clientMutationId=secrets.token_hex(16), operationType=operation,
                    baseRevisionNo=base, userId='test-alice', authorProof=proof, dataJson={'value': value})

    def batch(self, context, mutations, user='alice', **extra):
        return self.api('POST', '/sync/batches', dict(context, id=secrets.token_hex(16), businessDate=self.today, mutations=mutations, **extra), user=user)

    def test_01_omitted_date_retry_uses_stored_date_and_preserves_mutation_identity(self):
        context, fields, proof = self.context()
        mutation = self.mutation('date-' + secrets.token_hex(8), fields, proof)
        body = dict(context, id=secrets.token_hex(16), mutations=[mutation])
        first = self.api('POST', '/sync/batches', body, user='alice')
        self.assertEqual(first['status'], 'ACCEPTED')
        yesterday = (datetime.now(ZoneInfo('Asia/Manila')).date() - timedelta(days=1)).isoformat()
        logical = {key: value for key, value in mutation.items() if key != 'authorProof'}
        old_hash = digest(dict(body, businessDate=yesterday, mutations=[logical]))
        stored = dict(first, businessDate=yesterday)
        # Represent a committed request received yesterday, then retry the original omitted-date body today.
        sql('UPDATE SyncDailyBatch SET businessDate=' + quote(yesterday) + ',payloadHash=' + quote(old_hash)
            + ',resultJson=' + quote(json.dumps(stored)) + ' WHERE id=' + quote(body['id']))
        self.assertEqual(self.api('POST', '/sync/batches', body, user='alice'), stored)
        changed = dict(mutation, dataJson={'value': 'tampered'})
        self.api('POST', '/sync/batches', dict(body, mutations=[changed]), user='alice', expected=409)
        replay = self.batch(context, [changed])
        self.assertEqual(replay['results'][0]['error'], 'MUTATION_ID_REUSED')
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmRecordRevision WHERE recordId=' + quote(mutation['recordId'])), '1')

    def test_02_recovery_preserves_receipts_and_releases_rotated_lease(self):
        context, fields, proof = self.context()
        first = self.mutation('recover-a-' + secrets.token_hex(6), fields, proof)
        second = self.mutation('recover-b-' + secrets.token_hex(6), fields, proof)
        committed = self.batch(context, [first])['results'][0]
        body = dict(context, id=secrets.token_hex(16), businessDate=self.today, mutations=[first, second])
        normalized = [{key: value for key, value in m.items() if key != 'authorProof'} for m in body['mutations']]
        payload_hash = digest(dict(body, mutations=normalized))
        manifest = [{key: value for key, value in m.items() if key in ('clientMutationId', 'userId', 'recordId', 'operationType')} | {'payloadHash': digest(m)} for m in normalized]
        sql('INSERT INTO SyncDailyBatch (id,ppmFormId,userId,deviceId,leaseVersion,businessDate,batchNo,status,mutationCount,payloadHash,manifestJson) VALUES ('
            + ','.join([quote(body['id']), quote(context['ppmFormId']), "'test-alice'", quote(context['deviceId']), '1', quote(self.today), '2', "'PUSHING'", '2', quote(payload_hash), quote(json.dumps(manifest))]) + ')')
        self.api('POST', '/devices/' + context['deviceId'] + '/credentials', {'reason': 'Recover after worker interruption'})
        self.api('POST', '/sync/batches', body, user='alice', expected=403)
        recovery = {'reason': 'Verify durable receipt and retain unknown local work', 'expectedPayloadHash': payload_hash, 'action': 'FINALIZE'}
        self.api('POST', '/sync/batches/' + body['id'] + '/recover', recovery, user='alice', expected=403)
        self.api('POST', '/sync/batches/' + body['id'] + '/recover', dict(recovery, expectedPayloadHash='0' * 64), expected=409)
        recovered = self.api('POST', '/sync/batches/' + body['id'] + '/recover', recovery)
        self.assertEqual(recovered['results'][0], committed)
        self.assertEqual(recovered['results'][1]['error'], 'RECOVERY_NOT_PROCESSED')
        self.assertTrue(recovered['results'][1]['requiresReconciliation'])
        self.assertEqual(recovered['acceptedCount'], 1)
        self.assertEqual(recovered['rejectedCount'], 1)
        self.assertEqual(self.api('POST', '/sync/batches/' + body['id'] + '/recover', recovery), recovered)
        self.assertEqual(self.api('GET', '/sync/batches/' + body['id'], user='alice')['resultJson'], recovered)
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmRecord WHERE id=' + quote(second['recordId'])), '0')
        replacement = self.api('POST', '/devices', {'deviceUuid': secrets.token_hex(16), 'displayName': 'Replacement'}, user='alice')
        lease = self.api('PUT', '/forms/' + context['ppmFormId'] + '/lease', {'deviceId': replacement['id'], 'expectedLeaseVersion': 0, 'reason': 'Recovered durable batch before replacement'})
        self.assertEqual(lease['leaseVersion'], 1)
        self.assertEqual(sql('SELECT COUNT(*) FROM SyncMutationReceipt WHERE clientMutationId=' + quote(first['clientMutationId'])), '1')
        self.assertEqual(recovered['unresolvedCount'], 1)
        current = dict(context, deviceId=replacement['id'], leaseVersion=1)
        grant = self.api('POST', '/sync/grants', current, user='alice')
        requeued = dict(second, clientMutationId=secrets.token_hex(16), authorProof=grant['authorProof'],
                        recoveryOfMutationId=second['clientMutationId'], recoveryOfBatchId=body['id'],
                        recoveryReason='Reviewed unprocessed record and current server state')
        accepted = self.batch(current, [requeued])
        self.assertEqual(accepted['results'][0]['status'], 'APPLIED', accepted)
        self.assertEqual(sql("SELECT COUNT(*) FROM AuditLog WHERE entityType='SyncMutationReceipt' AND JSON_UNQUOTE(JSON_EXTRACT(afterJson,'$.recoveryOfMutationId'))=" + quote(second['clientMutationId'])), '1')
        false_reference = dict(requeued, clientMutationId=secrets.token_hex(16), recordId=first['recordId'], operationType='UPDATE_DRAFT', baseRevisionNo=1,
                               recoveryOfMutationId=first['clientMutationId'])
        rejected = self.batch(current, [false_reference])
        self.assertEqual(rejected['results'][0]['error'], 'RECOVERY_REFERENCE_INVALID')


    def test_03_recovery_refuses_an_active_worker_lock(self):
        context, fields, proof = self.context()
        mutation = self.mutation('locked-' + secrets.token_hex(6), fields, proof)
        batch = self.batch(context, [mutation])
        code = '$d=new mysqli(getenv("DB_HOST"),getenv("DB_USERNAME"),getenv("DB_PASSWORD"),getenv("DB_DATABASE"),(int)getenv("DB_PORT"));$l="ppms-batch-".substr(hash("sha256",$argv[1]),0,40);$s=$d->prepare("SELECT GET_LOCK(?,0)");$s->bind_param("s",$l);$s->execute();echo "READY\\n";flush();fgets(STDIN);'
        process = subprocess.Popen(PHP + ['-r', code, batch['id']], cwd=ROOT, env=self.env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual(process.stdout.readline().strip(), 'READY')
            failure = self.api('POST', '/sync/batches/' + batch['id'] + '/recover', {'action': 'FINALIZE', 'reason': 'Must not interfere with active worker', 'expectedPayloadHash': '0' * 64}, expected=409)
            self.assertEqual(failure['error'], 'BATCH_BUSY')
        finally:
            process.communicate('\n', timeout=10)

    def test_04_conflicting_predecessor_cannot_allow_later_predicted_revision_overwrite(self):
        context, fields, proof = self.context()
        record = 'dependency-' + secrets.token_hex(6)
        self.assertEqual(self.batch(context, [self.mutation(record, fields, proof)])['status'], 'ACCEPTED')
        self.assertEqual(self.batch(context, [self.mutation(record, {}, proof, 'UPDATE_DRAFT', 1, 'server-current')])['status'], 'ACCEPTED')
        stale = self.mutation(record, {}, proof, 'UPDATE_DRAFT', 1, 'local-stale')
        dependent = self.mutation(record, {}, proof, 'UPDATE_DRAFT', 2, 'must-not-overwrite')
        dependent['dependsOnMutationId'] = stale['clientMutationId']
        other = self.mutation('independent-' + secrets.token_hex(6), fields, proof)
        result = self.batch(context, [stale, dependent, other])
        self.assertEqual(result['results'][0]['status'], 'CONFLICT')
        self.assertEqual(result['results'][1]['error'], 'DEPENDENCY_NOT_APPLIED')
        self.assertEqual(result['results'][2]['status'], 'APPLIED')
        view = self.api('GET', '/records/' + record, user='alice')
        self.assertEqual(view['revision']['dataJson']['value'], 'server-current')
        self.assertEqual(view['record']['currentRevisionNo'], 2)

    def test_05_bootstrap_pages_have_no_early_cursor_and_replay_crossing_changes(self):
        context, fields, proof = self.context()
        originals = [self.mutation('page-' + secrets.token_hex(6), fields, proof, value='x' * 9000) for _ in range(3)]
        self.assertEqual(self.batch(context, originals)['status'], 'ACCEPTED')
        ids = set(); page_token = None; terminal = None; page_count = 0; crossing = None
        while True:
            body = dict(context, limit=1)
            if page_token:
                body['pageToken'] = page_token
            page = self.api('POST', '/sync/bootstrap', body, user='alice')
            page_count += 1
            self.assertLessEqual(len(page['records']) + len(page['templates']) + sum(len(s['outputs']) for s in page['sources']), 1)
            ids.update(v['record']['id'] for v in page['records'])
            if page_count == 1:
                crossing = self.mutation('crossing-' + secrets.token_hex(6), fields, proof)
                self.assertEqual(self.batch(context, [crossing])['status'], 'ACCEPTED')
            if not page['hasMore']:
                terminal = page
                break
            self.assertTrue(all('cursorToken' not in s for s in page['sources']))
            page_token = page['pageToken']
            self.assertLess(page_count, 20)
        self.assertGreaterEqual(page_count, 4)
        self.assertTrue(set(m['recordId'] for m in originals).issubset(ids))
        for source in terminal['sources']:
            self.api('POST', '/sync/ack', dict(context, cursorToken=source['cursorToken']), user='alice')
        own = next(s for s in terminal['sources'] if s['sourcePpmFormId'] == context['ppmFormId'])
        changes = self.api('POST', '/sync/pull', dict(context, sourcePpmFormId=context['ppmFormId'], afterSequence=own['sequence']), user='alice')
        self.assertIn(crossing['recordId'], [e['recordId'] for e in changes['events']])
        bounded = self.api('POST', '/sync/pull', dict(context, sourcePpmFormId=context['ppmFormId'], afterSequence='0', limit=100, maxBytes=16384), user='alice')
        self.assertTrue(bounded['hasMore'])
        self.assertLess(len(bounded['events']), 5)
        self.assertLessEqual(len(json.dumps(bounded).encode()), 18000)
        for event in bounded['events']:
            self.assertNotIn('revisions', event['payloadJson'])

    def test_06_original_author_grant_is_revoked_with_auth_version(self):
        context, fields, proof = self.context()
        bob = self.api('POST', '/sync/grants', context, user='bob')
        sql("UPDATE User SET authVersion=authVersion+1 WHERE id='test-bob'")
        mutation = self.mutation('revoked-' + secrets.token_hex(6), fields, bob['authorProof'])
        mutation['userId'] = 'test-bob'
        result = self.batch(context, [mutation], user='alice')
        self.assertEqual(result['results'][0]['error'], 'AUTHOR_ACCESS_REVOKED')
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmRecord WHERE id=' + quote(mutation['recordId'])), '0')

    def test_07_one_device_has_independent_form_cursors_and_all_leases_rotate(self):
        first, fields, proof = self.context(trace=True)
        second, _, _ = self.context()
        second = dict(second, deviceId=first['deviceId'], leaseVersion=1)
        self.api('PUT', '/forms/' + second['ppmFormId'] + '/lease', {'deviceId': first['deviceId'], 'expectedLeaseVersion': 0,
            'reason': 'Use one personnel device for two assigned forms'})
        self.api('PUT', '/forms/' + second['ppmFormId'] + '/connections', {'sourcePpmFormId': first['ppmFormId'],
            'sourceOutputKey': 'code', 'targetInputKey': 'value', 'connectionName': 'Shared source stream', 'status': 'ACTIVE'})
        mutation = self.mutation('multi-form-' + secrets.token_hex(6), fields, proof)
        self.assertEqual(self.batch(first, [mutation])['status'], 'ACCEPTED')
        self.api('POST', '/records/' + mutation['recordId'] + '/publish', {'baseRevisionNo': 1})
        own = self.api('POST', '/sync/pull', dict(first, sourcePpmFormId=first['ppmFormId']), user='alice')
        self.api('POST', '/sync/ack', dict(first, cursorToken=own['cursorToken']), user='alice')
        upstream = self.api('POST', '/sync/pull', dict(second, sourcePpmFormId=first['ppmFormId']), user='alice')
        self.assertIn('TRACE_OUTPUT_PUBLISHED', [event['eventType'] for event in upstream['events']])
        self.api('POST', '/sync/ack', dict(second, cursorToken=own['cursorToken']), user='alice', expected=403)
        self.api('POST', '/sync/ack', dict(second, cursorToken=upstream['cursorToken']), user='alice')
        self.assertEqual(sql('SELECT COUNT(*) FROM SyncFormPullCursor WHERE deviceId=' + quote(first['deviceId']) + ' AND sourcePpmFormId=' + quote(first['ppmFormId'])), '2')
        rotated = self.api('POST', '/devices/' + first['deviceId'] + '/credentials', {'reason': 'Rotate the shared physical device'})
        leases = {row['ppmFormId']: row['leaseVersion'] for row in rotated['leases']}
        self.assertEqual(leases[first['ppmFormId']], 2)
        self.assertEqual(leases[second['ppmFormId']], 2)
        self.api('POST', '/devices/' + first['deviceId'] + '/revoke', {'reason': 'Retire both form leases'})
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmFormDeviceLease WHERE deviceId=' + quote(first['deviceId']) + ' AND revokedAt IS NOT NULL'), '2')

    def test_08_two_personnel_devices_on_one_form_preserve_conflicting_edits(self):
        first, fields, proof = self.context()
        self.login('bob')
        second_device = self.api('POST', '/devices', {'deviceUuid': secrets.token_hex(16), 'displayName': 'Second personnel phone'}, user='bob')
        second = dict(first, deviceId=second_device['id'])
        self.api('PUT', '/forms/' + first['ppmFormId'] + '/lease', {'deviceId': second_device['id'], 'expectedLeaseVersion': 0})
        bob = self.api('POST', '/sync/grants', second, user='bob')
        record = 'two-device-' + secrets.token_hex(6)
        self.assertEqual(self.batch(first, [self.mutation(record, fields, proof)])['status'], 'ACCEPTED')
        alice_edit = self.mutation(record, {}, proof, 'UPDATE_DRAFT', 1, 'alice version')
        self.assertEqual(self.batch(first, [alice_edit])['status'], 'ACCEPTED')
        bob_edit = self.mutation(record, {}, bob['authorProof'], 'UPDATE_DRAFT', 1, 'bob offline version')
        bob_edit['userId'] = 'test-bob'
        conflict = self.batch(second, [bob_edit], user='bob')['results'][0]
        self.assertEqual(conflict['status'], 'CONFLICT')
        current = self.api('GET', '/records/' + record, user='bob')
        self.assertEqual(current['revision']['dataJson']['value'], 'alice version')
        self.assertEqual(sql("SELECT JSON_UNQUOTE(JSON_EXTRACT(localPatchJson,'$.dataJson.value')) FROM SyncConflict WHERE id=" + quote(conflict['conflictId'])), 'bob offline version')
        self.assertEqual(sql('SELECT userId FROM SyncMutationReceipt WHERE clientMutationId=' + quote(bob_edit['clientMutationId'])), 'test-bob')
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmFormDeviceLease WHERE ppmFormId=' + quote(first['ppmFormId']) + ' AND revokedAt IS NULL'), '2')
        pending = secrets.token_hex(16)
        sql('INSERT INTO SyncDailyBatch (id,ppmFormId,userId,deviceId,leaseVersion,businessDate,batchNo,status,mutationCount,payloadHash) VALUES ('
            + ','.join([quote(pending), quote(first['ppmFormId']), "'test-alice'", quote(first['deviceId']), '1', quote(self.today), '9999', "'PUSHING'", '1', quote('0' * 64)]) + ')')
        blocked = self.api('PUT', '/forms/' + first['ppmFormId'] + '/lease', {'deviceId': first['deviceId'], 'expectedLeaseVersion': 1, 'reconciled': True, 'reason': 'Existing worker requires recovery'}, expected=409)
        self.assertEqual(blocked['error'], 'SYNC_BATCH_IN_PROGRESS')
        third_device = self.api('POST', '/devices', {'deviceUuid': secrets.token_hex(16), 'displayName': 'Third authorized phone'}, user='bob')
        granted = self.api('PUT', '/forms/' + first['ppmFormId'] + '/lease', {'deviceId': third_device['id'], 'expectedLeaseVersion': 0})
        self.assertEqual(granted['leaseVersion'], 1)

    def test_09_configuration_change_preserves_batch_retry_identity(self):
        context, fields, proof = self.context()
        original_setting = sql("SELECT valueJson FROM SystemSetting WHERE `key`='sync.batchSize'")
        try:
            sql("UPDATE SystemSetting SET valueJson='2' WHERE `key`='sync.batchSize'")
            original = dict(context, id=secrets.token_hex(16), mutations=[
                self.mutation('batch-limit-' + secrets.token_hex(6), fields, proof) for _ in range(2)])
            committed = self.api('POST', '/sync/batches', original, user='alice')
            self.assertEqual(committed['status'], 'ACCEPTED')
            sql("UPDATE SystemSetting SET valueJson='1' WHERE `key`='sync.batchSize'")
            self.assertEqual(self.api('POST', '/sync/batches', original, user='alice'), committed)
            sql("UPDATE SyncDailyBatch SET status='PUSHING',resultJson=NULL,completedAt=NULL WHERE id=" + quote(original['id']))
            self.assertEqual(self.api('POST', '/sync/batches', original, user='alice'), committed)
            self.assertEqual(sql('SELECT COUNT(*) FROM SyncMutationReceipt WHERE batchId=' + quote(original['id'])), '2')
            self.assertEqual(self.api('POST', '/sync/grants', context, user='alice')['maxBatchSize'], 1)
            self.assertEqual(self.api('POST', '/sync/bootstrap', context, user='alice')['maxBatchSize'], 1)
            new_batch = dict(original, id=secrets.token_hex(16), mutations=[
                self.mutation('batch-reject-' + secrets.token_hex(6), fields, proof) for _ in range(2)])
            rejected = self.api('POST', '/sync/batches', new_batch, user='alice', expected=422)
            self.assertEqual(rejected['error'], 'INVALID_BATCH_SIZE')
            self.assertEqual(rejected['details'], {'maxBatchSize': 1, 'accepted': False})
            self.assertEqual(sql('SELECT COUNT(*) FROM SyncDailyBatch WHERE id=' + quote(new_batch['id'])), '0')
            self.assertEqual(sql('SELECT COUNT(*) FROM SyncMutationReceipt WHERE clientMutationId=' + quote(new_batch['mutations'][0]['clientMutationId'])), '0')
        finally:
            sql("UPDATE SystemSetting SET valueJson=" + quote(original_setting) + " WHERE `key`='sync.batchSize'")


if __name__ == '__main__':
    unittest.main(verbosity=2, argv=[__file__] + harness.TEST_ARGS)
