"""Real-browser UI acceptance tests against the disposable, migrated API database.

Install Playwright Chromium first. Optional CHROMIUM_PATH selects an installed
browser; there is deliberately no system-browser fallback or API mocking.
Run with the same DB_* and PHP options as tests/api_integration.py.
"""
import os
import subprocess
import json

from api_integration import PpmApiIntegration
from integration import ROOT, PHP

if os.environ.get('PHP_BINARY'):
    PHP[0] = os.environ['PHP_BINARY']
runtime_args = json.loads(os.environ.get('PPMS_PHP_ARGS', '[]'))
if runtime_args:
    PHP[1:] = runtime_args


def main():
    try:
        PpmApiIntegration.setUpClass()
        environment = dict(
            os.environ,
            PPMS_UI_URL=PpmApiIntegration.base.removesuffix('/api/v1'),
            PPMS_UI_PASSWORD=PpmApiIntegration.password,
            PPMS_UI_FORM_ID=PpmApiIntegration.form,
        )
        result = subprocess.run(
            ['node', 'tests/ui_browser.mjs'], cwd=ROOT, env=environment,
            timeout=300,
        )
        return result.returncode
    finally:
        PpmApiIntegration.doClassCleanups()


if __name__ == '__main__':
    raise SystemExit(main())
