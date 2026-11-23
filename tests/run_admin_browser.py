"""Run browser checks against an owned private MariaDB and disposable PHP app."""
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
HIDDEN = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def main():
    # Reuse the private-server owner instead of connecting to local operational data.
    if os.environ.get('PPMS_BROWSER_PRIVATE_SERVER') != '1':
        return subprocess.run([sys.executable, str(ROOT / 'tests/run_with_mariadb.py'),
                               Path(__file__).name], cwd=ROOT,
                              env=dict(os.environ, PPMS_BROWSER_PRIVATE_SERVER='1')).returncode
    if os.environ.get('DB_HOST') != '127.0.0.1' or int(os.environ.get('DB_PORT', '0')) <= 1024:
        raise RuntimeError('The browser fixture requires the private test-server owner.')

    from integration import DATABASE, ENV, PHP, cli, sql
    password = secrets.token_urlsafe(24)
    fixture_id = secrets.token_hex(16)
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    base = 'http://127.0.0.1:' + str(port)
    env = dict(ENV, APP_BASE_URL=base + '/', APP_ENCRYPTION_KEY=secrets.token_hex(32),
               PPMS_TEST_PASSWORD=password, PPMS_TEST_USERNAME='admin',
               PPMS_TEST_BASE_URL=base, PPMS_TEST_FIXTURE_ID=fixture_id,
               PPMS_TEST_DISPOSABLE='1', PPMS_TEST_PROJECT_ROOT=str(ROOT))
    npm = shutil.which('npm.cmd') if os.name == 'nt' else shutil.which('npm')
    if not npm:
        raise RuntimeError('Node.js/npm is required for browser checks.')
    sql('CREATE DATABASE `' + DATABASE + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', None)
    try:
        for command in ('install', 'migrate'):
            result = cli('setup', command, env=env)
            if result.returncode:
                raise RuntimeError('Disposable browser database setup failed.')
        fixture = subprocess.run(PHP + ['tests/api_fixture.php'], cwd=ROOT, env=env,
                                 capture_output=True, text=True, timeout=15, creationflags=HIDDEN)
        if fixture.returncode:
            raise RuntimeError('Disposable browser accounts could not be created.')
        with tempfile.TemporaryDirectory(prefix='ppms_browser_') as directory:
            sessions = Path(directory) / 'sessions'
            sessions.mkdir()
            env['APP_SESSION_PATH'] = str(sessions)
            router = Path(directory) / 'router.php'
            router.write_text("<?php\nif (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/__ppms_browser_fixture') {\n"
                              "header('Content-Type: application/json');\n"
                              "echo json_encode(array('fixtureId' => getenv('PPMS_TEST_FIXTURE_ID')));\nreturn;\n}\n"
                              "require getenv('PPMS_TEST_PROJECT_ROOT').'/public/router.php';\n", encoding='utf-8')
            with (Path(directory) / 'server.log').open('w+') as log:
                server = subprocess.Popen(PHP + ['-S', '127.0.0.1:' + str(port), '-t', 'public', str(router)],
                                          cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=HIDDEN)
                try:
                    for _ in range(100):
                        if server.poll() is not None:
                            raise RuntimeError('Disposable browser PHP server failed to start.')
                        try:
                            with socket.create_connection(('127.0.0.1', port), timeout=0.1):
                                break
                        except OSError:
                            time.sleep(0.1)
                    else:
                        raise RuntimeError('Disposable browser PHP server did not become ready.')
                    result = subprocess.run([npm, 'run', 'test:admin'], cwd=ROOT, env=env,
                                            capture_output=True, text=True, encoding='utf-8', errors='replace',
                                            timeout=210, creationflags=HIDDEN)
                    # Playwright failures may describe an input action; never print the fixture secret.
                    print((result.stdout + result.stderr).replace(password, '[redacted]'))
                    return result.returncode
                finally:
                    server.terminate()
                    server.wait(timeout=10)
    finally:
        sql('DROP DATABASE `' + DATABASE + '`', None)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        print('Browser checks failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
