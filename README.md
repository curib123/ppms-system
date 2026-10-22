# PPMS — CodeIgniter 3

CodeIgniter **3.1.13** application structure with the existing PPMS PostgreSQL
schema and canonical default data. This is the PHP foundation for PPMS: setup,
database configuration, a read-only form register, and a health endpoint.
The NestJS/Angular application's authentication and business workflows have
not been ported.

## Requirements

- PHP with PDO and `pdo_pgsql`; verified with PHP **8.0.30**.
- PostgreSQL **17+**, with an existing database role and an empty database for
  installation. Existing PPMS databases can be connected without installation.
- Apache with `mod_rewrite`, or PHP's built-in server for local development.
- No Composer or Node.js install is needed to run the app.

## Local setup on Windows

From this repository folder:

```powershell
Copy-Item application/config/local.example.php application/config/local.php
php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
```

Edit `application/config/local.php`: set `DB_PASSWORD` to your PostgreSQL role's
password and paste the generated value into `APP_ENCRYPTION_KEY`. Check the
host, port, database name, and base URL. This local file is ignored by Git.
The example uses the sibling PPMS Docker PostgreSQL port **55432**, database
**ppms_ci3**, role **ppms**, and web port **8085**. For a normal PostgreSQL
installation, use port **5432**. Environment variables with the same names
override the local file; an explicitly empty environment value also overrides it.

Create the database using your PostgreSQL administration tools. With the
existing local PPMS Docker container:

```powershell
docker exec ppms-postgres-1 createdb -U ppms ppms_ci3
```

Install and check the schema and default data:

```powershell
.\scripts\php.ps1 index.php setup check
.\scripts\php.ps1 index.php setup install
.\scripts\php.ps1 index.php setup verify
```

The PowerShell wrapper enables the installed `pdo_pgsql` extension for that
process when necessary. It does not edit your global PHP configuration. If
PowerShell script execution is restricted, use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/php.ps1 index.php setup check
```

Start the local development server:

```powershell
.\scripts\php.ps1 -S 127.0.0.1:8085 -t public public/router.php
```

Open **http://localhost:8085/**. The setup page reports the database connection
and lists the PPM forms. **http://localhost:8085/health** returns HTTP 200 with
`{"status":"ok","database":"connected"}` when the reference tables can be read;
an unavailable or uninitialized database returns HTTP 503.

For PHP with `pdo_pgsql` already enabled, the equivalent commands are
`php index.php setup install`, `php index.php setup verify`, and
`php -S 127.0.0.1:8085 -t public public/router.php`.

## Connect to existing PPMS data

Set `DB_DATABASE` and the credentials to the existing database, then run only
`setup check` and start the server. **Skip `setup install` and the SQL imports.**
The status page and model read the original quoted PPMS table/column names;
normal startup does not change data. `setup verify` compares an exact fresh
seed snapshot, so it is intended for newly initialized databases.

The fresh defaults include 7 production areas, 26 forms, 26 area assignments,
26 templates, 26 trace-code rules, 56 trace connections, and 15 system settings.
The five roles remain PostgreSQL enum values. No default login is created and
no live account passwords, records, or sessions are copied. See
[database/README.md](database/README.md) for import details and provenance.

## Structure

```text
application/
  config/         CI3 settings, PostgreSQL connection, local configuration
  controllers/    Welcome, Health, and CLI-only Setup
  models/         Read-only PPMS reference model
  libraries/      Transactional database installation and verification
  views/          Setup status and original CI3 error views
  cache/          Runtime cache (ignored)
  logs/           Runtime logs (ignored)
  sessions/       Runtime sessions (ignored)
database/
  schema.sql      Existing tables, enums, constraints, and indexes
  default_data.sql
  manifest.json   Provenance, source hashes, and complete seed fingerprints
  source/         Original Prisma schema, migrations, and canonical seed inputs
public/           Web document root, front controller, development router
scripts/          Windows PHP launcher
system/           Unmodified CodeIgniter 3.1.13 framework
tests/            End-to-end checks using a disposable PostgreSQL database
index.php         CLI entry point
```

For Apache/XAMPP, configure a virtual host whose `DocumentRoot` is this
repository's **public/** directory and enable `AllowOverride All` there.
Do not serve the repository root. Only `application/cache`, `application/logs`,
and `application/sessions` need to be writable by PHP. Set `APP_BASE_URL` to
the actual URL, and use `DB_SSLMODE=require` when your server requires TLS.
The application defaults to the production error environment; set `CI_ENV`
to `development` locally if detailed debugging is needed.

## Verification

The integration suite uses Python's standard library, PHP, and the existing
PostgreSQL Docker container. Configure the local credentials, or set
`DB_PASSWORD` in the process environment, then run:

```powershell
python tests/integration.py --php-extension pdo_pgsql
```

Omit `--php-extension pdo_pgsql` if PHP already enables that extension.
Optional `PPMS_TEST_CONTAINER`, `DB_USERNAME`, and `DB_PORT` environment
variables select the test container and connection. The suite creates and
removes its own `ppms_ci3_test_<process-id>` database. It checks installation,
refusal to overwrite data, default-data drift, connection failures, rendered
forms, HTTP health responses, private-file protection, and source integrity.

Framework source and licensing: [FRAMEWORK.md](FRAMEWORK.md), [LICENSE](LICENSE).
