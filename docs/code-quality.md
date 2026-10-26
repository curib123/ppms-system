# Code quality checks

The syntax runner and pinned optional Topos integration implement Task 1 of the
[active plan](superpowers/plans/2026-10-26-simple-trackable-backend.md).
The analyzer stays independent of review/admin functionality.

Run from the repository root:

```powershell
python scripts/check_quality.py
python scripts/check_quality.py --topos
```

The first command lints tracked first-party PHP and parses Python without
executing application code. It excludes `system/`, third-party/vendor files,
runtime caches/logs/sessions, dependency/generated directories, untracked files
and local credentials. Stage new source files before checking them. Use
`--php C:/path/to/php.exe` if PHP is not on PATH.

The second command also runs [Topos](https://github.com/Krv-Labs/topos), pinned
to **v0.14.0**, against supported tracked first-party files. It uses an installed
CLI first; otherwise it builds the development-only `ppms-topos:0.14.0` Linux
Docker image. Docker Desktop must be running with Linux containers on Windows.
The first build needs internet access to download Ubuntu and the
release binary. Its SHA-256 is checked against the published release checksum.
Subsequent analysis runs use no container network and mount the project read-only.

Topos does **not** support PHP or Dart. Here it measures Python tools/tests and,
when added, first-party admin JavaScript. It cannot certify CI3 or Flutter.
`--no-composable` avoids GitNexus; COMPOSABLE is explicitly unavailable. All
structural findings are advisory. Syntax failures, tool failures, version
mismatches and invalid analyzer output exit nonzero.

The ignored `.quality/topos.json` report contains tool version, source revision,
working-tree state, source hashes, analyzed paths and the complete upstream
result, including unavailable metrics.
Metadata is captured before evaluation; a source change during evaluation
fails the check instead of recording misleading provenance. Update notices
are disabled for native and Docker execution.
A completed analysis does not mean every file meets every structural criterion.
Reports are local developer artifacts and are never production or audit data.

Behavior checks remain separate:

```powershell
php tests/api_routing.php
php tests/validation.php
python tests/quality.py
python tests/conversion.py
python tests/run_with_mariadb.py
```

The routing check covers controller contracts; the disposable MariaDB suites
exercise installation, migrations and the real HTTP -> services -> database
flow. Topos supplements these checks.

Verified on 2026-10-26: 15 quality-runner tests, syntax for 58 PHP and 8 Python
files, and a real Topos v0.14.0 Linux-container analysis of all 8 supported
first-party files. Every source parsed; COMPOSABLE was unavailable by design.
Structural findings remain advisory and are not a PHP or Flutter assessment.

To rebuild the optional runner after changing its Dockerfile:

```powershell
docker build --platform linux/amd64 -t ppms-topos:0.14.0 tools/topos
```

No Composer, Node.js, Topos or Docker process is required by the running PHP
app. Tailwind, native CSS, Chart.js and jQuery are the planned admin stack.
Its CSS build/browser tests use development-only Node tooling; serve compiled
CSS and pinned assets locally. See the active plan for the delivery checks.

Upstream references: [release and checksums](https://github.com/Krv-Labs/topos/releases/tag/v0.14.0),
[supported languages](https://github.com/Krv-Labs/topos/blob/297a01301610124544a1b8a08123359ab32cb55e/topos/engine/src/graphs/ast/languages.rs),
[CLI](https://github.com/Krv-Labs/topos/blob/297a01301610124544a1b8a08123359ab32cb55e/docs/source/cli.rst).
