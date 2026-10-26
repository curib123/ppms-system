# Simple PPMS REST API and admin control panel

Date: 2026-10-26. Status: revised design for implementation, not a delivery claim.

## Purpose and ownership

Keep PPMS easy to understand, change and trace. This repository provides the
CodeIgniter 3 REST API and the browser admin control panel. Personnel enter PPM
records through the Flutter mobile app. Review guides people toward correct
records; production traceability does not wait for review or approval.

The [implementation plan](../plans/2026-10-26-simple-trackable-backend.md)
is the single active work list. It replaces the old offline browser plan and
the earlier backend-only cleanup scope. Database archives and Git history
remain provenance, not implementation instructions.

## Fixed constraints

- CodeIgniter 3.1.13; native MySQLi; MySQL 8.0.16+ or MariaDB 10.4+.
- Browser stack: CI3 PHP views, Tailwind CSS, native CSS, jQuery and Chart.js.
- Personnel client: Flutter; its source and release are outside this repository.
- Serve only `public/`; keep `system/` unchanged.
- Preserve PPMS table/column names, enum values, constraints and canonical defaults.
- Keep schema changes additive and versioned; never edit sealed migration checksums.
- Preserve individual authorship, device credentials, leases, locks and sync receipts.
- Never commit credentials, password hashes, sessions, live dumps or operational data.
- Commit each small, complete change with a descriptive message.

## Architecture choice

Use the existing CI3 controllers, services and bound MySQLi persistence model.
Keep `Api::_remap` as the JSON/authentication/error boundary for `/api/v1/*`.
Its resource grouping already exists in commit `48f15b8`; verify it rather than
repeat the refactor. Add ordinary CI3 admin controllers and views that call the
same services directly. jQuery enhances forms, filters and review actions.
Use Tailwind for layout, native CSS for small project styles and print, and
Chart.js for dashboard charts. Serve pinned, licensed assets locally. Compile
Tailwind during development and ship its CSS; production needs no Node process.

A separate SPA would add routing, state and build layers without a current
need. Building another offline browser client would duplicate Flutter's job.
These are excluded by the selected stack and client ownership. New wrappers,
repositories or generic workflow engines need a concrete use before inclusion.

## Current state and gaps

The repository has installation/migration commands, bearer authentication,
versioned templates, records/revisions, form access, shared-device sync,
trace publication, pull/ack and review services. The current human page is a
setup/form register. A complete admin panel and this Flutter client are not
implemented here.

Task 1 now implements the syntax/Topos runner with focused failure/provenance
tests and a real analyzer run. Pending functional changes remove approval
filters from trace linking, upstream discovery and replacement selection;
preserve that work for Task 2 rather than treating it as the complete rule.
`Ppms_workflow_service::review` still creates content revisions,
progresses sequential approval states and retires outputs on RETURN. Review and
revalidation also demand the form's mobile device lease. Those gaps are explicit
tasks, not evidence that the new behavior already works.

## Record quality and traceability

### Independent guidance

Show three indicators on each submitted content revision:

| UI indicator | Existing workflow step | Permitted role |
| --- | --- | --- |
| Checked | `FSQA_REVIEW` | FSQA or ADMIN |
| Reviewed | `SUPERVISOR_REVIEW` | SUPERVISOR or ADMIN |
| Approved | `PLANT_MANAGER_REVIEW` | PLANT_MANAGER or ADMIN |

This label mapping is the implementation proposal based on existing roles.
Each indicator is independent: a permitted reviewer may act even when another
indicator is pending. Reuse existing `WorkflowEvent` fields: `revisionId`,
`step`, `action`, `actorId`, `reason`, `createdAt`. `APPROVE` confirms that stage;
`RETURN` means an input issue needs attention. Display RETURN as **Needs correction**.
Do not add enum values or another review table for these labels.

Append events to the current content revision. Do not increment
`currentRevisionNo`, rewrite `dataJson`, change record lifecycle status, close
the record, republish codes, retire outputs or create revalidation work for a
review-only decision. A correction request requires a reason. The latest event
for each revision/step determines its indicator; preserve earlier events.

All writes require current role/form access and `baseRevisionNo`. Use client
`eventId` as `WorkflowEvent.id` for replay-safe review submission. Reusing it
with the same actor, record, revision, step, action and reason returns the existing
result; a different payload fails with 409. After checking current identity and
access, compare an existing event before enforcing the current revision check.
Thus an identical retry after a later correction returns the original event and
revision, alongside the current summary, without applying it to the new content.
Lock the owning form and reread mutable state for new decisions. Any later
content revision starts with pending indicators; prior review stays historical.

Write the event, audit entry and change-feed entry in one transaction. Reuse
`RECORD_REVISION` for a metadata refresh containing `reviewSummary`; its content
revision number can stay unchanged. Flutter applies it by newer event sequence,
not only by content revision. Do not emit a new trace publication for a note.
Allocate monotonically increasing `createdAt` per record/step under the form
lock (the later of UTC now and the preceding timestamp plus one millisecond),
so two decisions in one clock tick still have a defined latest result.

New requests explicitly name `step`. Existing reviewer clients may infer their
single stage from their role when absent; ADMIN must provide it. Document this
intentional contract change. Preserve old lifecycle enums and historical
approval/closed events. Do not reopen or rewrite old closed records. This plan
adds no new operational closure or archive process. Draft, closed and archived
records are read-only for new guidance. Legacy `PLANT_MANAGER_REVIEW/CLOSE`
counts as confirmation on its recorded revision; do not backfill other stages
onto newer revisions or reinterpret a historical return as a new correction.

### Connected forms continue

A complete submitted record can publish and provide an eligible source to the
next PPM before any check, review or approval. All combinations of pending,
confirmed and correction-request indicators leave an otherwise eligible source
usable. Apply this rule to bootstrap, incremental pull, selected trace links and
replacement-source revalidation. Retain `requiresApprovalBeforeUse` and its
stored values for compatibility; it is inert metadata, omitted from new admin
editing controls, and must not impose an approval prerequisite even when true.

Keep real integrity checks: active configured connection, published/current
eligible output, matching code/input path, template validation, form access,
revision checks, archive restrictions and unresolved genuine trace impacts.
A draft, disabled/superseded output or invalid source remains ineligible.

An actual data correction still uses immutable content revisions. It retires
affected outputs, preserves historical links and produces recursive downstream
revalidation. A reviewer note alone never triggers that process. Existing closed
records retain their correction restrictions; `ACCEPT_HISTORICAL` stays limited
to closed records. Missing review cannot prevent eligible source replacement.

## Authentication boundaries

Flutter keeps individual bearer sessions plus registered device credentials,
one authoritative device per form and original-author grants for queued work.
Keep those checks on sync, field edits, corrections and trace publication.

The online admin panel uses CI3 sessions, server-side identity, CSRF protection
and server-side role/form checks. Reuse existing login defense and account
validation; store the underlying bearer session token only in the server-side
session and revalidate it on requests. Regenerate the CI3 session on login;
logout revokes the underlying session. Never put tokens in browser storage.

Review and revalidation decisions require a reviewer role and form access, not
possession of the personnel device. API and browser paths use that same service
authorization. When a caller supplies device context, require the complete
device ID/token/lease-version set and validate it through the existing lease
check; caching a token with `credential()` alone does not verify it. Browser
review requests omit that optional mobile context entirely.
Do not trust client flags such as `isAdmin` or remove mobile lease checks globally.
An admin browser must never take over a mobile lease merely to review a record.

## Admin control panel

ADMIN configures the system. FSQA, SUPERVISOR and PLANT_MANAGER get assigned
area/form monitoring and their own review actions. PERSONNEL uses Flutter and
does not gain admin-panel access. Enforce this on server routes.

| Area | Minimum useful behavior |
| --- | --- |
| Dashboard | Scoped record counts, pending quality checks, sync issues and records by production date; Chart.js with an equivalent table |
| Forms/templates | Register, area assignments, draft definition editor with preview and validation, immutable publish/version history, trace rules/connections |
| People/access | Create accounts through an authorized wrapper of the account service, auditing the acting administrator; manage active status, roles, area/per-form permissions; preserve history |
| Devices | Lease/credential state, last synchronization, revoke/rotate and explicit reconciled transfer with reason; never reveal existing secrets |
| Records | Filtered/paginated list, pinned field values, revision differences, author/review history, quality indicators and notes |
| Traceability | Source/downstream links, output state and actual correction impacts; explain unavailable outputs |
| Sync/audit | Paginated batch outcomes, conflicts, revalidation tasks and audit history; input corrections stay in the authorized personnel flow |

Use reusable CI3 partials for navigation, alerts, pagination and field display.
Lists default to 50 items, maximum 100. Apply permission filters before counts,
pagination and chart aggregation. Do not fetch every record to filter in jQuery.
Load histories separately in pages; cap lineage traversal and detect cycles.
Provide empty, loading, error and expired-session states, keyboard access,
visible focus, responsive tables and escaped record values/notes. Dates use
plant timezone (default Asia/Manila); stored timestamps remain UTC.

The template editor is a small configuration/JSON editor with preview, not a
new visual builder engine. The browser stores no field drafts, author proofs
or synchronization queues. Administrative writes need an online response.

## Flutter contract to preserve

Flutter owns dynamic field rendering, durable local storage, original-author
proofs, mutation queues, grant-expiry feedback, retries and conflict UI. It must
commit snapshots/pages locally before acknowledging signed cursors. The backend
remains authoritative for validation, code generation and current permissions.

Keep immutable batch IDs/payloads, per-mutation outcomes, idempotent receipts,
stale-template/revision conflicts, lease-transfer reconciliation, revocation and
selective upstream projections. Daily batches use plant business dates and may
have multiple batch numbers. Do not expose other forms' raw records through a
dependency projection.

Supply documented JSON fixtures and API tests here. Flutter widgets, local
storage choices, APK delivery and mobile end-to-end validation require the
Flutter repository; PHP tests or admin screenshots cannot certify them.

## Topos and maintainability

Use [Krv-Labs/Topos](https://github.com/Krv-Labs/topos) as an optional development
analyzer, pinned to v0.14.0 with verified download checksums. Its
[supported languages](https://github.com/Krv-Labs/topos/blob/297a01301610124544a1b8a08123359ab32cb55e/topos/engine/src/graphs/ast/languages.rs)
exclude PHP and Dart. Analyze first-party Python tooling and admin JavaScript;
retain PHP lint, behavioral tests and human review for CI3. Use measurements
to choose useful simplifications, never to change business rules for a score.

Keep the native CLI or optional Linux Docker runner out of production. Exclude
`system/`, downloaded/vendor assets, credentials and generated/operational files.
Record version, revision, dirty state, analyzed paths/hashes and coverage limits
in ignored reports. `--no-composable` avoids GitNexus initially; mark that metric
unavailable. Findings are advisory; syntax/tool/output failures exit nonzero.
No global agent settings or extra runtime framework is needed.

## Evidence and completion

The plan assigns tests for no-review trace use, RETURN without retirement,
stale/replayed review commands, browser review without a mobile token, real
correction propagation, scoped pagination and unchanged Flutter sync security.
Validate admin actions at desktop, mobile width and landscape, including long
histories and failure responses.

Do not label dirty code, proposed screens or a draft quality runner as shipped.
Record checks for the tested commit and commit independently complete changes.
Task 1 delivers development checks. Functional implementation boxes remain
unchecked until their own behavior and browser verification pass.
