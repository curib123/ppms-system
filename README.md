# PPMS REST API and admin control panel

CodeIgniter **3.1.13** with the native **MySQLi** driver, the converted PPMS
schema, and the original default data. Includes guarded database setup,
individual authentication, dynamic versioned templates, immutable records,
shared-device daily synchronization, traceability and review APIs, the PPM form
register, and a health endpoint. See [the backend API guide](docs/backend-api.md)
for setup, requests and client synchronization responsibilities.

The revised target is a **CI3 REST API plus an online admin control panel**.
Personnel enter records through a **Flutter mobile app**. The browser stack is
**Tailwind CSS, native CSS, jQuery and Chart.js**, using CI3 PHP views.
Checked, Reviewed and Approved are quality guidance; they do not block an
otherwise valid source from feeding a connected PPM.

Start with the [active implementation plan](docs/superpowers/plans/2026-10-26-simple-trackable-backend.md)
and its [design](docs/superpowers/specs/2026-10-26-simple-trackable-backend-design.md).
These replace the obsolete root plans. The admin panel and complete advisory
review behavior are planned work, not implemented features of the current
setup/form-register page. Preserved local functional changes belong to Task 2;
the quality tooling is implemented and verified.

See the [code map](docs/architecture.md),
[Flutter client contract](docs/flutter-client-contract.md),
[current API guide](docs/backend-api.md) and [quality checks](docs/code-quality.md).

## Requirements

- PHP with `mysqli`; verified with XAMPP PHP **8.0.30**.
- **MySQL 8.0.16+** or **MariaDB 10.4+**; verified with XAMPP MariaDB **10.4.32**.
- Apache with `mod_rewrite`, or PHP's development server for local use.
- The current PHP backend needs no PostgreSQL, Composer or Node.js runtime.
- The planned admin CSS build/browser tests use development-only Node tooling;
  compiled CSS and pinned JavaScript assets are served locally in production.

## Windows / XAMPP setup

Start MySQL in XAMPP, then run from the repository folder:

```powershell
Copy-Item application/config/local.example.php application/config/local.php
php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
```

Edit the ignored `application/config/local.php`: paste the generated value into
`APP_ENCRYPTION_KEY` and set the MySQL credentials. Defaults are host
`127.0.0.1`, port **3306**, database **ppms_ci3**, user **root**, and an empty
password for a default local XAMPP installation. Use your configured password
when one is required. Environment variables with the same names override the
local file, including explicitly empty environment values.

Create a fresh database using phpMyAdmin or the MySQL client:

```powershell
& C:\xampp\mysql\bin\mysql.exe --user=root --execute="CREATE DATABASE ppms_ci3 CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
```

Add `--password` if your MySQL account requires a password. Install and verify:

```powershell
.\scripts\php.ps1 index.php setup check
.\scripts\php.ps1 index.php setup install
.\scripts\php.ps1 index.php setup verify
.\scripts\php.ps1 index.php setup migrate
.\scripts\php.ps1 -S 127.0.0.1:8085 -t public public/router.php
```

If script execution is restricted, run the wrapper with
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/php.ps1 ...`.
The wrapper enables the installed `mysqli` extension for that process if
needed, without changing global PHP configuration. If already enabled, plain
`php index.php setup install` and `php -S 127.0.0.1:8085 -t public public/router.php`
work as well.

Open **http://localhost:8085/**. The register lists all 26 default PPM forms.
**http://localhost:8085/health** returns HTTP 200 with
`{"status":"ok","database":"connected"}` when the reference tables can be read,
or HTTP 503 when the database is unavailable or uninitialized.

The installer is CLI only and refuses a populated database. MySQL/MariaDB DDL
implicitly commits, so the installer uses an advisory lock, seeds inside a
transaction, and removes only its known new tables if installation fails after
the empty-database check. Normal web startup never imports or modifies data.

## Data and conversion

The 28 application tables retain their original PPMS names and default values:
7 areas, 26 forms, 26 area assignments, 26 templates, 26 trace-code rules,
56 trace connections, and 15 settings. Roles are native ENUM values. No login
accounts, sessions, passwords, or production records are included in the seeds.

JSONB becomes JSON, timestamps become DATETIME(3), booleans have 0/1 checks,
and foreign keys retain their delete/update actions. Indexed/defaulted text
columns become VARCHAR(191); other text remains TEXT. The nonunique retention
partial index becomes a covering index. Full details and original PostgreSQL
artifacts are in [database/README.md](database/README.md).

To use an existing **converted MySQL/MariaDB** database, configure its credentials,
run `setup check` and `setup migrate`, then start the server. Skip installation and SQL imports.
`setup verify` compares the exact original default snapshot and is intended for
fresh installations, before operational data is added.

## Structure

```text
application/config/       CI3 settings and local MySQLi credentials
application/controllers/  JSON API, register, health, CLI-only setup/accounts
application/models/       Reference reads and bound MySQLi persistence model
application/libraries/    Form/record/sync/trace/workflow services and migrations
application/views/        Setup page and CI3 error views
database/schema.sql       MySQL/MariaDB tables, enums, indexes, and constraints
database/default_data.sql Converted original default rows
database/manifest.json    Provenance, hashes, row counts, and column types
database/source/          Archived original PostgreSQL/Prisma artifacts
database/migrations/      Versioned MySQL runtime extensions
public/                   Web document root
scripts/                  PHP launcher and reproducible SQL converter
tools/topos/              Optional pinned developer analyzer container
system/                   Unmodified CodeIgniter 3.1.13 framework
tests/                    Integration checks using a disposable MySQL database
index.php                 CLI entry point
```

For Apache/XAMPP, set the virtual host's `DocumentRoot` to **public/** and enable
`AllowOverride All`. Only `application/cache`, `application/logs`, and
`application/sessions` need PHP write access. Configure `APP_BASE_URL` for the
actual address. Production error handling is the default; use
`CI_ENV=development` locally when debugging. Remote MySQL TLS options can be
configured through CI3's `encrypt` connection setting.

## Verification and regeneration

Check first-party syntax, optionally including Topos structural analysis:

```powershell
python scripts/check_quality.py
python scripts/check_quality.py --topos
```

The quality runner implements Task 1 of the active plan. Topos v0.14.0 analyzes
supported Python/JavaScript sources; it does not parse PHP or Dart. Its optional
Windows runner uses Docker's Linux containers. PHP lint and behavior tests
remain required. The planned web client is the online admin panel; Flutter owns
personnel entry and offline storage/queues.

```powershell
python tests/integration.py
python tests/migrations.py
python tests/api_integration.py
php tests/api_routing.php
php tests/validation.php
python tests/quality.py
python tests/run_with_mariadb.py
python scripts/convert_database.py
```

The integration tests use Python's standard library and PHP's MySQLi extension.
No Docker or Python MySQL package is required. `DB_HOST`, `DB_PORT`,
`DB_USERNAME`, and `DB_PASSWORD` select the server; defaults are local port
3306, root, and no password. The test account must be able to create and drop
its disposable `ppms_ci3_test_<process-id>` databases. The tests never target
the configured application database.

Checks cover installation, refusal to overwrite data, exact seed verification,
modified defaults, invalid JSON, duplicate codes, foreign keys, boolean checks,
key-length limits, failed-install cleanup/retry, rendered forms, health
responses, and private-file protection. `--php` selects another PHP executable;
`--php-extension mysqli` can enable an installed extension for the test process.

The converter rebuilds SQL and fingerprints deterministically from the archived
source without any database connection. It does not export live data.
Framework source and licensing: [FRAMEWORK.md](FRAMEWORK.md), [LICENSE](LICENSE).
