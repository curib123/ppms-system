"""End-to-end setup checks using a disposable database in a local PostgreSQL container.

Set DB_PASSWORD for the local test database role, then run:
python tests/integration.py --php-extension pdo_pgsql
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
PARSER = argparse.ArgumentParser()
PARSER.add_argument('--php', default='php')
PARSER.add_argument('--php-extension', action='append', default=[])
OPTIONS, TEST_ARGS = PARSER.parse_known_args()
PHP = [OPTIONS.php]
for extension in OPTIONS.php_extension:
    PHP += ['-d', 'extension=' + extension]
CONTAINER = os.environ.get('PPMS_TEST_CONTAINER', 'ppms-postgres-1')
USER = os.environ.get('DB_USERNAME', 'ppms')
DATABASE = 'ppms_ci3_test_' + str(os.getpid())
ENV = dict(os.environ, DB_DATABASE=DATABASE, DB_HOST='127.0.0.1',
           DB_PORT=os.environ.get('DB_PORT', '55432'), DB_USERNAME=USER,
           CI_ENV='testing')


def docker(*args):
    return subprocess.check_output(['docker', 'exec', CONTAINER, *args], text=True)


def sql(query):
    return docker('psql', '-X', '-U', USER, '-d', DATABASE,
                  '-v', 'ON_ERROR_STOP=1', '-At', '-c', query).strip()


def cli(*args, env=ENV):
    return subprocess.run(PHP + ['index.php', *args], cwd=ROOT, env=env,
                          text=True, capture_output=True, timeout=30)


def request(path, base):
    try:
        with urlopen(base + path, timeout=10) as response:
            return response.status, response.read().decode()
    except HTTPError as error:
        with error:
            return error.code, error.read().decode()


class SetupIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        docker('createdb', '-U', USER, DATABASE)
        cls.addClassCleanup(lambda: docker('dropdb', '-U', USER, DATABASE))

    def test_01_install_and_verify_canonical_database(self):
        result = cli('setup', 'install')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'installed')
        result = cli('setup', 'verify')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['tables'], 28)
        self.assertEqual(sql('SELECT count(*) FROM public."User"'), '0')

    def test_02_second_install_refuses_without_changing_data(self):
        before = sql('SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public."PpmTemplateVersion" t')
        result = cli('setup', 'install')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('empty', result.stderr.lower())
        self.assertEqual(before, sql('SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) FROM public."PpmTemplateVersion" t'))

    def test_03_verify_detects_modified_default_data(self):
        original = sql('SELECT title FROM public."PpmForm" WHERE "ppmCode" = \'PPM-001\'')
        try:
            sql('UPDATE public."PpmForm" SET title = \'Changed\' WHERE "ppmCode" = \'PPM-001\'')
            result = cli('setup', 'verify')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('PpmForm', result.stderr)
        finally:
            sql('UPDATE public."PpmForm" SET title = \'' + original.replace("'", "''") + '\' WHERE "ppmCode" = \'PPM-001\'')

    def test_04_connection_failure_has_nonzero_exit_and_no_password(self):
        result = cli('setup', 'check', env=dict(ENV, DB_PORT='1', DB_PASSWORD='must-not-be-disclosed'))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('connection', result.stderr.lower())
        self.assertNotIn('must-not-be-disclosed', result.stdout + result.stderr)

    def test_05_web_routes_and_private_files(self):
        self.check_server(ENV, healthy=True)

    def test_06_unavailable_database_returns_503(self):
        self.check_server(dict(ENV, DB_PORT='1', DB_PASSWORD='must-not-be-disclosed'), healthy=False)

    def test_07_manifest_hashes(self):
        manifest = json.loads((ROOT / 'database/manifest.json').read_text())
        for name, digest in manifest['sha256'].items():
            with self.subTest(file=name):
                self.assertEqual(hashlib.sha256((ROOT / 'database' / name).read_bytes()).hexdigest(), digest)

    def check_server(self, env, healthy):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        base = 'http://127.0.0.1:' + str(port)
        with tempfile.TemporaryFile() as log:
            server = subprocess.Popen(PHP + ['-S', '127.0.0.1:' + str(port), '-t', 'public', 'public/router.php'],
                                      cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                for _ in range(50):
                    try:
                        with socket.create_connection(('127.0.0.1', port), timeout=0.1):
                            break
                    except OSError:
                        time.sleep(0.1)
                status, body = request('/health', base)
                self.assertEqual(status, 200 if healthy else 503, body)
                self.assertEqual(json.loads(body)['database'], 'connected' if healthy else 'unavailable')
                self.assertNotIn('must-not-be-disclosed', body)
                status, body = request('/', base)
                self.assertEqual(status, 200)
                self.assertIn('PPMS', body)
                self.assertIn('Database connected' if healthy else 'Database setup needed', body)
                if healthy:
                    self.assertIn('PPM-001', body)
                    self.assertEqual(body.count('<tr><td>'), 26)
                self.assertNotIn('must-not-be-disclosed', body)
                for path in ['/setup/install', '/index.php/setup/install', '/application/config/local.php',
                             '/database/default_data.sql', '/system/core/CodeIgniter.php', '/.git/config']:
                    with self.subTest(path=path):
                        self.assertEqual(request(path, base)[0], 404)
            finally:
                server.terminate()
                server.wait(timeout=5)


if __name__ == '__main__':
    unittest.main(argv=[__file__, *TEST_ARGS], verbosity=2)
