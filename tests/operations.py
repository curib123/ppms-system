"""Restore drill and cleanup safety against disposable databases only."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import unittest

from integration import DATABASE, ENV, PHP, ROOT, TEST_ARGS, cli, sql


class OperationalChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (os.environ.get('PPMS_SQL_CLIENT') or shutil.which('mariadb') or shutil.which('mysql')):
            raise unittest.SkipTest('MySQL/MariaDB client utility required for restore drill')
        if not (os.environ.get('PPMS_SQL_DUMP') or shutil.which('mariadb-dump') or shutil.which('mysqldump')):
            raise unittest.SkipTest('MySQL/MariaDB dump utility required for restore drill')
        sql('CREATE DATABASE `' + DATABASE + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', None)
        cls.addClassCleanup(lambda: sql('DROP DATABASE `' + DATABASE + '`', None))
        for action in ('install', 'migrate'):
            result = cli('setup', action)
            if result.returncode:
                raise AssertionError(result.stdout + result.stderr)

    def operation(self, *args, success=True):
        result = subprocess.run([sys.executable, 'scripts/maintenance.py', *args], cwd=ROOT, env=ENV,
                                capture_output=True, text=True, timeout=120)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0)
        return result

    def test_01_backup_restore_and_refuse_overwrite(self):
        with tempfile.TemporaryDirectory(prefix='ppms-restore-drill-') as directory:
            path = Path(directory) / 'snapshot.sql'
            backup = self.operation('backup', '--output', str(path))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(backup['sha256'], digest)
            self.assertEqual(json.loads(path.with_suffix('.sql.json').read_text())['sha256'], digest)
            self.operation('backup', '--output', str(path), success=False)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
            target = DATABASE + '_restored'
            try:
                self.operation('restore', '--input', str(path), '--target', target, '--sha256', '0' * 64, success=False)
                self.assertEqual(sql("SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='" + target + "'", None), '0')
                result = self.operation('restore', '--input', str(path), '--target', target, '--sha256', digest)
                self.assertEqual(result['status'], 'restored_for_verification')
                self.assertEqual(sql('SELECT COUNT(*) FROM PpmForm', target), '26')
                self.assertEqual(sql('SELECT COUNT(*) FROM PpmTemplateVersion', target), '26')
                self.assertEqual(sql('SELECT COUNT(*) FROM SyncFormPullCursor', target), '0')
                result = cli('setup', 'migrate', env=dict(ENV, DB_DATABASE=target))
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.operation('restore', '--input', str(path), '--target', target, '--sha256', digest, success=False)
                self.assertEqual(sql('SELECT COUNT(*) FROM PpmForm', target), '26')
                self.operation('restore', '--input', str(path), '--target', DATABASE, '--sha256', digest, success=False)
            finally:
                sql('DROP DATABASE IF EXISTS `' + target + '`', None)
            self.assertEqual(sql("SELECT COUNT(*) FROM SystemJobRun WHERE status='SUCCEEDED'"), '2')

    def test_02_cleanup_only_expired_authentication_data(self):
        account = json.dumps({'username': 'operator-test', 'email': 'operator@example.test', 'displayName': 'Operator test',
                              'role': 'PERSONNEL', 'password': secrets.token_urlsafe(24)})
        result = subprocess.run(PHP + ['index.php', 'accounts', 'create'], cwd=ROOT, env=ENV,
                                input=account, text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        user = json.loads(result.stdout)['id']
        sql("INSERT INTO AuthSession (id,userId,refreshTokenHash,expiresAt) VALUES ('expired-session','" + user + "','not-a-real-token',DATE_SUB(UTC_TIMESTAMP(),INTERVAL 100 DAY))")
        sql("INSERT INTO AuthLoginDefense(id,identifierHash,failureCount,lastFailedAt) VALUES ('expired-defense','test-defense',2,DATE_SUB(UTC_TIMESTAMP(),INTERVAL 2 DAY))")
        before = sql('SELECT COUNT(*) FROM AuditLog')
        self.operation('cleanup')
        self.assertEqual(sql('SELECT COUNT(*) FROM AuthSession'), '0')
        self.assertEqual(sql('SELECT COUNT(*) FROM AuthLoginDefense'), '0')
        self.assertEqual(sql('SELECT COUNT(*) FROM AuditLog'), before)
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmForm'), '26')
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmTemplateVersion'), '26')

    def test_03_backup_never_writes_public_root(self):
        path = ROOT / 'public' / 'must-not-exist.sql'
        self.operation('backup', '--output', str(path), success=False)
        self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main(argv=[__file__] + TEST_ARGS, verbosity=2)
