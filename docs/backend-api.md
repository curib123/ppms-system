# PPMS REST API: current contract

This is the CodeIgniter 3 / native MySQLi backend for the Flutter personnel
client. The planned browser admin panel calls the same domain services. All
paths below start with `/api/v1`. Responses are JSON with `Cache-Control:
no-store`. Successful requests return HTTP 200; rejected requests return
`{"error":"ERROR_CODE","details":{}}` with the appropriate HTTP status.
Batch responses contain an outcome for each mutation, including failed ones.

## Revised direction and delivery status

The [active plan](superpowers/plans/2026-10-26-simple-trackable-backend.md) and
[design](superpowers/specs/2026-10-26-simple-trackable-backend-design.md) define
the delivery work. This guide records the current REST service contract. The
online admin panel and new list/history endpoints remain planned work.

Review is informational and revision-specific. Missing checks, review,
approval or a correction-request note do not block otherwise eligible connected
trace work. Review appends a workflow event without creating a content revision,
closing a record or retiring outputs. Actual content corrections retain trace
revalidation. The legacy approval flag no longer gates source discovery, use
or replacement.

This behavior reuses `WorkflowEvent` and the existing lifecycle enums; it
requires no schema migration or changes to canonical default data.

Authorized online review and revalidation decisions can omit mobile device
context. Mobile sync/edit/correct/publish retain their device credentials and
lease checks. The planned admin panel adds its own session/CSRF boundary around
these shared services; its browser routes are not yet available.

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
the legacy table is preserved but unused. A compatibility upgrade adds missing
service fields to experimental daily-batch tables without removing their rows.
Old batches remain historical; send new work with fresh batch IDs.
Version one's implementation is
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
the device's protected shared storage. Sync, record publication and correction
writes require device credentials. The header is:

```http
X-PPMS-Device-Token: <registered-device-token>
```

Review and revalidation decisions require a current reviewer role and form
access, but no mobile credential when device context is omitted. If supplied,
include both `deviceId` and `leaseVersion` in the body plus this header; the
server validates device possession and the current form lease. A token header
without either body field returns HTTP 400 (`DEVICE_CONTEXT_REQUIRED`); partial
body context returns 422. Missing/invalid credentials or a stale lease return
403. Reviewing a record never transfers the personnel device's lease.

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
Reusing an ID with another owner, device or payload is rejected.
An already committed receipt can be replayed after its author grant expires;
this reads history and still requires current uploader access/device credentials.
Server revision numbers are authoritative. Conflicts persist the local command and server base;
resolution supports `KEEP_SERVER`, `APPLY_LOCAL_AS_NEW_REVISION`, and
`MANUAL_MERGE`, using the same permission, template and lifecycle checks.

## Records, traceability and online review

`GET /records/{id}` returns metadata, the current revision, immutable revision
history, `reviewSummary`, exact source links and revalidation items. It requires
form access. The summary belongs to the current content revision, with this
shape:

```json
{
  "revisionId":"content-revision-id",
  "checked":{"step":"FSQA_REVIEW","label":"Checked","status":"PENDING","event":null},
  "reviewed":{"step":"SUPERVISOR_REVIEW","label":"Reviewed","status":"PENDING","event":null},
  "approved":{"step":"PLANT_MANAGER_REVIEW","label":"Approved","status":"PENDING","event":null}
}
```

Each indicator is `PENDING`, `CONFIRMED` or `NEEDS_CORRECTION`. Its `event` is
the latest applicable `WorkflowEvent` for that exact revision and stage, or
`null`. Earlier events remain historical. A new content revision starts with
pending indicators; confirmation never carries onto changed content. A legacy
`PLANT_MANAGER_REVIEW` event with action `CLOSE` counts as confirmation on its
recorded revision only. Existing closed records remain closed.

`POST /records/{id}/corrections` takes `deviceId`, `leaseVersion`,
`baseRevisionNo`, `reason`, replacement `dataJson`, and optional
`traceSelections`. It appends a corrected revision and returns the record to
`ACTIVE`. Closed/archived records cannot be changed. Relevant output retirement
preserves old links and recursively creates revalidation items and retirement
events throughout the downstream record chain.

`POST /records/{id}/publish` takes the same device/base fields and requires
`canPublish` (or admin), a submitted record (or compatible legacy approval/closed
lifecycle state), valid current source links and no outstanding revalidation.
Publication is idempotent per revision; quality review is not a prerequisite.

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
`requiresApprovalBeforeUse`. The last field is retained as inert compatibility
metadata, including when true. Only active connections are selectable. Valid
submitted sources may publish before any quality review; pending or
needs-correction indicators do not remove otherwise eligible outputs from
bootstrap, incremental pull, trace selection or replacement-source validation.
Publication, matching code/input path, current permissions, output eligibility
and genuine revalidation checks still apply. Record mutations select an existing
published output using:

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

`POST /records/{id}/review` requires an online bearer-authenticated reviewer,
current form access, and a stable client-generated `eventId`:

```json
{
  "eventId":"client-generated-review-event-id",
  "baseRevisionNo":2,
  "step":"FSQA_REVIEW",
  "action":"RETURN",
  "reason":"Check the spelling of the supplier name"
}
```

| Indicator | Step | Permitted role |
| --- | --- | --- |
| Checked | `FSQA_REVIEW` | FSQA or ADMIN |
| Reviewed | `SUPERVISOR_REVIEW` | SUPERVISOR or ADMIN |
| Approved | `PLANT_MANAGER_REVIEW` | PLANT_MANAGER or ADMIN |

Stages are independent; a supervisor may review while Checked is still
pending. Reviewers may omit `step` to infer their own stage. ADMIN must provide
it or receive 422 (`REVIEW_STEP_REQUIRED`). `APPROVE` confirms that stage and
may omit `reason`; `RETURN` requires a nonempty reason of at most 2,000
characters and marks that stage `NEEDS_CORRECTION`. New decisions on drafts,
closed or archived records return 409 (`RECORD_NOT_REVIEWABLE`).

The response keeps the normal record view and adds `reviewEvent`, the accepted
event with its `id`, `recordId`, `revisionId`, `step`, `action`, `actorId`,
`reason` and `createdAt`. `reviewSummary` describes the current revision. A
review-only decision changes neither record lifecycle nor content revision,
data, trace links or published outputs. It does not close, retire, republish or
create downstream revalidation work. A correction-request note guides the
personnel correction flow; an actual data correction still appends content
history, retires affected outputs and propagates genuine downstream impacts.

Reuse the same `eventId` and payload after a lost response. Current identity,
access and reviewer role are checked first. The stored event is then compared
before the current-revision precondition: identical actor, record, base
revision, stage, action and reason return the original event without duplicate
writes. This also works after a later correction, returning the old
`reviewEvent.revisionId` alongside the current revision and its summary; it
does not review the newer content. Different payload/actor/record reuse returns
409 (`REVIEW_EVENT_REUSED`). A new event with a stale base returns 409
(`REVISION_CHANGED`).

The workflow event, audit entry and `RECORD_REVISION` change-feed entry commit
together. This metadata refresh may carry the same content revision number
with an updated `reviewSummary`. Apply it by feed sequence, not by revision
number alone. It emits no trace-publication event.

`GET /forms/{id}/revalidations` exposes authorized impact item IDs and reasons.
`POST /revalidations/items/{id}/resolve` takes `baseRevisionNo`, `notes` and
`decision`, with optional complete device context as described above.
`REPLACED_SOURCE` requires a current eligible replacement link, without an
approval prerequisite. `ACCEPT_HISTORICAL` requires a closed record. Only an
authorized reviewer/admin can resolve an item. A parent resolves once all its
items are resolved.
Finalized impact dispositions cannot be overwritten.

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
These are Flutter responsibilities: dynamic rendering, durable local storage,
mutation queue, original-author preservation and applying review refresh events
by feed sequence even when the content revision does not change. See the
[Flutter contract](flutter-client-contract.md). The online admin panel does not
implement a second offline personnel client.

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

Historical baseline verification on 2026-10-23 with PHP 8.0.30 and disposable MariaDB 10.4.32:
35 Python test cases passed, including concurrent publication, cross-form
mutation-ID reuse, legacy batch upgrades and three-form trace invalidation.
Application PHP syntax checks and the standalone field-validation checks passed.
These historical results do not verify the revised plan or current local edits.

Task 2 verification on 2026-10-26: 9 installer, 4 migration and 29 API cases
passed against disposable MariaDB, including independent review, replay after
correction, atomic feed rollback, concurrent writes and trace use with both
legacy flag values. Disabled outputs, unrelated upstream streams and draft
publication remain rejected. Routing (1,074 assertions), field validation,
conversion integrity and 15 quality-runner tests passed. Syntax checks covered
58 PHP and 8 Python files; real Topos parsed all 8 supported files. These checks
verify the REST change, not a delivered admin UI or Flutter storage behavior.
