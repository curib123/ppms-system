"""Check first-party syntax; optionally measure supported sources with Topos."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
TOPOS_VERSION = '0.14.0'
IMAGE = 'ppms-topos:' + TOPOS_VERSION
SUPPORTED = {'.py', '.js', '.mjs', '.cjs', '.ts', '.tsx'}


def tracked_sources(root):
    result = subprocess.run(['git', 'ls-files', '-z'], cwd=root,
                            capture_output=True, check=True)
    sources = []
    for name in result.stdout.decode('utf-8').split('\0'):
        path = Path(name)
        if not name or path.parts[0] not in {'application', 'public', 'scripts', 'tests', 'index.php'}:
            continue
        if (name == 'application/config/local.php'
                or path.parts[:2] in {('application', 'cache'), ('application', 'logs'), ('application', 'sessions')}
                or any(part in {'vendor', 'third_party', 'node_modules', 'generated', 'dist', 'build'} for part in path.parts)):
            continue
        if path.suffix in SUPPORTED | {'.php'} and (root / path).is_file():
            sources.append(path)
    return sources


def lint(root, sources, php):
    counts = {'.php': 0, '.py': 0}
    for path in sources:
        if path.suffix == '.php':
            result = subprocess.run([php, '-l', str(path)], cwd=root,
                                    capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError(str(path) + '\n' + result.stdout + result.stderr)
            counts['.php'] += 1
        elif path.suffix == '.py':
            try:
                ast.parse((root / path).read_text(encoding='utf-8-sig'), filename=str(path))
            except (SyntaxError, UnicodeError) as error:
                raise RuntimeError(str(path) + ': ' + str(error)) from error
            counts['.py'] += 1
    print(f"Syntax: {counts['.php']} PHP and {counts['.py']} Python files passed.")


def source_hashes(root, names):
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in names}


def run_topos(root, sources, command):
    supported = [path.as_posix() for path in sources if path.suffix in SUPPORTED]
    if not supported:
        raise RuntimeError('Topos: no supported first-party files; PHP is unsupported.')
    environment = dict(os.environ, TOPOS_NO_UPDATE_NOTICES='1')
    version = subprocess.run(command + ['--version'], cwd=root, capture_output=True,
                             text=True, encoding='utf-8', env=environment)
    if version.returncode:
        raise RuntimeError('Topos version check failed: ' + version.stderr.strip())
    if version.stdout.strip() != 'topos ' + TOPOS_VERSION:
        raise RuntimeError('Topos version mismatch: expected ' + TOPOS_VERSION + ', got ' + version.stdout.strip())
    revision = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True, check=True)
    changes = subprocess.run(['git', 'status', '--porcelain'], cwd=root, capture_output=True, check=True)
    hashes = source_hashes(root, supported)
    result = subprocess.run(command + ['evaluate', *supported, '--no-composable', '--json'],
                            cwd=root, capture_output=True, text=True, encoding='utf-8', env=environment)
    if result.returncode:
        raise RuntimeError('Topos analysis failed: ' + result.stderr.strip())
    try:
        analysis = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError('Topos returned invalid JSON.') from error
    rows = analysis.get('results') if isinstance(analysis, dict) else None
    if (not isinstance(analysis, dict) or analysis.get('version') != TOPOS_VERSION or not isinstance(rows, list)
            or len(rows) != len(supported) or any(not isinstance(row, dict) for row in rows)
            or {row.get('file') for row in rows} != set(supported)):
        raise RuntimeError('Topos returned incomplete or invalid file coverage.')
    if source_hashes(root, supported) != hashes:
        raise RuntimeError('Topos source changed during analysis; rerun the check.')
    report = {
        'topos_version': version.stdout.strip(), 'source_revision': revision.stdout.strip(),
        'working_tree_dirty': bool(changes.stdout),
        'source_sha256': hashes,
        'scope': supported, 'php_supported': False, 'composable_enabled': False,
        'advisory': True, 'analysis': analysis,
    }
    destination = root / '.quality' / 'topos.json'
    destination.parent.mkdir(exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    if any(row.get('is_parseable') is not True for row in rows):
        raise RuntimeError('Topos could not parse every source; see ' + str(destination))
    print(f'Topos analyzed {len(supported)} supported files; advisory report: {destination}')
    print('Topos does not parse PHP. COMPOSABLE is disabled; findings are not a behavior test.')
    return report


def topos_command(root):
    native = shutil.which('topos')
    if native:
        return [native]
    docker = shutil.which('docker')
    if not docker:
        raise RuntimeError('Topos needs the v0.14.0 CLI or Docker with Linux containers.')
    image = subprocess.run([docker, 'image', 'inspect', IMAGE], capture_output=True)
    if image.returncode:
        subprocess.run([docker, 'build', '--platform', 'linux/amd64', '--tag', IMAGE,
                        str(root / 'tools' / 'topos')], check=True)
    return [docker, 'run', '--rm', '--network', 'none', '--platform', 'linux/amd64',
            '--mount', f'type=bind,source={root},target=/workspace,readonly', IMAGE]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--topos', action='store_true', help='also run pinned Topos (native CLI or Docker)')
    parser.add_argument('--php', default=shutil.which('php'), help='PHP executable (default: PATH)')
    args = parser.parse_args()
    try:
        sources = tracked_sources(ROOT)
        if not args.php:
            raise RuntimeError('PHP executable not found; add PHP to PATH or pass --php.')
        lint(ROOT, sources, args.php)
        if args.topos:
            run_topos(ROOT, sources, topos_command(ROOT))
        else:
            print('Topos not requested; add --topos for structural analysis. Topos does not parse PHP.')
        return 0
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print('Quality check failed: ' + str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
