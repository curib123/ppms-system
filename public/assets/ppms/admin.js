import {
  el,
  button,
  iconButton,
  field,
  textInput,
  searchInput,
  select,
  searchableSelect,
  modal,
  notify,
  showError,
  empty,
  sectionTitle,
  badge,
  dateLabel,
  confirmAction,
  readJSON,
  debounce,
  errorMessage,
} from "./ui.js";
import { fieldsOf, walkFields, clone } from "./schema.js";
import { FormRenderer } from "./renderer.js";
import { DocumentViewport } from "./viewport.js";
import { SyncEngine } from "./offline.js";

const roles = ["ADMIN", "PERSONNEL", "FSQA", "SUPERVISOR", "PLANT_MANAGER"];
export async function showPeople(app) {
  const search = searchInput("", {
      placeholder: "Search people…",
      "aria-label": "Search people",
    }),
    list = el("div"),
    pager = el("div", { class: "pagination" });
  let page = 1;
  const load = async () => {
    try {
      const result = await app.api.request(
        "/users?" + new URLSearchParams({ q: search.value, page, limit: 25 }),
      );
      list.replaceChildren();
      const table = el(
        "table",
        { class: "data-table" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            ...["Person", "Role", "Status", ""].map((v) =>
              el("th", { scope: "col" }, v),
            ),
          ),
        ),
      );
      const body = el("tbody");
      for (const user of result.items)
        body.append(
          el(
            "tr",
            {},
            el(
              "td",
              {},
              el("strong", {}, user.displayName),
              el("small", {}, user.username + " · " + user.email),
            ),
            el("td", {}, user.role.toLowerCase().replaceAll("_", " ")),
            el("td", {}, badge(user.accountStatus)),
            el(
              "td",
              {},
              el(
                "div",
                { class: "actions" },
                button("Edit", () => accountEditor(app, user, load), {
                  small: true,
                  glyph: "edit",
                }),
                button("Area access", () => areaAccess(app, user), {
                  small: true,
                  glyph: "users",
                }),
              ),
            ),
          ),
        );
      table.append(body);
      list.append(
        result.items.length
          ? el("div", { class: "data-table-scroll" }, table)
          : empty("No matching people", "Try a different name or username."),
      );
      pager.replaceChildren(
        button(
          "Previous",
          () => {
            page--;
            load();
          },
          { small: true, disabled: page === 1 },
        ),
        el("span", {}, `${result.total} people · page ${page}`),
        button(
          "Next",
          () => {
            page++;
            load();
          },
          { small: true, disabled: page * 25 >= result.total },
        ),
      );
    } catch (error) {
      showError(error);
    }
  };
  search.addEventListener(
    "input",
    debounce(() => {
      page = 1;
      load();
    }),
  );
  app.main.append(
    sectionTitle(
      "People & access",
      "Manage identities, roles and production-area access.",
      [
        button("Add person", () => accountEditor(app, null, load), {
          kind: "primary",
          glyph: "plus",
        }),
      ],
    ),
    el(
      "div",
      { class: "filters", role: "search", "aria-label": "Find people" },
      search,
    ),
    list,
    pager,
  );
  await load();
}
function accountEditor(app, user, onSaved) {
  const username = textInput(user?.username || "", {
      required: true,
      disabled: !!user,
      autoComplete: "off",
    }),
    name = textInput(user?.displayName || "", { required: true }),
    email = textInput(user?.email || "", { type: "email", required: true }),
    role = select(roles, user?.role || "PERSONNEL"),
    status = select(
      ["ACTIVE", "INACTIVE", "LOCKED"],
      user?.accountStatus || "ACTIVE",
    ),
    password = textInput("", {
      type: "password",
      autoComplete: "new-password",
      minLength: 12,
      maxLength: 72,
      required: !user,
    });
  const form = el(
    "form",
    {},
    el(
      "div",
      { class: "field-grid" },
      field("Username", username),
      field("Display name", name),
      field("Email", email),
      field("Role", role),
    ),
    user
      ? field("Account status", status)
      : field(
          "Initial password",
          password,
          "12–72 characters. Share it through your approved secure channel.",
        ),
  );
  const d = modal(user ? "Edit person" : "Add person", form);
  const save = button(
    "Save person",
    async () => {
      if (!form.reportValidity()) return;
      try {
        await app.api.request(user ? `/users/${user.id}` : "/users", {
          method: user ? "PATCH" : "POST",
          body: {
            username: username.value,
            displayName: name.value,
            email: email.value,
            role: role.value,
            ...(user
              ? { accountStatus: status.value }
              : { password: password.value }),
          },
        });
        password.value = "";
        d.close();
        notify("Person saved");
        onSaved();
      } catch (error) {
        showError(error);
      }
    },
    { kind: "primary" },
  );
  if (user)
    d.querySelector(".dialog-actions").append(
      button("Reset password", () => {
        const input = textInput("", {
          type: "password",
          minLength: 12,
          maxLength: 72,
          required: true,
          autoComplete: "new-password",
        });
        const reset = modal(
          "Reset password",
          field(
            "New password",
            input,
            "Existing sessions and offline author grants will be revoked.",
          ),
        );
        reset.querySelector(".dialog-actions").append(
          button(
            "Reset password",
            async () => {
              if (!input.reportValidity()) return;
              try {
                await app.api.request(`/users/${user.id}/reset-password`, {
                  method: "POST",
                  body: { newPassword: input.value },
                });
                input.value = "";
                reset.close();
                notify("Password reset and sessions revoked");
              } catch (error) {
                showError(error);
              }
            },
            { kind: "primary" },
          ),
        );
      }),
      button("Revoke sessions", async () => {
        if (
          await confirmAction(
            "Revoke sessions?",
            `Sign ${user.displayName} out of all active sessions. Their local records remain on their devices.`,
            "Revoke",
          )
        )
          try {
            await app.api.request(`/users/${user.id}/revoke-sessions`, {
              method: "POST",
              body: {},
            });
            notify("Sessions revoked");
          } catch (error) {
            showError(error);
          }
      }),
    );
  d.querySelector(".dialog-actions").append(save);
}
async function areaAccess(app, user) {
  try {
    const result = await app.api.request("/areas");
    const area = searchableSelect(
      result.items.map((a) => ({
        value: a.id,
        label: a.code + " · " + a.name,
      })),
      result.items[0]?.id,
    );
    const action = select(
      [
        { value: "true", label: "Grant current area access" },
        { value: "false", label: "Revoke area access" },
      ],
      "true",
    );
    const d = modal(
      "Area access · " + user.displayName,
      el(
        "div",
        {},
        el(
          "p",
          { class: "muted" },
          "Reviewer roles use their active production-area assignments. Personnel form permissions are managed on each form.",
        ),
        field("Production area", area),
        field("Action", action),
      ),
    );
    d.querySelector(".dialog-actions").append(
      button(
        "Apply access change",
        async () => {
          try {
            await app.api.request(`/users/${user.id}/areas/${area.value}`, {
              method: "PUT",
              body: { isActive: action.value === "true" },
            });
            d.close();
            notify("Area access updated");
          } catch (error) {
            showError(error);
          }
        },
        { kind: "primary" },
      ),
    );
  } catch (error) {
    showError(error);
  }
}

export async function showAssignments(app, form) {
  try {
    const [assignments, people, devices] = await Promise.all([
      app.api.request(`/forms/${form.id}/assignments`),
      app.api.request("/users?limit=100"),
      app.api.request("/devices?limit=100"),
    ]);
    const list = el("div", { class: "assignment-list" });
    for (const person of assignments.personnel || [])
      list.append(
        el(
          "div",
          { class: "assignment-row" },
          el(
            "strong",
            {},
            person.displayName || person.username || person.userId,
          ),
          el(
            "span",
            {},
            ["canView", "canCreate", "canEdit", "canPublish"]
              .filter((k) => Number(person[k]))
              .map((k) => k.replace("can", ""))
              .join(" · "),
          ),
        ),
      );
    const user = searchableSelect(
        people.items.map((u) => ({
          value: u.id,
          label: u.displayName + " · " + u.role.toLowerCase(),
        })),
        people.items[0]?.id,
      ),
      flags = {};
    const flagRow = el("div", { class: "check-options" });
    for (const [key, label] of Object.entries({
      isActive: "Active assignment",
      canView: "View",
      canCreate: "Create",
      canEdit: "Edit",
      canPublish: "Publish outputs",
    })) {
      flags[key] = el("input", {
        type: "checkbox",
        checked: key !== "canPublish",
      });
      flagRow.append(field(label, flags[key]));
    }
    const applyCurrent = () => {
      const existing = assignments.personnel.find(
        (p) => p.userId === user.value || p.id === user.value,
      );
      if (existing)
        for (const key of Object.keys(flags))
          flags[key].checked = Boolean(
            Number(existing[key] ?? (key === "isActive" ? 1 : 0)),
          );
    };
    user.addEventListener("change", applyCurrent);
    applyCurrent();
    const d = modal(
      "Assignments · " + form.ppmCode,
      el(
        "div",
        {},
        el("h3", {}, "Personnel permissions"),
        list,
        field("Person", user),
        flagRow,
        el("hr"),
        el("h3", {}, "Authorized devices"),
        el(
          "p",
          {},
          (assignments.leases || (assignments.lease ? [assignments.lease] : []))
            .map(
              (lease) =>
                `Device ${lease.deviceId} · version ${lease.leaseVersion}`,
            )
            .join("; ") || "No mobile devices authorized",
        ),
        button(
          "Authorize device for form",
          () =>
            assignDevice(
              app,
              form,
              devices.items,
              assignments.leases ||
                (assignments.lease ? [assignments.lease] : []),
              () => {
                d.close();
                showAssignments(app, form);
              },
            ),
          { glyph: "mobile" },
        ),
      ),
      [],
      { wide: true },
    );
    d.querySelector(".dialog-actions").append(
      button(
        "Save permissions",
        async () => {
          try {
            await app.api.request(`/forms/${form.id}/access/${user.value}`, {
              method: "PUT",
              body: Object.fromEntries(
                Object.entries(flags).map(([k, v]) => [k, v.checked]),
              ),
            });
            d.close();
            notify("Form permissions updated");
          } catch (error) {
            showError(error);
          }
        },
        { kind: "primary" },
      ),
    );
  } catch (error) {
    showError(error);
  }
}
function assignDevice(
  app,
  form,
  devices,
  memberships,
  onSaved,
  preferredDeviceId,
) {
  const leases = Array.isArray(memberships)
    ? memberships
    : memberships
      ? [memberships]
      : [];
  const uniqueDevices = [
    ...new Map(
      devices.filter((d) => !d.revokedAt).map((d) => [d.id, d]),
    ).values(),
  ];
  const device = searchableSelect(
    uniqueDevices.map((d) => ({
      value: d.id,
      label: d.displayName + " · " + d.id,
    })),
    preferredDeviceId || uniqueDevices[0]?.id,
  );
  const reason = textInput("", {
    placeholder: "Reason for authorizing or renewing this device",
  });
  const reconciled = el("input", { type: "checkbox" });
  const reconciliation = field(
    "I have reconciled pending work before renewing this device authorization",
    reconciled,
  );
  const current = () => leases.find((lease) => lease.deviceId === device.value);
  const update = () => {
    const renewal = !!current();
    reason.required = renewal;
    reconciled.required = renewal;
    reconciliation.hidden = !renewal;
    reconciled.checked = false;
  };
  device.addEventListener("change", update);
  update();
  const f = el(
    "form",
    {},
    field("Mobile device", device),
    field("Reason", reason),
    reconciliation,
    el(
      "p",
      { class: "field-hint" },
      "Each authorized device can enter records for this form. Concurrent changes use version checks and explicit conflict resolution.",
    ),
  );
  const d = modal("Authorize device · " + form.ppmCode, f);
  d.querySelector(".dialog-actions").append(
    button(
      "Authorize device",
      async () => {
        if (!f.reportValidity()) return;
        try {
          await app.api.request(`/forms/${form.id}/lease`, {
            method: "PUT",
            body: {
              deviceId: device.value,
              expectedLeaseVersion: Number(current()?.leaseVersion || 0),
              reason: reason.value || "Authorize device for form",
              reconciled: reconciled.checked,
            },
          });
          d.close();
          app.forms = (await app.api.request("/forms")).items;
          notify("Device authorized for form");
          onSaved?.();
        } catch (error) {
          showError(error);
        }
      },
      { kind: "primary" },
    ),
  );
}

export async function showSync(app) {
  if (app.mode === "mobile") {
    await mobileSync(app);
    return;
  }
  if (app.user.role !== "ADMIN") {
    app.main.append(
      sectionTitle(
        "Synchronization",
        "Device and batch recovery is managed by administrators.",
      ),
      empty("Administrator access required"),
    );
    return;
  }
  const deviceList = el("div"),
    batchList = el("div"),
    filter = searchableSelect(
      [
        { value: "", label: "All batch states" },
        ...["PUSHING", "PARTIAL", "ACCEPTED", "CONFLICTED", "REJECTED"].map(
          (v) => ({ value: v, label: v.toLowerCase() }),
        ),
      ],
      "",
      { "aria-label": "Filter batch status" },
    );
  let afterId = "",
    nextAfterId = null;
  const reloadBatches = async () => {
    const response = await app.api.request(
      "/sync/batches?" +
        new URLSearchParams({ limit: 25, status: filter.value, afterId }),
    );
    batchList.replaceChildren();
    const table = el(
      "table",
      { class: "data-table" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          ...["Batch", "Form", "State", "Results", ""].map((x) =>
            el("th", { scope: "col" }, x),
          ),
        ),
      ),
    );
    const body = el("tbody");
    for (const b of response.items) {
      const form = app.forms.find((f) => f.id === b.ppmFormId);
      body.append(
        el(
          "tr",
          {},
          el(
            "td",
            {},
            el("strong", {}, b.id.slice(0, 12)),
            el("small", {}, b.businessDate),
          ),
          el("td", {}, form?.ppmCode || b.ppmFormId),
          el("td", {}, badge(b.status)),
          el(
            "td",
            {},
            `${b.acceptedCount} applied · ${b.conflictCount} conflicts · ${b.rejectedCount} rejected`,
          ),
          el(
            "td",
            {},
            b.status === "PUSHING"
              ? button("Recover", () => recoverBatch(app, b, reloadBatches), {
                  small: true,
                  glyph: "sync",
                })
              : null,
          ),
        ),
      );
    }
    table.append(body);
    batchList.append(
      response.items.length
        ? el("div", { class: "data-table-scroll" }, table)
        : empty("No matching synchronization batches"),
    );
    nextAfterId = response.nextAfterId;
    batchList.append(
      el(
        "div",
        { class: "pagination" },
        button(
          "First page",
          () => {
            afterId = "";
            reloadBatches().catch(showError);
          },
          { small: true, disabled: !afterId },
        ),
        button(
          "Next page",
          () => {
            afterId = nextAfterId;
            reloadBatches().catch(showError);
          },
          { small: true, disabled: !response.hasMore },
        ),
      ),
    );
  };
  const reloadDevices = async () => {
    const { items, hasMore } = await app.api.request("/devices?limit=100");
    deviceList.replaceChildren();
    for (const device of items) {
      const form = app.forms.find((f) => f.id === device.ppmFormId);
      deviceList.append(
        el(
          "article",
          { class: "device-card" },
          el(
            "div",
            {},
            el("h3", {}, device.displayName),
            el("small", {}, device.id),
            el(
              "p",
              {},
              form ? form.ppmCode + " · " + form.title : "No form assigned",
            ),
            el("small", {}, "Last seen " + dateLabel(device.lastSeenAt)),
          ),
          badge(device.revokedAt ? "REVOKED" : "ACTIVE"),
          el(
            "div",
            { class: "actions" },
            button(
              "Authorize for form",
              () => {
                const choice = searchableSelect(
                  app.forms.map((f) => ({
                    value: f.id,
                    label: f.ppmCode + " · " + f.title,
                  })),
                  form?.id || app.forms[0]?.id,
                );
                const d = modal("Choose form", field("Form", choice));
                d.querySelector(".dialog-actions").append(
                  button(
                    "Continue",
                    async () => {
                      const selected = app.forms.find(
                        (f) => f.id === choice.value,
                      );
                      const assignments = await app.api.request(
                        `/forms/${selected.id}/assignments`,
                      );
                      d.close();
                      assignDevice(
                        app,
                        selected,
                        items,
                        assignments.leases ||
                          (assignments.lease ? [assignments.lease] : []),
                        reloadDevices,
                        device.id,
                      );
                    },
                    { kind: "primary" },
                  ),
                );
              },
              { small: true, glyph: "mobile", disabled: !!device.revokedAt },
            ),
            button(
              "Rotate credential",
              () => rotateDevice(app, device, reloadDevices),
              { small: true, disabled: !!device.revokedAt },
            ),
            button("Revoke", () => revokeDevice(app, device, reloadDevices), {
              small: true,
              disabled: !!device.revokedAt,
            }),
          ),
        ),
      );
    }
    if (!items.length)
      deviceList.append(
        empty(
          "No mobile devices",
          "Personnel register a device when they sign in to the mobile app.",
        ),
      );
    if (hasMore)
      deviceList.append(
        el(
          "p",
          { class: "notice" },
          "Showing the first 100 devices. Use the paginated device API for larger deployments.",
        ),
      );
  };
  filter.addEventListener("change", () => {
    afterId = "";
    reloadBatches().catch(showError);
  });
  app.main.append(
    sectionTitle(
      "Synchronization",
      "Inspect registered devices, committed batches and interrupted work.",
      [
        button(
          "Refresh",
          () =>
            Promise.all([reloadDevices(), reloadBatches()]).catch(showError),
          { glyph: "sync" },
        ),
      ],
    ),
    el("section", { class: "panel" }, el("h2", {}, "Devices"), deviceList),
    el(
      "section",
      { class: "panel" },
      el(
        "div",
        { class: "section-heading" },
        el("h2", {}, "Sync batches"),
        filter,
      ),
      batchList,
    ),
  );
  await Promise.all([reloadDevices(), reloadBatches()]);
}
async function mobileSync(app) {
  const list = el("div"),
    summary = el("div", { class: "metric-row" });
  const reload = async () => {
    const records = await app.store.listRecords();
    const queue = await app.store.list("queue");
    summary.replaceChildren();
    for (const state of [
      "SAVED_LOCALLY",
      "PENDING_SYNC",
      "SYNCED",
      "CONFLICT",
      "FAILED",
    ])
      summary.append(
        el(
          "div",
          { class: "metric" },
          el("strong", {}, records.filter((r) => r.status === state).length),
          el("span", {}, state.toLowerCase().replaceAll("_", " ")),
        ),
      );
    list.replaceChildren();
    for (const item of queue.filter(
      (q) => !["SYNCED", "RESOLVED"].includes(q.status),
    ))
      list.append(
        el(
          "article",
          { class: "queue-card" },
          el(
            "div",
            {},
            el(
              "strong",
              {},
              item.mutation.operationType.toLowerCase().replaceAll("_", " "),
            ),
            el("small", {}, item.mutation.recordId),
            item.error || item.outcome?.error
              ? el(
                  "p",
                  { class: "inline-error" },
                  errorMessage(item.error || item.outcome),
                )
              : null,
          ),
          badge(item.status),
          button(
            "Open record",
            () => {
              const form = app.forms.find(
                (f) => f.id === item.context.ppmFormId,
              );
              app.editRecord(item.mutation.recordId, form);
            },
            { small: true, glyph: "arrow" },
          ),
          item.batchId
            ? button(
                "Check server result",
                async () => {
                  try {
                    if (!app.api.token)
                      throw new Error(
                        "Sign in before checking the server result",
                      );
                    if (!app.engine) {
                      const context = await app.store.get(
                        "settings",
                        "context:" + item.context.ppmFormId,
                      );
                      app.engine = new SyncEngine({
                        store: app.store,
                        request: (p, o) => app.api.request(p, o),
                        onStatus: () => app.updateSyncStatus(),
                      });
                      await app.engine.configure(context);
                    }
                    await app.engine.reconcileBatch(item.batchId);
                    await reload();
                    notify("Durable server result checked");
                  } catch (error) {
                    showError(error);
                  }
                },
                { small: true, glyph: "sync" },
              )
            : null,
          item.outcome?.status === "REJECTED" ||
            (!item.batchId &&
              item.error?.error ===
                "DEVICE_ASSIGNMENT_CHANGED_RECONCILIATION_REQUIRED")
            ? button(
                "Reconcile and queue",
                () => reconcileRejected(app, item, reload),
                { small: true, glyph: "history" },
              )
            : null,
        ),
      );
    if (!list.childElementCount)
      list.append(
        empty(
          "No pending operations",
          "Saved local drafts remain protected on this device.",
        ),
      );
  };
  const sync = async () => {
    try {
      if (!app.api.token)
        throw new Error("Sign in online before synchronizing");
      if (!app.engine) {
        const form = app.forms.find((f) => f.deviceId === app.device?.id);
        if (!form)
          throw new Error(
            "Ask an administrator to assign this device to a form",
          );
        await app.formContext(form);
      }
      await app.engine.retry();
      await reload();
      notify("Synchronization checked");
    } catch (error) {
      showError(error);
    }
  };
  app.main.append(
    sectionTitle(
      "Synchronization",
      "Local work stays on this device until the server confirms it.",
      [button("Sync now", sync, { kind: "primary", glyph: "sync" })],
    ),
    summary,
    el("section", { class: "panel" }, el("h2", {}, "Pending work"), list),
    el(
      "section",
      { class: "panel" },
      el("h2", {}, "Device recovery"),
      el(
        "p",
        { class: "muted" },
        "Export an encrypted recovery copy before replacing this device. Keep its unlock passphrase separately.",
      ),
      button(
        "Download encrypted recovery copy",
        async () => {
          try {
            const data = await app.store.exportVault();
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(data)], { type: "application/json" }),
            );
            const a = el("a", {
              href: url,
              download: `ppms-encrypted-recovery-${new Date().toISOString().slice(0, 10)}.json`,
            });
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (error) {
            showError(error);
          }
        },
        { glyph: "download" },
      ),
      button("Connect rotated credential", () => connectDevice(app), {
        glyph: "mobile",
      }),
    ),
  );
  await reload();
  const listener = () => reload().catch(() => {});
  document.addEventListener("ppms-sync-status", listener);
  app.cleanup = () =>
    document.removeEventListener("ppms-sync-status", listener);
}
function connectDevice(app) {
  const id = textInput(app.device?.id || "", { required: true }),
    token = textInput("", {
      type: "password",
      required: true,
      minLength: 64,
      maxLength: 64,
      autoComplete: "off",
    });
  const form = el(
    "form",
    {},
    field("Device identifier", id),
    field("New device credential", token),
    el(
      "p",
      { class: "muted" },
      "Use the credential supplied by your administrator. Pending requests retain their original identities and may need reconciliation.",
    ),
  );
  const d = modal("Reconnect mobile device", form);
  d.querySelector(".dialog-actions").append(
    button(
      "Save credential",
      async () => {
        if (!form.reportValidity()) return;
        try {
          app.device = {
            ...app.device,
            id: id.value,
            deviceToken: token.value,
          };
          await app.store.put("settings", "device", app.device);
          token.value = "";
          d.close();
          app.forms = (await app.api.request("/forms")).items;
          notify(
            "Credential stored securely. Open your assigned form to reconnect.",
          );
        } catch (error) {
          showError(error);
        }
      },
      { kind: "primary" },
    ),
  );
}
function recoverBatch(app, batch, onDone) {
  const reason = textInput("", { required: true });
  const d = modal(
    "Recover interrupted batch",
    el(
      "div",
      {},
      el(
        "p",
        {},
        "Existing committed receipts will be preserved. Work not proven committed will be marked for reconciliation, not accepted silently.",
      ),
      field("Recovery reason", reason),
    ),
  );
  d.querySelector(".dialog-actions").append(
    button(
      "Finalize recovery",
      async () => {
        if (!reason.reportValidity()) return;
        try {
          const result = await app.api.request(
            `/sync/batches/${batch.id}/recover`,
            {
              method: "POST",
              body: {
                reason: reason.value,
                expectedPayloadHash: batch.payloadHash,
                action: "FINALIZE",
              },
            },
          );
          d.close();
          notify(`Recovered batch: ${String(result.status).toLowerCase()}`);
          await onDone();
        } catch (error) {
          showError(error);
        }
      },
      { kind: "primary", glyph: "sync" },
    ),
  );
}
async function reconcileRejected(app, item, onDone) {
  try {
    if (!app.api.token)
      throw new Error("Reconnect and sign in before reconciling work");
    const form = app.forms.find((f) => f.id === item.context.ppmFormId);
    if (!form)
      throw new Error(
        "A current form assignment is required before requeueing this work",
      );
    const context = await app.formContext(form);
    const local = await app.store.get("records", item.mutation.recordId);
    let server = null;
    try {
      server = await app.api.request("/records/" + item.mutation.recordId);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    if (server?.deleted || server?.record?.archivedAt)
      throw new Error(
        "The server deleted this record. Its local copy is retained; it cannot be restored by retrying an old change.",
      );
    const templateId =
      server?.record?.templateVersionId ||
      local?.record?.templateVersionId ||
      item.mutation.templateVersionId;
    let template = await app.store.get("templates", templateId);
    if (!template) template = await app.api.request("/templates/" + templateId);
    const selected = new FormRenderer({
      definition: template.definitionJson,
      data: local?.dataJson || item.mutation.dataJson || {},
      traceInputs: {
        connections: context.connections,
        outputs: context.outputs,
      },
      traceSelections:
        local?.traceSelections || item.mutation.traceSelections || [],
      title: "Retained local version",
      metadata: template,
      isExisting: !!server,
    });
    selected.setReview(local?.reviewReference || {});
    const left = new DocumentViewport(selected.root);
    const content = el("div");
    const comparison = el("div", { class: "conflict-comparison" }, left.root);
    let right;
    if (server) {
      const renderer = new FormRenderer({
        definition: template.definitionJson,
        data: server.revision.dataJson,
        readonly: true,
        title: "Current server version",
        metadata: template,
      });
      renderer.setReview(server.reviewReference);
      right = new DocumentViewport(renderer.root);
      comparison.append(right.root);
    } else
      comparison.append(
        empty(
          "No server record",
          "The operation was not durably applied. Review the retained data before creating a new request.",
        ),
      );
    const reason = textInput("", { required: true }),
      reviewed = el("input", { type: "checkbox", required: true });
    const formNode = el(
      "form",
      {},
      field("Reconciliation reason", reason),
      field(
        "I compared the retained data with the current server state",
        reviewed,
      ),
    );
    content.append(
      el(
        "p",
        { class: "muted" },
        `The new operation will use server revision ${Number(server?.record?.currentRevisionNo || 0)}. The rejected operation stays in the audit history.`,
      ),
      comparison,
      formNode,
    );
    const d = modal("Reconcile rejected work", content, [], { wide: true });
    d.querySelector(".dialog-actions").append(
      button(
        "Queue reviewed change",
        async () => {
          if (!formNode.reportValidity()) return;
          try {
            await app.engine.requeueRejected(item.id, {
              baseRevisionNo: Number(server?.record?.currentRevisionNo || 0),
              dataJson: selected.getData(),
              traceSelections: selected.getSelections(),
              reason: reason.value,
              reviewed: true,
            });
            d.close();
            await onDone();
            notify("Reviewed change queued with a new operation identity");
          } catch (error) {
            showError(error);
          }
        },
        { kind: "primary" },
      ),
    );
    d.addEventListener(
      "close",
      () => {
        left.destroy();
        right?.destroy();
      },
      { once: true },
    );
  } catch (error) {
    showError(error);
  }
}
function rotateDevice(app, device, onDone) {
  const reason = textInput("", { required: true });
  const d = modal(
    "Rotate device credential",
    field(
      "Reason",
      reason,
      "This advances the device lease. Reconcile pending requests before replacing credentials.",
    ),
  );
  d.querySelector(".dialog-actions").append(
    button(
      "Rotate credential",
      async () => {
        if (!reason.reportValidity()) return;
        try {
          const result = await app.api.request(
            `/devices/${device.id}/credentials`,
            { method: "POST", body: { reason: reason.value } },
          );
          d.close();
          const token = textInput(result.deviceToken, {
            type: "password",
            readOnly: true,
          });
          const view = modal(
            "New device credential",
            el(
              "div",
              {},
              el(
                "p",
                {},
                "Transfer this one-time credential through your approved secure channel, then enter it in the mobile synchronization screen.",
              ),
              field("Device ID", textInput(device.id, { readOnly: true })),
              field("Credential", token),
            ),
          );
          view.querySelector(".dialog-actions").append(
            button("Show / hide", () => {
              token.type = token.type === "password" ? "text" : "password";
            }),
            button("Copy credential", async () => {
              try {
                await navigator.clipboard.writeText(result.deviceToken);
                notify("Credential copied");
              } catch (error) {
                showError(error);
              }
            }),
          );
          await onDone();
        } catch (error) {
          showError(error);
        }
      },
      { kind: "primary" },
    ),
  );
}
function revokeDevice(app, device, onDone) {
  const reason = textInput("", { required: true });
  const d = modal("Revoke mobile device", field("Reason", reason));
  d.querySelector(".dialog-actions").append(
    button(
      "Revoke device",
      async () => {
        if (!reason.reportValidity()) return;
        try {
          await app.api.request(`/devices/${device.id}/revoke`, {
            method: "POST",
            body: { reason: reason.value },
          });
          d.close();
          notify("Device revoked");
          onDone();
        } catch (error) {
          showError(error);
        }
      },
      { kind: "danger" },
    ),
  );
}

export async function showSettings(app) {
  const result = await app.api.request("/settings");
  const controls = [];
  const form = el("form", { class: "settings-list" });
  for (const setting of result.items) {
    let input;
    if (setting.valueType === "BOOLEAN")
      input = el("input", {
        type: "checkbox",
        checked: setting.valueJson === true,
      });
    else if (setting.valueType === "INTEGER")
      input = textInput(setting.valueJson, { type: "number", step: 1 });
    else if (setting.valueType === "STRING")
      input = textInput(setting.valueJson);
    else
      input = el("textarea", {
        rows: 3,
        value: JSON.stringify(setting.valueJson, null, 2),
      });
    controls.push({ setting, input });
    form.append(
      el(
        "section",
        { class: "setting-row" },
        el(
          "div",
          {},
          el("label", { htmlFor: "setting-" + setting.key }, setting.key),
          el("p", {}, setting.description || ""),
        ),
        el("div", { class: "setting-control" }, input),
      ),
    );
    input.id = "setting-" + setting.key;
  }
  const save = button(
    "Save settings",
    async () => {
      try {
        const items = [];
        for (const { setting, input } of controls) {
          const value =
            setting.valueType === "BOOLEAN"
              ? input.checked
              : setting.valueType === "INTEGER"
                ? Number(input.value)
                : setting.valueType === "STRING"
                  ? input.value
                  : readJSON(input.value, setting.key);
          if (JSON.stringify(value) !== JSON.stringify(setting.valueJson))
            items.push({
              key: setting.key,
              valueJson: value,
              expectedUpdatedAt: setting.updatedAt,
            });
        }
        if (!items.length) {
          notify("No settings changed");
          return;
        }
        await app.api.request("/settings", { method: "PUT", body: { items } });
        notify("Settings saved");
        app.navigate("settings");
      } catch (error) {
        showError(error);
      }
    },
    { kind: "primary", glyph: "save" },
  );
  app.main.append(
    sectionTitle(
      "System settings",
      "Shared configuration for forms, offline access and operations.",
      [save],
    ),
    form,
    el(
      "section",
      { class: "panel" },
      el("h2", {}, "Audit history"),
      button("View recent activity", () => showAudit(app), {
        glyph: "history",
      }),
    ),
  );
}
async function showAudit(app) {
  try {
    let page = 1;
    const body = el("div"),
      pager = el("div", { class: "pagination" });
    const d = modal("Audit history", el("div", {}, body, pager), [], {
      wide: true,
    });
    const load = async () => {
      const data = await app.api.request(`/audit?page=${page}&limit=25`);
      body.replaceChildren();
      for (const event of data.items)
        body.append(
          el(
            "article",
            { class: "history-item" },
            el(
              "div",
              {},
              el("strong", {}, event.action.toLowerCase().replaceAll("_", " ")),
              el("span", {}, dateLabel(event.createdAt)),
            ),
            el("p", {}, `${event.entityType || ""} · ${event.entityId || ""}`),
            el(
              "small",
              {},
              `Actor ${event.actorId || event.userId || "system"}`,
            ),
          ),
        );
      pager.replaceChildren(
        button(
          "Previous",
          () => {
            page--;
            load().catch(showError);
          },
          { small: true, disabled: page === 1 },
        ),
        el("span", {}, `${data.total} events · page ${page}`),
        button(
          "Next",
          () => {
            page++;
            load().catch(showError);
          },
          { small: true, disabled: page * 25 >= data.total },
        ),
      );
    };
    await load();
  } catch (error) {
    showError(error);
  }
}

export async function showRelationships(app, form) {
  try {
    const [inputs, versions] = await Promise.all([
      app.api.request(`/forms/${form.id}/trace-inputs`),
      app.api.request(`/forms/${form.id}/templates`),
    ]);
    const current = versions.items.find((t) => t.isActive) || versions.items[0];
    const paths = [];
    if (current)
      walkFields(fieldsOf(current.definitionJson), (f, path) => {
        if (!f.fields)
          paths.push({ value: path, label: f.label + " · " + path });
      });
    const list = el("div", { class: "connection-list" });
    for (const c of inputs.connections || [])
      list.append(
        el(
          "article",
          { class: "connection-card" },
          el("strong", {}, c.connectionName),
          el(
            "span",
            {},
            `${app.forms.find((f) => f.id === c.sourcePpmFormId)?.ppmCode || c.sourcePpmFormId}.${c.sourceOutputKey} → ${c.targetInputKey}`,
          ),
          badge(c.status),
        ),
      );
    const source = searchableSelect(
        app.forms
          .filter((f) => f.id !== form.id)
          .map((f) => ({ value: f.id, label: f.ppmCode + " · " + f.title })),
        app.forms.find((f) => f.id !== form.id)?.id,
      ),
      output = textInput("", { required: true, placeholder: "outputKey" }),
      target = searchableSelect(paths, paths[0]?.value),
      name = textInput("", { required: true }),
      status = select(
        ["ACTIVE", "RESERVED", "PENDING_VALIDATION", "DISABLED"],
        "ACTIVE",
      ),
      approval = el("input", { type: "checkbox", checked: false });
    const formNode = el(
      "form",
      {},
      el("h3", {}, "Configure connection"),
      field("Connection name", name),
      el(
        "div",
        { class: "field-grid" },
        field("Source form", source),
        field("Source output key", output),
        field("Target input", target),
        field("Status", status),
      ),
      field(
        "Require approved source before use",
        approval,
        "Leave off for reference-only review. Enable only for a specific trace eligibility policy.",
      ),
    );
    const d = modal(
      "Connections · " + form.ppmCode,
      el("div", {}, list, formNode),
      [],
      { wide: true },
    );
    d.querySelector(".dialog-actions").append(
      button(
        "Save connection",
        async () => {
          if (!formNode.reportValidity()) return;
          try {
            await app.api.request(`/forms/${form.id}/connections`, {
              method: "PUT",
              body: {
                sourcePpmFormId: source.value,
                sourceOutputKey: output.value,
                targetInputKey: target.value,
                connectionName: name.value,
                status: status.value,
                requiresApprovalBeforeUse: approval.checked,
              },
            });
            d.close();
            notify("Connection saved");
            showRelationships(app, form);
          } catch (error) {
            showError(error);
          }
        },
        { kind: "primary", glyph: "trace" },
      ),
    );
  } catch (error) {
    showError(error);
  }
}
export async function showTraceRules(app, form, template, onSaved = () => {}) {
  if (!template) return;
  try {
    const snapshot = await app.api.request(`/templates/${template.id}/rules`);
    if (!template.publishedAt && snapshot.editHash !== template.editHash)
      throw Object.assign(new Error("TEMPLATE_CHANGED"), { error: "TEMPLATE_CHANGED" });
    let rules = snapshot.items || [];
    const content = el("div");
    const locked = !!template.publishedAt;
    let d, saving = false;
    const render = () => {
      content.replaceChildren();
      for (const [rIndex, rule] of rules.entries())
        content.append(
          el(
            "article",
            { class: "rule-card" },
            el(
              "div",
              {},
              el("strong", {}, rule.outputLabel),
              el(
                "p",
                {},
                `${rule.outputKey} · ${rule.sourceType.toLowerCase().replaceAll("_", " ")}`,
              ),
              rule.formulaTemplate
                ? el("code", {}, rule.formulaTemplate)
                : null,
            ),
            badge(rule.status),
            button(
              locked ? "View" : "Edit",
              () =>
                ruleEditor(
                  rule,
                  (value) => {
                    rules[rIndex] = value;
                    render();
                  },
                  locked,
                ),
              { small: true, glyph: "edit" },
            ),
            !locked
              ? iconButton("Remove rule", "trash", () => {
                  rules.splice(rIndex, 1);
                  render();
                })
              : null,
          ),
        );
      if (!rules.length)
        content.append(
          empty(
            "No output rules",
            "Add an output rule to publish trace codes from this form.",
          ),
        );
    };
    d = modal("Trace outputs · " + form.ppmCode, content, [], { wide: true });
    d.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
    if (!locked)
      d.querySelector(".dialog-actions").append(
        button(
          "Add output",
          () =>
            ruleEditor(
              null,
              (value) => {
                rules.push(value);
                render();
              },
              false,
            ),
          { glyph: "plus" },
        ),
        button(
          "Save rules",
          async (event) => {
            if (saving) return;
            const trigger = event.currentTarget;
            saving = true;
            d.inert = true;
            try {
              trigger.disabled = true;
              const cleaned = rules.map((r) => ({
                ...r,
                requiresUniqueBusinessCode: !!Number(
                  r.requiresUniqueBusinessCode,
                ),
              }));
              const saved = await app.api.request(`/templates/${template.id}/rules`, {
                method: "PUT",
                body: { rules: cleaned, expectedEditHash: snapshot.editHash },
              });
              onSaved({ editHash: saved.editHash });
              d.close();
              notify("Trace output rules saved");
            } catch (error) {
              showError(error);
            } finally {
              saving = false;
              d.inert = false;
              trigger.disabled = false;
            }
          },
          { kind: "primary" },
        ),
      );
    render();
  } catch (error) {
    showError(error);
  }
}
function ruleEditor(original, onSave, locked) {
  const rule = clone(
    original || {
      outputKey: "",
      outputLabel: "",
      sourceType: "SYSTEM_GENERATED",
      status: "ACTIVE",
      formulaTemplate: "LOT-{{sequence}}",
      resetPeriod: "NONE",
      sequencePadding: 3,
      configurationJson: {},
    },
  );
  const key = textInput(rule.outputKey, { required: true, disabled: locked }),
    label = textInput(rule.outputLabel, { required: true, disabled: locked }),
    source = select(
      [
        "SYSTEM_GENERATED",
        "MANUAL_EXTERNAL",
        "SCAN_EXTERNAL",
        "UPSTREAM_LOOKUP",
        "PENDING_RULE",
      ],
      rule.sourceType,
      { disabled: locked },
    ),
    status = select(
      ["ACTIVE", "RESERVED", "PENDING_VALIDATION", "DISABLED"],
      rule.status,
      { disabled: locked },
    ),
    formula = textInput(rule.formulaTemplate || "", { disabled: locked }),
    reset = select(["NONE", "DAILY", "MONTHLY", "YEARLY"], rule.resetPeriod, {
      disabled: locked,
    }),
    padding = textInput(rule.sequencePadding, {
      type: "number",
      min: 0,
      max: 12,
      disabled: locked,
    }),
    unique = el("input", {
      type: "checkbox",
      checked: !!Number(rule.requiresUniqueBusinessCode),
      disabled: locked,
    }),
    path = textInput(rule.configurationJson?.outputPath || "", {
      disabled: locked,
    }),
    quantity = textInput(rule.configurationJson?.quantityPath || "", {
      disabled: locked,
    }),
    unit = textInput(rule.configurationJson?.unit || "", { disabled: locked });
  const bindings = el("textarea", {
    rows: 5,
    value: JSON.stringify(rule.configurationJson?.bindings || {}, null, 2),
    disabled: locked,
    spellcheck: false,
  });
  const advanced = el(
    "details",
    {},
    el("summary", {}, "Advanced field bindings"),
    field(
      "Token bindings (structured JSON)",
      bindings,
      'Example: {"date":{"source":"RECORD","path":"productionDate","format":"YYYYMMDD"}}',
    ),
  );
  const form = el(
    "form",
    {},
    el(
      "div",
      { class: "field-grid" },
      field("Output key", key),
      field("Output label", label),
      field("Source type", source),
      field("Status", status),
    ),
    field(
      "Formula",
      formula,
      "Use {{sequence}}, {{record.productionDate}}, or a configured field path.",
    ),
    el(
      "div",
      { class: "field-grid" },
      field("Sequence reset", reset),
      field("Sequence padding", padding),
      field("Output path", path),
      field("Quantity path", quantity),
      field("Unit", unit),
    ),
    field("Unique business code", unique),
    advanced,
  );
  const d = modal("Trace output rule", form, [], { wide: true });
  if (!locked)
    d.querySelector(".dialog-actions").append(
      button(
        "Apply rule",
        () => {
          try {
            if (!form.reportValidity()) return;
            const config = { ...rule.configurationJson };
            for (const [k, input] of Object.entries({
              outputPath: path,
              quantityPath: quantity,
              unit,
            }))
              if (input.value) config[k] = input.value;
              else delete config[k];
            config.bindings = readJSON(bindings.value, "Bindings");
            onSave({
              ...rule,
              outputKey: key.value,
              outputLabel: label.value,
              sourceType: source.value,
              status: status.value,
              formulaTemplate:
                source.value === "SYSTEM_GENERATED" ? formula.value : null,
              resetPeriod: reset.value,
              sequencePadding: Number(padding.value),
              requiresUniqueBusinessCode: unique.checked,
              configurationJson: config,
            });
            d.close();
          } catch (error) {
            showError(error);
          }
        },
        { kind: "primary" },
      ),
    );
}
