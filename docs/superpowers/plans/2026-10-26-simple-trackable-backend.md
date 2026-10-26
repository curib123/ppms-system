# PPMS REST API and Admin Control Panel Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task by task. Track the checkboxes and commit each small, complete change.

**Goal:** Deliver a simple CI3 REST API and admin panel for Flutter personnel,
with quality guidance that never gates connected trace work.

**Architecture:** Keep the API resource handlers, domain services and MySQLi
store. CI3 admin controllers/views call the same services, with server-side
sessions and CSRF for browser writes. Flutter owns offline entry.

**Tech Stack:** CodeIgniter 3.1.13, native MySQLi, MySQL/MariaDB, Tailwind,
native CSS, jQuery, Chart.js; optional Topos v0.14.0 for supported sources.

**Spec:** [REST API and admin design](../specs/2026-10-26-simple-trackable-backend-design.md).

**Status:** Task 1 implemented and verified on 2026-10-26; Tasks 2-8 pending.
This is the single active plan, superseding backend-only and offline browser
tasks. Preserved local functional changes do not complete Task 2.

## Global constraints

- CodeIgniter 3.1.13; native MySQLi; MySQL 8.0.16+ or MariaDB 10.4+.
- Browser stack: CI3 PHP views, Tailwind CSS, native CSS, jQuery and Chart.js.
- Personnel client: Flutter; its source and release are outside this repository.
- Serve only `public/`; keep `system/` unchanged.
- Preserve PPMS table/column names, enum values, constraints and canonical defaults.
- Keep schema changes additive and versioned; never edit sealed migration checksums.
- Preserve individual authorship, device credentials, leases, locks and sync receipts.
- Never commit credentials, password hashes, sessions, live dumps or operational data.
- Commit each small, complete change with a descriptive message.
- Preserve API contracts except the explicit advisory-review changes in Task 2.
- No SPA framework, duplicate offline browser client, per-form table or generic workflow engine.
- Topos does not parse PHP or Dart; structural findings are advisory.

## Review focus

1. RETURN without a data edit preserves source availability with no downstream impact (Task 2).
2. Stale/retried review cannot approve another revision or duplicate events (Task 2).
3. Browser review needs no mobile token; personnel edits still require it (Tasks 2, 3).
4. Counts, histories and charts never disclose data outside current form access (Tasks 4, 7).
5. Lost responses, revoked access and real corrections retain Flutter receipt/cursor and revalidation guarantees (Tasks 2, 5, 8).

## File ownership

| Files | Responsibility |
| --- | --- |
| Existing `application/controllers/Api.php` | REST transport, bearer boundary, explicit resource dispatch |
| Existing `application/libraries/Ppms_*_service.php` | Shared domain rules and authorization |
| Existing `application/models/Ppms_store_model.php` | Bound MySQLi persistence, transactions, locks, audit/feed |
| New `application/controllers/Admin.php`, `Admin_config.php`, `Admin_records.php` | Login/dashboard, configuration, records/monitoring and browser actions |
| New `application/core/MY_Admin_controller.php`, `application/libraries/Ppms_admin_session.php` | Online session/role boundary |
| New `application/libraries/Ppms_admin_query_service.php` | Scoped lists, bounded histories, aggregates, trace projections |
| New `application/views/admin/`, `resources/css/admin.css`, `public/assets/` | CI3 screens/partials, Tailwind input/built CSS, native styles, pinned JS/licenses |
| Existing `tests/`, new `tests/admin_integration.py`, `tests/admin_browser.spec.js` | Real HTTP/database and browser verification |
| Existing `scripts/check_quality.py`, `tests/quality.py`, `tools/topos/Dockerfile` | Verified syntax checks and optional supported-source analysis |

Unqualified service names below live under `application/libraries/`; controllers
under `application/controllers/`. New paths are proposals, not existing features.

## Task 1: Baseline and quality tool

**Files:** `scripts/check_quality.py`, `tests/quality.py`, `tools/topos/Dockerfile`,
`.gitignore`, `docs/code-quality.md`; inspect `Api.php`, `tests/api_routing.php`.

**Interfaces:** Keep the API resource grouping from `48f15b8`.
`python scripts/check_quality.py [--topos] [--php PATH]` exits nonzero on
syntax/tool/coverage failure. Reports are ignored developer artifacts.

- [x] Record branch/HEAD, staged/unstaged work and actual baseline test results. Inspect unfinished tooling and trace edits; preserve unrelated work.
- [x] Run `php tests/api_routing.php`, `php tests/validation.php`, `python tests/conversion.py`, `python tests/run_with_mariadb.py`. Address any baseline defect in a separate scoped change.
- [x] Review/test invalid PHP/Python, analyzer failure, wrong version, malformed/incomplete output, unsupported PHP and exclusion of vendor/private data. Demonstrate failures before finalizing handling.
- [x] Finish tracked first-party source selection and pinned native/Docker Topos execution. Verify download checksums, read-only mounts, no analysis network, version/revision/path hashes and explicit unavailable PHP/Dart/COMPOSABLE coverage.
- [x] Run `python tests/quality.py`, the normal quality command and a real `--topos` analysis; inspect its report. Missing tooling is a limitation, not a pass.
- [x] Commit only the finished tooling: `chore: add optional Topos and first-party syntax checks`. Optional analyzer installation can proceed independently and must not delay functional tasks.

### Task 1 verification record

Tooling source commit: `799895a`. Work continues on
`feature/offline-dynamic-ppm-api`; the existing functional edits were preserved.

- `python tests/quality.py`: 15 tests passed. New exclusion, concurrent-edit,
  pre-analysis metadata and update-notice checks failed before their fixes.
- Normal syntax check and `python scripts/check_quality.py --topos`: 58 PHP
  and 8 Python files passed; real Topos v0.14.0 parsed all 8 supported files.
  The ignored report includes source hashes/revision and dirty state.
- `php tests/api_routing.php`: 1,074 assertions passed;
  `php tests/validation.php` and the conversion-integrity test passed.
- `python tests/run_with_mariadb.py`: 9 installer, 4 migration and 21 API tests
  passed on a private disposable server. An initial installer retry scenario
  exceeded its 30-second child timeout; an isolated rerun and the final complete
  run passed. The cause was unconfirmed; no speculative installer fix was made.
- Independent Task 1 review found no material code/security issues.

Backend baseline tests used the working tree, including preexisting trace and
API-test edits. Those functional files remain uncommitted; these results do
not establish Task 2's full advisory-review contract or an admin-panel release.

## Task 2: Independent review and non-blocking trace progression

**Files:** workflow/trace/pull/record services, `Api.php`,
`tests/api_integration.py`, `tests/api_routing.php`, `docs/backend-api.md`.

**Interfaces:** Keep `review($actor,$id,$input)` and
`resolveItem($actor,$itemId,$input)`. Review input:
`{eventId,baseRevisionNo,step,action,reason}`. Reuse `WorkflowEvent.step` and
`APPROVE|RETURN` for the spec's indicators. Add revision-scoped `reviewSummary`
to record reads. Return `reviewEvent` with the accepted event/original revision
identity alongside the current `reviewSummary`. If device context is supplied,
validate its complete ID/token/version through `lease()`; partial context fails.

- [ ] Add cases proving a submitted unreviewed source publishes and works in bootstrap, pull, selection and replacement with legacy approval metadata false and true. Draft, superseded, disabled and unauthorized sources remain rejected.
- [ ] Add regressions for independent stages and RETURN leaving output IDs/status, current revision/data hash, lifecycle and downstream impacts unchanged. Assert no duplicate codes or automatic CLOSED status.
- [ ] Test role/form denial, reviewer success without a mobile token, invalid/partial supplied device context, stale revision 409, identical-event replay after a later correction, changed-payload/cross-actor/cross-record event reuse 409 and concurrent review/content changes. Run against current code and identify expected failures.
- [ ] Append review events to the existing content revision without synthetic revisions, trace retirement/relinking or republication. Require a RETURN reason. Infer missing step only from a single reviewer role; ADMIN must name it (`REVIEW_STEP_REQUIRED`).
- [ ] Use `eventId` as `WorkflowEvent.id`; after fresh identity/access checks, compare an existing event before enforcing the current revision check. Replays return the original event and current summary without duplicate writes. New events lock the form and reread content/access.
- [ ] Append audit/feed entries transactionally. Emit `RECORD_REVISION` with updated summary even when the content revision is unchanged; test pull/ack applying it by event sequence. Allocate monotonic per-record/step timestamps as the spec defines and test same-clock-tick decisions. Keep legacy CLOSE history readable and closed records read-only.
- [ ] Finish removal of approval filters in trace/pull/replacement code. Keep `requiresApprovalBeforeUse` stored but inert. Authorize review/impact decisions by role/form, preserving device leases for mobile sync/edit/correct/publish.
- [ ] Test real data correction retiring affected outputs, preserving links, generating recursive impacts and leaving prior review historical. Preserve existing closed records and their correction restrictions.
- [ ] Run routing/validation/lint and full disposable suites. Update the implemented API contract; commit `fix: separate PPM quality review from trace progression`.

## Task 3: Admin login and page shell

**Files:** new `MY_Admin_controller.php`, `Ppms_admin_session.php`, `Admin.php`,
`application/views/admin/{login,layout}.php`, `public/assets/js/admin.js`,
`resources/css/admin.css`, `public/assets/css/admin.css`, build manifest/lockfile
and license notices; `routes.php`, session/CSRF configuration,
`tests/admin_integration.py`, `tests/admin_browser.spec.js`, `tests/run_with_mariadb.py`.

**Interfaces:** `/admin/login` GET/POST, `/admin/logout` POST, `/admin` GET.
`Ppms_admin_session::login($input,$ip)`, `actor()`, `logout()` wrap existing
authentication with server-side CI3 session storage. The base controller checks
the session and allowed roles on every protected handler.

- [ ] Add HTTP tests for login/throttle, unauthorized redirect, PERSONNEL denial, reviewer/admin access, session rotation/expiry/revocation, missing CSRF and logout revocation; add this suite to the disposable runner.
- [ ] Implement session/route guards using current account validation. Keep bearer/device tokens out of browser storage; page and AJAX actions must consistently reject expired sessions.
- [ ] Build navigation/alerts with Tailwind/native CSS and pinned local jQuery. Add a reproducible CSS build, lockfile, built CSS and licenses; exclude vendor assets from Topos.
- [ ] Add development-only Playwright with `npm run test:admin`, `PPMS_TEST_BASE_URL`, fixture-only credentials and ignored reports/screenshots. Run against a disposable test app, not operational data.
- [ ] Run disposable suites and browser login/logout at 1440x900, 390x844 and 844x390; check labels/focus, errors and expiry. Commit `feat: add CI3 admin authentication and navigation`.

## Task 4: Scoped read models and record browsing

**Files:** new `Ppms_admin_query_service.php`, `Admin_records.php`,
`application/views/admin/records/{index,show}.php`, pagination/field partials;
record service, `Api.php`, routes and API/admin/browser tests.

**Interfaces:** Query methods `records($actor,$filters)` and
`history($actor,$recordId,$kind,$page,$perPage)`. REST additions:
`GET /api/v1/records`, `GET /api/v1/records/{id}/history?kind=revisions|reviews`.
Lists return `{items,total,page,perPage}`, default 50, maximum 100.
Browser paths: `/admin/records`, `/admin/records/{id}`.

- [ ] Add more than 100 fixture records/history entries across allowed/denied forms. Assert scoped counts, stable timestamp/ID ordering, bounded pagination, invalid-filter errors and no cross-form disclosure.
- [ ] Implement bound queries for form, area, production date range, lifecycle and quality indicators. Preserve the existing mobile detail shape; browser history uses bounded endpoints rather than all revisions.
- [ ] Render pinned definitions/values, repeatable rows, revision differences and actor/stage/revision history. Escape script-like fields/notes; handle absent configuration and empty/error states.
- [ ] Run API/admin suites and browser paging/filter/history checks, including unauthorized direct URLs and long values. Commit `feat: add scoped PPM record and history browsing`.

## Task 5: Configuration and devices

**Files:** new `Admin_config.php`, `application/views/admin/config/`; existing
form/template/trace/device/account/auth services; query service, routes and tests.

**Interfaces:** `/admin/forms`, `/admin/forms/{id}`, `/admin/people`,
`/admin/devices`; explicit CSRF-protected POST handlers call shared services.
Extend `Ppms_account_service` with `createForAdmin($actor,$input)`,
`update($actor,$userId,$input)` and
`assignArea($actor,$userId,$areaId,$input)`. ADMIN writes; reviewers only read
their permitted configuration.

- [ ] Add tests for draft edit/preview/validation/publish, immutable published versions, stale definition hashes, assignments and denied configuration writes.
- [ ] Add a small definition editor and field/table preview, trace rules and connections. Hide obsolete approval-gate editing without changing stored values. New forms need no new table/controller.
- [ ] Add people/account/role/area/per-form access management through existing services. Browser creation audits the authenticated administrator, while `create($input)` keeps CLI provisioning behavior; test both attribution paths. Revocation affects active sessions and queued writes; never return hashes or delete historical actors.
- [ ] Add device status, rotate/revoke and reconciled lease transfer with reason/expected version. New secrets appear once to authorized users without logging/caching; review never changes the mobile lease.
- [ ] Test stale leases, pending work and revoked grants with sync/admin suites and browser configuration flows. Commit each complete screen/service change separately.

## Task 6: Review UI, trace and sync monitoring

**Files:** `Admin_records.php`, query service, review/trace/sync/audit views,
`public/assets/js/records.js`, routes and API/admin/browser tests.

**Interfaces:** `POST /admin/records/{id}/review` uses Task 2 input.
`POST /admin/revalidations/{id}/resolve` uses decision/base/notes fields.
`trace($actor,$recordId,$depth)` caps depth at 5 and detects visited IDs.
`batches($actor,$filters)`, `conflicts($actor,$filters)`, `audit($actor,$filters)`
use Task 4 pagination. Read views: `/admin/trace`, `/admin/sync`, `/admin/audit`.

- [ ] Add cases for independent indicators, revision-bound notes, missing/partial/needs-correction guidance with available sources, stale refresh and replay-safe double clicks.
- [ ] Add role-specific review actions and CSRF handlers calling Task 2 authorization without device registration. Show who checked which revision and the latest result at each stage.
- [ ] Add bounded lineage/output/impact views, unavailable-source reasons and cycle/truncation messages without exposing unauthorized upstream payloads.
- [ ] Add batch outcomes, conflicts, real impact resolution and audit filters. Input corrections stay in the personnel flow; notes never create trace-impact tasks.
- [ ] Test corrected-content history, deep/cyclic graphs, lost AJAX responses and empty/error states. Run suites/browser cases; commit review and monitoring features separately.

## Task 7: Dashboard

**Files:** `Admin.php`, query service, `application/views/admin/dashboard.php`,
`public/assets/js/dashboard.js`, pinned Chart.js/license and admin/browser tests.

**Interfaces:** `dashboard($actor,$filters)` returns scoped record counts,
pending current-revision indicators, sync issues and counts per plant production
date. Reuse record-list filters and count definitions.

- [ ] Test permitted/denied forms, Asia/Manila date boundaries, multiple events on a revision, correction resets and empty ranges. Dashboard/list totals must agree without duplicate join counts.
- [ ] Add bounded aggregates and Chart.js with an equivalent accessible table. Display quality indicators separately from production readiness.
- [ ] Check filters, empty data, resize/landscape, chart fallback and role changes in admin/browser suites. Commit `feat: add scoped PPM dashboard reporting`.

## Task 8: Flutter contract and final verification

**Files:** API/architecture/quality/offline-client documentation, `README.md`,
safe JSON fixtures under `tests/fixtures/`, sync/API tests and this checklist.

**Interfaces:** Preserve bearer/device/author-proof authentication, immutable
batch replay and signed durable-ack cursors. Document additive `reviewSummary`
with revision identity. Fixtures contain no secrets or operational records.

- [ ] Test fixtures for bootstrap, multi-author daily batches, partial failure/retry, stale templates/revisions, revocation, correction propagation, empty filtered pull pages and acknowledgment boundaries. Document that actual local durability is a Flutter obligation.
- [ ] Verify pending/needs-correction indicators never remove eligible upstream outputs, while real retirements do; include three-form correction propagation and replacement without approval.
- [ ] Update the route -> service -> table -> test map and final API contract. Document admin/API URLs and exact build/test commands. Remove target-only caveats only after the relevant checks pass.
- [ ] Run `python scripts/check_quality.py`, `php tests/api_routing.php`, `php tests/validation.php`, `python tests/quality.py`, `python tests/conversion.py`, `python tests/run_with_mariadb.py`, the CSS build and `npm run test:admin` on a disposable app. Run real optional Topos; report unavailable coverage honestly.
- [ ] Independently review authorization/locks/defaults, advisory review and large-list browser flows at desktop/mobile/landscape widths. Fix material findings and rerun relevant checks.
- [ ] Record commands/results/tested SHA and limitations. Mark only verified tasks complete; commit final docs. Flutter widgets/storage/APK validation stays pending until its repository is available.

## Definition of done

The admin panel manages configuration and review online; personnel entry stays
in Flutter. Submitted sources feed connected forms regardless of quality
indicators. Notes do not mutate content/traces; actual corrections stay
traceable. Scoped admin access and mobile sync guarantees pass their checks.
Docs describe tested behavior, Topos coverage is honest, and each complete
change has a descriptive commit.
