# Flutter personnel client and API boundary

The Flutter app is the personnel client. This repository supplies its CI3 REST
API and the planned online admin control panel. The
[active plan](superpowers/plans/2026-10-26-simple-trackable-backend.md) owns the
implementation work; this document records responsibilities and handoff checks.
See [the current API guide](backend-api.md) for existing request bodies.

## Server responsibilities

- Validate current individual accounts, roles, form/area permissions, registered
  device credentials and the authoritative device lease for mobile writes.
- Bind offline author grants to original user, device, form, lease and expiry.
  The uploader is not substituted for authors sharing the same device.
- Validate dynamic templates and records; keep published definitions immutable
  and existing records pinned to their exact template version.
- Serialize mutations under the form lock; retain immutable revisions, audit
  context, per-mutation transactions, conflicts and replay-safe receipts.
- Accept immutable daily batches with plant business date and batch number.
  Successful mutations survive failure of other mutations in the same batch.
- Generate trace outputs, verify selected source evidence, preserve historical
  links and propagate genuine source correction/revalidation.
- Supply selective bootstrap/pull projections and signed acknowledgments.
  Pull alone never advances the durable device cursor.

## Flutter responsibilities

1. Sign people in individually on the shared assigned device. Protect session,
   device and author secrets; never include them in telemetry or audit text.
2. Render the pinned dynamic definition and save fields/rows locally before
   reporting success. Keep each mutation's original author grant and base
   revision. The storage library is a Flutter-project decision.
3. Persist immutable batch IDs and payloads. Retry interrupted work with the
   same IDs; reconcile explicit conflicts without overwriting history. Show
   expiry, stale-template, revoked-access and lease-transfer responses clearly.
4. Atomically store snapshots/pull pages before acknowledging their signed
   tokens. Apply events idempotently by sequence, including empty filtered pages
   with `hasMore`. Prune no-longer-authorized cached dependencies on rebootstrap.
5. Remove retired outputs and refresh affected records/impact tasks. A newer
   feed event can refresh quality guidance without increasing the content
   revision; the client must not discard it solely for that reason.

## Quality guidance and connected work

Record responses include `reviewSummary.revisionId` plus `checked`, `reviewed`
and `approved`. Each contains `step`, `label`, `status` and the latest `event`
or `null`. Show `PENDING`, `CONFIRMED` and `NEEDS_CORRECTION` against that exact
content revision. Checked belongs to FSQA, Reviewed to SUPERVISOR and Approved
to PLANT_MANAGER; stages do not depend on one another. New content revisions
start pending and leave earlier events historical. Legacy Plant Manager
`CLOSE` counts as confirmation only on its recorded revision.

None of these indicators is a prerequisite for selecting an otherwise eligible
published output, including when legacy `requiresApprovalBeforeUse` is true.
Needs-correction notes guide input fixes; review does not create content
revisions, close records, retire/republish outputs or start revalidation. Real
corrections still retire affected outputs and create downstream revalidation.

An authorized online review integration sends a stable `eventId`,
`baseRevisionNo`, `step`, `action` and optional `reason` to the
[review endpoint](backend-api.md#records-traceability-and-online-review).
RETURN requires a reason; ADMIN must name a stage, while a reviewer role may
infer its own. Keep the same event ID/payload after a lost response. The
response includes `reviewEvent` for the accepted original decision and a
summary for the current revision. After correction, a replay can return an
older `reviewEvent.revisionId`; never apply that decision to newer content.
Current role and form access still apply to retries, and changed event-ID reuse
returns 409. Personnel permissions do not grant review actions.

Review and impact resolution can omit device context. If supplied, send the
complete device ID/lease/token set, which is validated; do not attach a token
header by itself. The planned online admin uses its own session/role/CSRF
boundary and never borrows the Flutter credential or takes over a lease to
review. Personnel field edits, corrections, publication and sync keep mobile
security. The admin panel and new list/history endpoints remain planned work.

A review commits its audit and `RECORD_REVISION` metadata refresh together.
Store a newer feed event's summary even if its content revision number matches
the cached revision; revision equality alone is not a duplicate-event test.
Persist that update before acknowledging the signed cursor.

## Handoff and validation

Provide safe JSON examples and API regressions for bootstrap, two authors on
one device, partial daily batches, retries after lost responses, stale versions,
revocation, lease reconciliation, selective pull/ack and actual correction
propagation through three forms. Include metadata-only guidance refreshes.

The PHP suite can prove the server contract. Durable storage, queue recovery,
mobile form rendering and APK behavior require tests/playthroughs in the
Flutter repository. Do not mark those checks complete from admin screenshots.
This repository has no personnel browser renderer, offline browser queue or
IndexedDB/PWA implementation task.
