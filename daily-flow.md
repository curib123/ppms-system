# PPMS Finalized Schema and Sync Architecture

For your PPMS system with 26 forms, one assigned account and device per form, daily synchronization, and traceability between forms, I recommend a combination of:

* Single-writer ownership for each form.

* Git-style daily change batches for synchronization history.

* Server-controlled record codes so dependent forms cannot use codes that have not been synchronized and published.

* Revision-based conflict detection so unsynchronized changes never silently overwrite newer data.

* Selective pull synchronization so a device downloads only the forms and upstream records it is authorized and needs to use.

Your existing schema already contains much of the foundation: `PpmForm`, `PersonnelPpmAssignment`, `ClientDevice`, `PpmRecordRevision`, `PpmTraceOutput`, `PpmTraceLink`, `SyncMutationReceipt`, `SyncConflict`, and `AuditLog`.

The important distinction is that one account/device per form reduces conflicts, but does not eliminate them. A device can edit offline while an administrator changes assignments or another form publishes a code. The server must still validate ownership, revision numbers, dependencies, and publication status.

## 1. Recommended operating model

1. One authoritative writer per form

Each of the 26 forms has one active personnel assignment and one registered device authorized to create or edit its records. Other forms may read published outputs but cannot edit the source form's records.

2. Daily local draft and commit

Every local change is stored in an offline queue with a unique mutation ID, record ID, base revision, form ID, and business date. A date groups changes for review; it does not replace the record's identity or revision.

3. Push, validate, and commit on the server

The server checks permissions, duplicate mutations, revision numbers, code uniqueness, and trace dependencies before applying changes transactionally. Rejected or conflicting changes remain visible for resolution.

4. Selective pull

Devices download updates for their assigned form, plus the published upstream outputs and other authorized data required by that form. They do not need to pull every change from all 26 forms.

## 2. How the 26 forms should depend on one another

Use a directed dependency graph, not a requirement that every form synchronize with every other form.

### Form 1 — Egg Preparation

Create record → generate trace code → publish and sync

Authoritative source

Published output code becomes available

### Form 2

Egg Whites

Select the published Form 1 egg-preparation code.

### Form 3

Egg Yolks

Select the published Form 1 egg-preparation code.

Forms 2 and 3 may operate independently after they have synchronized the required upstream output. If another form depends on their outputs, it must follow the same rule.

The required sequence is:

1. Form 1 creates and saves the egg-preparation record locally.

2. Form 1 pushes the record to the server.

3. The server validates and commits the record, then publishes its trace output.

4. Form 2 and Form 3 pull the published output into their local databases.

5. The personnel can select that code only after it is present locally and verified as usable.

6. The downstream record stores a permanent link to the selected upstream output and its source revision.

Important: A code typed manually is not proof that the source record exists. A downstream form must validate the code against its synchronized output registry, not merely accept a matching text value.

If Form 1 corrects a trace-critical value later, the system should create a new revision and trigger trace revalidation for affected downstream records. Do not silently change the historical source data of Forms 2 and 3.

## 3. Git-style daily synchronization

Use Git as the conceptual model, but implement it as a database-backed synchronization protocol. The server remains the authoritative repository.

| Git-style concept  | PPMS implementation                               |
| ------------------ | ------------------------------------------------- |
| Repository         | One PPMS deployment and its central database      |
| Branch             | Logical batch for one form and business date      |
| Local working tree | Device's local database and draft records         |
| Commit             | Immutable snapshot of a set of local mutations    |
| Push               | Upload pending mutations to the server            |
| Pull               | Download authorized changes since the last cursor |
| Merge conflict     | `SyncConflict` with explicit resolution           |
| Tag/release        | Accepted or finalized daily batch, if needed      |

A date is a grouping key, not a conflict-prevention mechanism. For example, two changes to the same record on October 23, 2026, still conflict if they are based on different revisions. Different records on the same date can normally be accepted independently.

The synchronization cycle should work as follows:

1. Start of shift: Pull the latest authorized data and required upstream codes. Verify that the assigned form, device, account, and local schema version are valid.

2. During work: Save every draft locally with a unique mutation ID and its base revision. Do not require internet for every keystroke.

3. Daily commit: Group pending mutations by form and business date. Preserve each mutation's identity and ordering.

4. Push: Submit the batch. The server validates each mutation independently and applies valid changes in database transactions.

5. Reconcile: Return an explicit result for every mutation: applied, duplicate, conflict, or rejected. Never mark an unconfirmed push as successful.

6. Pull: Download relevant server changes and update the local cursor only after the received changes have been durably applied.

Do not make an entire day's batch one indivisible transaction unless the business requires that behavior. A conflict in one record should not unnecessarily block unrelated records from being synchronized.

## 4. Schema changes needed to finalize the design

Your current schema is a strong foundation, but it does not yet fully enforce the one-form/one-account/one-device rule or explicitly represent daily synchronization batches and per-form pull cursors.

Keep your existing tables and add the following.

### A. Enforce one active writer per form

Use one authoritative ownership row per form. The unique constraints also prevent the same personnel account or device from owning multiple forms under this strict model.

SQL

```
CREATE TABLE PpmFormWriterLease (
    ppmFormId VARCHAR(191) NOT NULL,
    userId VARCHAR(191) NOT NULL,
    deviceId VARCHAR(191) NOT NULL,
    leaseVersion INT NOT NULL DEFAULT 1,
    assignedAt DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3),
    revokedAt DATETIME(3) NULL,
    updatedAt DATETIME(3) NOT NULL,

    PRIMARY KEY (ppmFormId),
    UNIQUE KEY uq_form_writer_user (userId),
    UNIQUE KEY uq_form_writer_device (deviceId),

    CONSTRAINT fk_writer_form
        FOREIGN KEY (ppmFormId)
        REFERENCES PpmForm(id) ON DELETE RESTRICT,

    CONSTRAINT fk_writer_user
        FOREIGN KEY (userId)
        REFERENCES User(id) ON DELETE RESTRICT,

    CONSTRAINT fk_writer_device
        FOREIGN KEY (deviceId)
        REFERENCES ClientDevice(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_bin;
```

Operational rules:

* Only an authorized administrator can change form ownership.

* A writer lease is valid only when its user and device are active, the device belongs to that user, and the lease has not been revoked.

* Every write must be checked against the current lease on the server.

* A revoked or replaced device cannot push changes using its old assignment.

* Device replacement should be a controlled transfer, with pending offline data reconciled before the old device is retired.

The table deliberately has one row per form. A transfer updates that row transactionally rather than creating multiple competing active owners.

### B. Represent the daily branch as a synchronization batch

SQL

```
CREATE TABLE SyncDailyBatch (
    id VARCHAR(191) NOT NULL,
    ppmFormId VARCHAR(191) NOT NULL,
    userId VARCHAR(191) NOT NULL,
    deviceId VARCHAR(191) NOT NULL,
    businessDate DATE NOT NULL,
    batchNo INT NOT NULL DEFAULT 1,

    status ENUM(
        'DRAFT',
        'PUSHING',
        'PARTIAL',
        'ACCEPTED',
        'CONFLICTED',
        'REJECTED'
    ) NOT NULL DEFAULT 'DRAFT',

    baseServerCursor BIGINT NOT NULL DEFAULT 0,
    mutationCount INT NOT NULL DEFAULT 0,
    acceptedCount INT NOT NULL DEFAULT 0,
    conflictCount INT NOT NULL DEFAULT 0,
    rejectedCount INT NOT NULL DEFAULT 0,

    createdAt DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3),
    pushedAt DATETIME(3) NULL,
    completedAt DATETIME(3) NULL,

    PRIMARY KEY (id),

    UNIQUE KEY uq_form_day_batch
        (ppmFormId, businessDate, batchNo),

    KEY idx_batch_device_date
        (deviceId, businessDate, status),

    CONSTRAINT fk_batch_form
        FOREIGN KEY (ppmFormId)
        REFERENCES PpmForm(id) ON DELETE RESTRICT,

    CONSTRAINT fk_batch_user
        FOREIGN KEY (userId)
        REFERENCES User(id) ON DELETE RESTRICT,

    CONSTRAINT fk_batch_device
        FOREIGN KEY (deviceId)
        REFERENCES ClientDevice(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_bin;
```

A form can have more than one batch on a day, for example if a morning batch is accepted and an afternoon batch is pushed later. The `batchNo` differentiates them.

The business date must use the plant's configured time zone, not the device's unverified clock.

### C. Track synchronization separately for every upstream form

A device may need data from Form 1 but not from Forms 4–26. Give each device a separate cursor for each source form it subscribes to.

SQL

```
CREATE TABLE SyncPullCursor (
    deviceId VARCHAR(191) NOT NULL,
    sourcePpmFormId VARCHAR(191) NOT NULL,
    lastEventSequence BIGINT NOT NULL DEFAULT 0,
    updatedAt DATETIME(3) NOT NULL,

    PRIMARY KEY (deviceId, sourcePpmFormId),

    CONSTRAINT fk_cursor_device
        FOREIGN KEY (deviceId)
        REFERENCES ClientDevice(id) ON DELETE RESTRICT,

    CONSTRAINT fk_cursor_form
        FOREIGN KEY (sourcePpmFormId)
        REFERENCES PpmForm(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_bin;
```

This cursor requires a server-side change feed with a monotonically increasing `eventSequence`. Add a `SyncChangeEvent` table or equivalent append-only event stream with a `BIGINT AUTO_INCREMENT` sequence, form ID, entity ID, mutation receipt ID, event type, and creation time.

Also add a nullable `batchId` to `SyncMutationReceipt` and a foreign key to `SyncDailyBatch`, so the server can identify which daily batch submitted each mutation.

SQL

```
ALTER TABLE SyncMutationReceipt
    ADD COLUMN batchId VARCHAR(191) NULL;

ALTER TABLE SyncMutationReceipt
    ADD CONSTRAINT fk_receipt_batch
    FOREIGN KEY (batchId)
    REFERENCES SyncDailyBatch(id)
    ON DELETE RESTRICT;

CREATE INDEX idx_receipt_batch
    ON SyncMutationReceipt(batchId);
```

Do not advance a pull cursor until the corresponding changes have been saved locally. On reconnect, replay from the last durable cursor and make applying events idempotent.

## 5. Rules for conflicts and code availability

These should be mandatory application rules, not merely recommendations in the user interface.

| Situation                                              | Required behavior                                               |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| Record exists locally and its base revision is current | Allow the mutation to be submitted                              |
| The same mutation is pushed twice                      | Return the original receipt; do not apply it twice              |
| The record has a newer server revision                 | Create a `SyncConflict`; never silently overwrite               |
| The required upstream code is absent locally           | Disable selection and request synchronization                   |
| The code is local but not confirmed as published       | Do not allow it to be used                                      |
| The upstream record is corrected later                 | Preserve history and initiate trace revalidation when necessary |
| A device has lost its assignment                       | Reject new writes from that device                              |
| An unrelated record conflicts                          | Continue processing other valid mutations                       |
| Internet is unavailable                                | Save drafts locally; queue changes until connectivity returns   |

For revision conflicts, compare the submitted `baseRevisionNo` with the current server revision inside a transaction. Your existing `PpmRecordRevision` unique constraint on `(recordId, revisionNo)` helps prevent duplicate revision numbers, but the application must still perform the comparison and handle the conflict.

For code selection, validate all of the following:

1. The code exists in the local synchronized output registry.

2. It belongs to the expected upstream form and output type.

3. The source output has been published and is not disabled or superseded for the intended use.

4. The source record and revision meet the configured approval and traceability requirements.

5. The code is permitted for the target form under an active `PpmTraceConnection`.

If the device cannot establish whether a previously synchronized code remains valid, the system needs a defined offline policy. For strict safety, require online revalidation before use; alternatively, permit only previously synchronized outputs covered by an explicit offline-use policy.

## 6. Required adjustments to your existing schema

The following changes complete the design around your existing tables.

Keep the existing revision and conflict model

`PpmRecordRevision`, `RevisionChange`, `SyncConflict`, and `SyncMutationReceipt` provide the basis for immutable revisions, conflict tracking, and idempotent mutation processing. Ensure the server generates authoritative revision numbers.

Validate device ownership at the API layer

`PersonnelPpmAssignment` alone does not enforce one device per form. Check the writer lease, registered device, user, form assignment, and account status for every write. A client-provided form ID is not authorization.

Make mutation receipts idempotent per device

Your existing unique `clientMutationId` is useful. Generate a globally unique mutation ID for every operation and verify that a repeated ID has the same authenticated owner, device, operation, and payload hash. Do not treat a reused ID with a different payload as a successful duplicate.

Make daily batches auditable

Record batch acceptance, partial acceptance, rejection, and conflict resolution in `AuditLog`. A batch is not accepted simply because its upload request returned successfully.

Keep trace links revision-specific

`PpmTraceLink` already references the exact source output and downstream revision. Preserve those links when corrections happen, and use `TraceRevalidation` and `TraceRevalidationItem` to track downstream impact.

One additional consideration: `PpmTraceOutput.status` includes `SUPERSEDED` and `DISABLED`. Your code-selection logic must interpret these statuses explicitly; it must not assume that every historical output remains valid for new production.

## 7. Recommended daily operating example

07:00 — Synchronize

Form 1 pulls its assigned data. Forms 2 and 3 pull the required published outputs from Form 1. If a required code is missing, it cannot be selected.

During production — Work offline if needed

Each device saves its own drafts and mutation queue. No other device can write to the same form under the normal ownership policy.

End of shift — Push and reconcile

Each device pushes its daily batch. The server accepts valid changes, records conflicts, and returns a receipt for each mutation.

After acceptance — Pull dependencies

Downstream forms retrieve newly published outputs. The server retains historical revisions and audit history; the next day's work starts from the latest authorized state.

## Final recommendation

Use one authoritative writer per form, daily database-backed batches, revision-checked pushes, and dependency-based selective pulls. Do not use the date as the sole conflict key, and do not use Git branches as the actual storage mechanism for production records.

Your existing schema can support this design without replacing the 26 form tables or the traceability model. Add the writer-lease, daily-batch, and pull-cursor infrastructure, implement the ordered change feed, and enforce code availability and revision checks in the server transaction layer.

The result is a system where each form works independently, downstream forms can consume published upstream codes, offline work is preserved, and conflicting or unverified changes cannot silently overwrite authoritative production records.
