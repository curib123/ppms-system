# Offline synchronization and dynamic PPM backend

Implement the two root plans in the CodeIgniter 3 application using native
MySQLi. Keep the original 26 forms, seeds, names, roles and workflow states.
The browser's IndexedDB database, renderer and mutation queue are outside this
database/model/service/controller change.

## Implementation sequence

1. Restore reproducible baseline SQL and add repeatable, CLI-only upgrade
   migrations. Replace the unfinished writer lease with a device lease, reuse
   personnel assignments with operation permissions, and persist batches,
   mutation attribution, change events and per-device cursors.
2. Add database models, bearer session authentication, shared-device leases,
   assignment checks and signed offline author grants. The device registrar is
   not the author of subsequent users' work. Lease transfers require explicit
   reconciliation and invalidate old grants.
3. Add dynamic template validation and immutable publication. Validate records
   against their pinned template version, append revisions and field changes,
   and preserve workflow/audit history. Published versions are never edited.
4. Add daily batch processing with canonical payload hashes, per-mutation
   transactions, original author attribution, retry receipts, revision conflicts
   and explicit authorized resolution. Use the configured plant timezone for
   dates; permit multiple numbered batches per day.
5. Add server-controlled trace publication, revision-specific eligible links,
   downstream revalidation, selective bootstrap/pull and signed cursor
   acknowledgments. A pull does not advance the stored cursor.
6. Exercise the API against disposable MariaDB databases, including two users
   on a shared device, retries, stale revisions, revoked permissions/devices,
   template validation, trace eligibility and durable cursor acknowledgments.
   Document requests, migration commands and client responsibilities.

## Decisions

- Execute in the current checkout on `feature/offline-dynamic-ppm-api`, leaving
  sibling repositories alone. Commit each complete change with its checks.
- Preserve `database/schema.sql` and its manifest as the converted baseline;
  install runtime extensions through versioned MySQL migrations. Never run
  archived PostgreSQL migrations or modify a configured operational database.
- JSON API authentication uses an explicit Authorization bearer header. JSON
  writes do not use browser cookies. Offline grants bind the person, device,
  form, lease version and expiry and are checked against current permissions.
- Serialize writes through the owning form row, then check leases/revisions
  inside the same transaction. Keep change-feed sequence allocation in that
  transaction so a per-form cursor cannot skip a later commit.
- An old published template remains readable, but new records require its
  active effective version. Existing records keep their original template.
- Drafts allow incomplete required fields; submit/publication require complete
  template validation. Unknown fields and unsupported definitions are rejected.
- Trace-critical edits retire old outputs, retain historical links and create
  revalidation items. Resolution cannot bypass record lifecycle rules.

## Verification

Use PHP syntax checks and Python standard-library integration tests against a
temporary MariaDB data directory on a loopback-only ephemeral port. Run the
original installer/private-file tests as well as the new API tests. The helper
owns and removes only the temporary database directory it created.
