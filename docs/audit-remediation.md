# Audit repair and acceptance map

Baseline audited: `6a38a5f96234f36c78a93d172fee7c419f9823ad`.
This change implements the audit repairs plus the requested shared form platform.
Verification results must distinguish real HTTP/SQL, pure calculations, emulated
IndexedDB, real browsers, and physical mobile devices.

| Finding | Repair | Regression evidence |
|---|---|---|
| F01 migration failure | Sealed-checksum preflight; nullable active marker/composite unique; resumable additive upgrades | migrations.py: pristine, repeat, partial, checksum and legacy cursor cases |
| F02 warehouse read-only trace dead end | Verified source selection populates protected trace values before final validation | domain_regressions.py: actual seeded WH-STOCK-RELEASE workflow |
| F03 business batch cast | Text batch IDs remain strings; numeric sync batch conversion is explicit | domain_validation.php + platform/domain HTTP tests |
| F04 provenance-only changes | Compare exact selections; retire outputs and traverse exact historical dependencies | domain HTTP three-form chain and same-code source switch |
| F05 sequence restart/collision | Stable cross-version namespace, atomic counters and legacy counter floor | domain HTTP NONE/DAILY continuity and unchanged-publication tests |
| F06 interrupted batch recovery | Durable manifests, receipt-only status read and locked audited recovery | sync_regressions.py: interruption/rotation/finalization/active-worker exclusion |
| F07 midnight retry identity | Default business date once; replay uses stored date | sync HTTP stored-date replay and changed-body rejection |
| F08 invalid immutable formula | Semantic template/rule/path/type/date validation before sealing | pure validators and domain HTTP invalid-rule cases |
| F09 effective-area access | Current period and active-area enforcement; explicit role tests | platform_integration.py: FSQA/supervisor/manager future/expired/current checks |
| F10 repeated lockout | Failure window reset, exact username identity, account/IP budgets and cleanup | platform HTTP expiry/one-typo/success sequence |
| F11 nested read-only deletion | Check protected descendants; explicit controlled removal with one-to-one prior-row matching | domain pure validation cases |
| F12 missing/stale feed metadata | Emit impact/disposition events; finalize conflict metadata before compact event | domain/platform/sync events and offline projection tests |
| F13 invalid timezone offsets | Strict datetime component/offset validation | domain_validation.php |

## Requested platform

- Shared versioned Header/Main/Summary builder and renderer, reusable field types,
  safe declarative calculations/conditions, metadata, template duplication and
  exact historical retrieval.
- Personnel PWA with encrypted IndexedDB vault, durable immutable attempted batches,
  original authors, dependency-guarded queued edits, reconnect/backoff, preserved
  conflicts, tombstones and explicit rejected-work recovery.
- Administration UI for forms, users, assignments, records/history/conflicts,
  reference-only reviews, trace-code graph, devices, sync monitor and settings.
- Multiple form memberships per device and multiple personnel devices per form;
  server revision checks arbitrate concurrent writes.
- Separate liveness/readiness, bounded request/snapshot/feed/history reads, account
  lifecycle, review notifications/preferences, backup/isolated restore and CI gates.
- Explicit multiple-records-per-form/day policy; no undocumented daily uniqueness.

## Release gates

### Local verification — 23 November 2026

The combined runner completed successfully against an isolated MariaDB 11.8.6
instance with PHP 8.4.27. It used disposable fixtures, not a live plant database.

| Gate | Result |
|---|---:|
| Installation and original-data integrity | 9 passed |
| Migration, checksum and cursor upgrades | 8 passed |
| Existing API contract and concurrency regressions | 21 passed |
| Accounts, permissions, review and online records | 8 passed |
| Dynamic forms, trace integrity and bounded history | 15 passed |
| Offline protocol and multi-device synchronization | 9 passed |
| Actual backup, isolated restore and bounded cleanup | 3 passed |
| Deterministic conversion fingerprint | 1 passed |
| Pure domain validation | 35 checks passed |
| Client schema validation/calculation checks | 29 checks; 8 PHP/JavaScript parity fixtures passed |
| Encrypted queue, recovery and local concurrency | 46 checks passed using Node WebCrypto and emulated IndexedDB |

PHP syntax and the existing template validation gate also passed. The calculation
fixture includes 1,000 rows; it is a functional/per-calculation check, not a plant
load benchmark. The original 26 template definitions and trace rules compile.

The client regressions include the cross-review fix that binds the local base
revision to the displayed draft, along with separate editor identities and local
generation guards. A newer remote feed or another tab's receipt cannot silently
rebase stale local input or replace an unqueued draft.

Local Chromium could not start because this execution environment denied its
socket operation. No local browser screenshots, physical keyboard, gesture or
fullscreen acceptance is claimed. Real browser and additional PHP/database
combinations are configured in the CI workflow and need their own passing results.

### Deployment acceptance

Run `tests/run_all.py` against each declared runtime. Run browser tests separately
with installed Playwright Chromium. Run a restore drill using the deployment's
actual backup/client combination. Then validate keyboard/focus, pinch/pan and
fullscreen on physical target devices and profile realistic data volumes.

The provided browser CI runner and device checklist are executable/operational
acceptance work, not evidence that physical-device checks occurred. Production
infrastructure, secrets and live databases are outside the repository changes.
