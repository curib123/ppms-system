# PPMS API and admin architecture map

This maps existing service ownership and the revised client boundary. The
[active plan](superpowers/plans/2026-10-26-simple-trackable-backend.md) tracks
implementation. The admin panel and complete advisory review behavior are
targets; uncommitted implementation/tooling must still be verified.

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
| `records/{id}`, `records/{id}/corrections` | `record` | `PpmRecord`, `PpmRecordRevision`, `RevisionChange`, `SyncConflict` | 05, 06, 07, 10, 19 |
| `sync/batches` | `sync` -> `record` | `SyncDailyBatch`, `SyncMutationReceipt`, `SyncConflict` | 04, 05, 07, 16, 18a |
| `templates/{id}/rules`, `forms/{id}/connections`, `records/{id}/publish` | `trace` | `TraceCodeRule`, `CodeSequence`, `PpmTraceConnection`, `PpmTraceOutput`, `PpmTraceLink` | 08, 09, 10, 12, 13, 18, 19 |
| `records/{id}/review`, `revalidations/items/{id}/resolve` | `workflow` | `WorkflowEvent`, `PpmRecordRevision`, `TraceRevalidation`, `TraceRevalidationItem` | 12, 19 |
| `forms/{id}/revalidations` | `record` | `TraceRevalidation`, `TraceRevalidationItem`, `PpmTraceLink` | 10, 12, 19 |
| `sync/bootstrap`, `sync/pull`, `sync/ack` | `pull` | `SyncChangeEvent`, `SyncPullCursor`; authorized template, record and trace reads | 11, 19, 20 |

`AuditLog` and `SyncChangeEvent` record applicable service writes. Services
reuse authentication, device and template checks rather than trusting browser
permissions or accepting public device IDs as credentials.

## Records, review and connected forms

`PpmForm` identifies a form; `PpmTemplateVersion.definitionJson` defines its
fields. Records pin that version, and `PpmRecordRevision.dataJson` stores each
immutable revision. A new ordinary form uses configuration and these shared
tables rather than a form-specific table or controller.

The required rule is that Checked, Reviewed and Approved are independent
guidance against a content revision. A submitted source must publish and feed
the next form before review. `requiresApprovalBeforeUse` remains inert
compatibility metadata even when true. Reuse `WorkflowEvent` for review notes,
with audit/feed refreshes and no content revision or lifecycle change.

Some direct approval filters have been removed in pending local edits, but
`Ppms_workflow_service::review` still advances sequential states and retires
outputs on RETURN. It also requires the mobile lease. Task 2 removes these
remaining blockers; this map does not claim the target is implemented.

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
