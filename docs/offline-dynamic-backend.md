# PPMS application architecture

PPMS has two clients and one business-rule implementation:

- `/mobile`: installable personnel PWA with a protected local vault, durable queue,
  version-pinned record entry, fullscreen document editor and sync/conflict status.
- `/admin` (also `/`): form builder, configuration, users/assignments, records,
  reference review, trace tree, synchronization monitor and settings.
- `/api/v1`: shared PHP/MySQLi services for validation, persistence, permissions,
  trace evidence and synchronization.

## Module boundaries

| Concern | Implementation |
|---|---|
| Schema grammar and authoritative calculations | `Ppms_form_validator`, `Ppms_form_engine` |
| Templates and document metadata | `Ppms_template_service` |
| Immutable data revisions / conflicts / tombstones | `Ppms_record_service` |
| Online transport and durable receipts | `Ppms_online_record_service` |
| Reference review and impact disposition | `Ppms_workflow_service` |
| Exact provenance and stable code sequences | `Ppms_trace_service` |
| Device identity, concurrent form memberships and author proofs | `Ppms_device_service` |
| Push identity, receipts and recovery | `Ppms_sync_service` |
| Paged bootstrap, feed and signed acknowledgements | `Ppms_pull_service` |
| Accounts, authorization, administrative settings | `Ppms_auth_service`, `Ppms_account_service`, `Ppms_admin_service` |
| Shared client schema / form table rendering | `public/assets/ppms/schema.js`, `renderer.js` |
| Document pan/zoom/fullscreen and keyboard visibility | `viewport.js` |
| Encrypted IndexedDB, durable queue and recovery | `offline.js` |
| Admin and personnel application orchestration | `app.js`, `admin.js`, `records.js` |

The two clients reuse the same renderer and schema definitions. Tables paginate
rendered rows rather than rebuilding the entire form on every keystroke. Calculated
summaries update without replacing the active input node. Explicit two-finger zoom
is separate from ordinary single-finger controls and scrolling. A visualViewport
listener keeps focused controls in the visible area when the keyboard changes it.

## Invariants

1. Published templates are immutable; existing and queued records retain their
   exact published version. New draft configurations are semantically validated.
2. A record write is accepted only with current permissions and the expected
   server revision. A conflict preserves both versions for a deliberate decision.
3. Original authorship is preserved on a shared physical device. A transport user
   cannot silently impersonate another author or change a sealed attempted batch.
4. Receipts and record changes commit together. Clients do not display Synced
   until the matching durable receipt has been persisted locally.
5. Provenance includes exact output identities and revisions. Equal code strings
   do not erase a changed dependency.
6. Review information is reference-only and separately versioned. Approval does
   not block normal entry, editing, saving or code selection.
7. Deletion is an audited tombstone. Unsynchronized local drafts cannot be removed
   through normal cleanup. Remote deletion preserves pending work as a conflict.
8. Snapshot/feed synchronization converges through captured stream boundaries,
   monotonic revisions, ordered metadata events and acknowledgement after local
   persistence. Each target form has its own upstream cursor.
9. Public web startup never installs/migrates a database. Upgrades are explicit,
   resumable, checksum-checked operator actions.

## Growth and operations

Record history, conflicts, trace outputs and graph traversal are bounded. Template
lists can request metadata-only pages; exact pinned versions have their own read
endpoint. Events carry compact current projections. Bootstrap avoids holding a
writer lock while assembling all records. These bounds reduce memory/transfer
amplification; they do not replace measurement with the deployment's actual data.

See [the API contract](backend-api.md), [deployment and recovery](operations.md),
and [the audit repair/acceptance map](audit-remediation.md). Tests include a
1,000-row calculated form, multi-level trace changes, concurrent/stale edits,
interrupted batches, lost responses, page/byte limits and vault quota failures.
Real phone keyboard behavior and deployment-volume profiling remain release
acceptance checks on the actual target devices and server.
