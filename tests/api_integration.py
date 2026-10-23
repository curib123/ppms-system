"""Real HTTP -> CI3 controllers -> services -> disposable MySQL integration."""
import json
import os
import secrets
import socket
import subprocess
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from integration import DATABASE, ENV, PHP, ROOT, cli, query, sql


class PpmApiIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sql('CREATE DATABASE `' + DATABASE + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', None)
        cls.addClassCleanup(lambda: sql('DROP DATABASE `' + DATABASE + '`', None))
        for command in ('install', 'migrate'):
            result = cli('setup', command)
            if result.returncode:
                raise AssertionError(result.stdout + result.stderr)
        cls.password = secrets.token_urlsafe(24)
        cls.env = dict(ENV, APP_ENCRYPTION_KEY=secrets.token_hex(32),
                       PPMS_TEST_PASSWORD=cls.password, PLANT_TIMEZONE='Asia/Manila')
        fixture = subprocess.run(PHP + ['tests/api_fixture.php'], cwd=ROOT, env=cls.env,
                                 text=True, capture_output=True, timeout=10)
        if fixture.returncode:
            raise AssertionError(fixture.stderr)
        cls.forms = {row['ppmCode']: row for row in json.loads(fixture.stdout)['forms']}
        cls.form = cls.forms['PPM-001']['id']
        cls.other_form = cls.forms['PPM-002']['id']
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        cls.base = 'http://127.0.0.1:' + str(port) + '/api/v1'
        cls.log = tempfile.TemporaryFile()
        cls.addClassCleanup(cls.log.close)
        cls.server = subprocess.Popen(PHP + ['-S', '127.0.0.1:' + str(port), '-t', 'public', 'public/router.php'],
                                      cwd=ROOT, env=cls.env, stdout=cls.log, stderr=cls.log)
        cls.addClassCleanup(cls.stop_server)
        for _ in range(50):
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=0.1):
                    break
            except OSError:
                time.sleep(0.1)
        cls.tokens = {}
        cls.device_tokens = {}

    @classmethod
    def stop_server(cls):
        cls.server.terminate()
        cls.server.wait(timeout=5)

    def api(self, method, path, data=None, user='admin', expected=200, device_auth=True):
        headers = {'Content-Type': 'application/json'}
        if user in self.tokens:
            headers['Authorization'] = 'Bearer ' + self.tokens[user]
        if data and 'deviceId' in data:
            if device_auth is True and data['deviceId'] in self.device_tokens:
                headers['X-PPMS-Device-Token'] = self.device_tokens[data['deviceId']]
            elif isinstance(device_auth, str):
                headers['X-PPMS-Device-Token'] = device_auth
        request = Request(self.base + path, data=None if data is None else json.dumps(data).encode(),
                          headers=headers, method=method)
        try:
            response = urlopen(request, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            body = response.read().decode()
            self.assertEqual(response.status, expected, body)
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            result = json.loads(body)
            if path == '/devices' and 'deviceToken' in result:
                self.device_tokens[result['id']] = result['deviceToken']
            return result

    def login(self, user):
        result = self.api('POST', '/auth/login', {'username': user, 'password': self.password}, user=None)
        self.tokens[user] = result['token']
        return result

    def test_01_individual_login_and_bearer_authentication(self):
        self.api('GET', '/me', user=None, expected=401)
        self.api('POST', '/auth/login', {'username': 'alice', 'password': 'wrong'}, user=None, expected=401)
        for user in ('admin', 'alice', 'bob', 'outsider'):
            result = self.login(user)
            self.assertEqual(result['user']['id'], 'test-' + user)
            self.assertNotIn('passwordHash', result['user'])
        self.assertEqual(self.api('GET', '/me', user='alice')['id'], 'test-alice')
        self.assertNotIn(self.tokens['alice'], sql("SELECT GROUP_CONCAT(refreshTokenHash) FROM AuthSession"))

    def test_02_shared_device_lease_and_multiple_personnel(self):
        device = self.api('POST', '/devices', {'deviceUuid': 'test-shared-workstation', 'displayName': 'Shared device'}, user='alice')
        type(self).device = device['id']
        lease = self.api('PUT', '/forms/' + self.form + '/lease', {'deviceId': self.device, 'expectedLeaseVersion': 0})
        self.assertEqual(lease['leaseVersion'], 1)
        for user in ('alice', 'bob'):
            self.api('PUT', '/forms/' + self.form + '/access/test-' + user,
                     {'canView': True, 'canCreate': True, 'canEdit': True, 'canPublish': False})
        for user in ('alice', 'bob'):
            grant = self.api('POST', '/sync/grants', {'deviceId': self.device, 'ppmFormId': self.form, 'leaseVersion': 1}, user=user)
            setattr(type(self), user + '_proof', grant['authorProof'])
            self.assertEqual(grant['userId'], 'test-' + user)
        self.api('POST', '/sync/grants', {'deviceId': self.device, 'ppmFormId': self.form, 'leaseVersion': 1}, user='outsider', expected=403)
        self.api('PUT', '/forms/' + self.other_form + '/lease', {'deviceId': self.device, 'expectedLeaseVersion': 0}, expected=409)
        self.api('PUT', '/forms/' + self.form + '/access/test-outsider', {'canView': True}, user='alice', expected=403)

    def test_03_dynamic_templates_publish_immutably(self):
        definition = {'fields': [
            {'key': 'supplier', 'label': 'Supplier', 'type': 'text', 'required': True},
            {'key': 'temperature', 'label': 'Temperature', 'type': 'number', 'required': True,
             'validation': {'min': 0, 'max': 100}},
            {'key': 'accepted', 'label': 'Accepted', 'type': 'boolean', 'required': True},
            {'key': 'entries', 'label': 'Readings', 'type': 'repeatable', 'maxRows': 10,
             'fields': [{'key': 'value', 'label': 'Reading', 'type': 'integer', 'required': True}]}
        ]}
        type(self).definition = definition
        template = self.api('POST', '/forms/' + self.form + '/templates', {'definitionJson': definition})
        type(self).template = template['id']
        self.assertEqual(template['definitionJson'], definition)
        published = self.api('POST', '/templates/' + self.template + '/publish', {})
        self.assertTrue(published['isActive'])
        self.api('PATCH', '/templates/' + self.template,
                 {'definitionJson': definition, 'expectedDefinitionHash': template['definitionHash']}, expected=409)
        self.api('POST', '/templates/' + self.template + '/publish', {}, expected=409)
        self.assertEqual(sql("SELECT COUNT(*) FROM PpmTemplateVersion WHERE ppmFormId='" + self.form + "' AND isActive=1"), '1')
        self.api('POST', '/forms/' + self.form + '/templates',
                 {'definitionJson': {'fields': [{'key': 'bad', 'label': 'Bad', 'type': 'executable'}]}}, expected=422)
        self.api('POST', '/forms/' + self.form + '/templates', {'definitionJson': definition}, user='alice', expected=403)
        versions = self.api('GET', '/forms/' + self.form + '/templates', user='bob')
        self.assertIn(self.template, [row['id'] for row in versions['items']])
        self.api('GET', '/forms/' + self.form + '/templates', user='outsider', expected=403)

    def batch(self, mutations, batch_id=None, user='bob', expected=200):
        return self.api('POST', '/sync/batches', {
            'id': batch_id or secrets.token_hex(16), 'ppmFormId': self.form,
            'deviceId': self.device, 'leaseVersion': 1, 'businessDate': '2026-10-23',
            'mutations': mutations}, user=user, expected=expected)

    def mutation(self, operation, record, user='alice', base=0, data=None, mutation_id=None):
        result = {'clientMutationId': mutation_id or secrets.token_hex(16), 'operationType': operation,
                  'userId': 'test-' + user, 'recordId': record, 'baseRevisionNo': base,
                  'authorProof': getattr(self, user + '_proof')}
        if operation == 'CREATE_DRAFT':
            result.update(templateVersionId=self.template,
                          areaPpmAssignmentId=self.forms['PPM-001']['areaPpmAssignmentId'],
                          productionDate='2026-10-23')
        if data is not None:
            result['dataJson'] = data
        return result

    def test_04_daily_batch_preserves_each_author_and_retries(self):
        mutations = [self.mutation('CREATE_DRAFT', 'record-a', data={'supplier': 'A', 'temperature': 0, 'accepted': False}),
                     self.mutation('CREATE_DRAFT', 'record-b', user='bob', data={})]
        type(self).create_mutations = mutations
        batch_id = secrets.token_hex(16)
        first = self.batch(mutations, batch_id)
        self.assertEqual(first['status'], 'ACCEPTED')
        self.assertEqual(first['acceptedCount'], 2)
        self.assertEqual(self.batch(mutations, batch_id), first)
        duplicate = self.batch(mutations)
        self.assertEqual(duplicate['acceptedCount'], 2)
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmRecordRevision'), '2')
        self.assertEqual(sql("SELECT createdById FROM PpmRecordRevision WHERE recordId='record-a'"), 'test-alice')
        self.assertEqual(sql("SELECT createdById FROM PpmRecordRevision WHERE recordId='record-b'"), 'test-bob')
        self.assertEqual(sql("SELECT userId FROM SyncMutationReceipt WHERE recordId='record-a'"), 'test-alice')
        self.assertEqual(sql("SELECT COUNT(*) FROM AuditLog WHERE recordId='record-a' AND actorId='test-alice' AND batchId IS NOT NULL"), '1')
        changed = dict(mutations[0], dataJson={'supplier': 'Tampered'})
        rejected = self.batch([changed])
        self.assertEqual(rejected['results'][0]['error'], 'MUTATION_ID_REUSED')
        self.api('GET', '/records/record-a', user='outsider', expected=403)

    def test_05_one_conflict_does_not_block_other_records(self):
        updated = self.batch([self.mutation('UPDATE_DRAFT', 'record-a', base=1,
                                          data={'supplier': 'A', 'temperature': 82.5, 'accepted': True})])
        self.assertEqual(updated['results'][0]['revisionNo'], 2)
        result = self.batch([
            self.mutation('UPDATE_DRAFT', 'record-a', base=1, data={'supplier': 'Stale'}),
            self.mutation('UPDATE_DRAFT', 'record-b', user='bob', base=1,
                          data={'supplier': 'B', 'temperature': 50, 'accepted': True}),
            self.mutation('UPDATE_DRAFT', 'record-b', base=2, data={'temperature': 'bad'})])
        self.assertEqual(result['status'], 'PARTIAL')
        self.assertEqual((result['acceptedCount'], result['conflictCount'], result['rejectedCount']), (1, 1, 1))
        type(self).conflict = result['results'][0]['conflictId']
        self.assertEqual(sql("SELECT currentRevisionNo FROM PpmRecord WHERE id='record-a'"), '2')
        self.assertEqual(sql("SELECT COUNT(*) FROM PpmRecordRevision WHERE recordId='record-b'"), '2')
        self.assertEqual(self.api('GET', '/records/record-a', user='bob')['revision']['dataJson']['temperature'], 82.5)

    def test_06_submission_validates_pinned_template_and_lifecycle(self):
        bad = self.batch([self.mutation('CREATE_DRAFT', 'incomplete', data={}),
                          self.mutation('QUEUE_SUBMIT', 'incomplete', base=1)])
        self.assertEqual(bad['results'][1]['status'], 'REJECTED')
        submitted = self.batch([self.mutation('QUEUE_SUBMIT', 'record-b', user='bob', base=2)])
        self.assertEqual(submitted['results'][0]['status'], 'APPLIED')
        self.assertEqual(self.api('GET', '/records/record-b', user='bob')['record']['status'], 'SUBMITTED')
        forbidden = self.batch([self.mutation('UPDATE_DRAFT', 'record-b', user='bob', base=3,
                                            data={'supplier': 'Overwrite submitted'})])
        self.assertEqual(forbidden['results'][0]['error'], 'RECORD_NOT_EDITABLE')
        self.assertEqual(sql("SELECT COUNT(*) FROM WorkflowEvent WHERE recordId='record-b'"), '1')

    def test_07_conflict_resolution_is_explicit_and_revision_checked(self):
        resolution = self.mutation('CONFLICT_RESOLUTION', 'record-a', base=2)
        resolution.update(conflictId=self.conflict, resolutionType='KEEP_SERVER', reason='Keep reviewed server data')
        kept = self.batch([resolution])
        self.assertEqual(kept['results'][0]['status'], 'APPLIED')
        self.assertEqual(sql("SELECT currentRevisionNo FROM PpmRecord WHERE id='record-a'"), '2')
        self.assertEqual(sql("SELECT resolutionType FROM SyncConflict WHERE id='" + self.conflict + "'"), 'KEEP_SERVER')
        stale = self.batch([self.mutation('UPDATE_DRAFT', 'record-a', base=1, data={'supplier': 'Local'})])
        conflict = stale['results'][0]['conflictId']
        merge = self.mutation('CONFLICT_RESOLUTION', 'record-a', base=1,
                              data={'supplier': 'Merged', 'temperature': 82.5, 'accepted': True})
        merge.update(conflictId=conflict, resolutionType='MANUAL_MERGE', reason='Review both edits')
        self.assertEqual(self.batch([merge])['results'][0]['error'], 'RESOLUTION_BASE_CHANGED')
        merge['baseRevisionNo'] = 2
        merge['clientMutationId'] = secrets.token_hex(16)
        resolved = self.batch([merge])
        self.assertEqual(resolved['results'][0]['revisionNo'], 3)
        self.assertEqual(sql("SELECT COUNT(*) FROM PpmRecordRevision WHERE recordId='record-a'"), '3')
        self.assertEqual(sql("SELECT status FROM SyncConflict WHERE id='" + conflict + "'"), 'RESOLVED')

    def test_08_server_publishes_configured_trace_codes(self):
        draft = self.api('POST', '/forms/' + self.form + '/templates', {'definitionJson': self.definition})
        type(self).source_template = draft['id']
        self.api('PUT', '/templates/' + draft['id'] + '/rules', {'rules': [{
            'outputKey': 'lotCode', 'outputLabel': 'Lot', 'status': 'ACTIVE', 'sourceType': 'SYSTEM_GENERATED',
            'formulaTemplate': 'LOT-{{record.productionDate}}-{{sequence}}', 'resetPeriod': 'DAILY',
            'sequencePadding': 3, 'requiresUniqueBusinessCode': True,
            'configurationJson': {'bindings': {'record.productionDate': {'source': 'RECORD', 'path': 'productionDate', 'format': 'YYYYMMDD'}}}
        }]})
        self.api('POST', '/templates/' + draft['id'] + '/publish', {})
        create = self.mutation('CREATE_DRAFT', 'source-lot', data={'supplier': 'Lot supplier', 'temperature': 90, 'accepted': True})
        create['templateVersionId'] = draft['id']
        result = self.batch([create, self.mutation('QUEUE_SUBMIT', 'source-lot', base=1)])
        self.assertEqual(result['acceptedCount'], 2)
        body = {'deviceId': self.device, 'leaseVersion': 1, 'baseRevisionNo': 2}
        self.api('POST', '/records/source-lot/publish', body, user='alice', expected=403)
        published = self.api('POST', '/records/source-lot/publish', body)
        self.assertEqual(published['outputs'][0]['outputCode'], 'LOT-20261023-001')
        type(self).output = published['outputs'][0]
        self.assertEqual(self.api('POST', '/records/source-lot/publish', body), published)
        self.assertEqual(sql('SELECT currentValue FROM CodeSequence LIMIT 1'), '1')
        self.api('PUT', '/templates/' + draft['id'] + '/rules', {'rules': []}, expected=409)

    def downstream_batch(self, mutations):
        return self.api('POST', '/sync/batches', {'id': secrets.token_hex(16), 'ppmFormId': self.other_form,
                        'deviceId': self.downstream_device, 'leaseVersion': 1, 'businessDate': '2026-10-23',
                        'mutations': mutations}, user='bob')

    def test_09_trace_links_require_an_eligible_configured_source(self):
        target = self.api('POST', '/forms/' + self.other_form + '/templates', {'definitionJson': {
            'fields': [{'key': 'sourceLot', 'label': 'Source lot', 'type': 'trace-code', 'required': True}]}})
        type(self).target_template = target['id']
        self.api('POST', '/templates/' + target['id'] + '/publish', {})
        connection = self.api('PUT', '/forms/' + self.other_form + '/connections', {
            'sourcePpmFormId': self.form, 'sourceOutputKey': 'lotCode', 'targetInputKey': 'sourceLot',
            'connectionName': 'Lot dependency', 'status': 'ACTIVE', 'requiresApprovalBeforeUse': False})
        type(self).connection = connection['id']
        device = self.api('POST', '/devices', {'deviceUuid': 'test-downstream-device', 'displayName': 'Downstream'})
        type(self).downstream_device = device['id']
        self.api('PUT', '/forms/' + self.other_form + '/lease', {'deviceId': device['id'], 'expectedLeaseVersion': 0})
        self.api('PUT', '/forms/' + self.other_form + '/access/test-bob', {'canView': True, 'canCreate': True, 'canEdit': True})
        grant = self.api('POST', '/sync/grants', {'ppmFormId': self.other_form, 'deviceId': device['id'], 'leaseVersion': 1}, user='bob')
        type(self).downstream_proof = grant['authorProof']
        create = {'clientMutationId': secrets.token_hex(16), 'operationType': 'CREATE_DRAFT', 'recordId': 'downstream-lot',
                  'baseRevisionNo': 0, 'userId': 'test-bob', 'authorProof': self.downstream_proof,
                  'templateVersionId': target['id'], 'areaPpmAssignmentId': self.forms['PPM-002']['areaPpmAssignmentId'],
                  'productionDate': '2026-10-23', 'dataJson': {'sourceLot': self.output['outputCode']}}
        missing = self.downstream_batch([create])
        self.assertEqual(missing['results'][0]['error'], 'TRACE_SELECTION_REQUIRED')
        create['clientMutationId'] = secrets.token_hex(16)
        create['traceSelections'] = [{'connectionId': self.connection, 'sourceTraceOutputId': 'missing', 'inputPath': 'sourceLot'}]
        self.assertEqual(self.downstream_batch([create])['results'][0]['error'], 'TRACE_OUTPUT_INELIGIBLE')
        create['clientMutationId'] = secrets.token_hex(16)
        create['traceSelections'][0]['sourceTraceOutputId'] = self.output['id']
        accepted = self.downstream_batch([create])
        self.assertEqual(accepted['results'][0]['status'], 'APPLIED', accepted)
        self.assertEqual(sql("SELECT sourceTraceOutputId FROM PpmTraceLink WHERE downstreamInputKey='sourceLot' LIMIT 1"), self.output['id'])

    def test_10_trace_correction_preserves_links_and_creates_revalidation(self):
        body = {'deviceId': self.device, 'leaseVersion': 1, 'baseRevisionNo': 2,
                'reason': 'Correct production reading', 'dataJson': {'supplier': 'Lot supplier', 'temperature': 91, 'accepted': True}}
        corrected = self.api('POST', '/records/source-lot/corrections', body, user='alice')
        self.assertEqual(corrected['revisionNo'], 3)
        self.assertEqual(sql("SELECT status FROM PpmTraceOutput WHERE id='" + self.output['id'] + "'"), 'SUPERSEDED')
        self.assertEqual(sql('SELECT COUNT(*) FROM TraceRevalidationItem'), '1')
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmTraceLink'), '1')
        self.assertEqual(sql("SELECT COUNT(*) FROM PpmRecordRevision WHERE recordId='source-lot'"), '3')
        # Reusing an old source through a fresh revision must fail server revalidation.
        submit = {'clientMutationId': secrets.token_hex(16), 'operationType': 'QUEUE_SUBMIT', 'recordId': 'downstream-lot',
                  'baseRevisionNo': 1, 'userId': 'test-bob', 'authorProof': self.downstream_proof}
        self.assertEqual(self.downstream_batch([submit])['results'][0]['error'], 'TRACE_OUTPUT_INELIGIBLE')

    def test_11_selective_pull_advances_only_after_signed_acknowledgment(self):
        context = {'ppmFormId': self.other_form, 'deviceId': self.downstream_device, 'leaseVersion': 1}
        snapshot = self.api('POST', '/sync/bootstrap', context, user='bob')
        self.assertEqual(snapshot['ppmFormId'], self.other_form)
        self.assertTrue(all(row['ppmFormId'] == self.other_form for row in snapshot['templates']))
        self.assertTrue(all(row['record']['ppmFormId'] == self.other_form for row in snapshot['records']))
        self.assertEqual(snapshot['sources'][0]['sourcePpmFormId'], self.form)
        self.assertEqual(snapshot['sources'][0]['outputs'], [])  # retired source is ineligible
        pull = self.api('POST', '/sync/pull', dict(context, sourcePpmFormId=self.form, afterSequence='0', limit=100), user='bob')
        self.assertGreater(int(pull['nextSequence']), 0)
        self.assertTrue(all(row['eventType'].startswith('TRACE_OUTPUT_') for row in pull['events']))
        self.assertIn('TRACE_OUTPUT_RETIRED', [row['eventType'] for row in pull['events']])
        self.assertEqual(sql('SELECT COUNT(*) FROM SyncPullCursor'), '0')
        self.api('POST', '/sync/ack', dict(context, cursorToken=pull['cursorToken'] + 'x'), user='bob', expected=403)
        acknowledged = self.api('POST', '/sync/ack', dict(context, cursorToken=pull['cursorToken']), user='bob')
        self.assertEqual(acknowledged['lastEventSequence'], pull['nextSequence'])
        self.assertEqual(self.api('POST', '/sync/ack', dict(context, cursorToken=pull['cursorToken']), user='bob'), acknowledged)
        self.api('POST', '/sync/pull', dict(context, sourcePpmFormId=self.forms['PPM-003']['id']), user='bob', expected=403)
        self.api('PUT', '/forms/' + self.other_form + '/access/test-alice', {'canView': True})
        shared = self.api('POST', '/sync/pull', dict(context, sourcePpmFormId=self.form), user='alice')
        self.assertEqual(shared['nextSequence'], pull['nextSequence'])
        self.assertEqual(shared['events'], [])
        self.assertEqual(sql('SELECT COUNT(*) FROM SyncPullCursor'), '1')

    def test_12_approval_gate_and_downstream_revalidation(self):
        submitted = self.batch([self.mutation('QUEUE_SUBMIT', 'source-lot', base=3)])
        self.assertEqual(submitted['results'][0]['revisionNo'], 4)
        published = self.api('POST', '/records/source-lot/publish', {'deviceId': self.device, 'leaseVersion': 1, 'baseRevisionNo': 4})
        output = published['outputs'][0]
        self.assertEqual(output['outputCode'], 'LOT-20261023-002')
        self.api('PUT', '/forms/' + self.other_form + '/connections', {
            'sourcePpmFormId': self.form, 'sourceOutputKey': 'lotCode', 'targetInputKey': 'sourceLot',
            'connectionName': 'Lot dependency', 'status': 'ACTIVE', 'requiresApprovalBeforeUse': True})
        change = {'clientMutationId': secrets.token_hex(16), 'operationType': 'UPDATE_DRAFT', 'recordId': 'downstream-lot',
                  'baseRevisionNo': 1, 'userId': 'test-bob', 'authorProof': self.downstream_proof,
                  'dataJson': {'sourceLot': output['outputCode']},
                  'traceSelections': [{'connectionId': self.connection, 'sourceTraceOutputId': output['id'], 'inputPath': 'sourceLot'}]}
        self.assertEqual(self.downstream_batch([change])['results'][0]['error'], 'TRACE_OUTPUT_INELIGIBLE')
        review = {'deviceId': self.device, 'leaseVersion': 1, 'baseRevisionNo': 4, 'action': 'APPROVE', 'reason': 'FSQA checked source'}
        self.api('POST', '/records/source-lot/review', review, user='alice', expected=403)
        approved = self.api('POST', '/records/source-lot/review', review)
        self.assertEqual(approved['record']['status'], 'FSQA_APPROVED')
        change['clientMutationId'] = secrets.token_hex(16)
        self.assertEqual(self.downstream_batch([change])['results'][0]['revisionNo'], 2)
        impacts = self.api('GET', '/forms/' + self.other_form + '/revalidations', user='bob')['items']
        self.assertEqual(len(impacts), 1)
        item = impacts[0]['id']
        self.assertEqual(self.api('GET', '/records/downstream-lot', user='bob')['revalidations'][0]['id'], item)
        context = {'deviceId': self.downstream_device, 'leaseVersion': 1, 'baseRevisionNo': 2,
                   'decision': 'REPLACED_SOURCE', 'notes': 'Selected and validated replacement lot'}
        self.api('POST', '/revalidations/items/' + item + '/resolve', context, user='bob', expected=403)
        self.api('POST', '/revalidations/items/' + item + '/resolve', context)
        self.assertEqual(sql('SELECT status FROM TraceRevalidation LIMIT 1'), 'RESOLVED')
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmTraceLink'), '2')
        self.assertEqual(sql("SELECT currentRevisionNo FROM PpmRecord WHERE id='source-lot'"), '5')

    def test_13_concurrent_publication_reads_after_the_form_lock(self):
        draft = self.api('POST', '/forms/' + self.form + '/templates', {'definitionJson': self.definition})
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        second = subprocess.Popen(PHP + ['-S', '127.0.0.1:' + str(port), '-t', 'public', 'public/router.php'],
                                  cwd=ROOT, env=self.env, stdout=self.log, stderr=self.log)
        lock = None
        try:
            for _ in range(50):
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=0.1):
                        break
                except OSError:
                    time.sleep(0.1)
            lock = subprocess.Popen(PHP + ['tests/hold_form_lock.php', self.form], cwd=ROOT, env=self.env,
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(lock.stdout.readline().strip(), 'READY')
            def publish(base):
                request = Request(base + '/templates/' + draft['id'] + '/publish', data=b'{}', method='POST',
                                  headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.tokens['admin']})
                try:
                    response = urlopen(request, timeout=20)
                except HTTPError as error:
                    response = error
                with response:
                    return response.status, json.loads(response.read())
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(publish, base) for base in (self.base, 'http://127.0.0.1:' + str(port) + '/api/v1')]
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    if int(sql('SELECT COUNT(*) FROM information_schema.INNODB_LOCK_WAITS')) >= 2:
                        break
                    time.sleep(0.05)
                lock.communicate('\n', timeout=5)
                results = [future.result() for future in futures]
            self.assertEqual(sorted(result[0] for result in results), [200, 409], results)
            self.assertEqual(sql("SELECT COUNT(*) FROM SyncChangeEvent WHERE eventType='TEMPLATE_PUBLISHED' AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson,'$.id'))='" + draft['id'] + "'"), '1')
        finally:
            if lock is not None and lock.poll() is None:
                lock.communicate('\n', timeout=5)
            second.terminate()
            second.wait(timeout=5)

    def test_14_new_records_reject_stale_templates_and_authorship_spoofing(self):
        old = self.mutation('CREATE_DRAFT', 'stale-template', data={})
        self.assertEqual(self.batch([old])['results'][0]['error'], 'TEMPLATE_STALE_OR_UNPUBLISHED')
        # Existing records still use their exact historical definition.
        edit = self.mutation('UPDATE_DRAFT', 'record-a', base=3,
                             data={'supplier': 'Pinned', 'temperature': 70, 'accepted': False})
        self.assertEqual(self.batch([edit])['results'][0]['revisionNo'], 4)
        forged = self.mutation('UPDATE_DRAFT', 'record-a', base=4, data={})
        forged['userId'] = 'test-bob'
        self.assertEqual(self.batch([forged])['results'][0]['error'], 'AUTHOR_PROOF_MISMATCH')
        forged['authorProof'] += 'x'
        self.assertEqual(self.batch([forged])['results'][0]['error'], 'INVALID_PROOF')
        unauthored = self.mutation('UPDATE_DRAFT', 'record-a', base=4, data={})
        del unauthored['authorProof']
        self.assertEqual(self.batch([unauthored])['results'][0]['error'], 'AUTHOR_PROOF_REQUIRED')
        self.assertEqual(sql("SELECT currentRevisionNo FROM PpmRecord WHERE id='record-a'"), '4')

    def test_15_configured_forms_reuse_the_same_tables_and_services(self):
        area = sql('SELECT id FROM ProductionArea LIMIT 1')
        created = self.api('POST', '/forms', {'ppmCode': 'TEST-PPM-027', 'title': 'Configured inspection', 'areaId': area})
        type(self).configured_form = created['id']
        self.assertEqual(created['ppmCode'], 'TEST-PPM-027')
        self.api('POST', '/forms', {'ppmCode': 'TEST-PPM-027', 'title': 'Duplicate', 'areaId': area}, expected=409)
        self.api('POST', '/forms', {'ppmCode': 'TEST-PPM-028', 'title': 'Forbidden', 'areaId': area}, user='bob', expected=403)
        listed = self.api('GET', '/forms', user='alice')
        self.assertNotIn(created['id'], [row['id'] for row in listed['items']])
        self.api('PUT', '/forms/' + created['id'] + '/access/test-alice', {'canView': True})
        self.assertIn(created['id'], [row['id'] for row in self.api('GET', '/forms', user='alice')['items']])
        self.api('PUT', '/forms/' + created['id'] + '/areas/' + area, {'effectiveFrom': '2026-10-23'}, expected=409)
        self.assertEqual(sql("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'TEST-PPM-%'"), '0')

    def test_16_retries_ignore_json_key_order_and_expired_proofs_fail(self):
        duplicate = dict(self.create_mutations[0])
        duplicate['dataJson'] = {'accepted': False, 'temperature': 0, 'supplier': 'A'}
        self.assertEqual(self.batch([duplicate])['results'][0]['status'], 'APPLIED')
        import base64
        import hashlib
        import hmac
        claims = {'kind': 'author', 'userId': 'test-alice', 'ppmFormId': self.form,
                  'deviceId': self.device, 'leaseVersion': 1, 'issuedAt': 1, 'expiresAt': 2}
        payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip('=')
        proof = payload + '.' + hmac.new(self.env['APP_ENCRYPTION_KEY'].encode(), payload.encode(), hashlib.sha256).hexdigest()
        expired = self.mutation('UPDATE_DRAFT', 'record-a', base=4, data={})
        expired['authorProof'] = proof
        self.assertEqual(self.batch([expired])['results'][0]['error'], 'PROOF_EXPIRED_OR_INVALID')

    def test_17_public_device_ids_do_not_authorize_a_second_device(self):
        context = {'deviceId': self.device, 'ppmFormId': self.form, 'leaseVersion': 1}
        self.api('POST', '/sync/grants', context, user='alice', expected=403, device_auth=False)
        self.api('POST', '/sync/grants', context, user='alice', expected=403, device_auth='f' * 64)
        write = self.mutation('UPDATE_DRAFT', 'record-a', user='bob', base=4, data={})
        del write['authorProof']  # individual session alone is not device possession
        self.api('POST', '/sync/batches', dict(context, id=secrets.token_hex(16), mutations=[write]),
                 user='bob', expected=403, device_auth=False)
        token = self.device_tokens[self.device]
        self.assertNotIn(token, sql('SELECT GROUP_CONCAT(tokenHash) FROM ClientDeviceCredential'))
        self.assertEqual(sql("SELECT currentRevisionNo FROM PpmRecord WHERE id='record-a'"), '4')

    def test_18_unique_trace_rules_reject_duplicate_repeatable_rows(self):
        form = self.configured_form
        definition = {'fields': [{'key': 'entries', 'label': 'Entries', 'type': 'repeatable',
                      'fields': [{'key': 'code', 'label': 'Code', 'type': 'text', 'required': True}]}]}
        template = self.api('POST', '/forms/' + form + '/templates', {'definitionJson': definition})
        self.api('PUT', '/templates/' + template['id'] + '/rules', {'rules': [{
            'outputKey': 'lotCode', 'outputLabel': 'Lot', 'sourceType': 'MANUAL_EXTERNAL', 'status': 'ACTIVE',
            'requiresUniqueBusinessCode': True, 'configurationJson': {'outputPath': 'entries[].code'}}]})
        self.api('POST', '/templates/' + template['id'] + '/publish', {})
        device = self.api('POST', '/devices', {'deviceUuid': 'test-configurable-device', 'displayName': 'Configured device'})
        type(self).configured_device = device['id']
        self.api('PUT', '/forms/' + form + '/lease', {'deviceId': device['id'], 'expectedLeaseVersion': 0})
        assignment = sql("SELECT id FROM AreaPpmAssignment WHERE ppmFormId='" + form + "' LIMIT 1")
        create = {'clientMutationId': secrets.token_hex(16), 'operationType': 'CREATE_DRAFT', 'recordId': 'unique-rows',
                  'userId': 'test-admin', 'baseRevisionNo': 0, 'templateVersionId': template['id'],
                  'areaPpmAssignmentId': assignment, 'productionDate': '2026-10-23', 'dataJson': {'entries': [{'code': 'DUP'}, {'code': 'DUP'}]}}
        submit = {'clientMutationId': secrets.token_hex(16), 'operationType': 'QUEUE_SUBMIT', 'recordId': 'unique-rows',
                  'userId': 'test-admin', 'baseRevisionNo': 1}
        result = self.api('POST', '/sync/batches', {'id': secrets.token_hex(16), 'ppmFormId': form,
                          'deviceId': device['id'], 'leaseVersion': 1, 'mutations': [create, submit]})
        self.assertEqual(result['acceptedCount'], 2)
        self.api('POST', '/records/unique-rows/publish', {'deviceId': device['id'], 'leaseVersion': 1, 'baseRevisionNo': 2}, expected=409)
        self.assertEqual(sql("SELECT COUNT(*) FROM PpmTraceOutput WHERE recordId='unique-rows'"), '0')

    def test_19_upstream_impacts_invalidate_the_complete_downstream_chain(self):
        target = self.api('POST', '/forms/' + self.other_form + '/templates', {'definitionJson': {
            'fields': [{'key': 'sourceLot', 'label': 'Source lot', 'type': 'trace-code', 'required': True}]}})
        self.api('PUT', '/templates/' + target['id'] + '/rules', {'rules': [{
            'outputKey': 'bCode', 'outputLabel': 'B output', 'sourceType': 'SYSTEM_GENERATED', 'status': 'ACTIVE',
            'formulaTemplate': 'B-{{record.id}}', 'configurationJson': {}}]})
        self.api('POST', '/templates/' + target['id'] + '/publish', {})
        source = self.api('GET', '/records/source-lot')['record']
        source_output = sql("SELECT id FROM PpmTraceOutput WHERE recordId='source-lot' AND status='LINKED_DOWNSTREAM' LIMIT 1")
        source_code = sql("SELECT outputCode FROM PpmTraceOutput WHERE id='" + source_output + "'")
        create_b = {'clientMutationId': secrets.token_hex(16), 'operationType': 'CREATE_DRAFT', 'recordId': 'chain-b',
                    'userId': 'test-bob', 'authorProof': self.downstream_proof, 'baseRevisionNo': 0,
                    'templateVersionId': target['id'], 'areaPpmAssignmentId': self.forms['PPM-002']['areaPpmAssignmentId'],
                    'productionDate': '2026-10-23', 'dataJson': {'sourceLot': source_code},
                    'traceSelections': [{'connectionId': self.connection, 'sourceTraceOutputId': source_output, 'inputPath': 'sourceLot'}]}
        submit_b = {'clientMutationId': secrets.token_hex(16), 'operationType': 'QUEUE_SUBMIT', 'recordId': 'chain-b',
                    'userId': 'test-bob', 'authorProof': self.downstream_proof, 'baseRevisionNo': 1}
        self.assertEqual(self.downstream_batch([create_b, submit_b])['acceptedCount'], 2)
        output_b = self.api('POST', '/records/chain-b/publish', {'deviceId': self.downstream_device, 'leaseVersion': 1, 'baseRevisionNo': 2})['outputs'][0]
        form_c = self.configured_form
        template_c = self.api('POST', '/forms/' + form_c + '/templates', {'definitionJson': {
            'fields': [{'key': 'fromB', 'label': 'B source', 'type': 'trace-code', 'required': True}]}})
        self.api('PUT', '/templates/' + template_c['id'] + '/rules', {'rules': [{
            'outputKey': 'cCode', 'outputLabel': 'C output', 'sourceType': 'SYSTEM_GENERATED', 'status': 'ACTIVE',
            'formulaTemplate': 'C-{{record.id}}', 'configurationJson': {}}]})
        self.api('POST', '/templates/' + template_c['id'] + '/publish', {})
        connection = self.api('PUT', '/forms/' + form_c + '/connections', {'sourcePpmFormId': self.other_form,
                             'sourceOutputKey': 'bCode', 'targetInputKey': 'fromB', 'connectionName': 'B to C',
                             'status': 'ACTIVE', 'requiresApprovalBeforeUse': False})
        create_c = dict(create_b, clientMutationId=secrets.token_hex(16), recordId='chain-c', userId='test-admin',
                        templateVersionId=template_c['id'], areaPpmAssignmentId=sql("SELECT id FROM AreaPpmAssignment WHERE ppmFormId='" + form_c + "' LIMIT 1"),
                        dataJson={'fromB': output_b['outputCode']}, traceSelections=[{'connectionId': connection['id'], 'sourceTraceOutputId': output_b['id'], 'inputPath': 'fromB'}])
        del create_c['authorProof']
        submit_c = dict(submit_b, clientMutationId=secrets.token_hex(16), recordId='chain-c', userId='test-admin')
        del submit_c['authorProof']
        self.api('POST', '/sync/batches', {'id': secrets.token_hex(16), 'ppmFormId': form_c, 'deviceId': self.configured_device,
                 'leaseVersion': 1, 'mutations': [create_c, submit_c]})
        output_c = self.api('POST', '/records/chain-c/publish', {'deviceId': self.configured_device, 'leaseVersion': 1, 'baseRevisionNo': 2})['outputs'][0]
        self.api('POST', '/records/source-lot/corrections', {'deviceId': self.device, 'leaseVersion': 1,
                 'baseRevisionNo': source['currentRevisionNo'], 'reason': 'Critical upstream correction',
                 'dataJson': {'supplier': 'Changed source', 'temperature': 92, 'accepted': True}}, user='alice')
        for output in (output_b, output_c):
            self.assertEqual(sql("SELECT status FROM PpmTraceOutput WHERE id='" + output['id'] + "'"), 'SUPERSEDED')
        self.api('POST', '/records/chain-b/publish', {'deviceId': self.downstream_device, 'leaseVersion': 1, 'baseRevisionNo': 2}, expected=409)
        impacts = self.api('GET', '/forms/' + form_c + '/revalidations')['items']
        self.assertEqual(impacts[0]['recordId'], 'chain-c')
        pull = self.api('POST', '/sync/pull', {'ppmFormId': form_c, 'deviceId': self.configured_device, 'leaseVersion': 1,
                       'sourcePpmFormId': self.other_form, 'afterSequence': '0'})
        self.assertIn(output_b['id'], [event['payloadJson']['id'] for event in pull['events'] if event['eventType'] == 'TRACE_OUTPUT_RETIRED'])

    def test_18a_mutation_identity_is_serialized_across_forms(self):
        identity = secrets.token_hex(16)
        template = sql("SELECT id FROM PpmTemplateVersion WHERE ppmFormId='" + self.configured_form + "' AND isActive=1")
        assignment = sql("SELECT id FROM AreaPpmAssignment WHERE ppmFormId='" + self.configured_form + "' LIMIT 1")
        body_a = {'id': secrets.token_hex(16), 'ppmFormId': self.form, 'deviceId': self.device, 'leaseVersion': 1,
                  'mutations': [{'clientMutationId': identity, 'operationType': 'UPDATE_DRAFT', 'recordId': 'record-a',
                                 'userId': 'test-admin', 'baseRevisionNo': 4, 'dataJson': {'supplier': 'Concurrent', 'temperature': 70, 'accepted': False}}]}
        body_b = {'id': secrets.token_hex(16), 'ppmFormId': self.configured_form, 'deviceId': self.configured_device, 'leaseVersion': 1,
                  'mutations': [{'clientMutationId': identity, 'operationType': 'CREATE_DRAFT', 'recordId': 'concurrent-other',
                                 'userId': 'test-admin', 'baseRevisionNo': 0, 'templateVersionId': template,
                                 'areaPpmAssignmentId': assignment, 'productionDate': '2026-10-23', 'dataJson': {'entries': []}}]}
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        second = subprocess.Popen(PHP + ['-S', '127.0.0.1:' + str(port), '-t', 'public', 'public/router.php'],
                                  cwd=ROOT, env=self.env, stdout=self.log, stderr=self.log)
        lock = None
        try:
            for _ in range(50):
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=0.1):
                        break
                except OSError:
                    time.sleep(0.1)
            lock = subprocess.Popen(PHP + ['tests/hold_form_lock.php', identity, 'mutation'], cwd=ROOT, env=self.env,
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertEqual(lock.stdout.readline().strip(), 'READY')
            def push(base, body):
                request = Request(base + '/sync/batches', data=json.dumps(body).encode(), method='POST',
                                  headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.tokens['admin'],
                                           'X-PPMS-Device-Token': self.device_tokens[body['deviceId']]})
                try:
                    response = urlopen(request, timeout=20)
                except HTTPError as error:
                    response = error
                with response:
                    return response.status, json.loads(response.read())
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(push, self.base, body_a),
                           pool.submit(push, 'http://127.0.0.1:' + str(port) + '/api/v1', body_b)]
                deadline = time.monotonic() + 8
                while time.monotonic() < deadline:
                    if int(sql('SELECT COUNT(*) FROM information_schema.INNODB_LOCK_WAITS')) >= 1:
                        break
                    time.sleep(0.05)
                lock.communicate('\n', timeout=5)
                results = [future.result() for future in futures]
            self.assertEqual([result[0] for result in results], [200, 200], results)
            self.assertEqual(sorted(result[1]['results'][0]['status'] for result in results), ['APPLIED', 'REJECTED'])
            self.assertEqual(sql("SELECT COUNT(*) FROM SyncMutationReceipt WHERE clientMutationId='" + identity + "'"), '1')
        finally:
            if lock is not None and lock.poll() is None:
                lock.communicate('\n', timeout=5)
            second.terminate()
            second.wait(timeout=5)

    def test_20_revocation_and_reconciled_device_transfer(self):
        edit = self.mutation('UPDATE_DRAFT', 'record-a', base=4, data={})
        self.api('PUT', '/forms/' + self.form + '/access/test-alice', {'canView': True})
        self.assertEqual(self.batch([edit])['results'][0]['error'], 'FORM_PERMISSION_DENIED')
        replacement = self.api('POST', '/devices', {'deviceUuid': 'test-replacement', 'displayName': 'Replacement'})
        self.api('PUT', '/forms/' + self.form + '/lease', {'deviceId': replacement['id'], 'expectedLeaseVersion': 1}, expected=409)
        lease = self.api('PUT', '/forms/' + self.form + '/lease', {'deviceId': replacement['id'], 'expectedLeaseVersion': 1,
                        'reconciled': True, 'reason': 'All pending local changes reconciled'})
        self.assertEqual(lease['leaseVersion'], 2)
        self.batch([edit], expected=403)
        self.api('POST', '/devices/' + replacement['id'] + '/revoke', {'reason': 'Device retired'})
        self.api('POST', '/sync/grants', {'ppmFormId': self.form, 'deviceId': replacement['id'], 'leaseVersion': 2}, user='bob', expected=403)
        self.api('POST', '/auth/logout', {}, user='bob')
        self.api('GET', '/me', user='bob', expected=401)


if __name__ == '__main__':
    unittest.main(verbosity=2)
