"""End-to-end setup checks using a disposable database in the local MySQL/MariaDB server.

Set DB_PASSWORD for the local test database role, then run:
python tests/integration.py
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import shutil
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
USER = os.environ.get('DB_USERNAME', 'root')
DATABASE = 'ppms_ci3_test_' + str(os.getpid())
ENV = dict(os.environ, DB_DATABASE=DATABASE, DB_HOST=os.environ.get('DB_HOST', '127.0.0.1'),
           DB_PORT=os.environ.get('DB_PORT', '3306'), DB_USERNAME=USER,
           DB_PASSWORD=os.environ.get('DB_PASSWORD', ''), CI_ENV='testing')


def query(statement, database=DATABASE):
    return subprocess.run(PHP + ['tests/database.php'], cwd=ROOT, env=ENV,
                          input=json.dumps({'database': database, 'sql': statement}),
                          text=True, capture_output=True, timeout=15)


def sql(statement, database=DATABASE):
    result = query(statement, database)
    if result.returncode:
        raise AssertionError(result.stderr)
    rows = json.loads(result.stdout)
    return rows[0][0] if rows else ''


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
        sql('CREATE DATABASE `' + DATABASE + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', None)
        cls.addClassCleanup(lambda: sql('DROP DATABASE `' + DATABASE + '`', None))

    def test_01_install_and_verify_canonical_database(self):
        result = cli('setup', 'install')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'installed')
        result = cli('setup', 'verify')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['tables'], 28)
        self.assertEqual(sql('SELECT count(*) FROM `User`'), '0')

    def test_02_second_install_refuses_without_changing_data(self):
        before = sql('SELECT SHA2(GROUP_CONCAT(id ORDER BY id),256) FROM `PpmTemplateVersion`')
        result = cli('setup', 'install')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('empty', result.stderr.lower())
        self.assertEqual(before, sql('SELECT SHA2(GROUP_CONCAT(id ORDER BY id),256) FROM `PpmTemplateVersion`'))

    def test_03_verify_detects_modified_default_data(self):
        original = sql('SELECT title FROM `PpmForm` WHERE `ppmCode` = \'PPM-001\'')
        try:
            sql('UPDATE `PpmForm` SET title = \'Changed\' WHERE `ppmCode` = \'PPM-001\'')
            result = cli('setup', 'verify')
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('PpmForm', result.stderr)
        finally:
            sql('UPDATE `PpmForm` SET title = \'' + original.replace("'", "''") + '\' WHERE `ppmCode` = \'PPM-001\'')

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

    def test_08_constraints_reject_invalid_data(self):
        statements = [
            "UPDATE `AreaPpmAssignment` SET `isActive`=2 LIMIT 1",
            "UPDATE `PpmTemplateVersion` SET `definitionJson`='invalid-json' LIMIT 1",
            "INSERT INTO `PpmTemplateVersion` (`id`,`ppmFormId`,`versionNo`,`definitionJson`,`createdAt`,`updatedAt`) VALUES ('orphan','missing',1,'{}',NOW(3),NOW(3))",
            "INSERT INTO `PpmForm` (`id`,`ppmCode`,`title`,`createdAt`,`updatedAt`) VALUES ('duplicate','PPM-001','Duplicate',NOW(3),NOW(3))",
            "UPDATE `PpmForm` SET `ppmCode`=REPEAT('x',192) LIMIT 1",
        ]
        for statement in statements:
            with self.subTest(statement=statement):
                self.assertNotEqual(query(statement).returncode, 0)
        self.assertEqual(cli('setup', 'verify').returncode, 0)

    def test_09_failed_seed_cleans_only_new_tables_and_can_retry(self):
        target = DATABASE + '_failure'
        sql('CREATE DATABASE `' + target + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', None)
        try:
            with tempfile.TemporaryDirectory() as directory:
                copy = Path(directory) / 'app'
                shutil.copytree(ROOT, copy, ignore=shutil.ignore_patterns('.git', '*.log', '__pycache__', 'local.php'))
                seed = copy / 'database/default_data.sql'
                seed.write_text(seed.read_text() + '\nINSERT INTO `missing_table` VALUES (1);\n', encoding='utf-8')
                manifest = copy / 'database/manifest.json'
                content = json.loads(manifest.read_text())
                content['sha256']['default_data.sql'] = hashlib.sha256(seed.read_bytes()).hexdigest()
                manifest.write_text(json.dumps(content), encoding='utf-8')
                result = subprocess.run(PHP + ['index.php', 'setup', 'install'], cwd=copy,
                                        env=dict(ENV, DB_DATABASE=target), capture_output=True, text=True, timeout=30)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertEqual(sql('SELECT count(*) FROM information_schema.tables WHERE table_schema=DATABASE()', target), '0')
                result = cli('setup', 'install', env=dict(ENV, DB_DATABASE=target))
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        finally:
            sql('DROP DATABASE `' + target + '`', None)

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
