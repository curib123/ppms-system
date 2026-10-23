"""Run integration suites with a private, disposable Windows MariaDB server.

Requires XAMPP's mysql_install_db.exe and mysqld.exe (override MARIADB_BIN).
No Windows service, existing server or application configuration is changed.
"""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.environ.get('MARIADB_BIN', 'C:/xampp/mysql/bin'))
HIDDEN = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def main():
    with tempfile.TemporaryDirectory(prefix='ppms_mariadb_') as directory:
        data = Path(directory) / 'data'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        subprocess.run([str(BIN / 'mysql_install_db.exe'), '--datadir=' + str(data),
                        '--port=' + str(port), '--silent'], check=True,
                       capture_output=True, timeout=60, creationflags=HIDDEN)
        with (Path(directory) / 'server.log').open('w+') as log:
            server = subprocess.Popen([str(BIN / 'mysqld.exe'), '--no-defaults',
                                       '--basedir=' + str(BIN.parent), '--datadir=' + str(data),
                                       '--port=' + str(port), '--bind-address=127.0.0.1',
                                       '--innodb-buffer-pool-size=32M', '--max-connections=20'],
                                      stdout=log, stderr=log, creationflags=HIDDEN)
            try:
                for _ in range(150):
                    if server.poll() is not None:
                        log.seek(0)
                        raise RuntimeError('Temporary MariaDB failed: ' + log.read()[-3000:])
                    try:
                        with socket.create_connection(('127.0.0.1', port), timeout=0.1):
                            break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError('Temporary MariaDB did not become ready.')
                env = dict(os.environ, DB_HOST='127.0.0.1', DB_PORT=str(port),
                           DB_USERNAME='root', DB_PASSWORD='')
                for suite in (sys.argv[1:] or ['integration.py', 'migrations.py', 'api_integration.py']):
                    result = subprocess.run([sys.executable, str(ROOT / 'tests' / suite)],
                                            cwd=ROOT, env=env, timeout=240)
                    if result.returncode:
                        return result.returncode
                return 0
            finally:
                subprocess.run([str(BIN / 'mysqladmin.exe'), '--protocol=tcp', '--host=127.0.0.1',
                                '--port=' + str(port), '--user=root', 'shutdown'],
                               capture_output=True, timeout=15, creationflags=HIDDEN)
                try:
                    server.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    server.terminate()
                    server.wait(timeout=10)


if __name__ == '__main__':
    sys.exit(main())
