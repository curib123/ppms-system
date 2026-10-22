# Why the PPMS architecture is dynamic, flexible, and offline-first

Your schema is designed around a central idea: the PPM form is data that describes a form, rather than a separate database table and a separate piece of application code for every form.

This is particularly useful for a production, quality assurance, and traceability system where forms can change, different production areas use different forms, and personnel may need to record production information without an internet connection.

Your schema separates three concerns:

1. The form definition — what fields the form contains and how it should be displayed.

2. The production record — the actual data entered by a user.

3. The workflow and traceability history — who submitted, corrected, approved, or linked that data to another production record.

The offline-first architecture builds on that separation so users can continue working when the server is unavailable and synchronize their changes later.

## 1. Static forms versus dynamic forms

Imagine your factory has these PPM forms:

![professional of quality control inspectors in food processing factory.](https://images.openai.com/static-rsc-4/T7tCmbvoBPHDqsb-0_tTzattFYbBMCXr9oImW7-TePsQM-h2JhUnSrbyATPqH6I_nt6lGLR-9W99vaIhODLWgRxB3YL5a2sANIDMuSQXLwmj_v_mdGPSYXXDhwDHxce7-7WTARG7p4JoUaIDAydJus8F4I1vcVUmAOnu4ReNtx6EIIWWy-oL-pf5T6lxL8hw?purpose=inline)

Checking Favorites status

PPM-001 — Raw Material Inspection

Supplier, material code, lot number, inspection results, acceptance status.

![Industry inspector worker checking machine operation for safety standard in food and drink factory.](https://images.openai.com/static-rsc-4/_M_hDR-GCFRFtO1wkxWxJObDiHROrkUciHu3Axdqy3-3h8e8C1qxEjd61uFMN_jvsDgXZloCLKHJacX9RRJyY5hoPlCmuyp9iDvWmAewJwxqZFP1BR7HL-3j92h-ZnHfPFrY6gCNkKoEqYKvPz-9jk_D0iXg6VvsAh2sPiK3DWLB1lkrxbZXi6PZamgIkPnS?purpose=inline)

Checking Favorites status

PPM-002 — Production Monitoring

Production date, shift, batch, temperature, machine settings, operator checks.

![Supplier Qualification Verification When Importing Food](https://images.openai.com/static-rsc-4/PSXNG4Vj3BQQoZa32SSB2mhqP1EwlSHHBwE05zmlzobh75_RvYX8Q-DIJ03EANNo_k4XcH8Zfk-cL4EmHb5XpmQoyFfRBAbu6ytSV-vZ22gDDxO7cXd0A5dA9DbkGndROoPw1-rRxyDjAAAWrphzqv5VtYK1yxWqpg1NAK1vTvo?purpose=inline)

Checking Favorites status

PPM-003 — Finished Product Inspection

Finished product, lot number, quantity, quality results, release decision.

### Approach A: Create a separate table for every PPM form

You might create:

SQL

```
CREATE TABLE PPM001_RawMaterialInspection (
    id VARCHAR(191) PRIMARY KEY,
    supplier VARCHAR(255),
    materialCode VARCHAR(100),
    lotNumber VARCHAR(100),
    accepted BOOLEAN
);

CREATE TABLE PPM002_ProductionMonitoring (
    id VARCHAR(191) PRIMARY KEY,
    productionDate DATETIME,
    shift VARCHAR(50),
    batchNumber VARCHAR(100),
    temperature DECIMAL(10,2)
);
```

This works, but every new form can require:

* A new database table and migration.

* New backend models and API endpoints.

* New frontend screens and validation logic.

* Additional offline storage and synchronization rules.

* New reporting, revision, and traceability integration.

Changing a form can become a software development task rather than a configuration task.

### Approach B: Your dynamic template architecture

Your schema uses common tables:

* `PpmForm` — identifies the form.

* `PpmTemplateVersion` — stores the form's version and definition.

* `PpmRecord` — identifies a production record.

* `PpmRecordRevision` — stores the actual submitted or draft data.

The form-specific fields live in `PpmTemplateVersion.definitionJson`, while the actual entered values live in `PpmRecordRevision.dataJson`.

For example, a template definition could look like this:

JSON

```
{
  "fields": [
    {
      "key": "supplier",
      "label": "Supplier",
      "type": "text",
      "required": true
    },
    {
      "key": "lotNumber",
      "label": "Lot Number",
      "type": "text",
      "required": true
    },
    {
      "key": "accepted",
      "label": "Accepted?",
      "type": "boolean",
      "required": true
    }
  ]
}
```

A record created using that template could contain:

JSON

```
{
  "supplier": "ABC Foods",
  "lotNumber": "LOT-2026-104",
  "accepted": true
}
```

The frontend reads the template definition and generates the corresponding form controls. The backend validates the submitted values against the applicable template and business rules.

The important distinction: JSON does not automatically make a system dynamic. The application becomes dynamic because its rendering, validation, and processing logic are designed to interpret the template definition.

## 2. How your database makes PPM forms dynamic

Here is how the main tables work together.

`PpmForm`

Form identity: PPM-001, PPM-002, PPM-003

`PpmTemplateVersion`

Version, field definitions, validation rules, metadata

`definitionJson`

Dynamic form renderer

Builds text inputs, dates, dropdowns, checkboxes, tables, and validation from the definition

`PpmRecord` + `PpmRecordRevision`

Record metadata and actual field values

`dataJson`

Suppose you add a fourth PPM form for equipment sanitation.

With a dynamic system, you can potentially:

1. Create a new `PpmForm` row.

2. Create its first `PpmTemplateVersion`.

3. Store the sanitation fields in `definitionJson`.

4. Publish the template.

5. Assign the form to the appropriate production area and personnel.

The existing renderer can display the new form without creating a new SQL table.

This works provided the new form uses field types and behaviors already supported by your renderer. If it introduces a new field type, calculation engine, or special workflow, application code may still need to change.

## 3. Why template versioning matters

Your schema includes:

```
PpmForm
   └── PpmTemplateVersion
          └── PpmRecord
                 └── PpmRecordRevision
```

These tables solve a problem that is especially important in quality and food-production records.

Imagine that PPM-002 originally contains:

* Production date

* Shift

* Batch number

* Temperature

Later, the organization publishes a new template that adds a pressure reading.

You should not silently reinterpret old records using the new template.

Instead:

* Version 1 remains available for historical records.

* Version 2 contains the additional pressure field.

* New records use version 2 once it becomes effective.

* Existing records retain their reference to the template version used when they were created.

The `PpmRecord.templateVersionId` foreign key supports this design.

`PpmRecordRevision` then provides a separate history of the record's data and lifecycle. For example, a draft may be revised, submitted, corrected, and eventually approved without erasing the prior revision.

Important implementation rule: published template versions should be immutable. If a published definition changes, create a new version instead of editing the old definition in place. Otherwise, historical records may become difficult to interpret reliably.

## 4. Understanding the offline-first architecture

Offline-first means the application is designed to keep working when the server cannot be reached. It does not mean that MySQL itself operates offline.

Your provided schema suggests an architecture with a local client database, a mutation queue, and a central MySQL/MariaDB database.

1. Local application

Cached templates, local records, draft revisions and pending changes

Offline

Save locally

Online

Synchronize

2. Synchronization engine

Mutation IDs, retry handling, revision checks and conflict detection

3. Central server + MySQL/MariaDB

Authorization, validation, transactions, audit history, approvals and traceability

The diagram describes the intended architecture inferred from your schema. The SQL definitions alone do not prove that every client-side or synchronization behavior has already been implemented.

### Step 1 — Prepare the device before going offline

When the device is online, the application retrieves the information the logged-in user needs:

* Published PPM template versions.

* Assigned forms and production areas.

* Applicable reference data and traceability options.

* Existing records and any relevant workflow state.

* The user's permitted offline-access window.

The device stores this information in local persistent storage, such as IndexedDB in a browser-based PWA or SQLite in a native application.

The server-side `ClientDevice` table tracks registered devices and includes `offlineAccessIssuedAt`, `offlineAccessExpiresAt`, and `revokedAt`.

Those fields support offline authorization, but the actual client must enforce access expiry and handle revoked credentials securely.

### Step 2 — Save records locally

When an operator opens a cached template and enters production data, the application can save the draft without sending a request to the server.

For example:

JSON

```
{
  "localRecordId": "rec-123",
  "templateVersionId": "template-v2",
  "status": "ACTIVE",
  "data": {
    "shift": "A",
    "batchNo": "BATCH-4501",
    "temperature": 82.5
  },
  "syncStatus": "PENDING"
}
```

This is an illustrative client-side representation, not a row format prescribed by your SQL schema.

The application should persist the draft before showing that it has been saved. If the browser closes or the network drops, the data should remain on the device.

A key detail: the server's `PpmRecord` and `PpmRecordRevision` tables are not themselves the offline database. They store the synchronized, authoritative server-side records.

### Step 3 — Queue mutations

When the operator edits a record or queues a submission, the client creates a mutation to send later.

Your `SyncMutationReceipt` table supports tracking these operations:

| Column             | Purpose                                               |
| ------------------ | ----------------------------------------------------- |
| `clientMutationId` | Identifies a client operation for duplicate detection |
| `deviceId`         | Identifies the originating device                     |
| `userId`           | Identifies the user responsible                       |
| `recordId`         | Identifies the record, when one exists                |
| `operationType`    | Describes the requested operation                     |
| `baseRevisionNo`   | Indicates the revision on which the change was based  |
| `payloadHash`      | Can help verify payload consistency                   |
| `status`           | Tracks the server's outcome                           |
| `resultJson`       | Can hold the result returned by processing            |

A typical operation flow is:

```
User edits record
       ↓
Save to local database
       ↓
Add mutation to local queue
       ↓
Network unavailable? ── Yes → Keep pending
       │
       No
       ↓
Send mutation to server
       ↓
Validate and process transactionally
       ↓
Store receipt and result
       ↓
Mark local mutation synchronized
```

The queue needs retry logic, durable storage, and a policy for permanent failures. Merely having a receipt table on the server does not create the client-side queue.

### Step 4 — Synchronize safely when connectivity returns

When the network becomes available, the client sends pending mutations to the server.

The server can use `SyncMutationReceipt` to recognize repeated submissions. This is important because a request might succeed on the server but its response might never reach the device.

For example:

1. The client sends mutation `M123`.

2. The server applies the change.

3. The response is lost.

4. The client retries `M123`.

5. The server recognizes the existing mutation receipt and avoids applying the same operation twice.

Your unique index on `SyncMutationReceipt.clientMutationId` helps enforce this behavior.

For this to work correctly, receipt creation, business changes, and result persistence need appropriate transactional handling. The server should also verify that a repeated ID has the same intended payload rather than blindly treating every reuse as a valid duplicate.

### Step 5 — Detect conflicting changes

Offline work creates a major challenge: two users can edit the same record without knowing about each other's changes.

Your `SyncConflict` table provides a mechanism for recording these conflicts.

Consider this example:

Device A — offline

Starts from revision 3 and changes temperature to 82.5°C.

Device B — online

Updates the same record to revision 4 with temperature 84°C.

Device A synchronizes

The server sees that the submitted change was based on revision 3, while the current server revision is 4.

Conflict resolution options

* `KEEP_SERVER` — keep the server's existing value.

* `APPLY_LOCAL_AS_NEW_REVISION` — preserve the offline edit as a new revision, subject to validation and authorization.

* `MANUAL_MERGE` — require an explicit resolution of the competing changes.

The relevant fields include:

* `baseRevisionNo`

* `serverRevisionNo`

* `localPatchJson`

* `changedPathsJson`

* `isTraceCritical`

* `resolutionType`

* `resolutionJson`

These fields make conflict resolution explicit and auditable rather than silently overwriting data.

For a traceability-critical value, such as a lot number, ingredient identity, or production quantity, the system should not automatically merge incompatible values without an appropriate business rule and authorization.

Also, a conflict-resolution option should not be allowed to bypass submission, approval, or revision rules.

## 5. How dynamic forms and offline-first work together

The two architectural ideas complement each other.

| Dynamic form architecture                     | Offline-first architecture                                   |
| --------------------------------------------- | ------------------------------------------------------------ |
| Stores form structure in template definitions | Caches published template definitions on the device          |
| Renders controls from configuration           | Renders cached forms without a network request               |
| Stores answers in structured JSON             | Saves draft answers locally                                  |
| Versions templates                            | Associates records with specific template versions           |
| Validates data against a form definition      | Performs suitable local validation before queuing changes    |
| Supports common record and revision tables    | Synchronizes records and revisions to the server             |
| Enables configurable traceability rules       | Queues traceability-related operations for server validation |

There is one particularly important dependency: a device must have the correct template version cached before it goes offline.

If a template changes while a device is disconnected, the device must not silently replace its cached definition with a newer one or reinterpret an existing draft. The application needs a policy for outdated templates, including when an offline draft can still be submitted and when it must be reviewed or migrated.

## 6. Why the traceability tables are separate

Your schema also models relationships between forms and production records without hardcoding every possible form-to-form connection.

Upstream PPM record

Publishes a traceable output code

`PpmTraceOutput`

Configured relationship

`PpmTraceConnection`

Defines which upstream output can populate which downstream input

Downstream PPM record

`PpmTraceLink` associates the selected output with a specific record revision and input

For example, a raw-material inspection might publish a material lot code that can be selected by a production-monitoring form. The production record can then be linked to that upstream lot.

The important tables are:

* `TraceCodeRule` — describes how a traceable output code is produced or obtained.

* `CodeSequence` — maintains counters for configured code-generation rules and periods.

* `PpmTraceOutput` — records published outputs.

* `PpmTraceConnection` — configures allowed relationships between forms and their input/output keys.

* `PpmTraceLink` — records the actual selected connection between production data.

* `TraceRevalidation` and `TraceRevalidationItem` — track downstream links requiring review after relevant upstream changes.

This allows the application to support new form combinations through configuration where the existing rules are sufficient.

For a robust traceability system, the server must verify that the selected connection is valid, the upstream output is eligible for use, and any required approvals have been satisfied.

## 7. What your schema gets right — and what to check

The design is a solid foundation for a configurable, auditable, offline-capable PPM system. There are, however, several areas to verify before relying on it in production.

Strong separation of responsibilities

Templates, records, revisions, assignments, traceability, workflow, and synchronization have distinct tables. This is easier to extend than a collection of unrelated form-specific schemas.

Auditability and revision history

`AuditLog`, `WorkflowEvent`, `RevisionChange`, and `PpmRecordRevision` provide the building blocks for reconstructing changes and decisions. Their value depends on the application recording all required events consistently.

JSON needs application-level validation

MySQL can validate that a value is valid JSON, but that alone does not ensure a required field exists, has the correct type, falls within an acceptable range, or satisfies a business rule. Validate the payload against its exact template version on the server.

Offline storage is not shown in this SQL schema

You still need a persistent client database, a durable mutation queue, retry behavior, reconciliation logic, and a policy for stale templates and revoked devices. The server tables provide supporting infrastructure, not the whole offline implementation.

Check database constraints and concurrency

The supplied SQL declares many foreign keys and indexes, but it does not visibly enforce every business invariant. For example, the schema does not itself guarantee that only one template version is active for a given form, that an area assignment has no overlapping effective periods, or that all active assignments are unique. Add suitable constraints or transactional application checks as appropriate.

A further consideration is performance. JSON is useful for flexible form fields, but frequently filtered or aggregated values—such as production date, batch number, status, and traceability codes—should remain indexed relational columns where practical. For heavily queried JSON fields, consider generated columns or carefully designed indexes.

## 8. The architectural principle in one sentence

Use relational tables for stable business entities, relationships, security, workflow, and audit history; use versioned JSON definitions for configurable form structure and JSON payloads for form-specific answers; and use a durable local database plus an idempotent, conflict-aware synchronization protocol to support offline work.

That is the core idea behind your PPMS schema.

It avoids creating a new database table for every PPM form while preserving the shared mechanisms needed for revisions, approvals, and traceability. It also lets the system evolve through controlled configuration rather than requiring a database migration for every ordinary form change.

The trade-off is that more responsibility moves into the application: template validation, renderer behavior, offline persistence, synchronization, and conflict resolution must be engineered carefully. The schema provides the structure for those capabilities, but the implementation determines whether they are reliable.
