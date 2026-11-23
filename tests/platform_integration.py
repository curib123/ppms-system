"""Real HTTP regression coverage for the shared web/mobile platform contract."""
import hashlib
import secrets
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
import unittest
from urllib.request import urlopen

import api_integration as api_fixture
from integration import TEST_ARGS, PHP, ROOT, sql, lock_wait_count


class PlatformIntegration(unittest.TestCase):
    setUpClass = classmethod(api_fixture.PpmApiIntegration.setUpClass.__func__)
    stop_server = classmethod(api_fixture.PpmApiIntegration.stop_server.__func__)
    api = api_fixture.PpmApiIntegration.api
    login = api_fixture.PpmApiIntegration.login

    def setUp(self):
        if 'admin' not in self.tokens:
            self.login('admin')
        if not getattr(type(self), 'platform_template', None):
            template = self.api('POST', '/forms/' + self.form + '/templates', {
                'definitionJson': {'fields': [{'key': 'note', 'label': 'Note', 'type': 'text', 'required': True}]}})
            self.api('POST', '/templates/' + template['id'] + '/publish', {})
            type(self).platform_template = template['id']

    def create(self, record=None, **extras):
        record = record or secrets.token_hex(12)
        body = dict(ppmFormId=self.form, recordId=record, clientMutationId=secrets.token_hex(16),
                    baseRevisionNo=0, templateVersionId=self.platform_template,
                    areaPpmAssignmentId=self.forms['PPM-001']['areaPpmAssignmentId'],
                    productionDate='2026-10-23', dataJson={'note': 'Original'}, **extras)
        result = self.api('POST', '/records', body)
        self.assertEqual(result['result']['status'], 'APPLIED', result)
        return record, body, result

    def test_01_online_idempotence_concurrency_conflict_and_tombstone(self):
        record, body, first = self.create(batchNo='0007')
        self.assertEqual(self.api('POST', '/records', body)['result'], first['result'])
        self.assertEqual(first['record']['record']['batchNo'], '0007')
        edit = {'clientMutationId': secrets.token_hex(16), 'baseRevisionNo': 1, 'dataJson': {'note': 'Server edit'}}
        updated = self.api('PATCH', '/records/' + record, edit)
        self.assertEqual(updated['result']['revisionNo'], 2)
        conflict = self.api('PATCH', '/records/' + record, dict(edit, clientMutationId=secrets.token_hex(16), dataJson={'note': 'Local edit'}))
        self.assertEqual(conflict['result']['status'], 'CONFLICT')
        self.assertEqual(conflict['record']['revision']['dataJson']['note'], 'Server edit')
        resolved = self.api('POST', '/records/' + record + '/resolve-conflict', {
            'clientMutationId': secrets.token_hex(16), 'baseRevisionNo': 2,
            'conflictId': conflict['result']['conflictId'], 'resolutionType': 'MANUAL_MERGE',
            'reason': 'Keep both observations', 'dataJson': {'note': 'Server and local edit'}})
        self.assertEqual(resolved['result']['revisionNo'], 3)
        self.assertEqual(resolved['record']['revision']['correctionReason'], 'Keep both observations')
        history = self.api('GET', '/records/' + record + '/history?limit=2')
        self.assertEqual(len(history['items']), 2)
        deleted = self.api('DELETE', '/records/' + record, {
            'clientMutationId': secrets.token_hex(16), 'baseRevisionNo': 3, 'reason': 'Duplicate worksheet'})
        self.assertEqual(deleted['result']['status'], 'APPLIED')
        self.assertTrue(deleted['record']['record']['archivedAt'])
        retry = self.api('PATCH', '/records/' + record, dict(edit, clientMutationId=secrets.token_hex(16), baseRevisionNo=4))
        self.assertEqual(retry['result']['status'], 'REJECTED')
        self.assertEqual(sql("SELECT COUNT(*) FROM PpmRecord WHERE id='" + record + "'"), '1')
        self.assertEqual(sql("SELECT COUNT(*) FROM SyncChangeEvent WHERE recordId='" + record + "' AND eventType='RECORD_DELETED'"), '1')

    def test_02_effective_area_permissions_for_real_reviewer_roles(self):
        area = sql("SELECT areaId FROM AreaPpmAssignment WHERE id='" + self.forms['PPM-001']['areaPpmAssignmentId'] + "'")
        assignment = self.forms['PPM-001']['areaPpmAssignmentId']
        for user in ('fsqa', 'supervisor', 'manager'):
            self.login(user)
            self.api('PUT', '/users/test-' + user + '/areas/' + area, {'isActive': True})
            try:
                sql("UPDATE AreaPpmAssignment SET effectiveFrom=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 30 DAY),effectiveTo=NULL WHERE id='" + assignment + "'")
                self.api('GET', '/forms/' + self.form + '/templates', user=user, expected=403)
                sql("UPDATE AreaPpmAssignment SET effectiveFrom=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 60 DAY),effectiveTo=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 30 DAY) WHERE id='" + assignment + "'")
                self.api('GET', '/forms/' + self.form + '/templates', user=user, expected=403)
                sql("UPDATE AreaPpmAssignment SET effectiveFrom='2026-01-01',effectiveTo=NULL WHERE id='" + assignment + "'")
                self.api('GET', '/forms/' + self.form + '/templates', user=user)
            finally:
                sql("UPDATE AreaPpmAssignment SET effectiveFrom='2026-01-01',effectiveTo=NULL WHERE id='" + assignment + "'")

    def test_03_reference_review_is_nonblocking_versioned_and_emitted(self):
        record, _, _ = self.create()
        submitted = self.api('POST', '/records/' + record + '/submit', {'clientMutationId': secrets.token_hex(16), 'baseRevisionNo': 1})
        self.assertEqual(submitted['result']['revisionNo'], 2)
        before = int(sql('SELECT COALESCE(MAX(sequence),0) FROM SyncChangeEvent'))
        review = {'status': 'APPROVED', 'reviewerName': 'QA Reviewer', 'reviewerPosition': 'Food Safety',
                  'expectedRevisionNo': 2, 'expectedReviewVersion': 0, 'remarks': 'Reviewed reference'}
        reviewed = self.api('POST', '/records/' + record + '/review', review, user='fsqa')
        self.assertEqual(reviewed['record']['currentRevisionNo'], 2)
        self.assertEqual(reviewed['reviewReference']['status'], 'APPROVED')
        self.assertTrue(reviewed['reviewReference']['reviewedAt'])
        self.assertGreater(int(sql('SELECT MAX(sequence) FROM SyncChangeEvent')), before)
        self.api('POST', '/records/' + record + '/review', review, user='manager', expected=409)
        self.login('outsider')
        self.api('POST', '/records/' + record + '/review', review, user='outsider', expected=403)
        changed = self.api('PATCH', '/records/' + record, {'clientMutationId': secrets.token_hex(16),
            'baseRevisionNo': 2, 'dataJson': {'note': 'Edited after approval'}})
        self.assertEqual(changed['result']['status'], 'APPLIED')
        self.assertEqual(changed['record']['reviewReference']['status'], 'PENDING_REVIEW')
        self.assertEqual(sql("SELECT JSON_CONTAINS_PATH(payloadJson,'one','$.revisions') FROM SyncChangeEvent WHERE recordId='" + record + "' ORDER BY sequence DESC LIMIT 1"), '0')

    def test_04_expired_lockout_resets_failure_budget(self):
        for _ in range(5):
            self.api('POST', '/auth/login', {'username': 'outsider', 'password': 'wrong'}, user=None, expected=401)
        key = hashlib.sha256(b'outsider|127.0.0.1').hexdigest()
        self.assertEqual(sql("SELECT failureCount FROM AuthLoginDefense WHERE identifierHash='" + key + "'"), '5')
        sql("UPDATE AuthLoginDefense SET lockedUntil=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE identifierHash='" + key + "'")
        self.api('POST', '/auth/login', {'username': 'outsider', 'password': 'wrong'}, user=None, expected=401)
        self.assertEqual(sql("SELECT failureCount FROM AuthLoginDefense WHERE identifierHash='" + key + "'"), '1')
        self.login('outsider')
        self.assertGreaterEqual(int(sql("SELECT COUNT(*) FROM AuditLog WHERE action='LOGIN_FAILED'")), 5)

    def test_05_user_password_lifecycle_and_last_admin(self):
        password = secrets.token_urlsafe(24)
        new = self.api('POST', '/users', {'username': 'platform-user', 'displayName': 'Platform User',
            'email': 'platform@example.test', 'role': 'PERSONNEL', 'password': password})
        self.assertNotIn(password, str(new))
        login = self.api('POST', '/auth/login', {'username': 'platform-user', 'password': password}, user=None)
        self.tokens['platform-user'] = login['token']
        self.api('GET', '/users', user='platform-user', expected=403)
        self.api('POST', '/users/' + new['id'] + '/revoke-sessions', {})
        self.api('GET', '/me', user='platform-user', expected=401)
        next_password = secrets.token_urlsafe(24)
        self.api('POST', '/users/' + new['id'] + '/reset-password', {'newPassword': next_password})
        self.api('POST', '/auth/login', {'username': 'platform-user', 'password': password}, user=None, expected=401)
        self.api('POST', '/auth/login', {'username': 'platform-user', 'password': next_password}, user=None)
        self.api('PATCH', '/users/test-admin', {'role': 'PERSONNEL'}, expected=409)
        self.api('PATCH', '/users/' + new['id'], {'accountStatus': 'INACTIVE'})
        self.api('POST', '/auth/login', {'username': 'platform-user', 'password': next_password}, user=None, expected=401)

    def test_06_settings_preferences_and_input_bounds(self):
        settings = self.api('GET', '/settings')['items']
        setting = next(row for row in settings if row['key'] == 'offline.enabled')
        payload = {'items': [{'key': setting['key'], 'expectedUpdatedAt': setting['updatedAt'], 'valueJson': False}]}
        self.api('PUT', '/settings', payload)
        self.api('PUT', '/settings', payload, expected=409)
        self.api('GET', '/settings', user='outsider', expected=403)
        preference = self.api('PUT', '/preferences', {'appearanceMode': 'DARK', 'listViewMode': 'CARDS', 'preferencesJson': {'compact': True}})
        self.assertTrue(preference['preferencesJson']['compact'])
        self.api('POST', '/records', {'content': 'x' * (2 * 1024 * 1024)}, expected=413)
        self.api('GET', '/records?limit[]=5', expected=422)

    def test_07_client_shells_and_readiness(self):
        root = self.base.removesuffix('/api/v1')
        for path in ('/admin', '/mobile'):
            with urlopen(root + path) as response:
                self.assertEqual(response.status, 200)
                self.assertIn('frame-ancestors', response.headers['Content-Security-Policy'])
                self.assertIn('ppms', response.read().decode().lower())
        with urlopen(root + '/ready') as response:
            self.assertEqual(response.status, 200)
        self.assertEqual(self.api('GET', '/jobs')['items'], [])


    def test_08_login_serializes_with_password_reset(self):
        old = secrets.token_urlsafe(24)
        self.api('POST', '/users', {'username': 'reset-race', 'email': 'race@example.test',
            'displayName': 'Reset race', 'role': 'PERSONNEL', 'password': old})
        holder = subprocess.Popen(PHP + ['tests/hold_user_lock.php', 'reset-race'], cwd=ROOT,
            env=dict(self.env, PPMS_TEST_NEW_PASSWORD=secrets.token_urlsafe(24)),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            self.assertEqual(holder.stdout.readline().strip(), 'READY')
            with ThreadPoolExecutor(max_workers=1) as pool:
                login = pool.submit(self.api, 'POST', '/auth/login', {'username': 'reset-race', 'password': old}, None, 401)
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if lock_wait_count() >= 1:
                        break
                    time.sleep(.02)
                holder.communicate('commit\n', timeout=10)
                login.result(timeout=10)
            self.assertEqual(sql("SELECT COUNT(*) FROM AuthSession s JOIN User u ON u.id=s.userId WHERE u.username='reset-race' AND s.revokedAt IS NULL"), '0')
        finally:
            if holder.poll() is None:
                holder.communicate('commit\n', timeout=10)


if __name__ == '__main__':
    unittest.main(argv=[__file__] + TEST_ARGS, verbosity=2)
