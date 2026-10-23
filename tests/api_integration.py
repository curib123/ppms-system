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


if __name__ == '__main__':
    unittest.main(verbosity=2)
