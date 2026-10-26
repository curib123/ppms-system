# PPMS API and admin architecture map

This maps existing service ownership and the revised client boundary. The
[active plan](superpowers/plans/2026-10-26-simple-trackable-backend.md) tracks
implementation. The API supports independent revision-scoped review guidance;
the admin panel and bounded list/history endpoints remain planned work. The
syntax/Topos runner is implemented; see [quality checks](code-quality.md).

PPMS runs on CodeIgniter 3 with its native MySQLi driver and MySQL/MariaDB.
`public/` is the web document root. Keep the original table names, enum values,
constraints and default data; extend the runtime through versioned migrations.

## Request and data flow

`application/config/routes.php` sends `/api/v1/*` to `Api::_remap`.
That method owns JSON parsing, bearer authentication, error handling and JSON
responses. Private resource handlers match paths and explicitly load the
service they call. Services in `application/libraries/` own business rules.

`Ppms_store_model` owns bound MySQLi statements, transactions, form locks, audit
writes and change-feed writes. `Ppms_database` obtains CI3's MySQLi connection
and handles guarded installation. `Ppms_values`, `Ppms_problem` and
`Ppms_form_validator` provide shared boundary validation and error contracts.
There is no additional router, dependency container or persistence framework.

## Route ownership

Paths below follow `/api/v1/`. Service names omit their `Ppms_` prefix and
`_service` suffix. Test numbers refer to `test_NN` methods in
[`tests/api_integration.py`](../tests/api_integration.py); these are existing
regression checks, not a statement that they were run when reading this map.

| Resource | Owner | Core tables | API tests |
| --- | --- | --- | --- |
| `auth/login`, `auth/logout`, `me` | `auth` | `User`, `AuthSession`, `AuthLoginDefense` | 01 |
| `devices/*`, `forms/{id}/lease`, `forms/{id}/access/{user}`, `sync/grants` | `device` | `ClientDevice`, `ClientDeviceCredential`, `PpmFormDeviceLease`, `PersonnelPpmAssignment` | 02, 14, 16, 17, 20 |
| `forms`, `forms/{id}/areas/{area}` | `form` | `PpmForm`, `ProductionArea`, `AreaPpmAssignment` | 15 |
| `areas` | `Api` via store | `ProductionArea` | No dedicated area-list test |
| `forms/{id}/templates`, `templates/{id}`, `templates/{id}/publish` | `template` + validator | `PpmTemplateVersion` | 03, 06, 14, 15 |
| `records/{id}`, `records/{id}/corrections` | `record` | `PpmRecord`, `PpmRecordRevision`, `RevisionChange`, `WorkflowEvent`, `SyncConflict` | 05, 06, 07, 10, 19, 21, 23, 25 |
| `sync/batches` | `sync` -> `record` | `SyncDailyBatch`, `SyncMutationReceipt`, `SyncConflict` | 04, 05, 07, 16, 18a |
| `templates/{id}/rules`, `forms/{id}/connections`, `records/{id}/publish` | `trace` | `TraceCodeRule`, `CodeSequence`, `PpmTraceConnection`, `PpmTraceOutput`, `PpmTraceLink` | 08, 09, 10, 12, 13, 18, 19 |
| `records/{id}/review`, `revalidations/items/{id}/resolve` | `workflow` | `WorkflowEvent`, `PpmRecordRevision`, `TraceRevalidation`, `TraceRevalidationItem` | 12, 19, 21–27 |
| `forms/{id}/revalidations` | `record` | `TraceRevalidation`, `TraceRevalidationItem`, `PpmTraceLink` | 10, 12, 19 |
| `sync/bootstrap`, `sync/pull`, `sync/ack` | `pull` | `SyncChangeEvent`, `SyncPullCursor`; authorized template, record and trace reads | 11, 19, 20, 24 |

`AuditLog` and `SyncChangeEvent` record applicable service writes. Services
reuse authentication, device and template checks rather than trusting browser
permissions or accepting public device IDs as credentials.

## Records, review and connected forms

`PpmForm` identifies a form; `PpmTemplateVersion.definitionJson` defines its
fields. Records pin that version, and `PpmRecordRevision.dataJson` stores each
immutable revision. A new ordinary form uses configuration and these shared
tables rather than a form-specific table or controller.

Checked (FSQA), Reviewed (SUPERVISOR) and Approved (PLANT_MANAGER) are
independent guidance against an exact content revision. `reviewSummary`
contains that revision's ID and each stage's latest event/status: `PENDING`,
`CONFIRMED` or `NEEDS_CORRECTION`. ADMIN may act at any explicitly named stage;
reviewer roles may omit the stage to infer their own. Draft, closed and archived
records reject new guidance. Historical events remain intact, including a
legacy Plant Manager `CLOSE` confirmation on its recorded revision.

`Ppms_workflow_service::review` appends a `WorkflowEvent`, audit entry and
`RECORD_REVISION` metadata refresh atomically. It never increments content
revision, changes lifecycle, retires/republishes outputs or starts revalidation.
A stable client `eventId` makes retries replay-safe. Current access and role
checks precede event comparison; identical retries after correction return the
original event alongside the current summary, without reviewing new content.
New content revisions start with pending guidance.

Review and impact resolution require role/form access, not the mobile device's
credential. Optional device context must still prove possession and the current
lease; a token header alone or partial body context is rejected. The service
does not take over a mobile lease for review.

A valid submitted source may publish and feed the next form before review.
Pending, confirmed and needs-correction indicators leave eligible sources
usable in bootstrap/pull, selections and replacement validation.
`requiresApprovalBeforeUse` remains inert compatibility metadata even when true.

Source eligibility still requires an active configured connection, an eligible
published output and a matching value/path. Permissions, device leases,
revision checks, record lifecycle rules and outstanding revalidation checks
remain enforced. Corrections retire affected outputs, preserve historical
links and create downstream revalidation work.

## Offline boundary

The server implements device credentials/leases, expiring original-author
grants, immutable daily batches, idempotent receipts, explicit revision
conflicts, selective snapshots/feeds and signed cursor acknowledgments.
Each mutation commits its record, receipt, audit and change events together;
one rejected mutation does not discard successful mutations in the batch.
Review metadata refreshes keep the content revision unchanged; clients must
apply `RECORD_REVISION` by increasing feed sequence and persist the summary
before acknowledging the cursor.

Flutter owns the renderer, durable local storage/queue, grant-expiry UI and
retry/reconciliation screens. See [the Flutter contract](flutter-client-contract.md).
This repository must not build another browser queue or personnel PWA.

## Planned admin panel

CI3 controllers/views use Tailwind, native CSS, jQuery and Chart.js. Online
browser sessions and CSRF protect admin writes; the existing domain services
enforce current roles/form access. The browser calls those services directly,
without HTTP loopback, copied business rules or the mobile device's token.
Flutter's REST requests retain bearer/device/lease requirements for entry/sync.

Add a small admin query service for scoped pagination, history, lineage and
dashboard aggregates. Share view partials, not a new application framework.
Dashboard, forms/templates, people/access, devices, records/review, trace,
sync and audit screens are planned. The current page remains the form register.
The plan lists proposed controllers/files and their verification tasks; the
table above lists existing API owners, not delivered admin routes.

## Editing one behavior

1. Find the route above and change its owning service. Keep transport changes
   in `Api`, persistence helpers in the store and field validation in the
   validator; introduce another layer only for a concrete need.
2. Preserve authorization, transaction boundaries, lock ordering, revision
   history and the JSON contract. Add schema changes as runtime migrations;
   leave the converted baseline SQL and canonical seeds intact.
3. Extend the relevant behavioral test when changing behavior. Run PHP syntax
   checks, `php tests/validation.php`, `python tests/conversion.py` and
   `python tests/run_with_mariadb.py`; the last uses a private temporary server.
4. Commit each small, complete change. Never stage local credentials,
   passwords/hashes, sessions, live dumps or operational data.

Installer checks live in `tests/integration.py`; migration/account checks live
in `tests/migrations.py`. Topos is optional development tooling for supported
sources such as Python tests/tooling. It does not parse PHP and cannot replace
PHP lint or the behavioral suites.
