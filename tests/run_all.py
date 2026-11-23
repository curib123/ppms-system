#!/usr/bin/env python3
"""Portable deterministic verification runner; uses disposable test databases."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--php', default='php')
parser.add_argument('--php-extension', action='append', default=[])
parser.add_argument('--browser', action='store_true', help='Run actual Playwright browser checks (installed Chromium required)')
parser.add_argument('--operations', action='store_true', help='Also run actual backup/restore drill (SQL clients required)')
args = parser.parse_args()
php_args = ['--php', args.php]
php = [args.php]
for extension in args.php_extension:
    php_args += ['--php-extension', extension]
    php += ['-d', 'extension=' + extension]

for folder in ('application', 'public', 'system', 'tests'):
    for path in sorted((ROOT / folder).rglob('*.php')):
        result = subprocess.run(php + ['-l', str(path)], capture_output=True, text=True)
        if result.returncode:
            sys.exit(result.stdout + result.stderr)
print('PHP syntax checks passed', flush=True)
commands = [[sys.executable, 'tests/design_system.py'], [sys.executable, 'tests/conversion.py'], php + ['tests/validation.php'], php + ['tests/domain_validation.php']]
for suite in ('integration.py', 'migrations.py', 'api_integration.py', 'platform_integration.py', 'domain_regressions.py', 'sync_regressions.py'):
    commands.append([sys.executable, 'tests/' + suite] + php_args)
if args.operations:
    commands.append([sys.executable, 'tests/operations.py'] + php_args)
commands += [['node', 'tests/schema_client.mjs'], ['node', 'tests/builder_model.mjs'], ['node', 'tests/uuid_client.mjs'], ['node', 'tests/offline_client.mjs', '--node']]
if args.browser:
    commands += [['node', 'tests/offline_client.mjs'], [sys.executable, 'tests/ui_integration.py'] + php_args]
for command in commands:
    print('Running ' + ' '.join(command), flush=True)
    result = subprocess.run(command, cwd=ROOT, timeout=240, stdin=subprocess.DEVNULL,
                            env=dict(os.environ, PHP_BINARY=args.php, PPMS_PHP_ARGS=json.dumps(php[1:])))
    if result.returncode:
        raise SystemExit(result.returncode)
print('All selected verification gates passed.', flush=True)
