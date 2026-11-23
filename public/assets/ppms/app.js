import { ApiClient } from "./api.js";
import {
  el,
  icon,
  button,
  iconButton,
  field,
  textInput,
  searchInput,
  select,
  searchableSelect,
  empty,
  sectionTitle,
  modal,
  notify,
  showError,
  errorMessage,
  badge,
  dateLabel,
  debounce,
  confirmAction,
} from "./ui.js";
import { OfflineStore, SyncEngine } from "./offline.js";
import { getThemePreference, setThemePreference } from "./theme.js";
import { FormBuilder } from "./builder.js";
import { openRecord } from "./records.js";
import {
  showPeople,
  showSettings,
  showSync,
  showAssignments,
  showRelationships,
  showTraceRules,
} from "./admin.js";

const base = document.body.dataset.base || "";
const mode = document.body.dataset.mode || "admin";
const appHost = document.getElementById("app");
export class Workspace {
  constructor() {
    this.api = new ApiClient(base);
    this.mode = mode;
    this.user = null;
    this.forms = [];
    this.store = null;
    this.engine = null;
    this.device = null;
    this.activeForm = null;
    this.context = null;
    this.currentPage = "forms";
    this.cleanup = null;
    this.pendingNavigation = false;
    this.api.onUnauthorized = () => {
      this.api.token = null;
      this.updateConnection();
      notify(
        "Your session has expired. Sign in to synchronize. Local changes remain saved.",
        "error",
      );
    };
    window.addEventListener("online", () => this.updateConnection());
    window.addEventListener("offline", () => this.updateConnection());
  }
  async start() {
    this.login();
    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register(base + "/sw.js", {
          scope: base + "/",
        });
      } catch (error) {
        console.info("Offline shell unavailable:", error.name);
      }
    }
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      this.installPrompt = event;
      this.installButton?.removeAttribute("hidden");
    });
  }
  login() {
    this.cleanup?.();
    this.engine?.stop();
    this.cleanup = null;
    appHost.replaceChildren();
    const username = textInput("", {
        name: "username",
        autoComplete: "username",
        required: true,
        placeholder: "Your username",
      }),
      password = textInput("", {
        type: "password",
        name: "password",
        autoComplete: "current-password",
        required: true,
        placeholder: "Your password",
      }),
      passphrase = textInput("", {
        type: "password",
        name: "offline-passphrase",
        autoComplete: "off",
        minLength: 8,
        required: this.mode === "mobile",
        placeholder: "At least 8 characters",
      });
    const error = el("p", { class: "inline-error", role: "alert" });
    const form = el(
      "form",
      { class: "login-form" },
      el(
        "div",
        { class: "brand" },
        el("span", { class: "brand-mark" }, "P"),
        el("span", {}, "PPMS"),
      ),
      el(
        "span",
        { class: "eyebrow" },
        this.mode === "mobile"
          ? "PERSONNEL WORKSPACE"
          : "ADMINISTRATION & REVIEW",
      ),
      el("h1", {}, "Production, connected."),
      el(
        "p",
        { class: "login-description" },
        this.mode === "mobile"
          ? "Your forms and production records, ready wherever work happens."
          : "Manage forms, review records and follow production from source to finish.",
      ),
      field("Username", username),
      field("Password", password),
      this.mode === "mobile"
        ? field(
            "Offline unlock passphrase",
            passphrase,
            "Protects records stored on this device. Use the same passphrase each time. It cannot be reset without losing access to unsynced local data.",
          )
        : null,
      error,
    );
    const submit = button("Sign in", null, {
      type: "submit",
      kind: "primary",
      glyph: "arrow",
    });
    form.append(submit);
    if (this.mode === "mobile")
      form.append(
        button(
          "Unlock saved workspace",
          () => this.unlockOffline(username.value, passphrase.value, error),
          { glyph: "lock" },
        ),
        button(
          "Restore encrypted recovery copy",
          () => this.restoreRecovery(passphrase.value, error),
          { glyph: "download" },
        ),
      );
    form.append(
      el(
        "div",
        { class: "login-footer" },
        el(
          "a",
          { href: base + (this.mode === "mobile" ? "/admin" : "/mobile") },
          this.mode === "mobile"
            ? "Administration and review"
            : "Personnel mobile app",
        ),
        el("span", {}, "One production record. One shared system."),
      ),
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      submit.disabled = true;
      try {
        const user = await this.api.login(
          username.value.trim(),
          password.value,
        );
        this.user = user;
        password.value = "";
        if (this.mode === "mobile") {
          this.store = await OfflineStore.open({
            userId: user.id,
            passphrase: passphrase.value,
          });
          await this.store.put("settings", "profile", user);
          const known = JSON.parse(
            localStorage.getItem("ppms-known-users") || "{}",
          );
          known[username.value.trim()] = {
            id: user.id,
            displayName: user.displayName,
          };
          localStorage.setItem("ppms-known-users", JSON.stringify(known));
          await this.prepareDevice();
        }
        passphrase.value = "";
        await this.enter();
      } catch (e) {
        error.textContent = errorMessage(e);
        this.api.token = null;
      } finally {
        submit.disabled = false;
      }
    });
    appHost.append(
      el(
        "main",
        {
          class: "login-layout",
          "data-screen-label": `${this.mode} sign-in`,
        },
        el(
          "aside",
          { class: "login-visual", "aria-hidden": "true" },
          el("div", { class: "login-visual-grid" }),
          el(
            "div",
            { class: "login-visual-copy" },
            el("span", { class: "eyebrow" }, "FORM TO FLOOR"),
            el("h2", {}, "Every detail.", el("br"), "Every connection."),
            el("p", {}, "Flexible forms. Clear reviews. Reliable records."),
            el(
              "div",
              { class: "visual-document" },
              el("div", { class: "visual-document-bar" }),
              ...Array.from({ length: 5 }, () =>
                el(
                  "div",
                  { class: "visual-document-row" },
                  ...Array.from({ length: 4 }, () => el("i")),
                ),
              ),
            ),
          ),
        ),
        form,
      ),
    );
    requestAnimationFrame(() => username.focus());
  }
  async unlockOffline(username, passphrase, error) {
    try {
      const known = JSON.parse(
        localStorage.getItem("ppms-known-users") || "{}",
      )[username.trim()];
      if (!known)
        throw new Error(
          "Sign in online once before unlocking this device offline",
        );
      this.store = await OfflineStore.open({ userId: known.id, passphrase });
      this.user = await this.store.get("settings", "profile");
      if (!this.user) throw new Error("No saved workspace is available");
      this.device = await this.store.get("settings", "device");
      this.api.token = null;
      await this.enter();
    } catch (e) {
      error.textContent = errorMessage(e);
    }
  }
  async restoreRecovery(passphrase, errorNode) {
    if (!passphrase || passphrase.length < 8) {
      errorNode.textContent =
        "Enter the recovery copy’s offline unlock passphrase first.";
      return;
    }
    const input = el("input", {
      type: "file",
      accept: "application/json,.json",
    });
    input.addEventListener("change", async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 64 * 1024 * 1024)
          throw new Error("Recovery file exceeds the 64 MiB import limit");
        const bundle = JSON.parse(await file.text());
        this.store = await OfflineStore.restore(bundle, passphrase);
        this.user = await this.store.get("settings", "profile");
        if (!this.user)
          throw new Error(
            "Recovery copy does not include a saved user profile",
          );
        this.device = await this.store.get("settings", "device");
        this.api.token = null;
        const known = JSON.parse(
          localStorage.getItem("ppms-known-users") || "{}",
        );
        known[this.user.username] = {
          id: this.user.id,
          displayName: this.user.displayName,
        };
        localStorage.setItem("ppms-known-users", JSON.stringify(known));
        await this.enter();
        notify(
          "Encrypted workspace restored. Sign in online to reconcile pending work.",
        );
      } catch (error) {
        errorNode.textContent = errorMessage(error);
      }
    });
    input.click();
  }
  signInOnline() {
    if (!this.user) {
      this.login();
      return;
    }
    const password = textInput("", {
      type: "password",
      autoComplete: "current-password",
      required: true,
    });
    const form = el(
      "form",
      {},
      field("Username", textInput(this.user.username, { readOnly: true })),
      field("Password", password),
    );
    const d = modal("Reconnect your account", form);
    const submit = async () => {
      if (!form.reportValidity()) return;
      try {
        const user = await this.api.login(this.user.username, password.value);
        password.value = "";
        if (user.id !== this.user.id) {
          this.api.token = null;
          throw new Error("Sign in using the original record author account");
        }
        this.user = user;
        this.forms = (await this.api.request("/forms")).items;
        this.updateConnection();
        d.close();
        if (
          this.activeForm &&
          this.forms.some((f) => f.id === this.activeForm.id)
        )
          await this.formContext(
            this.forms.find((f) => f.id === this.activeForm.id),
          );
        if (this.engine) await this.engine.sync();
        notify("Account reconnected");
      } catch (error) {
        showError(error);
      }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });
    d.querySelector(".dialog-actions").append(
      button("Sign in and synchronize", submit, { kind: "primary" }),
    );
  }
  async prepareDevice() {
    this.device = await this.store.get("settings", "device");
    if (this.device?.deviceToken) return;
    const key = "ppms-device-uuid:" + this.user.id;
    let deviceUuid = localStorage.getItem(key);
    if (!deviceUuid) {
      deviceUuid = crypto.randomUUID();
      localStorage.setItem(key, deviceUuid);
    }
    const device = await this.api.request("/devices", {
      method: "POST",
      body: { deviceUuid, displayName: `${this.user.displayName} · mobile` },
    });
    if (!device.deviceToken)
      throw new Error(
        "This device needs credential recovery. Ask an administrator to rotate its credential, then reconnect it.",
      );
    this.device = device;
    await this.store.put("settings", "device", device);
  }
  async enter() {
    this.shell();
    try {
      if (this.api.token) {
        const result = await this.api.request("/forms");
        this.forms = result.items || [];
        if (this.store) {
          for (const form of this.forms)
            await this.store.put("forms", form.id, form);
        }
      } else this.forms = await this.store.list("forms");
      await this.showForms();
    } catch (error) {
      showError(error);
      if (this.store) {
        this.forms = await this.store.list("forms");
        await this.showForms();
      } else
        this.main.append(
          empty(
            "Unable to load forms",
            "Check the connection and retry.",
            button("Retry", () => this.enter(), { kind: "primary" }),
          ),
        );
    }
  }
  shell() {
    appHost.replaceChildren();
    this.nav = el("nav", {
      class: "main-nav",
      "aria-label": "Main navigation",
    });
    this.main = el("main", {
      id: "workspace",
      class: "workspace",
      tabIndex: -1,
    });
    this.connection = el("button", {
      type: "button",
      class: "connection-indicator",
      onclick: () => {
        if (!this.api.token) this.signInOnline();
      },
    });
    const navItems = [
      ["forms", "Forms", "form"],
      ["records", "Records", "grid"],
      ["trace", "Traceability", "trace"],
      ["sync", "Synchronization", "sync"],
    ];
    if (this.mode === "admin" && this.user.role === "ADMIN")
      navItems.push(
        ["people", "People & access", "users"],
        ["settings", "Settings", "settings"],
      );
    for (const [key, label, glyph] of navItems)
      this.nav.append(
        el(
          "button",
          {
            type: "button",
            dataset: { page: key },
            onclick: () => this.navigate(key),
          },
          icon(glyph),
          el("span", {}, label),
        ),
      );
    this.installButton = button(
      "Install app",
      async () => {
        await this.installPrompt?.prompt();
        this.installPrompt = null;
        this.installButton.hidden = true;
      },
      { small: true, glyph: "download" },
    );
    this.installButton.hidden = !this.installPrompt;
    const aside = el(
      "aside",
      { class: "sidebar" },
      el(
        "a",
        {
          class: "brand",
          href: base + (this.mode === "mobile" ? "/mobile" : "/admin"),
        },
        el("span", { class: "brand-mark" }, "P"),
        el(
          "span",
          {},
          "PPMS",
          el("small", {}, this.mode === "mobile" ? "Personnel" : "Workspace"),
        ),
      ),
      this.nav,
      el(
        "div",
        { class: "sidebar-bottom" },
        this.installButton,
        button(
          this.api.token ? "Lock workspace" : "Sign in online",
          () => this.lockOrLogin(),
          { glyph: this.api.token ? "lock" : "logout" },
        ),
      ),
    );
    const topbar = el(
      "header",
      { class: "topbar" },
      el(
        "div",
        { class: "breadcrumb" },
        el("span", {}, "Production management"),
        el("span", { class: "separator" }, "/"),
        el(
          "strong",
          {},
          this.mode === "mobile" ? "Personnel" : "Administration",
        ),
      ),
      el(
        "div",
        { class: "topbar-right" },
        this.connection,
        el(
          "button",
          { class: "user-button", onclick: () => this.account() },
          el(
            "span",
            { class: "avatar" },
            (this.user.displayName || this.user.username)
              .slice(0, 2)
              .toUpperCase(),
          ),
          el("span", {}, this.user.displayName || this.user.username),
        ),
      ),
    );
    appHost.append(
      el(
        "div",
        { class: `app-shell ${this.mode}` },
        aside,
        el("div", { class: "main-shell" }, topbar, this.main),
      ),
    );
    this.updateConnection();
  }
  updateConnection() {
    if (!this.connection) return;
    const online = navigator.onLine && !!this.api.token;
    this.connection.className =
      "connection-indicator " + (online ? "online" : "offline");
    this.connection.replaceChildren(
      el("i"),
      online ? "Connected" : navigator.onLine ? "Sign in to sync" : "Offline",
    );
  }
  async lockOrLogin() {
    if (
      this.pendingNavigation &&
      !(await confirmAction(
        "Leave this form?",
        "Save your current changes before locking the workspace.",
        "Leave without saving",
      ))
    )
      return;
    try {
      await this.flushCurrent?.();
    } catch (error) {
      showError(error);
      return;
    }
    this.cleanup?.();
    this.cleanup = null;
    this.engine?.stop();
    if (this.api.token) await this.api.logout().catch(() => {});
    this.store?.lock();
    this.store = null;
    this.device = null;
    this.user = null;
    this.pendingNavigation = false;
    this.login();
  }
  async navigate(page) {
    if (
      this.pendingNavigation &&
      !(await confirmAction(
        "Leave this form?",
        "Your latest edits have not been explicitly saved. Stay here to save them first.",
        "Leave form",
      ))
    )
      return;
    try {
      await this.flushCurrent?.();
    } catch (error) {
      showError(error);
      return;
    }
    this.cleanup?.();
    this.cleanup = null;
    this.pendingNavigation = false;
    this.currentPage = page;
    this.main.dataset.screenLabel = `${this.mode} ${page}`;
    for (const n of this.nav.children)
      n.classList.toggle("active", n.dataset.page === page);
    this.main.replaceChildren();
    try {
      if (page === "forms") await this.showForms();
      else if (page === "records") await this.showRecords();
      else if (page === "trace") await this.showTrace();
      else if (page === "people") await showPeople(this);
      else if (page === "settings") await showSettings(this);
      else if (page === "sync") await showSync(this);
    } catch (error) {
      showError(error);
      this.main.append(
        empty(
          "Unable to load this view",
          errorMessage(error),
          button("Retry", () => this.navigate(page), { kind: "primary" }),
        ),
      );
    }
  }
  async showForms() {
    this.currentPage = "forms";
    this.main.dataset.screenLabel = `${this.mode} form library`;
    for (const n of this.nav.children)
      n.classList.toggle("active", n.dataset.page === "forms");
    this.main.replaceChildren();
    const count = this.forms.length;
    const search = searchInput("", {
      placeholder: "Search forms by name or code…",
      "aria-label": "Search forms",
    });
    const grid = el("div", { class: "form-library" });
    const render = () => {
      const q = search.value.toLowerCase();
      const forms = this.forms.filter((f) =>
        (f.title + " " + f.ppmCode).toLowerCase().includes(q),
      );
      grid.replaceChildren();
      for (const form of forms) {
        const card = el(
          "article",
          { class: "form-card" },
          el(
            "div",
            { class: "form-card-top" },
            el("span", { class: "form-code" }, form.ppmCode),
            badge(form.status || "ACTIVE"),
          ),
          el("h2", {}, form.title),
          el(
            "div",
            { class: "form-card-meta" },
            icon("form"),
            el("span", {}, "Versioned production form"),
          ),
          el(
            "div",
            { class: "form-card-actions" },
            button("Open form", () => this.openForm(form), { glyph: "arrow" }),
            this.mode === "admin" && this.user.role === "ADMIN"
              ? iconButton("Configure form", "settings", () =>
                  this.manageTemplates(form),
                )
              : null,
          ),
        );
        grid.append(card);
      }
      if (!forms.length)
        grid.append(
          empty(
            "No matching forms",
            q
              ? "Try a different search."
              : "Ask an administrator to assign a form to your account.",
          ),
        );
    };
    search.addEventListener("input", render);
    this.main.append(
      sectionTitle(
        "Form library",
        `${count} ${count === 1 ? "form" : "forms"} available to your account`,
        this.mode === "admin" && this.user.role === "ADMIN"
          ? [
              button("Create form", () => this.createForm(), {
                kind: "primary",
                glyph: "plus",
              }),
            ]
          : [],
      ),
      el(
        "div",
        { class: "search-toolbar", role: "search", "aria-label": "Find forms" },
        search,
      ),
      grid,
    );
    if (this.mode === "mobile" && this.device)
      this.main.append(
        el(
          "div",
          { class: "device-note" },
          icon("mobile"),
          el("span", {}, `Device: ${this.device.id}`),
          button("Device setup", () => this.deviceSetup(), { small: true }),
        ),
      );
    render();
  }
  async formContext(form, { bootstrap = true } = {}) {
    if (this.mode === "mobile") {
      const cached = await this.store.get(
        "settings",
        "form-context:" + form.id,
      );
      if (this.api.token && navigator.onLine && this.device) {
        const live =
          (await this.api.request("/forms")).items.find(
            (f) => f.id === form.id,
          ) || form;
        Object.assign(form, live);
        const membership =
          (form.leases || []).find(
            (lease) => lease.deviceId === this.device.id && !lease.revokedAt,
          ) ||
          (form.deviceId === this.device.id && !form.leaseRevokedAt
            ? { deviceId: form.deviceId, leaseVersion: form.leaseVersion }
            : null);
        if (!membership)
          throw new Error(
            "This device is not authorized for this form. Ask an administrator to authorize the device shown in Device setup.",
          );
        const grant = await this.api.request("/sync/grants", {
          method: "POST",
          deviceToken: this.device.deviceToken,
          body: {
            ppmFormId: form.id,
            deviceId: this.device.id,
            leaseVersion: Number(membership.leaseVersion),
          },
        });
        const config = {
          user: this.user,
          deviceId: this.device.id,
          deviceToken: this.device.deviceToken,
          leaseVersion: Number(membership.leaseVersion),
          ppmFormId: form.id,
          authorProof: grant.authorProof,
          plantTimezone: "Asia/Manila",
        };
        this.engine?.stop();
        this.engine = new SyncEngine({
          store: this.store,
          request: (p, o) => this.api.request(p, o),
          onStatus: () => this.updateSyncStatus(),
        });
        await this.engine.configure(config);
        if (bootstrap || !cached) await this.engine.bootstrap();
        const cachedForm = (await this.store.get("forms", form.id)) || form;
        const templates = (await this.store.list("templates")).filter(
          (t) => t.ppmFormId === form.id,
        );
        const connections =
          (await this.store.get("connections", form.id)) || [];
        const outputs = (await this.store.list("outputs")).filter(
          (o) => o.targetPpmFormId === form.id,
        );
        const context = {
          ...cached,
          ...config,
          grant,
          form: { ...cachedForm, ...form },
          templates,
          connections,
          outputs,
          areaAssignments: cachedForm.areaAssignments || form.assignments || [],
          personnel: cachedForm.personnel || [],
          permissions: form.permissions,
          plantTimezone: cachedForm.plantTimezone || config.plantTimezone,
        };
        await this.store.put("settings", "form-context:" + form.id, context);
        this.context = context;
        this.engine.start();
        return context;
      }
      if (!cached)
        throw new Error(
          "Open this form while online once to prepare it for offline entry",
        );
      this.engine?.stop();
      this.engine = new SyncEngine({
        store: this.store,
        request: (p, o) => this.api.request(p, o),
        onStatus: () => this.updateSyncStatus(),
      });
      await this.engine.configure({ ...cached, user: this.user });
      const freshTemplates = (await this.store.list("templates")).filter(
        (t) => t.ppmFormId === form.id,
      );
      const freshOutputs = (await this.store.list("outputs")).filter(
        (o) => o.targetPpmFormId === form.id,
      );
      this.context = {
        ...cached,
        templates: freshTemplates.length ? freshTemplates : cached.templates,
        outputs: freshOutputs,
        connections:
          (await this.store.get("connections", form.id)) || cached.connections,
      };
      return this.context;
    }
    const [templates, assignments, traceInputs] = await Promise.all([
      this.api.request(`/forms/${form.id}/templates`),
      this.api.request(`/forms/${form.id}/assignments`),
      this.api.request(`/forms/${form.id}/trace-inputs`),
    ]);
    if (
      form.activeTemplateId &&
      !templates.items.some((t) => t.id === form.activeTemplateId)
    )
      templates.items.push(
        await this.api.request("/templates/" + form.activeTemplateId),
      );
    return {
      form,
      templates: templates.items,
      areaAssignments: assignments.areas.filter(
        (a) => Number(a.isActive) !== 0 && a.areaStatus !== "INACTIVE",
      ),
      permissions: form.permissions,
      personnel: assignments.personnel,
      lease: assignments.lease,
      connections: traceInputs.connections || [],
      outputs: traceInputs.outputs || [],
      plantTimezone: "Asia/Manila",
    };
  }
  async openForm(form) {
    try {
      this.main.replaceChildren(
        sectionTitle(form.title, form.ppmCode),
        el("p", { class: "loading" }, "Opening form…"),
      );
      this.activeForm = form;
      this.context = await this.formContext(form);
      this.main.replaceChildren();
      await this.showRecords(form);
    } catch (error) {
      showError(error);
      this.main.replaceChildren(
        sectionTitle(form.title, form.ppmCode),
        empty(
          "Form not ready on this device",
          errorMessage(error),
          button("Back to forms", () => this.showForms(), { glyph: "back" }),
        ),
      );
    }
  }
  async showRecords(form = null) {
    this.currentPage = "records";
    this.main.dataset.screenLabel = `${this.mode} records`;
    for (const n of this.nav.children)
      n.classList.toggle("active", n.dataset.page === "records");
    this.main.replaceChildren();
    const chosen = form || this.activeForm;
    const filter = searchableSelect(
      [
        { value: "", label: "All forms" },
        ...this.forms.map((f) => ({
          value: f.id,
          label: f.ppmCode + " · " + f.title,
        })),
      ],
      chosen?.id || "",
      { "aria-label": "Filter by form" },
    );
    const search = searchInput("", {
      placeholder: "Search record ID, batch or lot…",
      "aria-label": "Search records",
    });
    const status = searchableSelect(
      [
        { value: "", label: "All review states" },
        ...[
          "PENDING_REVIEW",
          "UNDER_REVIEW",
          "APPROVED",
          "RETURNED_FOR_REVISION",
        ].map((v) => ({
          value: v,
          label: v.toLowerCase().replaceAll("_", " "),
        })),
      ],
      "",
      { "aria-label": "Filter by review status" },
    );
    const result = el("div", { class: "record-list" }),
      pager = el("div", { class: "pagination" });
    let page = 1;
    let offset = 0;
    const previousOffsets = [];
    let request = 0;
    const load = async () => {
      const seq = ++request;
      try {
        let items, total, hasMore, nextOffset;
        if (this.mode === "mobile") {
          items = await this.store.listRecords(filter.value || undefined);
          items = items.filter((i) => (!i.deleted && !i.remoteDeleted) ||
            ["SAVED_LOCALLY", "PENDING_SYNC", "SYNCING", "FAILED", "CONFLICT"].includes(i.status));
          if (search.value)
            items = items.filter((i) =>
              JSON.stringify([i.id, i.record?.batchNo, i.record?.lotNo])
                .toLowerCase()
                .includes(search.value.toLowerCase()),
            );
          if (status.value)
            items = items.filter(
              (i) =>
                (i.server?.reviewReference?.status ||
                  i.reviewReference?.status ||
                  "PENDING_REVIEW") === status.value,
            );
          total = items.length;
          items = items.slice((page - 1) * 25, page * 25);
          hasMore = page * 25 < total;
        } else {
          const params = new URLSearchParams({
            offset,
            limit: 25,
            summary: true,
          });
          if (filter.value) params.set("ppmFormId", filter.value);
          if (search.value) params.set("q", search.value);
          if (status.value) params.set("reviewStatus", status.value);
          const data = await this.api.request("/records?" + params);
          items = data.items;
          total = data.total;
          hasMore = data.hasMore;
          nextOffset = data.nextOffset;
        }
        if (seq !== request) return;
        result.replaceChildren();
        if (!items?.length) {
          result.append(
            empty(
              search.value || status.value
                ? "No matching records"
                : "No records yet",
              search.value || status.value
                ? "Try a different search or review status."
                : "Create a record using the current published form.",
              filter.value
                ? button("New record", () => this.newRecord(filter.value), {
                    kind: "primary",
                    glyph: "plus",
                  })
                : null,
            ),
          );
          pager.replaceChildren();
          return;
        }
        const table = el("table", { class: "data-table" });
        table.append(
          el(
            "thead",
            {},
            el(
              "tr",
              {},
              ...[
                "Record",
                "Form",
                "Production date",
                "Review",
                "Sync / version",
                "",
              ].map((x) => el("th", { scope: "col" }, x)),
            ),
          ),
        );
        const body = el("tbody");
        for (const item of items) {
          const record = item.record || item,
            formRow = this.forms.find(
              (f) => f.id === (record.ppmFormId || item.ppmFormId),
            );
          const review = item.reviewReference || item.server?.reviewReference;
          body.append(
            el(
              "tr",
              {},
              el(
                "td",
                {},
                el(
                  "strong",
                  {},
                  record.batchNo || record.lotNo || record.id.slice(0, 12),
                ),
                el("small", {}, record.id),
              ),
              el("td", {}, formRow?.ppmCode || "—"),
              el(
                "td",
                {},
                String(record.productionDate || "").slice(0, 10) || "—",
              ),
              el("td", {}, badge(review?.status || "PENDING_REVIEW")),
              el(
                "td",
                {},
                this.mode === "mobile"
                  ? badge(item.status || "SYNCED")
                  : el(
                      "span",
                      {},
                      `Revision ${record.currentRevisionNo || item.serverRevisionNo || 1}`,
                    ),
              ),
              el(
                "td",
                {},
                button(
                  "Open",
                  () => this.editRecord(record.id, formRow, item),
                  { small: true, glyph: "arrow" },
                ),
              ),
            ),
          );
        }
        table.append(body);
        result.append(el("div", { class: "data-table-scroll" }, table));
        pager.replaceChildren(
          button(
            "Previous",
            () => {
              page--;
              if (this.mode !== "mobile") offset = previousOffsets.pop() ?? 0;
              load();
            },
            { small: true, disabled: page === 1 },
          ),
          el("span", {}, `${total} records · view ${page}`),
          button(
            "Next",
            () => {
              page++;
              if (this.mode !== "mobile") {
                previousOffsets.push(offset);
                offset = nextOffset;
              }
              load();
            },
            { small: true, disabled: !hasMore },
          ),
        );
      } catch (error) {
        if (seq === request) {
          result.replaceChildren(
            empty("Unable to load records", errorMessage(error)),
          );
          showError(error);
        }
      }
    };
    for (const c of [filter, status])
      c.addEventListener("change", () => {
        page = 1;
        offset = 0;
        previousOffsets.length = 0;
        load();
      });
    search.addEventListener(
      "input",
      debounce(() => {
        page = 1;
        offset = 0;
        previousOffsets.length = 0;
        load();
      }),
    );
    this.main.append(
      sectionTitle(
        form ? form.title : "Records",
        form ? form.ppmCode : "Production entries and review references",
        [
          button("New record", () => this.newRecord(filter.value), {
            kind: "primary",
            glyph: "plus",
          }),
        ],
      ),
      el(
        "div",
        { class: "filters", role: "search", "aria-label": "Filter records" },
        search,
        filter,
        status,
      ),
      result,
      pager,
    );
    this.reloadRecords = load;
    await load();
  }
  async newRecord(formId) {
    if (!formId) {
      const choice = searchableSelect(
        this.forms.map((f) => ({
          value: f.id,
          label: f.ppmCode + " · " + f.title,
        })),
        this.forms[0]?.id,
      );
      const d = modal("Choose a form", field("Form", choice));
      d.querySelector(".dialog-actions").append(
        button(
          "Continue",
          () => {
            d.close();
            this.newRecord(choice.value);
          },
          { kind: "primary" },
        ),
      );
      return;
    }
    try {
      const form = this.forms.find((f) => f.id === formId);
      if (!form) throw new Error("Form is not available");
      const context =
        this.context?.form?.id === formId
          ? this.context
          : await this.formContext(form);
      const template = context.templates?.find(
        (t) => Number(t.isActive) === 1 && t.publishedAt,
      );
      if (!template)
        throw new Error("This form has no active published template");
      this.activeForm = form;
      this.context = context;
      openRecord(this, { form, context, template });
    } catch (error) {
      showError(error);
    }
  }
  async editRecord(id, form, item) {
    try {
      if (!form) {
        const found = this.forms.find(
          (f) => f.id === (item?.record?.ppmFormId || item?.ppmFormId),
        );
        form = found;
      }
      if (!form && this.mode === "admin") {
        const v = await this.api.request("/records/" + id);
        form = this.forms.find((f) => f.id === v.record.ppmFormId);
        item = v;
      }
      if (!form) throw new Error("Record form is unavailable");
      const context =
        this.context?.form?.id === form.id
          ? this.context
          : await this.formContext(form, { bootstrap: false });
      const view =
        this.mode === "mobile"
          ? item || (await this.store.get("records", id))
          : await this.api.request("/records/" + id);
      const record = view.record || view.server?.record;
      let template =
        context.templates?.find((t) => t.id === record?.templateVersionId) ||
        (await this.store?.get("templates", record?.templateVersionId));
      if (!template && this.api.token && record?.templateVersionId) {
        template = await this.api.request(
          "/templates/" + record.templateVersionId,
        );
        if (this.store)
          await this.store.put("templates", template.id, template);
        context.templates = [...(context.templates || []), template];
      }
      if (!template)
        throw new Error(
          "Pinned template is unavailable. Reconnect and refresh this form before editing.",
        );
      this.activeForm = form;
      this.context = context;
      openRecord(this, { form, context, template, view });
    } catch (error) {
      showError(error);
    }
  }
  async createForm() {
    try {
      const areas = await this.api.request("/areas");
      const code = textInput("", { required: true, placeholder: "PPM-027" }),
        title = textInput("", {
          required: true,
          placeholder: "Production monitoring",
        }),
        area = searchableSelect(
          areas.items.map((a) => ({
            value: a.id,
            label: a.code + " · " + a.name,
          })),
          areas.items[0]?.id,
        );
      const form = el(
        "form",
        {},
        field("Form code", code),
        field("Title", title),
        field("Production area", area),
      );
      const d = modal("Create production form", form);
      d.querySelector(".dialog-actions").append(
        button(
          "Create form",
          async (e) => {
            if (!form.reportValidity()) return;
            const trigger = e.currentTarget;
            trigger.disabled = true;
            try {
              const created = await this.api.request("/forms", {
                method: "POST",
                body: {
                  ppmCode: code.value,
                  title: title.value,
                  areaId: area.value,
                },
              });
              this.forms.push(created);
              d.close();
              this.builder(created, null);
            } catch (error) {
              showError(error);
            } finally {
              trigger.disabled = false;
            }
          },
          { kind: "primary", glyph: "plus" },
        ),
      );
    } catch (error) {
      showError(error);
    }
  }
  async manageTemplates(form) {
    const body = el("div", { class: "template-list" }),
      pager = el("div", { class: "pagination" });
    const d = modal(
      form.ppmCode + " · Templates",
      el("div", {}, body, pager),
      [],
      { wide: true },
    );
    let page = 1;
    const load = async () => {
      try {
        const response = await this.api.request(
          `/forms/${form.id}/templates?` +
            new URLSearchParams({ page, limit: 10, summary: true }),
        );
        body.replaceChildren();
        for (const t of response.items)
          body.append(
            el(
              "div",
              { class: "template-row" },
              el(
                "div",
                {},
                el("strong", {}, t.versionLabel || `Version ${t.versionNo}`),
                el("small", {}, t.documentNumber || t.id.slice(0, 12)),
              ),
              badge(
                Number(t.isActive) === 1
                  ? "ACTIVE"
                  : t.publishedAt
                    ? "PUBLISHED"
                    : "DRAFT",
              ),
              button(
                t.publishedAt ? "View" : "Edit",
                async () => {
                  try {
                    const exact = await this.api.request("/templates/" + t.id);
                    d.close();
                    this.builder(form, exact);
                  } catch (error) {
                    showError(error);
                  }
                },
                { small: true, glyph: "edit" },
              ),
            ),
          );
        if (!response.items.length)
          body.append(
            empty(
              "No templates",
              "Create the first version to start using this form.",
            ),
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
          el("span", {}, `${response.total} versions · page ${page}`),
          button(
            "Next",
            () => {
              page++;
              load();
            },
            { small: true, disabled: !response.hasMore },
          ),
        );
      } catch (error) {
        showError(error);
      }
    };
    d.querySelector(".dialog-actions").append(
      button(
        "Assignments",
        () => {
          d.close();
          showAssignments(this, form);
        },
        { glyph: "users" },
      ),
      button(
        "New template",
        () => {
          d.close();
          this.builder(form, null);
        },
        { kind: "primary", glyph: "plus" },
      ),
    );
    await load();
  }
  builder(form, template) {
    this.cleanup?.();
    this.cleanup = null;
    this.flushCurrent = null;
    this.main.replaceChildren();
    this.main.dataset.screenLabel = `${this.mode} form builder`;
    const b = new FormBuilder({
      form,
      template,
      onDirty: (dirty) => {
        this.pendingNavigation = dirty;
      },
      onSave: async (payload, existing) => {
        const saved = await this.api.request(
          existing
            ? "/templates/" + existing.id
            : `/forms/${form.id}/templates`,
          { method: existing ? "PATCH" : "POST", body: payload },
        );
        if (!existing) setTimeout(() => this.builder(form, saved), 0);
        return saved;
      },
      onPublish: async (current) => {
        const published = await this.api.request(
          `/templates/${current.id}/publish`,
          { method: "POST", body: {} },
        );
        this.builder(form, published);
      },
      onDuplicate: async (current) => {
        try {
          const duplicate = await this.api.request(
            `/templates/${current.id}/duplicate`,
            {
              method: "POST",
              body: { versionLabel: `Copy of version ${current.versionNo}` },
            },
          );
          this.builder(form, duplicate);
        } catch (error) {
          showError(error);
        }
      },
      onRules: () => showTraceRules(this, form, template),
      onConnections: () => showRelationships(this, form),
    });
    this.main.append(
      el(
        "div",
        { class: "back-row" },
        button("Forms", () => this.navigate("forms"), {
          small: true,
          glyph: "back",
        }),
      ),
      b.root,
    );
  }
  async showTrace() {
    this.main.replaceChildren();
    this.main.dataset.screenLabel = `${this.mode} traceability`;
    const q = searchInput("", {
        placeholder: "Search a production, batch or trace code…",
        required: true,
        "aria-label": "Trace code",
      }),
      results = el("div", { class: "trace-results" });
    const form = el(
      "form",
      { class: "trace-search" },
      q,
      button("Trace code", null, {
        type: "submit",
        kind: "primary",
        glyph: "search",
      }),
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!q.value.trim()) return;
      try {
        if (!this.api.token)
          throw new Error(
            "Reconnect and sign in to search the authoritative trace graph",
          );
        const response = await this.api.request(
          "/trace?" + new URLSearchParams({ q: q.value, limit: 50 }),
        );
        results.replaceChildren();
        for (const output of response.items || [])
          results.append(
            el(
              "article",
              { class: "trace-result" },
              el(
                "div",
                {},
                el("strong", {}, output.outputCode),
                el(
                  "p",
                  {},
                  `${output.ppmCode || ""} · ${output.title || output.outputKey}`,
                ),
                el(
                  "small",
                  {},
                  `Record ${output.recordId} · revision ${output.revisionNo || "—"}`,
                ),
              ),
              badge(output.status),
              button("Follow connections", () => this.traceTree(output), {
                small: true,
                glyph: "trace",
              }),
            ),
          );
        if (!response.items?.length)
          results.append(
            empty(
              "No matching trace code",
              "Only authorized production records are included.",
            ),
          );
      } catch (error) {
        showError(error);
      }
    });
    this.main.append(
      sectionTitle(
        "Traceability",
        "Follow exact production sources and their connected records.",
      ),
      form,
      results,
    );
  }
  async traceTree(output) {
    try {
      const tree = await this.api.request(
        `/trace/outputs/${output.id}/tree?maxNodes=100`,
      );
      const nodes = new Map(tree.nodes.map((n) => [n.id, n]));
      const edges = tree.edges || [];
      const adjacency = new Map();
      for (const edge of edges) {
        if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
        adjacency.get(edge.source).push(edge);
      }
      const shown = new Set();
      const build = (id, depth = 0) => {
        const node = nodes.get(id);
        if (!node) return null;
        const item = el("li");
        const card = el(
          "div",
          { class: "trace-node" },
          el(
            "div",
            {},
            el(
              "strong",
              {},
              node.outputCode || node.recordCode || node.recordId,
            ),
            el(
              "span",
              {},
              `${node.ppmCode || node.title || "Production"} · revision ${node.revisionNo || "—"}`,
            ),
          ),
          badge(node.status),
          button(
            "Record",
            () =>
              this.editRecord(
                node.recordId,
                this.forms.find((f) => f.id === node.ppmFormId),
              ),
            { small: true },
          ),
        );
        item.append(card);
        if (shown.has(id)) {
          item.append(el("small", {}, "Connection already shown above"));
          return item;
        }
        shown.add(id);
        if (depth < 30 && adjacency.has(id)) {
          const list = el("ul");
          for (const edge of adjacency.get(id)) {
            const child = build(edge.target, depth + 1);
            if (child) {
              child.prepend(
                el(
                  "span",
                  { class: "trace-edge-label" },
                  edge.inputPath || "Connected output",
                ),
              );
              list.append(child);
            }
          }
          item.append(list);
        }
        return item;
      };
      const panel = el(
        "div",
        { class: "trace-tree" },
        el(
          "p",
          { class: "muted" },
          "Arrows follow source outputs into dependent production records.",
        ),
        tree.truncated
          ? el(
              "p",
              { class: "notice" },
              "This view reached its node limit. Open a connected output to continue.",
            )
          : null,
      );
      const roots = tree.nodes.filter(
        (n) => !edges.some((e) => e.target === n.id),
      );
      const list = el("ul");
      for (const root of roots.length
        ? roots
        : [nodes.get(tree.root)].filter(Boolean)) {
        const branch = build(root.id);
        if (branch) list.append(branch);
      }
      panel.append(list);
      modal("Trace · " + output.outputCode, panel, [], { wide: true });
    } catch (error) {
      showError(error);
    }
  }
  async deviceSetup() {
    const id = textInput(this.device?.id || "", { readOnly: true });
    const note = el(
      "p",
      {},
      "An administrator authorizes this device for its production forms. Keep unsynced records on this device until the server confirms them.",
    );
    const d = modal(
      "Mobile device",
      el("div", {}, field("Device identifier", id), note),
    );
    d.querySelector(".dialog-actions").append(
      button(
        "Refresh assignments",
        async () => {
          try {
            this.forms = (await this.api.request("/forms")).items;
            d.close();
            await this.showForms();
            notify("Assignments refreshed");
          } catch (error) {
            showError(error);
          }
        },
        { kind: "primary" },
      ),
    );
  }
  updateSyncStatus() {
    this.updateConnection();
    document.dispatchEvent(new CustomEvent("ppms-sync-status"));
  }
  account() {
    const theme = select(
      [
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
      getThemePreference(),
    );
    theme.addEventListener("change", () => setThemePreference(theme.value));
    const content = el(
      "div",
      {},
      el("p", {}, this.user.displayName),
      el(
        "p",
        { class: "muted" },
        `${this.user.username} · ${this.user.role.toLowerCase().replaceAll("_", " ")}`,
      ),
      field("Theme", theme, "Appearance on this device."),
    );
    const d = modal("Your account", content);
    if (this.api.token) {
      const current = textInput("", {
          type: "password",
          autoComplete: "current-password",
        }),
        next = textInput("", {
          type: "password",
          autoComplete: "new-password",
          minLength: 12,
        });
      content.append(
        field("Current password", current),
        field("New password", next),
      );
      d.querySelector(".dialog-actions").append(
        button(
          "Change password",
          async () => {
            try {
              await this.api.request("/auth/password", {
                method: "POST",
                body: {
                  currentPassword: current.value,
                  newPassword: next.value,
                },
              });
              d.close();
              notify(
                "Password changed. Sign in again if your session was revoked.",
              );
            } catch (error) {
              showError(error);
            }
          },
          { kind: "primary" },
        ),
      );
    }
    d.querySelector(".dialog-actions").append(
      button(
        "Lock workspace",
        () => {
          d.close();
          this.lockOrLogin();
        },
        { glyph: "lock" },
      ),
    );
  }
}
const workspace = new Workspace();
workspace.start();
