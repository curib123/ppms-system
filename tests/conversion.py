"""Catch manual changes that make baseline SQL impossible to reproduce."""
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BaselineIntegrity(unittest.TestCase):
    def test_sql_matches_the_install_manifest(self):
        manifest = json.loads((ROOT / 'database/manifest.json').read_text())
        for name in ('schema.sql', 'default_data.sql'):
            with self.subTest(file=name):
                self.assertEqual(hashlib.sha256((ROOT / 'database' / name).read_bytes()).hexdigest(),
                                 manifest['sha256'][name])


if __name__ == '__main__':
    unittest.main(verbosity=2)
