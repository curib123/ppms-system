# PPMS — Dynamic Forms, Review and Offline Synchronization

One schema-driven PPMS platform with an administration web application, an
installable personnel web application (PWA), and a shared versioned REST API.
CodeIgniter 3.1.13 and its native MySQLi driver serve both clients. Form validation,
calculations, traceability, permissions, record revisions and synchronization rules
are enforced by the same backend services.

## Applications

- **`/admin` or `/`**: manage forms and templates, users, assignments, records,
  review references, conflicts, traceability, devices, synchronization and settings.
- **`/mobile`**: enter records, use the fullscreen interactive editor, unlock an
  encrypted local vault, save offline and synchronize when connectivity returns.
- **`/api/v1`**: the common authenticated REST API. Definitions are versioned and
  existing records retain their exact template version.

Every new form uses configurable **Header**, **Main content** and **Summary**
sections. The shared renderer also understands all 26 original seeded templates.
The builder supports reusable fields, tables, required rules, conditional
visibility and safe declarative calculations. Published templates are immutable;
create a new version or duplicate a template to change its structure.

Review is a reference associated with a record: reviewer name and position,
Pending Review / Under Review / Approved / Returned for Revision, review date and
remarks. It does not prevent ordinary creation or editing. A later data change
resets the reference to Pending Review while retaining its history.

Form documents stay white in every appearance. Fullscreen uses a dark workspace;
scroll the mouse wheel over the paper to zoom, drag a noninteractive area to pan,
or use Ctrl/Cmd + wheel in the embedded viewer. Inputs and dropdowns retain normal
editing behavior. See the [shared design guide](docs/design-system.md) for controls.

The personnel client is a PWA, not a native Android or iOS binary. Serve it over
HTTPS to enable installation, service workers and WebCrypto. Actual keyboard,
pinch, pan and fullscreen behavior must be accepted on the deployment's devices.

## Requirements

- PHP with `mysqli`, `mbstring` and `ctype`.
- An InnoDB MySQL or MariaDB server. The CI matrix targets PHP 8.3 / MariaDB 10.11,
  PHP 8.4 / MariaDB 11.8 and PHP 8.4 / MySQL 8.4.
- Apache with `mod_rewrite`, another server configured with `public/` as its only
  document root, or PHP's development server for local use.
- Python 3 for administration helpers and tests. Node 24 and npm are needed only
  for development tests; the applications have no production Node build step.

Local verification uses PHP 8.4.27 and MariaDB 11.8.6. The declared backend matrix,
native Chromium offline storage, application browser scenarios and backup/restore
checks have passing results linked in [the acceptance map](docs/audit-remediation.md).
See [the operational guide](docs/operations.md) for release and device acceptance.

## New installation

Copy `application/config/local.example.php` to the ignored
`application/config/local.php`. Set the database connection, `APP_BASE_URL`,
`PLANT_TIMEZONE` and a random `APP_ENCRYPTION_KEY` of at least 32 characters. Generate
a key with:

```sh
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'
```

Environment variables override the local configuration, including explicitly
empty values. Create an **empty** database using `utf8mb4` / `utf8mb4_bin`, then run:

```sh
php index.php setup check
php index.php setup install
php index.php setup verify
php index.php setup migrate
python scripts/create_admin.py --php php
php -S 127.0.0.1:8085 -t public public/router.php
```

The administrator helper prompts for credentials; it does not put passwords in
command-line arguments. No accounts or passwords are included in the seed.
Open <http://localhost:8085/admin>, sign in and configure personnel assignments.

On Windows / XAMPP, `scripts/php.ps1` selects PHP and enables the installed MySQLi
extension for that process when needed. For example:

```powershell
Copy-Item application/config/local.example.php application/config/local.php
.\scripts\php.ps1 index.php setup check
.\scripts\php.ps1 index.php setup install
.\scripts\php.ps1 index.php setup verify
.\scripts\php.ps1 index.php setup migrate
python scripts/create_admin.py --php C:\xampp\php\php.exe
.\scripts\php.ps1 -S 127.0.0.1:8085 -t public public/router.php
```

Installation is CLI-only and refuses a populated database. Web requests never
install or migrate the database. `/health` checks baseline reference connectivity;
`/ready` additionally checks runtime migrations, configuration and signing-key
readiness. The historical public form register is disabled unless an operator
explicitly enables `PPMS_PUBLIC_REGISTER`.

### Upgrading an existing converted database

Take and verify a backup, pause writes, run `setup check` and `setup migrate`, then
check `/ready`. Do not reinstall or reimport the baseline seed. `setup verify`
compares an untouched original snapshot and should be used before operational
data is added, not as a production integrity check.

The original migration implementation and PostgreSQL conversion remain sealed.
The upgrade wrapper repairs the active-template constraint only after checksum
verification. Additive migrations preserve existing data and introduce review
references, stable sequence counters and independent form/device sync cursors.
The [operations guide](docs/operations.md) explains resumability and restore drills.

## Personnel and offline workflow

1. An administrator assigns the form and permissions to personnel.
2. On `/mobile`, a user signs in, creates or unlocks the encrypted local vault and
   registers the device. An administrator authorizes that device for its forms.
3. While online, download the form definitions and permitted records. Open a
   record or create one with the current published template.
4. Save locally while offline. The durable queue retains the original author,
   exact template, stable identifiers and the revision on which the edit began.
5. Reconnect and synchronize. A record becomes Synced only after a committed
   server receipt is saved locally. Conflicts and rejected changes remain visible
   and require an explicit resolution or reviewed retry.

One device can be authorized for several forms, and several devices can be
authorized for the same form. Concurrent changes are checked against server
revision numbers. Pulling a newer server record does not give an older local edit
permission to overwrite it. Attempted batches retain their identities on retries;
deletions use tombstones and never silently discard pending local work.

The vault uses WebCrypto encryption and IndexedDB. Its unlock passphrase is not
persisted. Export the encrypted vault before clearing browser storage or replacing
a device. A lost passphrase cannot recover data that exists only in that vault.

## Architecture and API

Form configuration, presentation and persistence are separate. Both clients use
the same reusable renderer and the same schema contract. The server validates and
recomputes authoritative values, controls access, assigns trace codes and commits
each mutation with its revision, audit and receipt.

| Area | Location |
|---|---|
| API, application shells, health and CLI entry points | `application/controllers/` |
| Forms, records, review, trace, authentication and sync services | `application/libraries/` |
| Native MySQLi persistence | `application/models/` |
| Shared client, renderer, builder and offline store | `public/assets/ppms/` |
| Offline shell cache and install manifest | `public/sw.js`, `public/manifest.webmanifest` |
| Original converted schema, seed and provenance | `database/` |
| Additive runtime upgrades | `database/migrations/` |
| Account, backup, restore and cleanup helpers | `scripts/` |
| Disposable database, domain, client and browser regressions | `tests/` |

- [API contracts and examples](docs/backend-api.md)
- [Shared architecture and data-integrity invariants](docs/offline-dynamic-backend.md)
- [Deployment, device recovery, backup and restore](docs/operations.md)
- [Audit findings, repairs and acceptance map](docs/audit-remediation.md)
- [Centralized red theme and reusable UI components](docs/design-system.md)
- [Original database conversion and default-data provenance](database/README.md)

## Verification

Configure `DB_HOST`, `DB_PORT`, `DB_USERNAME` and `DB_PASSWORD` for a test account
that can create and drop disposable databases. Tests use only generated
`ppms_ci3_test_*` databases, never the configured application database.

```sh
npm ci --ignore-scripts
python tests/run_all.py --php php
python tests/run_all.py --php php --operations
npx playwright install chromium
python tests/run_all.py --php php --browser
```

`--php-extension` can be repeated. Backup/restore checks additionally need MySQL
or MariaDB command-line utilities; `PPMS_SQL_CLIENT` and `PPMS_SQL_DUMP` can select
them. `CHROMIUM_PATH` can select an installed browser.

The default runner covers PHP syntax, deterministic conversion, schema rules,
installation/upgrades, real HTTP/MySQL workflows, trace/provenance, permissions,
account lifecycle, reviews, idempotency, concurrent edits, interrupted batches,
multi-device authorization and browser/server calculation parity. Its offline
storage tests use real Node WebCrypto with emulated IndexedDB. `--browser` runs
actual Chromium storage, desktop/mobile viewport and application interactions.
Physical device acceptance and production-volume profiling remain separate gates.

The workflow in `.github/workflows/verify.yml` runs the runtime matrix plus browser
and restore jobs. No live credentials, records or production backups belong in
the repository. Serve only `public/`, use HTTPS, and restrict the ordinary runtime
database account after migrations. Framework source and licensing are documented
in [FRAMEWORK.md](FRAMEWORK.md) and [LICENSE](LICENSE).
