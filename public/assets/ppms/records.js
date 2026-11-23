import {
  el,
  button,
  field,
  textInput,
  select,
  modal,
  showError,
  notify,
  badge,
  dateLabel,
  confirmAction,
  debounce,
  errorMessage,
} from "./ui.js";
import { clone, defaultData, fieldsOf } from "./schema.js";
import { FormRenderer } from "./renderer.js";
import { DocumentViewport } from "./viewport.js";

function plantDate(zone = "Asia/Manila") {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type).value)
    .join("-");
}
export function openRecord(app, { form, context, template, view = null }) {
  app.cleanup?.();
  app.main.replaceChildren();
  const mobile = app.mode === "mobile";
  const editorSessionId = crypto.randomUUID();
  let expectedLocalEditVersion = Number(view?.localEditVersion || 0);
  let record = view?.record ||
    view?.server?.record || {
      id: crypto.randomUUID(),
      ppmFormId: form.id,
      templateVersionId: template.id,
      currentRevisionNo: 0,
      productionDate: plantDate(context.plantTimezone),
      areaPpmAssignmentId: context.areaAssignments?.[0]?.id,
      status: "ACTIVE",
    };
  let revision = view?.revision || view?.server?.revision;
  // This version belongs to the data displayed in the editor. A newer server
  // projection must never make stale local contents appear current.
  let dataBaseRevisionNo = Number(
    view?.localBaseRevisionNo ??
      view?.serverRevisionNo ??
      record.currentRevisionNo ??
      0,
  );
  let data = clone(
    view?.dataJson ||
      revision?.dataJson ||
      defaultData(fieldsOf(template.definitionJson)),
  );
  if (!record.currentRevisionNo && Object.hasOwn(data, "productionDate"))
    data.productionDate = String(record.productionDate).slice(0, 10);
  let review = view?.reviewReference || view?.server?.reviewReference || {};
  let selections = (
    view?.traceSelections ||
    view?.traceLinks ||
    view?.server?.traceLinks ||
    []
  ).filter(
    (x) => !x.downstreamRevisionId || x.downstreamRevisionId === revision?.id,
  );
  let dirty = false,
    editGeneration = 0,
    saving = false,
    pendingRequest = null,
    closed = false,
    conflicted = view?.status === "CONFLICT";
  const localStatus = el(
    "span",
    { class: "record-sync-status" },
    badge(view?.status || (!record.currentRevisionNo ? "UNSAVED" : "SYNCED")),
  );
  const reviewBadge = el("span", {}, badge(review.status));
  const permission = context.permissions || form.permissions || {};
  const canEdit =
    permission.canEdit !== false &&
    permission.canEdit !== 0 &&
    !record.archivedAt &&
    !view?.deleted &&
    !view?.remoteDeleted;
  const canCreate =
    permission.canCreate !== false && permission.canCreate !== 0;
  const editable = record.currentRevisionNo ? canEdit : canCreate;
  const productionDate = textInput(String(record.productionDate).slice(0, 10), {
    type: "date",
    required: true,
    disabled: !!record.currentRevisionNo || !editable,
  });
  const area = select(
    (context.areaAssignments || []).map((a) => ({
      value: a.id,
      label: a.areaName || a.name || a.areaId || a.id,
    })),
    record.areaPpmAssignmentId,
    { disabled: !!record.currentRevisionNo || !editable },
  );
  const batch = textInput(record.batchNo || "", {
      disabled: !!record.currentRevisionNo || !editable,
      placeholder: "Optional business batch",
    }),
    lot = textInput(record.lotNo || "", {
      disabled: !!record.currentRevisionNo || !editable,
      placeholder: "Optional lot reference",
    });
  const traceInputs = {
    connections: context.connections || [],
    outputs:
      context.outputs ||
      context.sources?.flatMap((s) =>
        (s.outputs || []).map((o) => ({
          ...o,
          sourcePpmFormId: s.sourcePpmFormId,
        })),
      ) ||
      [],
    search: app.api.token
      ? (query) =>
          app.api.request(
            `/forms/${form.id}/trace-inputs?` +
              new URLSearchParams({ q: query, limit: 100 }),
          )
      : null,
  };
  const rendererOptions = {
    definition: template.definitionJson,
    data,
    readonly: !editable,
    permissions: permission,
    traceInputs,
    traceSelections: selections,
    title: template.definitionJson.title || form.title,
    metadata: template,
    isExisting: Number(record.currentRevisionNo) > 0,
    onChange: () => {
      editGeneration++;
      dirty = true;
      app.pendingNavigation = true;
      localStatus.replaceChildren(badge("UNSAVED"));
      if (mobile) autosave();
    },
  };
  let renderer = new FormRenderer(rendererOptions);
  renderer.setReview(review);
  const viewport = new DocumentViewport(renderer.root, { title: form.title });
  const statusMessage = el("p", { class: "save-message", role: "status" });
  const title = el(
    "div",
    { class: "record-heading" },
    el(
      "div",
      {},
      el("span", { class: "eyebrow" }, form.ppmCode),
      el(
        "h1",
        {},
        record.currentRevisionNo
          ? "Production record"
          : "New production record",
      ),
      el("p", {}, `${record.id} · template v${template.versionNo}`),
    ),
    el("div", { class: "actions" }, reviewBadge, localStatus),
  );
  const errorPanel = el("div", { class: "record-errors", role: "alert" });
  const footer = el("div", { class: "record-action-bar" });
  const saveButton = button(
    mobile ? "Save & queue" : "Save record",
    () => save(false),
    { kind: "primary", glyph: "save", disabled: !editable },
  );
  const submitButton = button("Submit record", () => save(true), {
    glyph: "check",
    disabled: !editable,
  });
  const backButton = button("Records", () => app.navigate("records"), {
    small: true,
    glyph: "back",
  });
  const more = el(
    "div",
    { class: "actions" },
    record.currentRevisionNo
      ? button("History", () => history(app, record, form, context), {
          glyph: "history",
        })
      : null,
    record.currentRevisionNo &&
      !mobile &&
      ["ADMIN", "FSQA", "SUPERVISOR", "PLANT_MANAGER"].includes(app.user.role)
      ? button(
          "Review",
          () =>
            reviewRecord(
              app,
              { ...record, currentRevisionNo: dataBaseRevisionNo },
              review,
              (updated) => {
                review = updated.reviewReference || {};
                renderer.setReview(review);
                reviewBadge.replaceChildren(badge(review.status));
              },
            ),
          { glyph: "check" },
        )
      : null,
  );
  if (record.currentRevisionNo && !mobile) {
    more.append(
      button(
        "Conflicts",
        () =>
          showConflicts(app, {
            record,
            form,
            context,
            template,
            onResolved: () => app.editRecord(record.id, form),
          }),
        { glyph: "history" },
      ),
      button("Source impacts", () => showImpacts(app, record, form), {
        glyph: "trace",
      }),
      button(
        "Publish outputs",
        () =>
          publishOutputs(app, {
            ...record,
            currentRevisionNo: dataBaseRevisionNo,
          }),
        {
          glyph: "trace",
        },
      ),
      button("Delete", () => removeRecord(), {
        glyph: "trash",
        disabled: !editable,
      }),
    );
  }
  const editorMeta = el(
    "details",
    { class: "record-identification", open: !record.currentRevisionNo },
    el("summary", {}, "Record identification"),
    el(
      "div",
      { class: "field-grid four" },
      field("Production date", productionDate),
      field("Area assignment", area),
      field("Batch identifier", batch),
      field("Lot identifier", lot),
    ),
  );
  const syncNotice = mobile
    ? el(
        "div",
        { class: "offline-notice" },
        el(
          "span",
          {},
          "Changes are encrypted on this device. “Synced” appears only after server confirmation.",
        ),
        button("Sync now", () => synchronize(), { small: true, glyph: "sync" }),
      )
    : null;
  app.main.append(
    el("div", { class: "back-row" }, backButton, more),
    title,
    editorMeta,
    syncNotice,
    errorPanel,
    viewport.root,
    footer,
  );
  footer.append(
    statusMessage,
    el("div", { class: "actions" }, saveButton, submitButton),
  );
  if (view?.status === "CONFLICT" || view?.error?.error === "REVISION_CONFLICT")
    renderConflict();
  for (const input of [productionDate, area, batch, lot])
    input.addEventListener("input", () => {
      editGeneration++;
      dirty = true;
      app.pendingNavigation = true;
      localStatus.replaceChildren(badge("UNSAVED"));
      if (mobile) autosave();
    });
  const envelope = () => ({
    id: record.id,
    ppmFormId: form.id,
    record: {
      ...record,
      productionDate: productionDate.value,
      areaPpmAssignmentId: area.value,
      ...(batch.value ? { batchNo: batch.value } : {}),
      ...(lot.value ? { lotNo: lot.value } : {}),
    },
    revision: { ...revision, dataJson: renderer.getData() },
    dataJson: renderer.getData(),
    traceSelections: renderer.getSelections(),
    reviewReference: review,
    serverRevisionNo: Number(
      view?.serverRevisionNo ?? record.currentRevisionNo ?? 0,
    ),
    localBaseRevisionNo: dataBaseRevisionNo,
    editorSessionId,
    expectedLocalEditVersion,
    status: dirty ? "SAVED_LOCALLY" : view?.status || "SAVED_LOCALLY",
  });
  const persist = async (propagateError = false) => {
    if (!mobile || closed) return;
    const savedGeneration = editGeneration;
    try {
      const stored = await app.store.saveDraft(envelope());
      expectedLocalEditVersion = Number(stored.localEditVersion);
      if (editGeneration === savedGeneration) {
        statusMessage.textContent = "Saved locally";
        localStatus.replaceChildren(badge("SAVED_LOCALLY"));
        app.pendingNavigation = false;
      }
    } catch (error) {
      statusMessage.textContent = "Local save failed. Keep this form open.";
      showError(error);
      if (propagateError) throw error;
    }
  };
  const autosave = debounce(persist, 650);
  function payload(operation) {
    const mutation = {
      clientMutationId: crypto.randomUUID(),
      recordId: record.id,
      operationType: operation,
      baseRevisionNo: dataBaseRevisionNo,
    };
    if (operation !== "QUEUE_SUBMIT") {
      mutation.dataJson = renderer.getData();
      mutation.traceSelections = renderer.getSelections();
    }
    if (operation === "CREATE_DRAFT")
      Object.assign(mutation, {
        templateVersionId: template.id,
        areaPpmAssignmentId: area.value,
        productionDate: productionDate.value,
        ...(batch.value ? { batchNo: batch.value } : {}),
        ...(lot.value ? { lotNo: lot.value } : {}),
      });
    return mutation;
  }
  async function save(submit) {
    if (saving) return;
    if (!productionDate.value || !area.value) {
      showError(new Error("Select a production date and area assignment"));
      editorMeta.open = true;
      return;
    }
    const errors = renderer.validate(submit);
    errorPanel.replaceChildren();
    if (errors.length) {
      errorPanel.append(
        el(
          "p",
          {},
          `Check ${errors.length} ${errors.length === 1 ? "field" : "fields"} before ${submit ? "submitting" : "saving"}.`,
        ),
      );
      return;
    }
    saving = true;
    saveButton.disabled = true;
    submitButton.disabled = true;
    // Preserve the exact payload during a write. An interrupted online write
    // remains immutable until its retry returns a durable receipt.
    renderer.root.inert = true;
    editorMeta.inert = true;
    try {
      if (mobile) {
        await persist(true);
        const queueContext = {
          ppmFormId: form.id,
          deviceId: context.deviceId,
          leaseVersion: context.leaseVersion,
          plantTimezone: context.plantTimezone,
          userId: app.user.id,
          authorProof: context.authorProof,
          editorSessionId,
          expectedLocalEditVersion,
        };
        const prior = (await app.store.list("queue")).some(
          (q) =>
            q.mutation.recordId === record.id &&
            q.mutation.operationType === "CREATE_DRAFT",
        );
        const operation =
          Number(view?.serverRevisionNo ?? record.currentRevisionNo ?? 0) > 0 ||
          prior
            ? "UPDATE_DRAFT"
            : "CREATE_DRAFT";
        await app.store.queueMutation(queueContext, payload(operation));
        if (submit)
          await app.store.queueMutation(queueContext, payload("QUEUE_SUBMIT"));
        const queuedLocal = await app.store.get("records", record.id);
        if (queuedLocal?.editorSessionId === editorSessionId)
          expectedLocalEditVersion = Number(queuedLocal.localEditVersion);
        dirty = false;
        app.pendingNavigation = false;
        localStatus.replaceChildren(badge("PENDING_SYNC"));
        statusMessage.textContent =
          "Saved locally and queued for synchronization";
        notify("Record saved on this device");
        if (navigator.onLine && app.api.token) void synchronize();
      } else {
        let retried = false,
          submitted = false;
        if (pendingRequest) {
          const attempt = pendingRequest;
          const response = await app.api.request(attempt.path, {
            method: attempt.method,
            body: attempt.body,
          });
          handleResponse(response);
          submitted = attempt.stage === "submit";
          pendingRequest = null;
          retried = true;
        }
        if (!retried && (dirty || !record.currentRevisionNo || !submit)) {
          const body = payload(
            record.currentRevisionNo ? "UPDATE_DRAFT" : "CREATE_DRAFT",
          );
          body.ppmFormId = form.id;
          delete body.operationType;
          pendingRequest = {
            path: record.currentRevisionNo
              ? `/records/${record.id}`
              : "/records",
            method: record.currentRevisionNo ? "PATCH" : "POST",
            body,
            stage: "save",
          };
          handleResponse(
            await app.api.request(pendingRequest.path, {
              method: pendingRequest.method,
              body: pendingRequest.body,
            }),
          );
          pendingRequest = null;
        }
        if (submit && !submitted) {
          pendingRequest = {
            path: `/records/${record.id}/submit`,
            method: "POST",
            body: {
              clientMutationId: crypto.randomUUID(),
              baseRevisionNo: dataBaseRevisionNo,
            },
            stage: "submit",
          };
          handleResponse(
            await app.api.request(pendingRequest.path, {
              method: pendingRequest.method,
              body: pendingRequest.body,
            }),
          );
          pendingRequest = null;
        }
        dirty = false;
        app.pendingNavigation = false;
        statusMessage.textContent = submit
          ? "Submitted to the server"
          : "Saved to the server";
        localStatus.replaceChildren(badge("SYNCED"));
        notify(submit ? "Record submitted" : "Record saved");
      }
    } catch (error) {
      renderer.showServerError(error);
      errorPanel.replaceChildren(el("p", {}, errorMessage(error)));
      showError(error);
      if (mobile)
        statusMessage.textContent =
          "Local record retained. Reconnect or resolve the reported issue.";
      else if (
        pendingRequest &&
        (error.ambiguous || !error.status || error.status >= 500)
      )
        statusMessage.textContent =
          "Confirmation was interrupted. Save again to retry the exact operation. Editing resumes after confirmation.";
      else pendingRequest = null;
      if (conflicted) renderConflict();
    } finally {
      saving = false;
      saveButton.disabled = !editable || conflicted;
      submitButton.disabled = !editable || conflicted;
      renderer.root.inert = !!pendingRequest;
      editorMeta.inert = !!pendingRequest;
    }
  }
  function handleResponse(
    response,
    expectedMutationId = pendingRequest?.body?.clientMutationId,
  ) {
    if (
      !response.result ||
      !["APPLIED", "CONFLICT", "REJECTED"].includes(response.result.status)
    )
      throw new Error(
        "The server did not return a durable operation result. Retry the same operation.",
      );
    if (response.result?.status === "CONFLICT") {
      view = { ...view, status: "CONFLICT", error: response.result };
      renderConflict(response.result);
      throw Object.assign(
        new Error("Concurrent changes detected. Both versions were preserved."),
        { status: 409 },
      );
    }
    if (response.result?.status === "REJECTED")
      throw Object.assign(
        new Error(response.result.error || "Record rejected"),
        response.result,
        { status: 422 },
      );
    if (
      !response.result.receiptId ||
      response.result.recordId !== record.id ||
      !Number.isInteger(Number(response.result.revisionNo)) ||
      Number(response.result.revisionNo) < 1 ||
      (expectedMutationId &&
        response.result.clientMutationId !== expectedMutationId)
    )
      throw new Error(
        "The durable server receipt is incomplete. Retry the exact operation to confirm it.",
      );
    if (response.record) {
      record = response.record.record;
      revision = response.record.revision;
      dataBaseRevisionNo = Number(
        revision?.revisionNo ??
          response.result.revisionNo ??
          record.currentRevisionNo,
      );
      review = response.record.reviewReference || review;
      view = response.record;
      if (revision?.dataJson)
        replaceDisplayedData(
          revision.dataJson,
          response.record.traceLinks || [],
          true,
        );
      renderer.setReview(review);
      productionDate.disabled =
        area.disabled =
        batch.disabled =
        lot.disabled =
          true;
    } else if (response.result?.revisionNo) {
      record.currentRevisionNo = response.result.revisionNo;
      dataBaseRevisionNo = Number(response.result.revisionNo);
    }
  }
  function replaceDisplayedData(nextData, nextSelections, existing = true) {
    if (
      JSON.stringify(renderer.getData()) === JSON.stringify(nextData) &&
      JSON.stringify(renderer.getSelections()) ===
        JSON.stringify(nextSelections)
    )
      return;
    const left = viewport.viewport.scrollLeft,
      top = viewport.viewport.scrollTop;
    renderer = new FormRenderer({
      ...rendererOptions,
      data: nextData,
      traceSelections: nextSelections,
      isExisting: existing,
    });
    renderer.setReview(review);
    viewport.stage.replaceChildren(renderer.root);
    viewport.measure();
    viewport.viewport.scrollLeft = left;
    viewport.viewport.scrollTop = top;
  }
  function applyLocalSnapshot(latest) {
    view = latest;
    const server = latest.server || latest;
    // The engine advances this base only for our own confirmed ancestors. A
    // remote change updates serverRevisionNo while retaining the local base.
    if (
      latest.localBaseRevisionNo != null &&
      latest.editorSessionId === editorSessionId
    ) {
      dataBaseRevisionNo = Number(latest.localBaseRevisionNo);
      expectedLocalEditVersion = Number(latest.localEditVersion || 0);
    }
    if (!dirty && !saving) {
      const nextData =
        latest.dataJson ||
        latest.revision?.dataJson ||
        server.revision?.dataJson;
      if (nextData) {
        replaceDisplayedData(
          nextData,
          latest.traceSelections ||
            latest.traceLinks ||
            server.traceLinks ||
            [],
        );
        dataBaseRevisionNo = Number(
          latest.localBaseRevisionNo ??
            latest.serverRevisionNo ??
            server.record?.currentRevisionNo ??
            dataBaseRevisionNo,
        );
        expectedLocalEditVersion = Number(latest.localEditVersion || 0);
      }
    }
    if (server.record) record = { ...record, ...server.record };
    if (server.revision) revision = server.revision;
    review = latest.reviewReference || server.reviewReference || review;
    renderer.setReview(review);
    reviewBadge.replaceChildren(badge(review.status));
    localStatus.replaceChildren(badge(latest.status));
    if (latest.status === "CONFLICT" && !conflicted)
      renderConflict(latest.error);
  }
  async function synchronize() {
    if (!app.api.token || !navigator.onLine) {
      notify("Saved changes will synchronize after you reconnect and sign in.");
      return;
    }
    try {
      localStatus.replaceChildren(badge("SYNCING"));
      await app.engine.sync();
      const latest = await app.store.get("records", record.id);
      if (latest) {
        applyLocalSnapshot(latest);
        if (latest.status === "FAILED")
          statusMessage.textContent = errorMessage(latest.error);
        else
          statusMessage.textContent =
            latest.status === "SYNCED"
              ? "Server confirmed this record"
              : "Latest local edits are retained";
      }
    } catch (error) {
      showError(error);
      const latest = await app.store.get("records", record.id);
      localStatus.replaceChildren(badge(latest?.status || "PENDING_SYNC"));
    }
  }
  function renderConflict(result = view?.error) {
    conflicted = true;
    if (view?.remoteDeleted || view?.deleted) {
      errorPanel.replaceChildren(
        el(
          "div",
          { class: "conflict-banner" },
          el("h3", {}, "Server deletion requires reconciliation"),
          el(
            "p",
            {},
            "This record was deleted on the server. Your unsynchronized local copy is retained on this device. It cannot overwrite the deletion or restore the same record identifier.",
          ),
          button(
            "Open synchronization and recovery",
            () => app.navigate("sync"),
            { glyph: "sync" },
          ),
        ),
      );
      saveButton.disabled = submitButton.disabled = true;
      return;
    }
    errorPanel.replaceChildren(
      el(
        "div",
        { class: "conflict-banner" },
        el("h3", {}, "Changes need reconciliation"),
        el(
          "p",
          {},
          "Your local version and the server version are preserved. Compare them before deciding what to keep.",
        ),
        button(
          "Compare versions",
          () =>
            conflictDialog(app, {
              record,
              form,
              context,
              template,
              localData: renderer.getData(),
              localSelections: renderer.getSelections(),
              conflict: result || view?.conflict,
              onResolved: () => app.editRecord(record.id, form),
            }),
          { glyph: "history" },
        ),
      ),
    );
    saveButton.disabled = submitButton.disabled = true;
  }
  async function removeRecord() {
    if (mobile) return;
    if (
      !(await confirmAction(
        "Delete this record?",
        "A deletion marker and audit history will remain. Connected trace outputs may need revalidation.",
        "Delete record",
      ))
    )
      return;
    const reason = textInput("", {
      required: true,
      placeholder: "Reason for deletion",
    });
    let deletionRequest = null;
    const d = modal("Deletion reason", field("Reason", reason));
    d.querySelector(".dialog-actions").append(
      button(
        "Confirm deletion",
        async (event) => {
          if (!reason.reportValidity()) return;
          const trigger = event.currentTarget;
          trigger.disabled = true;
          reason.disabled = true;
          deletionRequest ||= {
            clientMutationId: crypto.randomUUID(),
            baseRevisionNo: dataBaseRevisionNo,
            reason: reason.value,
          };
          try {
            const response = await app.api.request(`/records/${record.id}`, {
              method: "DELETE",
              body: deletionRequest,
            });
            handleResponse(response, deletionRequest.clientMutationId);
            if (response.result?.status !== "APPLIED")
              throw new Error("Deletion was not confirmed");
            d.close();
            app.pendingNavigation = false;
            notify("Record deleted with its audit history retained");
            app.navigate("records");
          } catch (error) {
            showError(error);
            if (!error.ambiguous && error.status && error.status < 500) {
              deletionRequest = null;
              reason.disabled = false;
            }
          } finally {
            trigger.disabled = false;
          }
        },
        { kind: "danger" },
      ),
    );
  }
  const syncListener = async () => {
    if (closed || !mobile) return;
    const latest = await app.store.get("records", record.id);
    if (latest) {
      applyLocalSnapshot(latest);
    }
  };
  document.addEventListener("ppms-sync-status", syncListener);
  const beforeUnload = (e) => {
    if (dirty && (!mobile || app.pendingNavigation)) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", beforeUnload);
  app.cleanup = () => {
    autosave.cancel();
    app.flushCurrent = null;
    closed = true;
    viewport.destroy();
    document.removeEventListener("ppms-sync-status", syncListener);
    window.removeEventListener("beforeunload", beforeUnload);
  };
  app.flushCurrent = mobile
    ? async () => {
        if (!dirty || !app.pendingNavigation || closed) return;
        autosave.cancel();
        renderer.root.inert = editorMeta.inert = true;
        try {
          await persist(true);
        } finally {
          renderer.root.inert = editorMeta.inert = false;
        }
      }
    : null;
}

async function history(app, record, form, context) {
  try {
    if (!app.api.token)
      throw new Error("Reconnect to load full record history");
    const content = el("div", { class: "history-list" }),
      pager = el("div", { class: "pagination" });
    const d = modal("Record history", el("div", {}, content, pager), [], {
      wide: true,
    });
    let beforeRevisionNo = null;
    const previousCursors = [];
    const load = async () => {
      try {
        const params = new URLSearchParams({ limit: 25 });
        if (beforeRevisionNo !== null)
          params.set("beforeRevisionNo", beforeRevisionNo);
        const result = await app.api.request(
          `/records/${record.id}/history?` + params,
        );
        content.replaceChildren();
        for (const item of result.items || [])
          content.append(
            el(
              "article",
              { class: "history-item" },
              el(
                "div",
                {},
                el("strong", {}, `Revision ${item.revisionNo}`),
                badge(item.status),
                el("span", {}, dateLabel(item.createdAt)),
              ),
              item.correctionReason ? el("p", {}, item.correctionReason) : null,
              button(
                "View revision",
                async () => {
                  try {
                    const template =
                      context.templates.find(
                        (t) => t.id === record.templateVersionId,
                      ) ||
                      (await app.api.request(
                        "/templates/" + record.templateVersionId,
                      ));
                    const renderer = new FormRenderer({
                      definition: template.definitionJson,
                      data: item.dataJson,
                      readonly: true,
                      title: form.title,
                      metadata: template,
                    });
                    renderer.setReview({});
                    const viewport = new DocumentViewport(renderer.root);
                    const revisionDialog = modal(
                      `Revision ${item.revisionNo}`,
                      viewport.root,
                      [],
                      { wide: true },
                    );
                    revisionDialog.addEventListener(
                      "close",
                      () => viewport.destroy(),
                      { once: true },
                    );
                  } catch (error) {
                    showError(error);
                  }
                },
                { small: true, glyph: "eye" },
              ),
            ),
          );
        pager.replaceChildren(
          button(
            "Newer revisions",
            () => {
              beforeRevisionNo = previousCursors.pop();
              load();
            },
            { small: true, disabled: !previousCursors.length },
          ),
          el(
            "span",
            {},
            `${result.total} revisions · ${result.items.length} shown`,
          ),
          button(
            "Older revisions",
            () => {
              previousCursors.push(beforeRevisionNo);
              beforeRevisionNo = result.nextBeforeRevisionNo;
              load();
            },
            { small: true, disabled: !result.hasMore },
          ),
        );
      } catch (error) {
        showError(error);
      }
    };
    await load();
  } catch (error) {
    showError(error);
  }
}

function reviewRecord(app, record, reference, onUpdated) {
  const status = select(
      [
        "PENDING_REVIEW",
        "UNDER_REVIEW",
        "APPROVED",
        "RETURNED_FOR_REVISION",
      ].map((v) => ({ value: v, label: v.toLowerCase().replaceAll("_", " ") })),
      reference.status || "PENDING_REVIEW",
    ),
    name = textInput(reference.reviewerName || app.user.displayName),
    position = textInput(
      reference.reviewerPosition ||
        app.user.role.toLowerCase().replaceAll("_", " "),
    ),
    remarks = el("textarea", {
      rows: 4,
      value: reference.remarks || "",
      maxLength: 2000,
    });
  const form = el(
    "form",
    {},
    el(
      "p",
      { class: "muted" },
      "A review reference tracks responsibility and disposition. It does not lock normal record entry.",
    ),
    reference.reviewedRevisionNo &&
      Number(reference.reviewedRevisionNo) !== Number(record.currentRevisionNo)
      ? el(
          "p",
          { class: "notice" },
          "This record changed after its last review. Review the current revision before updating the reference.",
        )
      : null,
    field("Review status", status),
    el(
      "div",
      { class: "field-grid" },
      field("Reviewer name", name),
      field("Position", position),
    ),
    field("Remarks", remarks),
  );
  const d = modal("Review reference", form);
  d.querySelector(".dialog-actions").append(
    button(
      "Save review",
      async () => {
        try {
          const updated = await app.api.request(
            `/records/${record.id}/review`,
            {
              method: "POST",
              body: {
                status: status.value,
                reviewerName: name.value,
                reviewerPosition: position.value,
                remarks: remarks.value,
                expectedRevisionNo: Number(record.currentRevisionNo),
                expectedReviewVersion: Number(reference.version || 0),
              },
            },
          );
          onUpdated(updated);
          d.close();
          notify("Review reference updated");
        } catch (error) {
          showError(error);
        }
      },
      { kind: "primary", glyph: "check" },
    ),
  );
}

async function publishOutputs(app, record) {
  try {
    const result = await app.api.request(`/records/${record.id}/publish`, {
      method: "POST",
      body: { baseRevisionNo: Number(record.currentRevisionNo) },
    });
    const content = el("div", { class: "output-list" });
    for (const output of result.outputs || [])
      content.append(
        el(
          "article",
          {},
          el("strong", {}, output.outputCode),
          el("p", {}, output.outputKey),
          badge(output.status),
        ),
      );
    modal("Published trace outputs", content);
    notify("Trace outputs published");
  } catch (error) {
    showError(error);
  }
}

async function showConflicts(app, options) {
  try {
    const result = await app.api.request(
      `/records/${options.record.id}/conflicts?limit=100`,
    );
    const body = el("div");
    const d = modal("Open conflicts", body, [], { wide: true });
    for (const conflict of result.items || []) {
      const patch = conflict.localPatchJson || {};
      body.append(
        el(
          "article",
          { class: "history-item" },
          el(
            "div",
            {},
            el("strong", {}, `Server revision ${conflict.serverRevisionNo}`),
            badge(conflict.status),
          ),
          el(
            "p",
            {},
            `Retained local update based on revision ${conflict.baseRevisionNo}`,
          ),
          button(
            "Compare and resolve",
            () => {
              d.close();
              conflictDialog(app, {
                ...options,
                localData: patch.dataJson || {},
                localSelections: patch.traceSelections || [],
                conflict: { ...conflict, conflictId: conflict.id },
              });
            },
            { small: true, glyph: "history" },
          ),
        ),
      );
    }
    if (!result.items?.length)
      body.append(
        el(
          "p",
          { class: "muted" },
          "There are no open conflicts for this record.",
        ),
      );
  } catch (error) {
    showError(error);
  }
}

async function showImpacts(app, record, form) {
  try {
    const response = await app.api.request(
      `/forms/${form.id}/revalidations?recordId=${encodeURIComponent(record.id)}&limit=100`,
    );
    const rows = (response.items || []).filter((r) => r.recordId === record.id);
    const body = el("div");
    const d = modal("Source revalidation", body, [], { wide: true });
    for (const item of rows) {
      const card = el(
        "article",
        { class: "history-item" },
        el(
          "div",
          {},
          el("strong", {}, item.downstreamInputKey),
          badge(item.status),
        ),
        el("p", {}, item.reason || "A connected source changed."),
        el("small", {}, `Source ${item.sourceTraceOutputId}`),
      );
      if (item.status !== "RESOLVED") {
        const decision = select(
            [
              {
                value: "REPLACED_SOURCE",
                label: "Verified replacement selected on this record",
              },
              {
                value: "ACCEPT_HISTORICAL",
                label: "Retain historical source with reviewer acknowledgement",
              },
            ],
            "REPLACED_SOURCE",
          ),
          notes = textInput("", { required: true });
        card.append(
          field("Disposition", decision),
          field("Reviewer notes", notes),
          button(
            "Resolve impact",
            async () => {
              if (!notes.reportValidity()) return;
              try {
                await app.api.request(
                  `/revalidations/items/${item.id}/resolve`,
                  {
                    method: "POST",
                    body: {
                      decision: decision.value,
                      notes: notes.value,
                      baseRevisionNo: Number(record.currentRevisionNo),
                    },
                  },
                );
                d.close();
                notify("Source impact resolved");
                showImpacts(app, record, form);
              } catch (error) {
                showError(error);
              }
            },
            { small: true, glyph: "check" },
          ),
        );
      }
      body.append(card);
    }
    if (!rows.length)
      body.append(
        el(
          "p",
          { class: "muted" },
          "No source impacts are recorded for this record.",
        ),
      );
  } catch (error) {
    showError(error);
  }
}

async function conflictDialog(
  app,
  {
    record,
    form,
    context,
    template,
    localData,
    localSelections = [],
    conflict,
    onResolved,
  },
) {
  try {
    if (!app.api.token)
      throw new Error("Reconnect and sign in to resolve this conflict");
    const current = await app.api.request(`/records/${record.id}`);
    const conflictId = conflict?.conflictId || conflict?.details?.conflictId;
    if (!conflictId)
      throw new Error(
        "The conflict reference is not available. Refresh synchronization before resolving it.",
      );
    const localRenderer = new FormRenderer({
      definition: template.definitionJson,
      data: localData,
      readonly: false,
      isExisting: true,
      traceSelections: localSelections,
      traceInputs: {
        connections: context.connections || [],
        outputs: context.outputs || [],
        search: (q) =>
          app.api.request(
            `/forms/${form.id}/trace-inputs?` +
              new URLSearchParams({ q, limit: 100 }),
          ),
      },
      title: "Your retained version",
    });
    localRenderer.setReview({});
    const serverRenderer = new FormRenderer({
      definition: template.definitionJson,
      data: current.revision.dataJson,
      readonly: true,
      title: "Current server version",
    });
    serverRenderer.setReview(current.reviewReference);
    const left = new DocumentViewport(localRenderer.root),
      right = new DocumentViewport(serverRenderer.root);
    const reason = textInput("", {
      required: true,
      placeholder: "Explain the resolution",
    });
    const content = el(
      "div",
      {},
      el("div", { class: "conflict-comparison" }, left.root, right.root),
      field("Resolution reason", reason),
    );
    const d = modal("Resolve concurrent changes", content, [], { wide: true });
    let pendingResolution = null,
      queuedMutationId = null,
      resolving = false;
    const actions = d.querySelector(".dialog-actions");
    const resolve = async (type) => {
      if (resolving || !reason.reportValidity()) return;
      if (pendingResolution && pendingResolution.resolutionType !== type) {
        showError(
          new Error(
            "Retry the original resolution to confirm its server result before choosing another action.",
          ),
        );
        return;
      }
      if (
        !pendingResolution &&
        type === "MANUAL_MERGE" &&
        localRenderer.validate(false).length
      )
        return;
      pendingResolution ||= {
        clientMutationId: crypto.randomUUID(),
        baseRevisionNo: Number(current.record.currentRevisionNo),
        conflictId,
        resolutionType: type,
        reason: reason.value,
        ...(type === "MANUAL_MERGE"
          ? {
              dataJson: localRenderer.getData(),
              traceSelections: localRenderer.getSelections(),
            }
          : {}),
      };
      resolving = true;
      localRenderer.root.inert = true;
      reason.disabled = true;
      for (const action of actions.querySelectorAll("button"))
        action.disabled = true;
      try {
        let outcome;
        if (app.mode === "mobile") {
          if (!queuedMutationId) {
            const queued = await app.store.queueMutation(
              {
                ppmFormId: form.id,
                deviceId: context.deviceId,
                leaseVersion: context.leaseVersion,
                userId: app.user.id,
                authorProof: context.authorProof,
                plantTimezone: context.plantTimezone,
              },
              {
                ...pendingResolution,
                recordId: record.id,
                operationType: "CONFLICT_RESOLUTION",
              },
            );
            queuedMutationId = queued.mutationId;
          }
          await app.engine.sync();
          outcome = (await app.store.get("queue", queuedMutationId))?.outcome;
          if (!outcome)
            throw new Error(
              "Resolution is safely queued. Reconnect and retry this resolution to confirm its result.",
            );
        } else {
          const response = await app.api.request(
            `/records/${record.id}/resolve-conflict`,
            { method: "POST", body: pendingResolution },
          );
          outcome = response.result;
        }
        if (outcome?.status !== "APPLIED") {
          throw Object.assign(
            new Error(outcome?.error || "Resolution was not applied"),
            {
              status: ["REJECTED", "CONFLICT"].includes(outcome?.status)
                ? 409
                : undefined,
            },
          );
        }
        if (
          !outcome.receiptId ||
          outcome.recordId !== record.id ||
          outcome.clientMutationId !== pendingResolution.clientMutationId ||
          !Number.isInteger(Number(outcome.revisionNo))
        )
          throw new Error(
            "The server resolution receipt is incomplete. Retry the same resolution to confirm it.",
          );
        pendingResolution = null;
        d.close();
        notify("Conflict resolution confirmed by the server");
        onResolved();
      } catch (error) {
        showError(error);
        if (
          !queuedMutationId &&
          !error.ambiguous &&
          error.status &&
          error.status < 500
        )
          pendingResolution = null;
      } finally {
        resolving = false;
        localRenderer.root.inert = !!pendingResolution;
        reason.disabled = !!pendingResolution;
        for (const action of actions.querySelectorAll("button"))
          action.disabled = false;
      }
    };
    actions.append(
      button("Keep server version", () => resolve("KEEP_SERVER")),
      button(
        "Use reviewed local / merged version",
        () => resolve("MANUAL_MERGE"),
        { kind: "primary" },
      ),
    );
    d.addEventListener(
      "close",
      () => {
        left.destroy();
        right.destroy();
      },
      { once: true },
    );
  } catch (error) {
    showError(error);
  }
}
