# Dynamic PPM and offline synchronization API

This is the CodeIgniter 3 / native MySQLi backend for the two root plans. All
paths below start with `/api/v1`. Responses are JSON with `Cache-Control:
no-store`. Successful requests return HTTP 200; rejected requests return
`{"error":"ERROR_CODE","details":{}}` with the appropriate HTTP status.
Batch responses contain an outcome for each mutation, including failed ones.

## Install or upgrade

For a fresh database, run `php index.php setup install`, then
`php index.php setup verify`. For both fresh and existing converted databases:

```powershell
php index.php setup migrate
```

The baseline remains 28 original application tables and 182 original default
rows, including the 26 forms. Upgrades add six runtime tables (34 total),
operation flags on `PersonnelPpmAssignment`, receipt/audit context and a unique
active-template constraint. They do not seed users or production data.

Migration one replaces the unfinished user-owned writer design with
`PpmFormDeviceLease`. If a legacy writer table exists, its leases are copied;
the legacy table is preserved but unused. Version one's implementation is
sealed because its checksum includes its PHP runner. Later SQL migrations use
independent checksums through `Ppms_schema_upgrades`. MySQL DDL implicitly
commits, so migration steps must be restartable. Web startup never migrates.

Set `APP_ENCRYPTION_KEY` to at least 32 random characters and
`PLANT_TIMEZONE` to the plant's IANA timezone, default `Asia/Manila`. Environment
variables override the ignored `application/config/local.php`.

Create individual accounts through the CLI-only provisioning command. It reads
JSON from standard input so the password is not a command-line argument:

```powershell
$account = @{
    username = 'plant.admin'
    displayName = 'Plant administrator'
    email = 'plant.admin@example.com'
    role = 'ADMIN'
    password = [System.Net.NetworkCredential]::new('', (Read-Host 'Password' -AsSecureString)).Password
}
$account | ConvertTo-Json -Compress | php index.php accounts create
$account.Clear()
```

Passwords require 12–72 bytes and are hashed with PHP's password API. Roles are
the original `ADMIN`, `PERSONNEL`, `FSQA`, `SUPERVISOR`, and `PLANT_MANAGER`.
Provisioning refuses existing usernames/emails. It never resets passwords.

## Authentication and device identity

`POST /auth/login` accepts `username` and `password`, returning `token`,
`expiresAt`, and the public `user`. Subsequent calls require:

```http
Authorization: Bearer <individual-session-token>
Content-Type: application/json
```

Sessions expire after 12 hours and can be revoked with `POST /auth/logout`.
The server checks active accounts and current permissions. Login attempts are
throttled. Only session token hashes are stored. The JSON API does not
authenticate through cookies; normal CI3 form CSRF protection remains enabled.

Register a device with `POST /devices`:

```json
{"deviceUuid":"persistent-random-device-identity","displayName":"Egg preparation station"}
```

The response contains `id` and a one-time `deviceToken`. Persist the token in
the device's protected shared storage. All sync, record publication, correction,
review and revalidation writes also require:

```http
X-PPMS-Device-Token: <registered-device-token>
```

Public device IDs and lease versions are insufficient to authorize a device.
Only the token hash is stored. Registering an existing UUID does not reissue its
secret. An administrator can issue/rotate credentials for a migrated device
using `POST /devices/{id}/credentials` with `reason`. Rotation increments its
lease version and invalidates previous author grants. Revocation uses
`POST /devices/{id}/revoke` with `reason`.

## Form and personnel configuration

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/me` | Current individual user |
| GET | `/areas` | Active area identities |
| GET | `/forms` | Forms visible to the current user, including current lease metadata |
| POST | `/forms` | Admin creates a form using `ppmCode`, `title`, and `areaId` |
| PUT | `/forms/{form}/areas/{area}` | Admin adds a non-overlapping `effectiveFrom` / optional `effectiveTo` period |
| PUT | `/forms/{form}/access/{user}` | Admin assigns boolean `canView`, `canCreate`, `canEdit`, `canPublish` flags |
| PUT | `/forms/{form}/lease` | Admin assigns `deviceId` with `expectedLeaseVersion` |

Many personnel may share one form. Each form has one authoritative device;
each device has one form. The device's `userId` identifies its registrar, not
the author of subsequent work. Replacement of an existing lease also requires
`reconciled: true` and `reason`, after local pending changes are reconciled.
The server rejects replacement while a batch is still `PUSHING`. Transfers
increment the lease version and clear the replacement device's pull cursors.

Assignments reuse `PersonnelPpmAssignment`; there is no duplicate user-access
table. Inactive accounts, inaccessible forms, revoked devices and stale leases
cannot authorize new writes. Reviewer roles require form/area view access;
personnel permissions do not confer review roles.

## Dynamic template definitions

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/forms/{form}/templates` | Published versions; admins also see drafts |
| POST | `/forms/{form}/templates` | Admin creates a numbered draft with `definitionJson` |
| PATCH | `/templates/{id}` | Admin changes a draft with `definitionJson` and `expectedDefinitionHash` |
| PUT | `/templates/{id}/rules` | Admin replaces a draft's `rules` array |
| POST | `/templates/{id}/publish` | Publish immediately; body `{}` |
| PUT | `/forms/{form}/connections` | Configure a source output to target input relationship |

A simple definition is:

```json
{
  "fields": [
    {"key":"supplier","label":"Supplier","type":"text","required":true},
    {"key":"temperature","label":"Temperature","type":"number","validation":{"min":0,"max":100}},
    {"key":"accepted","label":"Accepted?","type":"boolean","required":true},
    {"key":"entries","label":"Readings","type":"repeatable","minRows":1,"maxRows":100,
     "fields":[{"key":"reading","label":"Reading","type":"number","required":true}]}
  ]
}
```

Sectioned definitions may instead use `schemaVersion: 1`, `title`, and
`sections: [{key,label,items:[...]}]`. Field/group keys must be unique in their
scope. Supported scalar types are `text`, `textarea`, `number`, `integer`,
`boolean`, `date`, `time`, `datetime`, `select`, `multiselect`, and `trace-code`.
`group` contains an object; `table` and `repeatable` contain arrays of row objects.
Nested groups have a maximum depth of three. Select options are strings or
`{value,label}` objects. Validation supports `min`, `max`, `step`, `minLength`,
`maxLength`, and bounded regular-expression `pattern` checks. Defaults must
match the field type. Trace-code defaults are prohibited. Read-only values may
only be initially supplied as their configured default and cannot then change.

Draft records may be incomplete; values supplied must have valid types and
known keys. Submit/publication require all required values and row minima.
Zero and `false` count as supplied values. Unknown fields are rejected.

Publishing deactivates the previous version transactionally. Published
definitions and trace-code rules cannot be edited. New records require the
active, effective, published version; stale offline creates return
`TEMPLATE_STALE_OR_UNPUBLISHED`. Existing records remain pinned to their exact
version. A new form or ordinary field change needs configuration, not a new
form-specific SQL table. Existing controlled default definitions are preserved;
the backend does not invent missing production fields or activate pending rules.

## Shared offline authorship and daily batches

On each individual sign-in on the assigned device, request `POST /sync/grants`:

```json
{"ppmFormId":"form-id","deviceId":"device-id","leaseVersion":1}
```

The signed `authorProof` binds that user, device, form, lease version and expiry.
Its access window follows `offline.maxAccessHours` (default 24 hours, bounded to
1–168). Each queued mutation must retain its original user's proof. A batch
uploader may submit mutations from several users; it never becomes their author.
Current user permissions and device leases are revalidated for every mutation.
The proof is confidential; never write it into audit messages or telemetry.

Push an immutable batch with `POST /sync/batches`:

```json
{
  "id":"client-generated-batch-id",
  "ppmFormId":"form-id",
  "deviceId":"device-id",
  "leaseVersion":1,
  "businessDate":"2026-10-23",
  "mutations":[{
    "clientMutationId":"client-generated-operation-id",
    "userId":"original-author-id",
    "authorProof":"signed-original-author-proof",
    "operationType":"CREATE_DRAFT",
    "recordId":"client-generated-record-id",
    "baseRevisionNo":0,
    "templateVersionId":"published-template-id",
    "areaPpmAssignmentId":"effective-area-assignment-id",
    "productionDate":"2026-10-23",
    "dataJson":{"supplier":"Example","temperature":82.5,"accepted":false}
  }]
}
```

Omitting `businessDate` uses the configured plant timezone. Historical dates are
allowed. Several batches per form/date receive increasing server batch numbers.
`sync.batchSize` bounds each request (default 50). Every mutation runs in its own
transaction, including its receipt, revision, trace checks, audit and change-feed
events. One rejection or revision conflict does not roll back valid operations.
Outcomes are `APPLIED`, `CONFLICT`, or `REJECTED`; batch states include
`ACCEPTED`, `PARTIAL`, `CONFLICTED`, and `REJECTED`.

Supported mutation types:

- `CREATE_DRAFT`: base zero, pinned template/area/date and an object `dataJson`.
- `UPDATE_DRAFT`: expected base revision and replacement object `dataJson`.
  Missing fields are removed; this is not JSON Merge Patch.
- `QUEUE_SUBMIT`: expected base revision; submits the saved revision's data.
- `CONFLICT_RESOLUTION`: `conflictId`, current base, `resolutionType`, and
  `reason`; `MANUAL_MERGE` additionally supplies complete replacement `dataJson`.

The same authenticated author may omit `authorProof` for an online mutation;
the device credential is still required. Different authors require their signed
proof. Tombstone/attachment operations are rejected until implemented.

Repeated batch/mutation IDs return their original stored result when the owner
and canonical payload match. JSON object-key order does not change identity.
Reusing an ID with another owner, device or payload is rejected. Server revision
numbers are authoritative. Conflicts persist the local command and server base;
resolution supports `KEEP_SERVER`, `APPLY_LOCAL_AS_NEW_REVISION`, and
`MANUAL_MERGE`, using the same permission, template and lifecycle checks.

## Records, traceability and online review

`GET /records/{id}` returns metadata, the current revision, immutable revision
history, exact source links and revalidation items. It requires form access.

`POST /records/{id}/corrections` takes `deviceId`, `leaseVersion`,
`baseRevisionNo`, `reason`, replacement `dataJson`, and optional
`traceSelections`. It appends a corrected revision and returns the record to
`ACTIVE`. Closed/archived records cannot be changed. Relevant output retirement
preserves old links and recursively creates revalidation items and retirement
events throughout the downstream record chain.

`POST /records/{id}/publish` takes the same device/base fields and requires
`canPublish` (or admin), a submitted/reviewed record, valid current source links,
and no outstanding revalidation. Publication is idempotent per revision.

Rules support `SYSTEM_GENERATED`, `MANUAL_EXTERNAL`, `SCAN_EXTERNAL`, and
`UPSTREAM_LOOKUP`. Pending rules cannot publish. Example generated rule:

```json
{"rules":[{
  "outputKey":"lotCode","outputLabel":"Lot","status":"ACTIVE",
  "sourceType":"SYSTEM_GENERATED","formulaTemplate":"LOT-{{record.productionDate}}-{{sequence}}",
  "resetPeriod":"DAILY","sequencePadding":3,"requiresUniqueBusinessCode":true,
  "configurationJson":{"bindings":{"record.productionDate":{"source":"RECORD","path":"productionDate","format":"YYYYMMDD"}}}
}]}
```

Bindings use `DATA`, `RECORD`, `LITERAL` or `SEQUENCE`. Supported formats are
`RAW`, `TRIM`, `UPPERCASE`, `LOWERCASE`, `INITIAL`, `DDMMYY`, `DDMMMYY`,
`MMDDYY`, and `YYYYMMDD`. Configured paths may use repeatable rows, such as
`entries[].code`. Uniqueness covers other records and duplicate rows of the
same revision. Sequence counters, output creation and audit commit together.

A trace connection accepts `sourcePpmFormId`, `sourceOutputKey`,
`targetInputKey`, `connectionName`, `status`, and boolean
`requiresApprovalBeforeUse`. Only active connections are selectable. Record
mutations select an existing published output using:

```json
{"traceSelections":[{
  "connectionId":"connection-id","sourceTraceOutputId":"published-output-id",
  "inputPath":"sourceLot"
}]}
```

For a row, use a concrete path such as `entries.0.sourceLot`; configuration uses
`entries[].sourceLot`. The data value must equal the verified source code.
Unchanged selections carry forward through new revisions only after current
eligibility checks. Typing a code does not create evidence of its source.

`POST /records/{id}/review` takes device/base fields, `action` (`APPROVE` or
`RETURN`) and `reason`. Decisions require online validation. FSQA, Supervisor,
and Plant Manager approvals proceed through the original statuses to `CLOSED`;
an admin may perform each step. Each decision appends a revision and workflow
event. Returns preserve history and retire affected published outputs.

`GET /forms/{id}/revalidations` exposes authorized impact item IDs and reasons.
`POST /revalidations/items/{id}/resolve` takes device/base fields, `notes` and
`decision`: `REPLACED_SOURCE` requires a current eligible replacement link;
`ACCEPT_HISTORICAL` requires a closed record. Only an authorized reviewer/admin
can resolve an item. A parent resolves once all its items are resolved.

## Selective pull protocol

`POST /sync/bootstrap` takes form/device/lease fields and returns the form's
published templates, personnel permissions, area assignments, recent records,
trace connections, and eligible upstream output projections. Other forms' raw
records/templates are not exposed. The cache horizon follows
`offline.maxCachedRecordDays`, default seven days. Each source includes a
signed `cursorToken` representing the snapshot's event boundary.

`POST /sync/pull` additionally takes `sourcePpmFormId`, optional
`afterSequence` and `limit` (1–500). A device may read its own stream and direct
active upstream dependencies. Upstream streams expose only configured trace
outputs and retirements. Sequences are decimal strings. The response contains
`events`, `nextSequence`, `hasMore`, and `cursorToken`. Filtered pages may be
empty while `hasMore` is true.

The client must atomically persist each page/snapshot before sending its token
to `POST /sync/ack`, using the same device/form/lease fields. Pulling does not
advance `SyncPullCursor`. Signed acknowledgments cannot forge skipped ranges;
cursors move forward only and are shared by all users on that device.

The client must apply events idempotently, replace active-template flags on a
publication event, remove retired outputs, and refresh affected record/impact
details after upstream retirement. Re-bootstrap when assignments or dependency
configuration change, pruning no-longer-authorized cache entries. Save drafts
and mutation queues durably, preserve original author proofs, retry interrupted
`PUSHING` batches with the same ID/payload, and enforce offline grant expiry.
The browser renderer, IndexedDB transactions and queue implementation are not
part of these backend changes.

## Verification

```powershell
php tests/validation.php
python tests/conversion.py
python tests/run_with_mariadb.py
```

The last command starts a private temporary MariaDB server using XAMPP's
`mysql_install_db.exe`/`mysqld.exe`, runs installer, migration and HTTP suites,
then shuts it down and removes its own temporary directory. `MARIADB_BIN` can
select another compatible binary directory. No Windows service or configured
application database is changed. To use a separately managed test server, run
the three Python suites individually with `DB_HOST`, `DB_PORT`, `DB_USERNAME`,
and `DB_PASSWORD`; each creates and drops only its disposable test database.
