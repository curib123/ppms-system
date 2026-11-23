# PPMS REST API v1

The personnel PWA (`/mobile`) and administration application (`/admin`, also `/`)
use the same `/api/v1` API. PHP services own permissions, schema validation,
calculations, record revisions, trace provenance and review decisions. Neither
client has a second business-rule implementation that can authorize a write.
Client calculations are immediate previews; the server recomputes persisted totals.

## Setup and transport

Run `setup install` only against a new empty database, then `setup migrate`.
For an existing converted database, pause writes and run only `setup migrate`.
The original first migration remains sealed; the upgrade wrapper repairs the
active-template constraint before invoking it. Later migrations add reference
reviews, stable sequences, recovery manifests, account grant versions and
form-scoped pull cursors without replacing baseline data.

All write bodies are JSON objects with `Content-Type: application/json`. Requests
are bounded to 2 MiB before the application reads the complete body. Configure the
same or a lower limit at the reverse proxy. API responses are `no-store` JSON and
include `X-Request-ID`. Failures use `{error, details}`; unexpected failures expose
`SERVICE_UNAVAILABLE` with a correlation ID, never SQL or credentials.

`POST /auth/login` takes `{username,password}` and returns `{token,expiresAt,user}`.
Send `Authorization: Bearer <token>` thereafter. Username identity is case-sensitive.
Sessions have a 12-hour maximum and 30-minute sliding inactivity expiry. Passwords
are 12–72 bytes; account creation is available through the CLI bootstrap or an
administrator. Bearer tokens stay in client memory, not localStorage or the service
worker cache. Production requires HTTPS. `GET /ready` checks database, migration
checksums, signing configuration and timezone; `/health` is only baseline liveness.

## Endpoint map

| Method and path | Purpose / input |
|---|---|
| `GET /me`, `POST /auth/logout` | Current user and logout |
| `POST /auth/password` | `{currentPassword,newPassword}`; revokes sessions and outstanding author grants |
| `GET /users` | Admin search and pagination: `q,page,limit` |
| `POST /users` | Admin creates `{username,email,displayName,role,password}` |
| `PATCH /users/{id}` | Admin edits name/email/role/accountStatus; cannot remove the last active admin |
| `POST /users/{id}/reset-password` | Admin `{newPassword}`; revokes access |
| `POST /users/{id}/revoke-sessions` | Admin revokes sessions and original-author grants |
| `PUT /users/{id}/areas/{areaId}` | Admin reviewer-area assignment `{isActive}` |
| `GET /forms`, `GET /areas` | Authorized forms, permissions, current assignments and active template; active areas |
| `POST /forms` | Admin `{ppmCode,title,areaId}` |
| `PATCH /forms/{id}` | Admin `{expectedUpdatedAt,title?,status?,description?,sortOrder?}` |
| `GET /forms/{id}/assignments` | Current areas, personnel permissions and device memberships; admins see assignment history |
| `PUT /forms/{id}/areas/{areaId}` | Create a non-overlapping assignment period `{effectiveFrom,effectiveTo?}` (dates) |
| `PUT /forms/{id}/access/{userId}` | Admin `{canView,canCreate,canEdit,canPublish}` |
| `GET /forms/{id}/templates` | Bounded `page,limit,summary=true`; default 10 / max 20; summary omits definitions |
| `GET /templates/{id}` | Exact authorized historical/published template for a pinned record |
| `POST /forms/{id}/templates` | Create draft `{definitionJson,...documentMetadata}` |
| `PATCH /templates/{id}` | Draft-only change with `expectedDefinitionHash` |
| `POST /templates/{id}/duplicate` | Create a new draft from a reusable version |
| `POST /templates/{id}/publish` | Semantic validation then immutable publication |
| `GET/PUT /templates/{id}/rules` | Read/replace trace rules, writes only while draft |
| `GET/PUT /forms/{id}/connections` | Read/configure source relationships; max 64 active incoming connections |
| `GET /forms/{id}/trace-inputs` | Bounded eligible source choices, connections and outputs |
| `GET /records` | Authorized metadata search: `ppmFormId` (or `formId`), `q,status,reviewStatus,page,limit,includeDeleted`; follow `nextOffset` |
| `GET /records/{id}` | Current record, pinned revision, current trace links, review reference and bounded history |
| `GET /records/{id}/history` | Byte-bounded immutable revisions; follow `nextBeforeRevisionNo` |
| `GET /records/{id}/conflicts` | Paginated conflicts including preserved local payloads, restricted to authorized form users |
| `POST /records` | Online create, durable mutation receipt |
| `PATCH /records/{id}` | Online edit with expected base revision |
| `POST /records/{id}/submit` | Validate required fields and submit |
| `DELETE /records/{id}` | Authorized audited tombstone; does not erase revisions/receipts |
| `POST /records/{id}/resolve-conflict` | Explicit keep-server, apply-local-as-new or manual merge |
| `POST /records/{id}/publish` | Publish configured trace outputs; `baseRevisionNo` required |
| `POST /records/{id}/corrections` | Explicit correction with `baseRevisionNo,reason,dataJson,traceSelections?` |
| `POST /records/{id}/review` | Simple versioned reference review, independent of editing |
| `GET /forms/{id}/revalidations` | Bounded impacts; optional `recordId` filter |
| `POST /revalidations/items/{id}/resolve` | Reviewer disposition with `baseRevisionNo,decision,notes` |
| `GET /trace?q=...` | Authorized trace-code search |
| `GET /trace/outputs/{id}/tree` | Bounded exact-provenance graph: `root,nodes,edges,truncated` |
| `GET/POST /devices` | Monitor/register devices; registration returns its secret once |
| `PUT /forms/{id}/lease` | Authorize a device membership for a form |
| `POST /devices/{id}/credentials` | Audited admin rotation; advances all device form leases |
| `POST /devices/{id}/revoke` | Audited device revocation |
| `POST /sync/grants` | Original-author proof for current user/form/device/lease |
| `POST /sync/batches` | Immutable idempotent offline batch |
| `GET /sync/batches` | Admin bounded monitor |
| `GET /sync/batches/{id}` | Owner/admin durable outcome read, including after credential rotation |
| `POST /sync/batches/{id}/recover` | Admin reconciles an interrupted batch from durable receipts |
| `POST /sync/bootstrap`, `/sync/pull`, `/sync/ack` | Paged snapshot, bounded events, signed durable acknowledgement |
| `GET/PUT /settings` | Admin non-sensitive typed configuration with optimistic `expectedUpdatedAt` |
| `GET /audit`, `/jobs` | Bounded admin history and operational job status |
| `GET/PUT /preferences` | User appearance/list preferences |
| `GET /notifications`, `PATCH /notifications/{id}/read` | User's own review notifications |

`ADMIN`, `PERSONNEL`, `FSQA`, `SUPERVISOR`, and `PLANT_MANAGER` retain the original
role enum. Assignments add explicit form permissions. Reviewer area access requires
an active production area and a currently effective form-area assignment. A current
assignment grants access to historical records in that form; expired assignments do
not independently grant current review authority.

## Three-section dynamic schema

New forms use `schemaVersion: 2` and exactly `header`, `main`, `summary` sections.
Legacy `fields` and `sections` definitions remain readable through the same engine.
Document number, revision number, series, page and source-file hash are version
metadata and are preserved when duplicating templates.

```json
{
  "schemaVersion": 2,
  "sections": [
    {"key":"header","label":"Production","items":[
      {"key":"operator","label":"Operator","type":"text","required":true}
    ]},
    {"key":"main","label":"Entries","items":[
      {"key":"rows","label":"Items","type":"repeatable","maxRows":1000,"fields":[
        {"key":"quantity","label":"Quantity","type":"number","validation":{"min":0}},
        {"key":"unitPrice","label":"Unit price","type":"number","validation":{"min":0}},
        {"key":"amount","label":"Amount","type":"number","readOnly":true,
         "calculation":{"op":"multiply","args":[{"path":"quantity"},{"path":"unitPrice"}]}}
      ]}
    ]},
    {"key":"summary","label":"Totals","items":[
      {"key":"total","label":"Total amount","type":"number","readOnly":true,
       "calculation":{"op":"sum","path":"rows[].amount"}}
    ]}
  ]
}
```

Supported input components include text, textarea, integer/number, date/datetime,
boolean, select/multiselect, groups, repeatable tables and trace-code selections.
Calculations use a bounded declarative expression tree, never JavaScript/PHP code
or `eval`. Conditions use `visibleWhen` / `requiredWhen` with structured operators
such as `{path:"quantity",operator:"gt",value:0}`. Formula references, cycles,
unknown fields and incompatible paths are rejected before publication. The server
calculates protected outputs; it rejects edits/deletion of protected stored values
unless the definition explicitly allows the relevant container removal.

## Online records and reference review

Every online write supplies a fresh globally unique `clientMutationId`; retry the
same attempted payload with the same ID. Changed intent must use a new ID.

```json
{
  "ppmFormId":"form-id", "recordId":"client-generated-uuid",
  "clientMutationId":"client-generated-mutation-uuid", "baseRevisionNo":0,
  "templateVersionId":"published-version-id", "areaPpmAssignmentId":"assignment-id",
  "productionDate":"2026-11-23", "batchNo":"BATCH-0007",
  "dataJson":{"operator":"Personnel","rows":[{"quantity":2,"unitPrice":5}]}
}
```

Online write responses are `{result,record}`. A successful HTTP response can contain
`result.status: CONFLICT` or `REJECTED`; clients must inspect it before claiming
success. An `APPLIED` result is emitted only after the receipt and record commit.
The online adapter calls the same record service as offline sync and uses a
server-managed WEB_API identity without taking the personnel device's form lease.

Multiple independent records per form/day are allowed. `dailyKey` is retained for
legacy data; no implicit one-sheet/day constraint is imposed. Synchronization batch
numbers are separate numeric sequences; business `batchNo` values remain strings.

Review input uses `status` (`PENDING_REVIEW`, `UNDER_REVIEW`, `APPROVED`,
`RETURNED_FOR_REVISION`), `reviewerName`, `reviewerPosition`, `remarks`,
`expectedRevisionNo` and `expectedReviewVersion` (0 before the first review).
Review time is server-set, and the actual actor is audited. Reference decisions do
not create a new data revision or require a writer device. Later edits remain
allowed and reset the current reference to pending while retaining history.
Legacy staged approval fields/flags remain in storage for compatibility; approval
is no longer a gate on normal editing or trace selection.

## Trace relationships and safe numbering

A selection contains `{connectionId,sourceTraceOutputId,inputPath}`. The server
verifies the exact source, fills protected trace values, and stores the precise
source output and downstream revision relationship. Equal displayed codes are not
equal provenance. Changing the selected source retires dependent output evidence
and emits downstream impact events even if displayed data is unchanged.

Published output sequences use a stable namespace across template versions. The
namespace includes the form, output key, reset period and optional explicit
sequence namespace. Legacy counters remain intact and seed the stable counter's
floor. Revalidation dispositions and conflict reasons are committed before their
compact feed event. Full history is paginated separately; events do not duplicate
all preceding revisions. Record reads include at most 256 KiB of compatibility
history and report `historyHasMore`. `/records` defaults to metadata-only
`summary=true`; fetch an exact record when opening the editor. Optional
`summary=false` lists and `/history` use a 1 MiB default byte budget with a 4 MiB
ceiling (one bounded first item may exceed the requested page budget). Follow
`nextOffset` on record lists and `nextBeforeRevisionNo` on history to avoid
skipping items when the byte budget shortens a page.

## Offline protocol and recovery

One physical device may hold memberships for several assigned forms, and several
authorized devices may edit the same form. Each (form,device) membership has its
own monotonic lease version; server record revisions detect competing edits.
Authorizing a new device uses expectedLeaseVersion 0 and does not revoke others.
Reissuing an existing membership requires its exact current version and recovery
of any interrupted work for that pair. Cursor identity is
`(deviceId, targetPpmFormId, sourcePpmFormId)`; one form cannot acknowledge away
another form's upstream changes. Credential rotation/revocation serializes on the
device and advances every affected form lease.

Device requests carry `X-PPMS-Device-Token` plus `deviceId,ppmFormId,leaseVersion`.
Author grants additionally bind user, expiry and `authVersion`; password resets,
revoke-all and account permission changes invalidate old grants. New writes always
recheck current permissions. Previously committed receipts remain immutable.

A batch contains `id,ppmFormId,deviceId,leaseVersion,businessDate?,mutations`.
Supported operations include `CREATE_DRAFT`, `UPDATE_DRAFT`, `QUEUE_SUBMIT`,
`CONFLICT_RESOLUTION`, and `DELETE_RECORD`. Each mutation has `clientMutationId`,
`recordId`, `userId`, `baseRevisionNo`, and its original `authorProof` where needed.
Offline creations may use a historical **published** version; draft/unpublished
versions cannot be used. Existing records never silently switch schemas.

When `businessDate` is omitted, the server chooses it once and reuses it for retry.
The client seals an immutable batch before its first attempt and retains it until a
matching durable server result is stored locally. The editable local base revision
is tied to the displayed draft; a background pull cannot advance that base while
retaining older local input. A later queued edit can specify
`dependsOnMutationId`; it applies only if that predecessor committed for the same
record, form, device and author at the expected revision. This prevents a later
predicted revision from overwriting data after an earlier conflict.

Bootstrap is paginated with signed short-lived `pageToken`s and bounded record,
template and output pages. It captures initial stream boundaries, not an open
multi-request SQL transaction. Clients merge snapshots by server revision and then
replay events after those boundaries. Equal data revisions can carry newer review
or impact metadata, ordered by server event sequence. Only the final page returns
acknowledgeable boundaries. Pull also limits response bytes; apply each page and
cursor atomically in IndexedDB before `/sync/ack`.

For an interrupted `PUSHING` batch, an administrator sends
`{action:"FINALIZE",reason,expectedPayloadHash}` to its recovery endpoint. Active
workers are excluded by the batch lock. Recovery reconstructs matching outcomes
from immutable receipts and explicitly identifies unprocessed work; it does not
pretend those mutations committed. The client retains failed/unresolved drafts for
review and requeue. A lost HTTP response can be retried without duplicate records.

The mobile vault encrypts records, cached definitions, device secrets, author
proofs, queue and attempted batches with WebCrypto and a user unlock passphrase.
The passphrase/derived key is not persisted. Do not clear browser storage to resolve
an error: it can destroy unsynchronized work. Export the encrypted vault first.
Sync runs on reconnect/backoff while the application is open, signed in and the
vault is unlocked. Closing an app does not grant a service worker credentials to
silently act as a user. Cross-device conflicts preserve local and server versions
for explicit resolution; device timestamps never choose the winner.
