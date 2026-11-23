#!/usr/bin/env python3
"""Explicit operator tools: consistent backups, restore drills and bounded cleanup.

Uses environment DB_* credentials and installed MySQL/MariaDB client utilities.
Never targets or overwrites an existing database during restore.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]


def database_name(value):
    if not value or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', value):
        raise ValueError('Use an explicit DB_DATABASE/target with a safe SQL identifier.')
    return value


def executable(setting, choices):
    path = os.environ.get(setting)
    if path:
        return path
    for name in choices:
        if shutil.which(name):
            return shutil.which(name)
    raise ValueError('Install a MySQL/MariaDB client, or set ' + setting + '.')


def literal(value):
    # Hex UTF-8 literals are independent of the server SQL escape mode.
    return "CONVERT(X'" + str(value).encode().hex() + "' USING utf8mb4)"


@contextmanager
def client_config(user=None, password=None):
    # Credentials are neither command-line arguments nor backup metadata.
    with tempfile.TemporaryDirectory(prefix='ppms-client-') as directory:
        path = Path(directory) / 'client.cnf'
        def quoted(value):
            return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r') + '"'
        path.write_text('[client]\nprotocol=tcp\nhost=' + quoted(os.environ.get('DB_HOST', '127.0.0.1')) +
                        '\nport=' + str(int(os.environ.get('DB_PORT', '3306'))) +
                        '\nuser=' + quoted(user if user is not None else os.environ.get('DB_USERNAME', 'root')) +
                        '\npassword=' + quoted(password if password is not None else os.environ.get('DB_PASSWORD', '')) + '\n', encoding='utf-8')
        path.chmod(0o600)
        yield path


class Operator:
    def __init__(self, config, database):
        self.database = database_name(database)
        self.client = executable('PPMS_SQL_CLIENT', ('mariadb', 'mysql', 'mysql.exe'))
        self.config = '--defaults-extra-file=' + str(config)

    def sql(self, query, database=None):
        command = [self.client, self.config, '--batch', '--skip-column-names', '--default-character-set=utf8mb4']
        if database is not False:
            command.append(database or self.database)
        result = subprocess.run(command, input=query, text=True, capture_output=True, timeout=120)
        if result.returncode:
            raise RuntimeError('Database operation failed (exit ' + str(result.returncode) + '); no credentials or SQL are printed.')
        return result.stdout.strip()

    def job(self, kind):
        job_id = str(uuid.uuid4())
        self.sql("INSERT INTO SystemJobRun(id,jobType,status,startedAt,updatedAt) VALUES (" + literal(job_id) + ',' + literal(kind) + ",'RUNNING',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
        return job_id

    def finish(self, job_id, success, artifact=None, checksum=None):
        self.sql("UPDATE SystemJobRun SET status=" + literal('SUCCEEDED' if success else 'FAILED') +
                 ",completedAt=UTC_TIMESTAMP(3),updatedAt=UTC_TIMESTAMP(3),artifactName=" + (literal(artifact) if artifact else 'NULL') +
                 ',artifactChecksum=' + (literal(checksum) if checksum else 'NULL') +
                 ',errorCode=' + ('NULL' if success else "'OPERATION_FAILED'") + ' WHERE id=' + literal(job_id))


def file_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def backup(operator, output):
    path = Path(output).resolve()
    if path == ROOT / 'public' or ROOT / 'public' in path.parents:
        raise ValueError('Backups must be stored outside the public document root.')
    if path.exists() or path.with_suffix(path.suffix + '.json').exists():
        raise ValueError('Backup destination already exists; choose a new filename.')
    path.parent.mkdir(parents=True, exist_ok=True)
    tool = executable('PPMS_SQL_DUMP', ('mariadb-dump', 'mysqldump', 'mysqldump.exe'))
    job = operator.job('BACKUP')
    try:
        with path.open('xb') as file:
            path.chmod(0o600)
            result = subprocess.run([tool, operator.config, '--single-transaction', '--skip-lock-tables',
                                     '--hex-blob', '--routines', '--triggers', '--events', '--default-character-set=utf8mb4',
                                     operator.database], stdout=file, stderr=subprocess.PIPE, timeout=600)
        if result.returncode:
            raise RuntimeError('Backup command failed (exit ' + str(result.returncode) + ').')
        digest = file_hash(path)
        metadata = {'format': 'ppms-sql-backup-v1', 'sha256': digest, 'database': operator.database,
                    'createdAt': datetime.now(timezone.utc).isoformat(), 'bytes': path.stat().st_size,
                    'schemaVersion': operator.sql('SELECT MAX(version) FROM PpmsSchemaMigration')}
        sidecar = path.with_suffix(path.suffix + '.json')
        with sidecar.open('x', encoding='utf-8') as file:
            sidecar.chmod(0o600)
            json.dump(metadata, file, indent=2)
        operator.finish(job, True, path.name, digest)
        return dict(metadata, path=str(path), jobId=job)
    except Exception:
        operator.finish(job, False)
        # A failed artifact remains explicitly incomplete; never report success.
        if path.exists():
            path.rename(path.with_suffix(path.suffix + '.incomplete'))
        raise


def restore(operator, source, target, expected_hash):
    path = Path(source).resolve(strict=True)
    target = database_name(target)
    if target == operator.database:
        raise ValueError('Restore requires a new database, distinct from DB_DATABASE.')
    if not re.fullmatch(r'[a-fA-F0-9]{64}', expected_hash) or file_hash(path) != expected_hash.lower():
        raise ValueError('Backup checksum mismatch.')
    # Fail if it already exists, even if empty. Never DROP or overwrite a target.
    operator.sql('CREATE DATABASE `' + target + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin', database=False)
    job = operator.job('RESTORE')
    restore_user = 'ppms_restore_' + uuid.uuid4().hex[:20]
    restore_password = secrets.token_urlsafe(32)
    principal = "'" + restore_user + "'@'%'"
    account_created = False
    try:
        # Import under a short-lived account authorized for this fresh target
        # only. Even a SQL file containing USE/qualified names cannot modify the
        # source or another existing database using the operator's credentials.
        operator.sql('CREATE USER ' + principal + " IDENTIFIED BY '" + restore_password + "'", database=False)
        account_created = True
        operator.sql('GRANT ALL PRIVILEGES ON `' + target + '`.* TO ' + principal, database=False)
        with client_config(restore_user, restore_password) as scoped_config, path.open('rb') as file:
            result = subprocess.run([operator.client, '--defaults-extra-file=' + str(scoped_config),
                                     '--binary-mode', '--local-infile=0', '--default-character-set=utf8mb4', target],
                                    stdin=file, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=600)
        if result.returncode:
            raise RuntimeError('Restore failed; target is incomplete and has not been selected for use.')
        operator.sql('SELECT id FROM PpmForm LIMIT 1', database=target)
        operator.sql('SELECT version FROM PpmsSchemaMigration LIMIT 1', database=target)
        operator.finish(job, True, path.name, expected_hash.lower())
        return {'status': 'restored_for_verification', 'target': target, 'jobId': job,
                'next': 'Run setup migrate, readiness and application integrity checks against the isolated target before any cutover.'}
    except Exception:
        operator.finish(job, False)
        raise
    finally:
        if account_created:
            operator.sql('DROP USER ' + principal, database=False)


def cleanup(operator):
    job = operator.job('CACHE_MAINTENANCE')
    try:
        operator.sql('DELETE FROM AuthLoginDefense WHERE lastFailedAt<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY) AND (lockedUntil IS NULL OR lockedUntil<UTC_TIMESTAMP(3)) LIMIT 10000')
        operator.sql('DELETE FROM AuthSession WHERE COALESCE(revokedAt,expiresAt)<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 90 DAY) LIMIT 10000')
        operator.finish(job, True)
        return {'status': 'cleaned', 'jobId': job, 'preserved': ['records', 'revisions', 'trace links', 'mutation receipts', 'audit events']}
    except Exception:
        operator.finish(job, False)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    actions.add_parser('cleanup')
    save = actions.add_parser('backup'); save.add_argument('--output', required=True)
    load = actions.add_parser('restore'); load.add_argument('--input', required=True); load.add_argument('--target', required=True); load.add_argument('--sha256', required=True)
    args = parser.parse_args()
    try:
        with client_config() as config:
            operator = Operator(config, os.environ.get('DB_DATABASE'))
            result = backup(operator, args.output) if args.action == 'backup' else restore(operator, args.input, args.target, args.sha256) if args.action == 'restore' else cleanup(operator)
        print(json.dumps(result, indent=2))
        return 0
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
