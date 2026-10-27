# Default PPM process flow

New documentation requested on 27 October 2026, based on this checkout's
canonical defaults and current service behavior. This is a new document;
there was no input PDF to reproduce.

## Deliverables

- [PPMS_Default_PPM_Process_Flow.pdf](PPMS_Default_PPM_Process_Flow.pdf): nine landscape pages with process diagrams, form register,
  exact connection register, and configuration limitations.
- [PPMS_Default_PPM_Process_Flow.drawio](PPMS_Default_PPM_Process_Flow.drawio): editable diagrams.net pages with native
  text, shapes, and connectors. Open with diagrams.net or the draw.io desktop app.
- `pages/*.svg`: vector copies for viewing and reuse.
- `previews/*.png`: rendered previews of the PDF pages.
- `source/default-ppm-flow.json`: selected canonical configuration, without
  accounts, production records, credentials, or operational data.

## Interpretation

The register contains **26 forms across seven areas**: 24 active and two
reserved. There is no PPM-025 in the defaults; `WH-STOCK-RELEASE` is the
26th form. Preserve the duplicate controlled titles for PPM-012/PPM-023
and PPM-015/PPM-016, distinguishing them by code and actual fields.

The 56 saved connections are **35 ACTIVE, 17 PENDING_VALIDATION, three RESERVED,
and one DISABLED**. Of the active connections, **33 match the current template
paths and output rules**. `CONN-004` and `CONN-005` refer to obsolete top-level
input paths; their current row-based counterparts are `REV84-FORM-003` and
`REV84-FORM-004`. The diagrams show the current mappings, and the connection
register retains every saved row and its exact status.

Required trace inputs without a matching active connection are
`PPM-017: entries[].packingCode` and
`PPM-024: entries[].productCode / entries[].rollCode`. The runtime requires an
exact source selection for populated trace fields, so these are configuration
gaps, not implied links. This documentation does not repair the defaults.

`PPM-011 -> PPM-011` (meringue) and `PPM-022 -> PPM-022` (oil) are configured
same-form connections. `Ppms_trace_service::link` rejects the same source
record as the target record: these require a different eligible source record.
The diagrams must not imply that one record can publish and select itself.
The first-record/bootstrap arrangement for these streams needs verification.

Form order is not a serial approval workflow. The physical progression from
forming through baking to baked receiving is supported by the activity/field
labels; its two gray arrows are explicitly identified as an operational
inference. The exact current code links for those activities originate from
`PPM-011.mixingCode`. Frozen eggyolk and pan greaser have no configured onward
production links; no such links are invented.

Checked (FSQA), Reviewed (SUPERVISOR), and Approved (PLANT_MANAGER) are
independent, revision-specific guidance. They do not gate an otherwise eligible
published trace source. Actual data corrections create immutable revisions,
retire affected published outputs, and propagate downstream revalidation.
Review events alone do not change lifecycle or content revisions.

The draft record lifecycle value is `PpmRecord.status=ACTIVE`; the corresponding
content revision is `PpmRecordRevision.status=DRAFT`. A correction returns the
record to ACTIVE with a CORRECTED revision; resubmission and publication are
separate actions. Ordinary review does not close a record. Existing CLOSED
records have special restrictions, including historical impact acceptance.

The API is implemented; Flutter local entry/storage and the browser admin
panel are client responsibilities described by the active plan. Their delivery
is not proved by this document. No live database was queried or modified.

## Sources and regeneration

Authority order: `database/default_data.sql` and `database/manifest.json` for
defaults; current `Ppms_*_service.php` files for runtime guards; the active
26 October architecture/spec/plan for client responsibility and planned work.
Archived PostgreSQL/Prisma seed scripts are provenance, not the active schema.
Source file SHA-256 values are included in the JSON snapshot.

The document build uses Python and PyMuPDF, without an application/runtime
dependency. If PyMuPDF is absent, install the pinned development requirement
with `python -m pip install -r scripts/documentation/requirements.txt`.
Run from the repository root:

```powershell
python scripts/documentation/ppm_source.py
python scripts/documentation/build_ppm_flow.py
python scripts/documentation/verify_ppm_flow.py
```

Validation checks source fingerprints, all 26 form codes and all 56 connection
names in the PDF, exact mapping coverage in the editable diagrams, page/text
bounds, and rendered PDF previews. It does not claim a production playthrough
or native Visio inspection. Edit configuration in the application through its
authorized workflow; editing the diagram changes documentation only.

The PDF pages are: ingredients to mixing; forming/baking/packing/stock release;
record entry/submission/publication with independent review; actual correction
and impact resolution; the 26-form register; two active-connection register
pages; non-active connections; and source authority/configuration gaps.
