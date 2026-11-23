# Deployment, device recovery and operational checks

## Runtime and web root

Use a supported PHP release with `mysqli`, `mbstring` and `ctype`, and an InnoDB
MySQL/MariaDB server. Local implementation verification used PHP 8.4.27 and MariaDB
11.8.6. CI targets PHP 8.3/8.4 with MariaDB 10.11/11.8 and MySQL 8.4. Keep the actual
chosen versions in a release record and require their CI gates before rollout.

Serve only `public/`. Keep local configuration, source, SQL, backups and test files
outside the document root. Production HTTPS is required for bearer credentials,
service workers and WebCrypto. Configure a request limit of 2 MiB or lower, suitable
PHP memory/time limits, error logging, trusted proxy addresses and TLS at the web
server. Never grant database DDL privileges to an ordinary runtime account after
installation; use an operator account for migrations/restore.

`application/config/local.php` remains ignored. Set `APP_ENCRYPTION_KEY` to at
least 32 cryptographically random characters, set `PLANT_TIMEZONE` (default
Asia/Manila), and configure DB_* values. Environment variables override local
configuration. Do not put credentials in source, browser bundles or command lines.

## Installation and upgrades

For a new empty database:

```sh
php index.php setup check
php index.php setup install
php index.php setup verify
php index.php setup migrate
python scripts/create_admin.py --php php
php -S 127.0.0.1:8085 -t public public/router.php
```

For an existing converted database: make a verified backup, pause incoming writes,
run `setup check`, then `setup migrate`. Do not rerun installation or reimport the
baseline seed. `setup verify` compares a pristine seed and is not a production-data
integrity check after users/records have been created.

The first migration PHP file remains byte-for-byte sealed. Its checksum is checked
before repair DDL. The wrapper replaces only its invalid active-template constraint
with an equivalent nullable marker plus unique(form,marker). Later additive
migrations preserve legacy sequence counters and cursor tables, backfill scoped
cursors, and allow multiple authorized devices per form. Existing form/device
memberships retain their versions. Repeat migration is safe after an interruption;
an unexpected checksum mismatch is a stop condition, not a reason to overwrite
migration history.

After upgrade, require HTTP 200 from `/ready`. `/health` only demonstrates baseline
reference connectivity. Run smoke checks for login, an existing pinned record,
a new revision, a trace lookup, and receipt replay. Then resume writes.

The shared UUID helper uses native `crypto.randomUUID()` when available and
cryptographically secure `crypto.getRandomValues()` otherwise. This supports
record creation in browsers where `randomUUID` is absent, including HTTP LAN
addresses. IDs remain UUIDv4; saved records, registered devices and pending retry
requests keep their existing identifiers. If neither secure API is available,
PPMS reports an error instead of generating weak identifiers. This compatibility
fallback does not replace HTTPS or the Web Crypto requirement for encrypted
offline storage.

After deploying a frontend update, save work, close all PPMS tabs/windows, then
reopen PPMS so its waiting service worker can activate the new shell. Do not clear
site data to resolve an old cached script: it also contains unsynchronized
records. The update keeps IndexedDB and its pending queue intact.

## First use

Open `/admin` (also the root URL), sign in, and create or edit a form. Use the shared
builder to configure Header, Main content and Summary; preview the document, save a
draft version, configure source connections/output rules, then publish. Assign form
permissions to personnel and reviewer areas to review roles.

On a personnel device, open `/mobile` over HTTPS and install it using the browser's
installation action. Sign in, create an offline unlock passphrase, and register the
device. An admin authorizes that device for each permitted form. Several devices
can be authorized for the same form; conflicting record revisions are preserved
rather than silently overwritten. Download the assigned form's offline data while
online. Cached definitions and records remain pinned to their original versions.

Keep the offline passphrase safe: it is not stored and the server cannot decrypt a
locked local vault. Export an encrypted vault before replacing a device or clearing
browser storage. A lost passphrase does not erase server-synchronized records, but
unrecoverable local-only data cannot be reconstructed from the server.

## Interrupted synchronization

1. Check the device's queue, original batch ID and server batch status.
2. Retry an uncertain attempted batch unchanged while its authorization remains
   valid. Do not generate a new ID merely because its HTTP response was lost.
3. If an interrupted `PUSHING` batch cannot resume after rotation/revocation, an
   admin inspects it in the sync monitor and finalizes recovery with a reason and
   its expected payload hash. An active worker prevents recovery.
4. Matching committed receipts are retained. Unprocessed mutations are explicitly
   marked for reconciliation, not counted as accepted.
5. The client preserves those drafts and requires a current server base/reviewed
   intent before requeueing with a new mutation identity. Resolve conflicts using
   keep-server, apply-local-as-new, or manual merge with a reason.
6. Reauthorizing a device affects its own form memberships. Revocation/rotation
   advances every membership for that device, without invalidating other devices.

A lease/version error is not permission to discard local work. A server tombstone
must also preserve a pending local edit as a conflict. Never delete mutation
receipts to “unlock” an interrupted batch.

## Backup and restore drill

Install `mariadb`/`mariadb-dump` or compatible MySQL client utilities. Optional
`PPMS_SQL_CLIENT` and `PPMS_SQL_DUMP` specify executable paths. These tools read the
explicit DB_* environment values, not the ignored PHP local file. Choose an output
directory outside `public/` on protected/encrypted storage.

```sh
python scripts/maintenance.py backup --output /secure/ppms/ppms-2026-11-23.sql
python scripts/maintenance.py restore --input /secure/ppms/ppms-2026-11-23.sql --target ppms_restore_drill --sha256 <reported-sha256>
python scripts/maintenance.py cleanup
```

Backup uses a single transaction, preserves triggers/routines/events, writes a
SHA256 sidecar and records a job. Output is mode 0600 and cannot overwrite an existing
file. Pause schema changes during the snapshot. Store and test copies outside the
application host; a backup file on the same failed disk is not a recovery plan.

Restore requires a verified hash and a **new** database distinct from DB_DATABASE.
It refuses an existing target, even if empty. Import runs under a short-lived SQL
account granted access only to that new target; client-side SQL commands and local
infile loading are disabled. The operator therefore needs CREATE DATABASE,
CREATE USER and appropriate GRANT privileges. Restore failures leave an isolated,
explicitly incomplete target for investigation and never select it for cutover.

After restoration, point a separate test instance at the target, run migrations,
readiness, record/revision/trace checks and application acceptance. Only an operator
should perform a deliberate cutover after validation. The repository's restore
regression verifies canonical tables, migration replay, checksums and refusal to
overwrite; it does not substitute for a drill with actual production volumes.

Cleanup is bounded and removes only old expired login-defense/session rows. It
preserves production records, revision history, trace links, mutation receipts and
audit events. Record retention remains archive-only through authorized tombstone
operations; no automatic destructive purge is introduced. Schedule backups and
cleanup through your deployment's job runner after defining ownership, frequency,
retention and monitoring. `GET /api/v1/jobs` exposes recorded operational status.

## Verification

Node is a development-only dependency for tests; clients are self-hosted static
ES modules and require no production Node server or build step.

```sh
npm ci --ignore-scripts
python tests/run_all.py --php php
python tests/run_all.py --php php --operations
npx playwright install chromium
python tests/run_all.py --php php --browser
```

DB_HOST/PORT/USERNAME/PASSWORD select a disposable-test-capable database account.
Tests create only `ppms_ci3_test_*` databases and drop those fixtures afterward.
`--php-extension` can be repeated when needed. `CHROMIUM_PATH` optionally selects
an installed browser; otherwise Playwright uses its installed Chromium.

`node tests/offline_client.mjs --node` uses real Node WebCrypto and emulated
IndexedDB for deterministic queue/storage tests. It must not be reported as a real
browser/device result. The default invocation runs the same workload in Chromium.
`tests/ui_integration.py` runs the real API with browser desktop/mobile contexts,
form-builder and editor workflows, network changes and visual artifacts.

Before plant deployment, verify Android/iOS keyboard, dropdown, pinch/pan and
fullscreen behavior on the actual target devices, test shared-device unlock/user
switching, and measure representative record/history volumes on the target server.
