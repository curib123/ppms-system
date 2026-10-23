# PPMS Finalized Schema and Sync Architecture

Revised for 26 forms, multiple users sharing one device per form, offline operation, daily synchronization, and end-to-end traceability.

## 1. Final architectural decision

PPMS will use one authoritative device per form, with multiple individual user accounts allowed to work on that form using the same local database.

For example, Form 1 (Egg Preparation) may be used by several authorized personnel on Device 1. They see the same synchronized Form 1 data, can continue working offline, and retain individual audit histories.

The architecture combines:

* Single-writer device ownership for each form.

* Multiple users per form and device, with individual authentication.

* Shared local database and offline mutation queue.

* Daily, database-backed synchronization batches.

* Server-controlled trace codes and publication status.

* Revision-based conflict detection and immutable history.

* Selective synchronization of required upstream data.

The server remains the authoritative source of accepted records, revisions, assignments, and published trace outputs.

## 2. Recommended operating model

### A. Multiple users sharing one device

Each form has one assigned device, but its personnel assignment is no longer restricted to one user.

For example:

| Form                     | Device                   | Authorized users             | Shared data                                  |
| ------------------------ | ------------------------ | ---------------------------- | -------------------------------------------- |
| Form 1 — Egg Preparation | Device 1                 | User A, B, C                 | Form 1 records                               |
| Form 2 — Egg Whites      | Device 2                 | User D, E                    | Form 2 records and published Form 1 codes    |
| Form 3 — Egg Yolks       | Device 3                 | User F, G                    | Form 3 records and published Form 1 codes    |
| Forms 4–26               | One assigned device each | One or more authorized users | Assigned form data and required dependencies |

All users assigned to the same form share the same local record set. They must log in individually, and the system records which user creates, edits, approves, or submits each change.

### B. Local work and server synchronization

1. Users log in and receive access to their assigned form.

2. The device loads the latest authorized records and published upstream codes.

3. Users create or edit records in the shared local database.

4. Every change is stored with a unique mutation ID, acting user, device ID, record ID, and base revision.

5. The device groups pending changes into daily batches.

6. The server validates permissions, revisions, traceability, and duplicate submissions.

7. Accepted changes are committed and published where authorized.

8. Devices pull relevant updates and retain their synchronization cursors.

Internet access is not required for every edit. Offline changes remain queued until synchronization is possible.

Important: Multiple users sharing one database do not automatically create separate data copies. However, if two users edit the same record concurrently, the application still needs local transaction handling and revision checks.

## 3. How the 26 forms depend on each other

Use a directed dependency graph rather than synchronizing every form with every other form.

Form 1 — Egg Preparation

Create record, generate trace code, synchronize, validate and publish

Form 2 — Egg Whites

Pull published Form 1 code

Form 3 — Egg Yolks

Pull published Form 1 code

Other forms follow the same pattern according to the configured PpmTraceConnection dependency graph.

The required sequence is:

1. Form 1 creates and saves the record locally.

2. Form 1 pushes the record to the server.

3. The server validates and commits the record, then publishes its trace output if permitted.

4. Forms 2 and 3 pull the published output into their local databases.

5. Their users can select the code only after it is synchronized and verified as eligible.

6. Each downstream record stores a permanent link to the source output and its exact revision.

A manually typed code is not sufficient evidence that its source exists. If a source revision changes later, PPMS preserves historical links and initiates trace revalidation when required.

## 4. Revised database schema

Keep your existing tables and extend the ownership model rather than rebuilding the 26 form tables.

### A. `PpmFormDeviceLease` — one device per form

Replace the previous `PpmFormWriterLease` design that required a unique user per form and device. The lease should identify the authoritative device, not a single person.

SQL

```
CREATE TABLE PpmFormDeviceLease (
    ppmFormId VARCHAR(191) NOT NULL,
    deviceId VARCHAR(191) NOT NULL,
    leaseVersion INT NOT NULL DEFAULT 1,
    assignedAt DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3),
    revokedAt DATETIME(3) NULL,
    updatedAt DATETIME(3) NOT NULL,

    PRIMARY KEY (ppmFormId),
    UNIQUE KEY uq_form_device (deviceId),

    CONSTRAINT fk_lease_form
        FOREIGN KEY (ppmFormId)
        REFERENCES PpmForm(id) ON DELETE RESTRICT,

    CONSTRAINT fk_lease_device
        FOREIGN KEY (deviceId)
        REFERENCES ClientDevice(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_bin;
```

This strict version permits one device per form and one form per device. Device replacement must be an authorized, transactional transfer after pending offline changes are reconciled.

### B. `PpmFormUserAccess` — multiple users per form

Use your existing `PersonnelPpmAssignment` if it can represent multiple users per form and enforce permissions. Otherwise, a dedicated access table can provide that capability.

SQL

```
CREATE TABLE PpmFormUserAccess (
    ppmFormId VARCHAR(191) NOT NULL,
    userId VARCHAR(191) NOT NULL,
    canView BOOLEAN NOT NULL DEFAULT TRUE,
    canCreate BOOLEAN NOT NULL DEFAULT TRUE,
    canEdit BOOLEAN NOT NULL DEFAULT TRUE,
    canPublish BOOLEAN NOT NULL DEFAULT FALSE,
    assignedAt DATETIME(3) NOT NULL
        DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (ppmFormId, userId),

    CONSTRAINT fk_access_form
        FOREIGN KEY (ppmFormId)
        REFERENCES PpmForm(id) ON DELETE RESTRICT,

    CONSTRAINT fk_access_user
        FOREIGN KEY (userId)
        REFERENCES User(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_bin;
```

This allows several users to access the same form without assigning multiple writer devices.

The application must check the user's current permissions, the device lease, and the requested operation on every server write. The example table is a starting point; avoid duplicating an existing permission system.

### C. Track the acting user on every mutation

Every mutation and audit event must distinguish the person from the device.

Retain the following information:

| Field                  | Purpose                                     |
| ---------------------- | ------------------------------------------- |
| `clientMutationId`     | Idempotent identity of the operation        |
| `userId`               | Authenticated person who performed it       |
| `deviceId`             | Registered device submitting it             |
| `ppmFormId`            | Form being changed                          |
| `recordId`             | Affected record                             |
| `baseRevisionNo`       | Revision on which the change was based      |
| `batchId`              | Daily synchronization batch                 |
| Server event timestamp | Authoritative time of receipt or processing |

Adapt `SyncMutationReceipt` and `AuditLog` to store these fields if they do not already exist. Preserve the acting user in the original mutation receipt even when a batch contains changes from several users.

Do not make the batch creator the assumed author of every mutation in that batch.

### D. `SyncDailyBatch` — daily synchronization history

Retain the proposed `SyncDailyBatch` design with its form, device, business date, batch number, status, counts, and timestamps.

Because multiple users may contribute to one form's daily batch, `userId` should represent the batch creator or submitter only, not the author of every operation. Individual authors remain recorded in the mutation receipts.

Use the plant's configured time zone for `businessDate`, and allow multiple batches per form per day.

### E. `SyncPullCursor` and `SyncChangeEvent`

Keep the proposed per-device, per-source-form pull cursor and the append-only change feed.

* Each device tracks its last durably applied event sequence for each required source form.

* The server publishes ordered change events.

* The local database applies events idempotently.

* The cursor advances only after local changes are durably stored.

Users sharing the same device should share the device's synchronized data and cursor. Do not create independent synchronization cursors for each user unless the application intentionally maintains separate local data stores.

## 5. Git-style daily synchronization

Git is a conceptual model here, not the production storage engine.

| Git concept    | PPMS implementation                     |
| -------------- | --------------------------------------- |
| Repository     | Central PPMS database                   |
| Working tree   | Shared local database                   |
| Commit         | Immutable snapshot of mutations         |
| Push           | Upload a daily batch                    |
| Pull           | Download authorized changes             |
| Merge conflict | `SyncConflict` with explicit resolution |
| Tag or release | Accepted/finalized batch, if required   |

A date groups changes for review; it does not prevent conflicts. Two edits to the same record can conflict on the same day if they were based on different revisions.

The server should process each mutation independently within the required database transactions. A conflict in one record should not unnecessarily block unrelated valid mutations.

## 6. Conflict prevention and resolution rules

| Situation                                                  | Required behavior                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| Several users work on different records on the same device | Allow concurrent work where safe                            |
| Several users edit the same record                         | Coordinate local writes and check revisions                 |
| A mutation is submitted twice                              | Return the original receipt without applying it twice       |
| A record has a newer server revision                       | Create a `SyncConflict`; never silently overwrite           |
| The required upstream code is absent locally               | Disable selection and request synchronization               |
| A code is present but unpublished or ineligible            | Reject its use                                              |
| A device lease or user assignment is revoked               | Reject unauthorized new writes                              |
| One record conflicts but others are valid                  | Continue processing unrelated valid mutations               |
| Internet is unavailable                                    | Save drafts locally and queue mutations                     |
| An upstream trace-critical value changes                   | Preserve history and revalidate affected downstream records |

For each write, the server must validate the user's access, the device's current lease, the submitted base revision, code uniqueness, and relevant trace dependencies. Revision checks must occur within a transaction.

For strict production traceability, require online revalidation where the system cannot establish whether a previously synchronized code remains valid. Otherwise, allow offline use only under a documented policy for previously synchronized outputs.

## 7. Required existing schema adjustments

Keep the existing revision and traceability model:

* `PpmRecordRevision` and `RevisionChange` preserve revision history.

* `SyncMutationReceipt` makes synchronization idempotent.

* `SyncConflict` stores unresolved conflicts.

* `PpmTraceOutput` controls published, superseded, and disabled outputs.

* `PpmTraceLink` records revision-specific source relationships.

* `TraceRevalidation` and `TraceRevalidationItem` track downstream impact.

* `AuditLog` records user actions, assignments, synchronization results, and conflict resolutions.

Ensure that revision numbers are server-authoritative and that reusing a mutation ID with a different owner or payload is rejected rather than treated as a duplicate success.

## 8. Daily operating example

07:00 — Start of shift

Several Form 1 personnel log in to Device 1. They share the same local Form 1 records and synchronized upstream data. Forms 2 and 3 pull the published Form 1 codes they need.

During production

Users create and edit records. The application saves their changes locally and attributes each mutation to its author. It coordinates simultaneous edits and queues offline changes.

End of shift

Device 1 pushes the Form 1 daily batch. The server validates each mutation and returns a result for each one. Forms 2 and 3 synchronize newly published outputs when available.

After acceptance

The system retains the accepted revisions, mutation receipts, audit events, and trace links. The next shift starts from the latest authorized data.

## Final recommendation

Adopt multiple individual users per form sharing one authoritative device and one local database. Keep one writer device per form, but remove the one-user-per-form restriction.

The final design consists of:

1. One active device lease per form.

2. Multiple user assignments per form with individual permissions.

3. Shared local records and mutation queues on the assigned device.

4. User-specific audit history for every mutation.

5. Daily database-backed synchronization batches.

6. Revision-checked, idempotent server commits.

7. Selective pull synchronization and published trace-code validation.

8. Immutable revision history and explicit conflict resolution.

This model supports personnel rotation and shared workstations without creating unnecessary competing device copies. It also preserves the critical distinction between who performed an operation, which device submitted it, and which form owns the record.
