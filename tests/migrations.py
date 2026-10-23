"""Upgrade a canonical install without replacing its reference data."""
import json
import unittest
from integration import DATABASE, cli, query, sql


class MigrationIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sql('CREATE DATABASE `' + DATABASE + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', None)
        cls.addClassCleanup(lambda: sql('DROP DATABASE `' + DATABASE + '`', None))
        result = cli('setup', 'install')
        if result.returncode:
            raise AssertionError(result.stderr)

    def test_01_upgrade_is_repeatable_and_keeps_the_seed(self):
        for _ in range(2):
            result = cli('setup', 'migrate')
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(json.loads(result.stdout)['status'], 'migrated')
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmsSchemaMigration'), '1')
        self.assertEqual(cli('setup', 'verify').returncode, 0)
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmForm'), '26')
        self.assertEqual(sql('SELECT COUNT(*) FROM PpmFormDeviceLease'), '0')
        self.assertEqual(sql('SELECT COUNT(*) FROM SyncDailyBatch'), '0')
        self.assertEqual(sql('SELECT COUNT(*) FROM SyncChangeEvent'), '0')
        self.assertEqual(sql('SELECT COUNT(*) FROM SyncPullCursor'), '0')

    def test_02_database_rejects_two_active_versions(self):
        result = query("INSERT INTO PpmTemplateVersion (id,ppmFormId,versionNo,isActive,definitionJson,updatedAt) "
                       "SELECT 'duplicate-active',ppmFormId,999,1,'{}',NOW(3) FROM PpmTemplateVersion WHERE isActive=1 LIMIT 1")
        self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
