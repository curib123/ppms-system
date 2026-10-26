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

The revised contract shows Checked, Reviewed and Approved against the exact
content revision. None is a prerequisite for selecting an otherwise eligible
published output, including when legacy `requiresApprovalBeforeUse` is true.
Needs-correction notes guide input fixes; notes alone do not retire outputs.
New content revisions leave previous guidance historical. Real corrections
still retire affected outputs and create downstream revalidation.

This is the target of Task 2, not a claim that current review code is complete.
The online admin uses its own session/role/CSRF boundary for review and never
borrows the Flutter device credential or takes over a lease for that action.
Personnel field edits, corrections, publication and sync keep mobile security.

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
