"""Real HTTP -> CI3 controllers -> services -> disposable MySQL integration."""
import json
import os
import secrets
import socket
import subprocess
import tempfile
import time
import unittest
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

    @classmethod
    def stop_server(cls):
        cls.server.terminate()
        cls.server.wait(timeout=5)

    def api(self, method, path, data=None, user='admin', expected=200):
        headers = {'Content-Type': 'application/json'}
        if user in self.tokens:
            headers['Authorization'] = 'Bearer ' + self.tokens[user]
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
            return json.loads(body)

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


if __name__ == '__main__':
    unittest.main(verbosity=2)
