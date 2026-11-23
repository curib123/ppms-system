import {
  el, button, iconButton, field, textInput, searchableSelect, modal,
  showError, notify, confirmAction,
} from "./ui.js";
import { clone, newDefinition, asV2, FIELD_TYPES, fieldsOf, defaultData } from "./schema.js";
import { FIELD_LABELS, CONTAINERS, builderIndex, builderListId, uniqueFieldKey,
  createBuilderField, removalDependents, validateBuilderDefinition } from "./builder-model.js";
import { FormRenderer } from "./renderer.js";
import { DocumentViewport } from "./viewport.js";

const metadataKeys = ["documentNumber", "revisionNumber", "seriesNumber", "pageNumber", "sourceFileName", "sourceFileHash"];
const labels = { documentNumber: "Document number", revisionNumber: "Revision number",
  seriesNumber: "Series number", pageNumber: "Page number", sourceFileName: "Source filename", sourceFileHash: "Source SHA-256" };
const dragType = "application/x-ppms-builder";

export class FormBuilder {
  constructor({ form, template, onSave, onPublish, onDuplicate, onRules, onConnections, onDirty = () => {} }) {
    this.form = form;
    this.template = template;
    this.definition = template ? asV2(template.definitionJson) : newDefinition(form.title);
    if (!this.definition.title) this.definition.title = form.title;
    this.metadata = Object.fromEntries([...metadataKeys, "versionLabel"].map((key) => [key, template?.[key] ?? ""]));
    this.readonly = !!template?.publishedAt;
    this.onSave = onSave;
    this.onPublish = onPublish;
    this.onDuplicate = onDuplicate;
    this.onRules = onRules;
    this.onDirty = onDirty;
    this.history = [];
    this.future = [];
    this.invalidInputs = new Set();
    this.destination = "header";
    this.selected = null;
    this.mode = "design";
    this.baseline = this.serialized();
    this.controller = new AbortController();
    window.addEventListener("beforeunload", (event) => {
      if (!this.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }, { signal: this.controller.signal });
    this.root = el("div", { class: "builder visual-builder", "data-screen-label": "Form builder" });
    this.titleInput = textInput(this.definition.title || form.title, { disabled: this.readonly, maxLength: 200, required: true });
    this.bindInput(this.titleInput, () => { this.definition.title = this.titleInput.value; });
    this.versionInput = textInput(this.metadata.versionLabel, { disabled: this.readonly, maxLength: 120, placeholder: "Optional, e.g. November production form" });
    this.bindInput(this.versionInput, () => { this.metadata.versionLabel = this.versionInput.value; });
    this.stateLabel = el("span", { class: "builder-state" }, this.readonly ? "Published · locked" : template ? "Draft saved" : "New draft");
    this.live = el("p", { class: "builder-announcement", role: "status", "aria-live": "polite" });
    this.saveButton = button("Save draft", () => this.run(() => this.save()), { kind: "primary", glyph: "save" });
    this.publishButton = button("Publish", () => this.publish(), { glyph: "check" });
    this.rulesButton = onRules ? button("Trace outputs", () => this.run(async () => {
      if (this.saving || this.publishing || this.rulesOpening || this.destroyed) return;
      this.rulesOpening = true;
      try {
        if (this.dirty) await this.save({ fromRules: true });
        if (!this.destroyed) {
          this.root.inert = true;
          await onRules(this.template, (updated) => { this.template = { ...this.template, ...updated }; });
        }
      } finally { this.rulesOpening = false; this.root.inert = false; }
    }), { glyph: "settings" }) : null;
    this.copyDraftButton = button("Save as new draft", () => this.run(() => this.save({ asNew: true })), { glyph: "copy" });
    this.copyDraftButton.title = "Save your layout as a new draft. Trace outputs are not copied; review them before publishing.";
    this.copyDraftButton.hidden = true;
    const heading = el("div", { class: "builder-heading" }, el("div", {},
      el("span", { class: "eyebrow" }, form.ppmCode),
      el("h2", {}, this.readonly ? "Published template" : "Form builder"),
      el("p", {}, this.readonly ? "This version is locked. Duplicate it to make changes." : "Build your form, try it, then publish when ready.")),
    el("div", { class: "actions" },
      onConnections ? button("Connections", onConnections, { glyph: "trace" }) : null,
      this.rulesButton,
      button("Preview", () => this.preview(), { glyph: "eye" }),
      this.readonly ? button("Duplicate", () => this.run(async () => {
        if (this.duplicating || this.destroyed) return;
        this.duplicating = true; this.root.inert = true;
        try { await onDuplicate(this.template); }
        finally { this.duplicating = false; this.root.inert = false; }
      }), { kind: "primary", glyph: "copy" }) : this.saveButton,
      this.readonly ? null : this.publishButton));
    const details = el("details", { class: "builder-metadata" }, el("summary", {}, "Document details"));
    const metaGrid = el("div", { class: "field-grid" });
    this.metadataInputs = new Map();
    for (const key of metadataKeys) {
      const input = textInput(this.metadata[key], { disabled: this.readonly, maxLength: key === "sourceFileHash" ? 64 : 512 });
      this.bindInput(input, () => { this.metadata[key] = input.value; });
      this.metadataInputs.set(key, input);
      metaGrid.append(field(labels[key], input));
    }
    details.append(metaGrid);
    this.undoButton = button("Undo", () => this.undo(), { small: true, glyph: "back", disabled: true });
    this.redoButton = button("Redo", () => this.redo(), { small: true, glyph: "arrow", disabled: true });
    this.designButton = button("Design form", () => this.setMode("design"), { small: true });
    this.tryButton = button("Try form", () => this.setMode("preview"), { small: true, glyph: "eye" });
    this.toolbar = el("div", { class: "builder-workspace-toolbar" },
      el("div", { class: "actions builder-mode-controls", role: "group", "aria-label": "Builder view" }, this.designButton, this.tryButton),
      this.stateLabel,
      el("div", { class: "actions" }, this.copyDraftButton, this.undoButton, this.redoButton));
    this.palette = this.createPalette();
    this.structure = el("div", { class: "builder-sections builder-canvas", "aria-label": "Form design" });
    this.inspector = el("aside", { class: "builder-inspector", "aria-label": "Field settings" });
    this.design = el("div", { class: "builder-design" }, this.palette, this.structure, this.inspector);
    this.previewHost = el("div", { class: "builder-preview", hidden: true });
    this.root.append(heading,
      el("div", { class: "builder-title-grid" }, field("Form title", this.titleInput), field("Version label", this.versionInput)),
      details, this.toolbar, this.live, this.design, this.previewHost);
    this.setupDrag();
    this.renderSections();
    this.renderInspector();
    this.syncControls();
    this.dirty = false;
  }
  serialized() { return JSON.stringify({ definition: this.definition, metadata: this.metadata }); }
  snapshot() { return { definition: clone(this.definition), metadata: clone(this.metadata), selected: this.selected, destination: this.destination }; }
  checkpoint() {
    if (this.readonly) return;
    this.history.push(this.snapshot());
    if (this.history.length > 60) this.history.shift();
    this.future = [];
  }
  get dirty() { return !!this._dirty; }
  set dirty(value) { this._dirty = value; if (!this.destroyed) this.onDirty?.(value); }
  changed({ repaint = true, message = "" } = {}) {
    this.dirty = this.serialized() !== this.baseline || this.invalidInputs.size > 0;
    this.syncControls();
    if (repaint) { this.renderSections(); this.renderInspector(); }
    if (this.mode === "preview") this.schedulePreview();
    if (message) this.announce(message);
  }
  announce(message) { this.live.textContent = message; }
  bindInput(input, apply, { repaint = false } = {}) {
    let recorded = false;
    input.addEventListener("focus", () => { recorded = false; });
    input.addEventListener("input", () => {
      if (this.readonly) return;
      if (!recorded) { this.checkpoint(); recorded = true; }
      if (input.checkValidity()) this.invalidInputs.delete(input);
      else this.invalidInputs.add(input);
      // Keep unfinished text in the working draft. Invalid numbers remain in
      // their focused control until corrected or undone; never save NaN.
      if (input.type !== "number" || input.checkValidity()) apply();
      this.changed({ repaint: false });
      if (this.selected) {
        const f = builderIndex(this.definition).fields.get(this.selected)?.field;
        const card = [...this.structure.querySelectorAll(".builder-field")].find((node) => node.dataset.fieldPath === this.selected);
        if (f && card) {
          const name = card.querySelector(":scope > .builder-field-line .builder-field-name");
          if (name) name.textContent = f.label;
          card.querySelector(":scope > .builder-field-line .builder-configure")?.setAttribute("aria-label", `Configure ${f.label}`);
          card.querySelector(":scope > .builder-field-line .builder-drag-handle")?.setAttribute("aria-label", `Drag ${f.label}`);
        }
      }
    });
    if (repaint) input.addEventListener("change", () => this.renderSections());
  }
  syncControls() {
    if (!this.stateLabel) return;
    this.stateLabel.textContent = this.readonly ? "Published · locked" : this.dirty ? "Unsaved changes" : this.template ? "Draft saved" : "New draft";
    this.undoButton.disabled = this.readonly || !this.history.length;
    this.redoButton.disabled = this.readonly || !this.future.length;
    this.publishButton.hidden = !this.template || this.readonly;
    if (this.rulesButton) this.rulesButton.hidden = !this.template;
    this.designButton.setAttribute("aria-pressed", String(this.mode === "design"));
    this.tryButton.setAttribute("aria-pressed", String(this.mode === "preview"));
    this.palette.hidden = this.readonly;
  }
  restore(snapshot) {
    this.definition = snapshot.definition;
    this.metadata = snapshot.metadata;
    this.selected = snapshot.selected;
    this.destination = snapshot.destination;
    this.invalidInputs.clear();
    this.titleInput.value = this.definition.title;
    this.versionInput.value = this.metadata.versionLabel;
    for (const [key, input] of this.metadataInputs) input.value = this.metadata[key];
    this.changed();
  }
  undo() {
    if (this.readonly || !this.history.length) return;
    this.future.push(this.snapshot());
    this.restore(this.history.pop());
    this.announce("Change undone");
  }
  redo() {
    if (this.readonly || !this.future.length) return;
    this.history.push(this.snapshot());
    this.restore(this.future.pop());
    this.announce("Change restored");
  }
  async run(action) {
    try { return await action(); } catch (error) { showError(error); }
  }
  ensureSettings() {
    for (const input of this.root.querySelectorAll("input,textarea"))
      if (!input.disabled && !input.closest(".builder-preview") && !input.reportValidity())
        throw new Error("Complete the highlighted setting first, or undo the change");
    this.invalidInputs.clear();
  }
  validate() {
    this.ensureSettings();
    validateBuilderDefinition(this.definition);
  }
  async save({ asNew = false, fromPublish = false, fromRules = false } = {}) {
    if (this.readonly) throw new Error("Duplicate this published version to make changes");
    if (this.destroyed) return;
    if (this.saving || (this.publishing && !fromPublish) || (this.rulesOpening && !fromRules))
      throw new Error("Wait for the current save or publication to finish");
    this.validate();
    const payload = { definitionJson: clone(this.definition),
      ...Object.fromEntries(Object.entries(this.metadata).map(([key, value]) => [key, value === "" ? null : value])) };
    if (this.template && !asNew) payload.expectedEditHash = this.template.editHash;
    this.saving = true;
    this.root.inert = true;
    try {
      const saved = await this.onSave(payload, asNew ? null : this.template);
      this.template = saved;
      this.baseline = this.serialized();
      this.dirty = false;
      this.copyDraftButton.hidden = true;
      this.syncControls();
      notify(asNew ? "Layout saved as a new draft. Trace outputs are not copied; review them before publishing." : "Draft template saved");
      this.announce(asNew ? "Layout saved as a new draft. Trace outputs are not copied; review them before publishing." : "Draft saved. Existing records are unchanged.");
      return saved;
    } catch (error) {
      if ([error?.error, error?.code, error?.message].includes("TEMPLATE_CHANGED")) {
        this.copyDraftButton.hidden = false;
        this.announce("This template changed elsewhere. Your edits are still here. Save your layout as a new draft. Trace outputs are not copied; review them before publishing.");
      }
      throw error;
    } finally { this.saving = false; this.root.inert = false; }
  }
  async publish() {
    if (this.readonly || !this.template || this.publishing || this.saving || this.rulesOpening || this.destroyed) return;
    this.publishing = true;
    try {
      if (!(await confirmAction("Publish this version?", "New records will use this version. Existing and offline records keep their current template. Published versions cannot be edited.", "Publish version"))) return;
      if (this.destroyed) return;
      this.validate();
      if (this.dirty) await this.save({ fromPublish: true });
      if (this.destroyed) return;
      this.root.inert = true;
      await this.onPublish(this.template);
      notify("Template published");
    } catch (error) { showError(error); }
    finally { this.publishing = false; this.root.inert = false; }
  }
  createPalette() {
    const palette = el("aside", { class: "builder-palette", "aria-label": "Add fields" },
      el("h3", {}, "Add fields"),
      el("p", {}, "Drag onto the form, or choose a destination and click a field."));
    this.destinationLabel = el("p", { class: "builder-destination" }, "Adding to Form header");
    palette.append(this.destinationLabel);
    const groups = [
      ["Common", ["text", "number", "date", "select", "table", "total"]],
      ["More fields", ["textarea", "integer", "boolean", "time", "datetime", "multiselect", "trace-code", "repeatable", "group"]],
    ];
    for (const [caption, types] of groups) {
      const list = el("div", { class: "builder-palette-list" });
      for (const type of types) {
        const node = button(FIELD_LABELS[type], () => this.run(() => this.addField(type, this.destination)), { small: true });
        node.classList.add("builder-palette-field");
        node.dataset.paletteType = type;
        node.draggable = true;
        node.setAttribute("aria-label", `Add ${FIELD_LABELS[type]} field`);
        node.title = `Drag or click to add ${FIELD_LABELS[type].toLowerCase()}`;
        node.prepend(el("span", { class: "builder-palette-symbol", "aria-hidden": "true" },
          CONTAINERS.has(type) ? "▦" : type === "total" ? "Σ" : type === "number" || type === "integer" ? "#" : type === "date" ? "◷" : type === "boolean" ? "☑" : type === "select" ? "⌄" : "Aa"));
        list.append(node);
      }
      if (caption === "Common") palette.append(list);
      else palette.append(el("details", { class: "builder-more-fields" }, el("summary", {}, caption), list));
    }
    return palette;
  }
  setDestination(path) {
    const { lists } = builderIndex(this.definition), list = lists.get(path);
    if (!list) return;
    this.destination = path;
    const section = this.definition.sections.find((s) => s.key === list.section);
    this.destinationLabel.textContent = `Adding to ${list.parent?.label || section.label}`;
    for (const node of this.structure.querySelectorAll("[data-destination]")) {
      const active = node.dataset.destination === path;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-pressed", String(active));
    }
  }
  select(path) {
    try { this.ensureSettings(); } catch (error) { showError(error); return; }
    const entry = builderIndex(this.definition).fields.get(path);
    if (!entry) return;
    this.selected = path;
    this.setDestination(entry.field.fields ? builderListId(path) : entry.listPath);
    for (const node of this.structure.querySelectorAll(".builder-field"))
      node.classList.toggle("is-selected", node.dataset.fieldPath === path);
    this.renderInspector();
  }
  addField(type, listPath, index = null) {
    if (this.readonly) return;
    this.ensureSettings();
    const list = builderIndex(this.definition).lists.get(listPath);
    const next = createBuilderField(this.definition, listPath, type);
    this.checkpoint();
    list.items.splice(index === null ? list.items.length : index, 0, next);
    this.selected = list.scope + next.key;
    this.destination = next.fields ? builderListId(this.selected) : listPath;
    this.changed({ message: `${next.label} added. Adjust its settings.` });
  }
  moveField(path, listPath, targetIndex, focusHandle = false) {
    if (this.readonly) return;
    this.ensureSettings();
    const { fields, lists } = builderIndex(this.definition), source = fields.get(path), target = lists.get(listPath);
    if (!source || !target) return;
    if (source.scope !== target.scope)
      throw new Error("Keep a column in its table or group to preserve its data and calculations");
    if (!source.scope && source.section === "main" && source.items.length === 1 && target.section !== "main")
      throw new Error("Keep at least one field in the main records section");
    const offset = source.items === target.items && source.index < targetIndex ? -1 : 0;
    if (source.items === target.items && source.index === targetIndex + offset) return;
    this.checkpoint();
    source.items.splice(source.index, 1);
    target.items.splice(Math.max(0, Math.min(target.items.length, targetIndex + offset)), 0, source.field);
    this.selected = path;
    this.destination = listPath;
    this.changed({ message: `${source.field.label} moved` });
    if (focusHandle) this.focusHandle(path);
  }
  focusHandle(path) {
    [...this.structure.querySelectorAll(".builder-field")].find((node) => node.dataset.fieldPath === path)
      ?.querySelector(":scope > .builder-field-line .builder-drag-handle")?.focus({ preventScroll: true });
  }
  async removeField(path) {
    if (this.readonly) return;
    try { this.ensureSettings(); } catch (error) { showError(error); return; }
    const entry = builderIndex(this.definition).fields.get(path);
    if (!entry) return;
    const users = removalDependents(this.definition, path);
    if (users.length) { showError(new Error(`Used by ${users.join(", ")}. Update that calculation or condition before removing this field.`)); return; }
    if (entry.scope && entry.items.length === 1) { showError(new Error("Keep at least one column or remove its whole table/group")); return; }
    if (!entry.scope && entry.section === "main" && entry.items.length === 1) { showError(new Error("Keep at least one field in the main records section")); return; }
    if (!(await confirmAction("Remove field?", `${entry.field.label} will be removed from this draft. You can undo this change. Existing records keep their original template.`, "Remove"))) return;
    // A dialog does not grant permission to remove a different later selection.
    const current = builderIndex(this.definition).fields.get(path);
    if (!current || current.field !== entry.field) return;
    this.checkpoint();
    current.items.splice(current.index, 1);
    this.selected = null;
    this.destination = current.listPath;
    this.changed({ message: `${current.field.label} removed. Undo is available.` });
  }
  renderSections() {
    this.structure.replaceChildren();
    const index = builderIndex(this.definition);
    for (const section of this.definition.sections) {
      const label = textInput(section.label || section.key, { class: "section-name", disabled: this.readonly, required: true, maxLength: 120,
        "aria-label": `${section.key} section label` });
      this.bindInput(label, () => { section.label = label.value; this.setDestination(this.destination); });
      const destination = button("Add here", () => this.setDestination(section.key), { small: true });
      destination.dataset.destination = section.key;
      const card = el("section", { class: "builder-section", "data-builder-section": section.key },
        el("header", {}, el("span", { class: "section-index" }, section.key === "header" ? "01" : section.key === "main" ? "02" : "03"),
          el("div", {}, label, el("p", {}, section.key === "header" ? "Identification and context" : section.key === "main" ? "Tables and production entries" : "Totals and summaries")),
          this.readonly ? null : el("div", { class: "actions builder-section-actions" }, destination,
            button("Add field", () => this.editField(section.items), { small: true, glyph: "plus" }))),
        this.fieldList(index.lists.get(section.key), index));
      this.structure.append(card);
    }
    this.setDestination(index.lists.has(this.destination) ? this.destination : "header");
  }
  fieldList(list, index) {
    const container = el("div", { class: `builder-field-list builder-drop-list${list.parent && ["table", "repeatable"].includes(list.parent.type) ? " builder-columns" : ""}`,
      "data-list-path": list.path, "aria-label": list.parent ? `${list.parent.label} fields` : `${list.section} fields` });
    const slot = (position) => el("div", { class: "builder-drop-slot", "data-list-path": list.path, "data-drop-index": position, "aria-hidden": "true" });
    container.append(slot(0));
    if (!list.items.length) container.append(el("p", { class: "builder-empty" }, this.readonly ? "No fields in this section." : "Drop a field here or use Add field."));
    list.items.forEach((f, position) => {
      const path = list.scope + f.key;
      const item = el("div", { class: `builder-field${this.selected === path ? " is-selected" : ""}`, "data-field-key": f.key, "data-field-path": path });
      const handle = iconButton(`Drag ${f.label}`, "menu", null, { class: "icon-button builder-drag-handle", draggable: !this.readonly, disabled: this.readonly,
        "data-drag-path": path, title: "Drag to move. Alt + Up/Down moves with the keyboard." });
      handle.addEventListener("keydown", (event) => {
        if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        this.run(() => this.moveField(path, list.path, event.key === "ArrowUp" ? Math.max(0, position - 1) : Math.min(list.items.length, position + 2), true));
      });
      const configure = button(f.label, () => this.select(path));
      configure.className = "builder-configure";
      configure.setAttribute("aria-label", `Configure ${f.label}`);
      configure.querySelector("span").className = "builder-field-name";
      if (f.required) configure.append(el("span", { class: "builder-required", "aria-label": "required" }, "*"));
      const controls = el("div", { class: "actions builder-field-actions" },
        iconButton(this.readonly ? "View field" : "Edit field", this.readonly ? "eye" : "settings", () => this.editField(list.items, position)));
      if (!this.readonly) controls.append(
        iconButton("Move field up", "back", () => this.run(() => this.moveField(path, list.path, position - 1, true)), { disabled: position === 0 }),
        iconButton("Move field down", "arrow", () => this.run(() => this.moveField(path, list.path, position + 2, true)), { disabled: position === list.items.length - 1 }),
        iconButton("Remove field", "trash", () => this.removeField(path)));
      const line = el("div", { class: "builder-field-line" }, handle,
        el("div", { class: "builder-field-text" }, configure,
          el("span", { class: "builder-field-kind" }, f.calculation ? "Calculated number" : FIELD_LABELS[f.type] || f.type)), controls);
      item.append(line);
      if (f.fields) {
        const addColumn = button("Add column", () => this.editField(f.fields), { small: true, glyph: "plus" });
        const choose = button("Add here", () => this.setDestination(builderListId(path)), { small: true });
        choose.dataset.destination = builderListId(path);
        item.append(el("div", { class: "builder-container-tools" },
          el("span", {}, `${f.fields.length} ${f.type === "group" ? "fields" : "columns"}`),
          this.readonly ? null : el("div", { class: "actions" }, choose, addColumn)),
          this.fieldList(index.lists.get(builderListId(path)), index));
      } else {
        const mock = el("div", { class: `builder-field-sample sample-${f.type}`, "aria-hidden": "true" },
          f.calculation ? "0.00" : f.type === "boolean" ? "□ Yes / No" : ["select", "multiselect"].includes(f.type) ? "Choose an option…  ⌄" : f.type === "date" ? "mm / dd / yyyy" : ["number", "integer"].includes(f.type) ? "0" : f.helpText || "Enter a value…");
        item.append(mock);
        mock.addEventListener("click", () => this.select(path));
      }
      container.append(item, slot(position + 1));
    });
    return container;
  }
  renderInspector() {
    this.inspector.replaceChildren(el("h3", {}, "Field settings"));
    const entry = builderIndex(this.definition).fields.get(this.selected);
    if (!entry) {
      this.inspector.append(el("p", { class: "builder-inspector-empty" }, "Choose a field on the form to edit its label and settings."),
        el("div", { class: "builder-safe-note" }, "Saved and offline records keep the template version they were created with."));
      return;
    }
    const f = entry.field;
    this.inspector.append(el("p", { class: "builder-inspector-type" }, FIELD_LABELS[f.type] || f.type));
    const label = textInput(f.label, { disabled: this.readonly, required: true, maxLength: 512 });
    this.bindInput(label, () => { f.label = label.value; });
    const help = textInput(f.helpText || "", { disabled: this.readonly, maxLength: 500 });
    this.bindInput(help, () => { if (help.value) f.helpText = help.value; else delete f.helpText; });
    this.inspector.append(field("Field label", label), field("Help text", help));
    if (!CONTAINERS.has(f.type) && !f.calculation) {
      const required = el("input", { type: "checkbox", checked: !!f.required, disabled: this.readonly });
      required.addEventListener("change", () => {
        try { this.ensureSettings(); } catch (error) { required.checked = !!f.required; showError(error); return; }
        this.checkpoint(); if (required.checked) f.required = true; else delete f.required; this.changed();
      });
      this.inspector.append(field("Required field", required));
    }
    if (["select", "multiselect"].includes(f.type)) this.inspector.append(this.optionInspector(entry));
    if (["number", "integer"].includes(f.type) && !f.calculation) {
      for (const [name, caption] of [["min", "Minimum value"], ["max", "Maximum value"]]) {
        const input = textInput(f.validation?.[name] ?? "", { type: "number", step: f.type === "integer" ? "1" : "any", disabled: this.readonly });
        this.bindInput(input, () => {
          f.validation = { ...f.validation };
          if (input.value === "") delete f.validation[name]; else f.validation[name] = Number(input.value);
          if (!Object.keys(f.validation).length) delete f.validation;
        });
        this.inspector.append(field(caption, input));
      }
    }
    if (["table", "repeatable"].includes(f.type)) {
      for (const [name, caption, minimum] of [["minRows", "Minimum rows", 0], ["maxRows", "Maximum rows", 1]]) {
        const input = textInput(f[name] ?? (minimum ? 200 : 0), { type: "number", min: minimum, max: 1000, step: 1, required: true, disabled: this.readonly });
        this.bindInput(input, () => { f[name] = Number(input.value); });
        this.inspector.append(field(caption, input));
      }
    }
    if (f.calculation && ["sum", "count", "average", "min", "max"].includes(f.calculation.op)) {
      const candidates = [...builderIndex(this.definition).fields.values()].filter((candidate) =>
        candidate.path !== entry.path && (f.calculation.op === "count" ? CONTAINERS.has(candidate.field.type) : ["number", "integer"].includes(candidate.field.type)));
      const source = searchableSelect(candidates.map((candidate) => ({ value: candidate.path, label: `${candidate.field.label} · ${candidate.path}` })), f.calculation.path, { disabled: this.readonly });
      source.addEventListener("change", () => {
        try { this.ensureSettings(); } catch (error) { source.value = f.calculation.path; showError(error); return; }
        const previous = clone(f.calculation); this.checkpoint(); f.calculation.path = source.value;
        try { validateBuilderDefinition(this.definition); this.changed(); }
        catch (error) { f.calculation = previous; this.history.pop(); showError(error); this.renderInspector(); }
      });
      this.inspector.append(field("Total from", source));
    }
    const advanced = button(this.readonly ? "View all settings" : "More settings", () => this.editField(entry.items, entry.index), { small: true, glyph: "settings" });
    this.inspector.append(advanced,
      el("p", { class: "builder-key-note" }, "Field identifiers stay fixed when labels or positions change."));
    if (!this.readonly) this.inspector.append(button("Remove selected field", () => this.removeField(entry.path), { small: true, glyph: "trash" }));
  }
  optionInspector(entry) {
    const f = entry.field;
    const group = el("fieldset", { class: "builder-option-editor" }, el("legend", {}, "Dropdown options"));
    const list = el("div", { class: "builder-option-list" });
    (f.options || []).forEach((option, index) => {
      const label = typeof option === "string" ? option : option.label || option.value;
      const input = textInput(label, { required: true, maxLength: 200, disabled: this.readonly, "aria-label": `Option ${index + 1} label` });
      this.bindInput(input, () => {
        const value = typeof f.options[index] === "string" ? f.options[index] : f.options[index].value;
        f.options[index] = { value, label: input.value };
      });
      list.append(el("div", { class: "builder-option-row" }, input,
        this.readonly ? null : iconButton(`Remove option ${index + 1}`, "close", () => {
          try { this.ensureSettings(); } catch (error) { showError(error); return; }
          if (f.options.length < 2) return;
          this.checkpoint(); f.options.splice(index, 1); this.changed();
        }, { disabled: f.options.length < 2 })));
    });
    group.append(list);
    if (!this.readonly) group.append(button("Add option", () => {
      try { this.ensureSettings(); } catch (error) { showError(error); return; }
      this.checkpoint();
      let next = 1;
      const used = new Set(f.options.map((option) => typeof option === "string" ? option : option.value));
      while (used.has(`option${next}`)) next++;
      f.options.push({ value: `option${next}`, label: `Option ${next}` });
      this.changed();
    }, { small: true, glyph: "plus" }));
    return group;
  }
  setupDrag() {
    const options = { signal: this.controller.signal };
    this.root.addEventListener("dragstart", (event) => {
      if (this.readonly) { event.preventDefault(); return; }
      const palette = event.target.closest("[data-palette-type]"), handle = event.target.closest("[data-drag-path]");
      if (!palette && !handle) return;
      this.dragging = palette ? { type: palette.dataset.paletteType } : { path: handle.dataset.dragPath };
      event.dataTransfer.effectAllowed = palette ? "copy" : "move";
      event.dataTransfer.setData(dragType, "local");
      this.root.classList.add("builder-is-dragging");
    }, options);
    const targetAt = (event) => {
      const slot = event.target.closest(".builder-drop-slot"), list = event.target.closest(".builder-drop-list");
      if (!list) return null;
      const model = builderIndex(this.definition).lists.get(list.dataset.listPath);
      if (!model) return null;
      if (slot && slot.closest(".builder-drop-list") === list) return { node: slot, path: model.path, index: Number(slot.dataset.dropIndex) };
      const card = event.target.closest(".builder-field");
      if (card && card.parentElement === list) {
        const fieldIndex = model.items.findIndex((field) => field.key === card.dataset.fieldKey), box = card.getBoundingClientRect();
        const after = list.classList.contains("builder-columns") ? event.clientX > box.left + box.width / 2 : event.clientY > box.top + box.height / 2;
        const position = fieldIndex + (after ? 1 : 0);
        return { node: [...list.children].find((node) => node.dataset.dropIndex === String(position)), path: model.path, index: position };
      }
      return { node: list.lastElementChild, path: model.path, index: model.items.length };
    };
    const clear = () => {
      for (const node of this.root.querySelectorAll(".is-drop-target")) node.classList.remove("is-drop-target");
    };
    this.structure.addEventListener("dragover", (event) => {
      if (!this.dragging || this.readonly) return;
      const target = targetAt(event);
      if (!target) return;
      event.preventDefault(); event.stopPropagation();
      event.dataTransfer.dropEffect = this.dragging.type ? "copy" : "move";
      clear(); target.node?.classList.add("is-drop-target");
      const columns = event.target.closest(".builder-columns");
      if (columns) {
        const bounds = columns.getBoundingClientRect();
        if (event.clientX < bounds.left + 36) columns.scrollLeft -= 12;
        else if (event.clientX > bounds.right - 36) columns.scrollLeft += 12;
      }
      // Keep long forms navigable while the pointer approaches a window edge.
      if (event.clientY < 80) window.scrollBy(0, -14);
      else if (event.clientY > window.innerHeight - 80) window.scrollBy(0, 14);
    }, options);
    this.structure.addEventListener("drop", (event) => {
      const payload = this.dragging, target = targetAt(event);
      if (!payload || !target || this.readonly) return;
      event.preventDefault(); event.stopPropagation();
      clear(); this.root.classList.remove("builder-is-dragging"); this.dragging = null;
      this.run(() => payload.type ? this.addField(payload.type, target.path, target.index) : this.moveField(payload.path, target.path, target.index));
    }, options);
    this.root.addEventListener("dragend", () => { clear(); this.dragging = null; this.root.classList.remove("builder-is-dragging"); }, options);
  }
  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === "preview") {
      try { this.validate(); } catch (error) { showError(error); return; }
    }
    this.mode = mode;
    this.design.hidden = mode !== "design";
    this.previewHost.hidden = mode !== "preview";
    this.syncControls();
    if (mode === "preview") this.renderPreview();
    else { this.previewViewport?.destroy(); this.previewViewport = null; }
  }
  schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => { if (this.root.isConnected && this.mode === "preview") this.renderPreview(); }, 300);
  }
  previewData() {
    // Preview remains small even when an existing schema requires many rows.
    const fields = clone(fieldsOf(this.definition));
    const trim = (fields) => {
      for (const f of fields) {
        if (["table", "repeatable"].includes(f.type)) f.minRows = Math.min(3, f.minRows || 0);
        if (f.fields) trim(f.fields);
      }
    };
    trim(fields);
    return defaultData(fields);
  }
  renderPreview() {
    this.previewViewport?.destroy();
    this.previewViewport = null;
    this.previewHost.replaceChildren(el("p", { class: "builder-preview-hint" }, "Try the fields and calculations. Preview entries are not saved as records."));
    try {
      const renderer = new FormRenderer({ definition: clone(this.definition), data: this.previewData(), title: this.definition.title, metadata: this.metadata });
      renderer.setReview({});
      this.previewViewport = new DocumentViewport(renderer.root, { title: "Live form preview" });
      this.previewHost.append(this.previewViewport.root);
    } catch (error) { this.previewHost.append(el("p", { class: "notice", role: "alert" }, error.message)); }
  }
  destroy() {
    this.destroyed = true;
    clearTimeout(this.previewTimer);
    this.controller.abort();
    this.previewViewport?.destroy();
    this.modalViewport?.destroy();
    this.openDialog?.close();
  }
  editField(items, index = null) {
    try { this.ensureSettings(); } catch (error) { showError(error); return; }
    const list = [...builderIndex(this.definition).lists.values()].find((value) => value.items === items);
    if (!list) return;
    const original = index === null ? null : items[index];
    const f = clone(original || { key: "", label: "", type: "text" });
    const key = textInput(f.key, {
      required: true,
      pattern: "[A-Za-z][A-Za-z0-9_-]*",
      disabled: this.readonly || !!original,
      maxLength: 128,
    });
    const label = textInput(f.label, {
      required: true,
      disabled: this.readonly,
      maxLength: 512,
    });
    let customKey = false;
    key.addEventListener("input", () => { customKey = true; });
    label.addEventListener("input", () => {
      if (!original && !customKey) key.value = uniqueFieldKey(this.definition, list.path, label.value);
    });
    const type = searchableSelect(FIELD_TYPES, f.type, {
      disabled: this.readonly || !!original,
    });
    const required = el("input", {
      type: "checkbox",
      checked: !!f.required,
      disabled: this.readonly,
    });
    const readOnly = el("input", {
      type: "checkbox",
      checked: !!f.readOnly,
      disabled: this.readonly,
    });
    const allowRemoval = el("input", {
      type: "checkbox",
      checked: !!f.allowRemoval,
      disabled: this.readonly,
    });
    const removalGroup = field(
      "Allow removal of rows or groups containing protected values",
      allowRemoval,
      "The server records each removal in revision history.",
    );
    const help = textInput(f.helpText || "", { disabled: this.readonly });
    const options = el("textarea", {
      rows: 4,
      disabled: this.readonly,
      value: (f.options || [])
        .map((o) =>
          typeof o === "string" ? o : `${o.value} | ${o.label || o.value}`,
        )
        .join("\n"),
      placeholder: "PACK | Pack\nBOX | Box",
    });
    const min = textInput(f.validation?.min ?? "", {
      type: "number",
      step: "any",
      disabled: this.readonly,
    });
    const max = textInput(f.validation?.max ?? "", {
      type: "number",
      step: "any",
      disabled: this.readonly,
    });
    const step = textInput(f.validation?.step ?? "", {
      type: "number",
      min: 0,
      step: "any",
      disabled: this.readonly,
    });
    const maxLength = textInput(f.validation?.maxLength ?? "", {
      type: "number",
      min: 1,
      max: 16384,
      disabled: this.readonly,
    });
    const minRows = textInput(f.minRows ?? 0, {
      type: "number",
      min: 0,
      max: 1000,
      disabled: this.readonly,
    });
    const maxRows = textInput(f.maxRows ?? 200, {
      type: "number",
      min: 1,
      max: 1000,
      disabled: this.readonly,
    });
    const calc = searchableSelect(
      [
        { value: "", label: "None (entered by user)" },
        ...[
          "sum",
          "count",
          "average",
          "min",
          "max",
          "add",
          "subtract",
          "multiply",
          "divide",
          "round",
        ].map((v) => ({ value: v, label: v })),
      ],
      f.calculation?.op || "",
      { disabled: this.readonly },
    );
    let calcTouched = false;
    const calcPath = textInput(f.calculation?.path || "", {
      placeholder: "entries[].quantity",
      disabled: this.readonly,
    });
    const operands = textInput(
      (f.calculation?.args || []).map((a) => a.path ?? a.value).join(", "),
      { placeholder: "quantity, unitPrice", disabled: this.readonly },
    );
    for (const input of [calc, calcPath, operands])
      input.addEventListener("change", () => {
        calcTouched = true;
      });
    const conditional = (existing, caption) => {
      const path = textInput(existing?.path || "", {
        placeholder: "status",
        disabled: this.readonly,
      });
      const operator = searchableSelect(
        ["eq", "ne", "gt", "gte", "lt", "lte", "in", "notEmpty"],
        existing?.operator || "eq",
        { disabled: this.readonly },
      );
      const value = textInput(
        Array.isArray(existing?.value)
          ? existing.value.join(",")
          : (existing?.value ?? ""),
        { disabled: this.readonly },
      );
      const state = { existing, touched: false };
      for (const input of [path, operator, value])
        input.addEventListener("change", () => {
          state.touched = true;
        });
      return {
        path,
        operator,
        value,
        state,
        node: el(
          "fieldset",
          { class: "condition-editor" },
          el("legend", {}, caption),
          el(
            "div",
            { class: "field-grid three" },
            field("Field path", path),
            field("Operator", operator),
            field("Value", value),
          ),
        ),
      };
    };
    const visible = conditional(f.visibleWhen, "Show when (optional)");
    const requiredWhen = conditional(
      f.requiredWhen,
      "Required when (optional)",
    );
    const numericGroup = el(
      "div",
      { class: "field-grid three" },
      field("Minimum", min),
      field("Maximum", max),
      field("Step", step),
    );
    const rowsGroup = el(
      "div",
      { class: "field-grid" },
      field("Minimum rows on submit", minRows),
      field("Maximum rows", maxRows),
    );
    const optionsGroup = field(
      "Options, one per line",
      options,
      "Use value | label for separate stored values and display labels.",
    );
    const lengthGroup = field("Maximum characters", maxLength);
    const calcGroup = el(
      "fieldset",
      { class: "calculation-editor" },
      el("legend", {}, "Calculation"),
      field("Operation", calc),
      field(
        "Aggregate path",
        calcPath,
        "Use entries[].quantity for a column total.",
      ),
      field(
        "Operands",
        operands,
        "Comma-separated field paths or numeric literals. Row fields resolve within that row.",
      ),
    );
    const form = el(
      "form",
      {},
      el(
        "div",
        { class: "field-grid" },
        field("Label", label),
        field("Stable field key", key),
        field("Input type", type),
        field("Help text", help),
      ),
      el(
        "div",
        { class: "check-options" },
        field("Required", required),
        field("Read only", readOnly),
      ),
      optionsGroup,
      numericGroup,
      lengthGroup,
      rowsGroup,
      removalGroup,
      el("details", { class: "builder-advanced-settings", open: !!(f.calculation || f.visibleWhen || f.requiredWhen) },
        el("summary", {}, "Calculations and conditional rules"),
        calcGroup, visible.node, requiredWhen.node),
    );
    const update = () => {
      optionsGroup.hidden = !["select", "multiselect"].includes(type.value);
      numericGroup.hidden = !["number", "integer"].includes(type.value);
      lengthGroup.hidden = !["text", "textarea"].includes(type.value);
      rowsGroup.hidden = !["table", "repeatable"].includes(type.value);
      removalGroup.hidden = !["table", "repeatable", "group"].includes(
        type.value,
      );
      calcGroup.hidden = !["number", "integer"].includes(type.value);
      calcPath.parentElement.hidden = ![
        "sum",
        "count",
        "average",
        "min",
        "max",
      ].includes(calc.value);
      operands.parentElement.hidden = ![
        "add",
        "subtract",
        "multiply",
        "divide",
        "round",
      ].includes(calc.value);
    };
    type.addEventListener("change", update);
    calc.addEventListener("change", update);
    update();
    const parseValue = (value) =>
      value === "true"
        ? true
        : value === "false"
          ? false
          : value !== "" && Number.isFinite(Number(value))
            ? Number(value)
            : value;
    const getCondition = (c) =>
      !c.state.touched
        ? c.state.existing
        : c.path.value.trim()
          ? {
              path: c.path.value.trim(),
              operator: c.operator.value,
              ...(c.operator.value === "notEmpty"
                ? {}
                : {
                    value:
                      c.operator.value === "in"
                        ? c.value.value
                            .split(",")
                            .map((v) => parseValue(v.trim()))
                        : parseValue(c.value.value),
                  }),
            }
          : undefined;
    const save = button(
      original ? "Update field" : "Add field",
      () => {
        try {
          if (!form.reportValidity()) return;
          if (items.some((x, i) => i !== index && x.key === key.value.trim()))
            throw new Error("Field keys must be unique");
          const sameType = original?.type === type.value;
          const next = sameType ? clone(original) : {};
          Object.assign(next, {
            key: key.value.trim(),
            label: label.value.trim(),
            type: type.value,
          });
          delete next.required;
          delete next.readOnly;
          if (required.checked) next.required = true;
          if (readOnly.checked) next.readOnly = true;
          if (help.value.trim()) next.helpText = help.value.trim();
          else delete next.helpText;
          if (sameType && f.defaultValue !== undefined)
            next.defaultValue = f.defaultValue;
          if (f.unit) next.unit = f.unit;
          if (["select", "multiselect"].includes(type.value)) {
            next.options = options.value
              .split("\n")
              .filter((x) => x.trim())
              .map((line) => {
                const [v, ...rest] = line.split("|");
                return {
                  value: v.trim(),
                  label: rest.join("|").trim() || v.trim(),
                };
              });
            if (!next.options.length)
              throw new Error("Add at least one option");
          }
          if (["number", "integer"].includes(type.value)) {
            const validation = sameType ? { ...next.validation } : {};
            for (const [k, input] of Object.entries({ min, max, step })) {
              if (input.value !== "") validation[k] = Number(input.value);
              else delete validation[k];
            }
            if (Object.keys(validation).length) next.validation = validation;
            else delete next.validation;
            if (calcTouched || !sameType) {
              delete next.calculation;
              if (calc.value) {
                next.calculation = [
                  "sum",
                  "count",
                  "average",
                  "min",
                  "max",
                ].includes(calc.value)
                  ? { op: calc.value, path: calcPath.value.trim() }
                  : {
                      op: calc.value,
                      args: operands.value
                        .split(",")
                        .filter((v) => v.trim())
                        .map((v) =>
                          Number.isFinite(Number(v.trim()))
                            ? { value: Number(v.trim()) }
                            : { path: v.trim() },
                        ),
                    };
              }
            }
          }
          if (["text", "textarea"].includes(type.value)) {
            next.validation = { ...next.validation };
            if (maxLength.value)
              next.validation.maxLength = Number(maxLength.value);
            else delete next.validation.maxLength;
            if (!Object.keys(next.validation).length) delete next.validation;
          }
          if (["group", "table", "repeatable"].includes(type.value)) {
            if (allowRemoval.checked) next.allowRemoval = true;
            else delete next.allowRemoval;
            next.fields = f.fields || [
              { key: "value", label: "Value", type: "text" },
            ];
            if (type.value !== "group") {
              next.minRows = Number(minRows.value);
              next.maxRows = Number(maxRows.value);
            }
          }
          const v = getCondition(visible),
            r = getCondition(requiredWhen);
          if (v) next.visibleWhen = v;
          else delete next.visibleWhen;
          if (r) next.requiredWhen = r;
          else delete next.requiredWhen;
          const candidate = clone(this.definition);
          const candidateList = builderIndex(candidate).lists.get(list.path).items;
          if (index === null) candidateList.push(next);
          else candidateList[index] = next;
          validateBuilderDefinition(candidate);
          this.checkpoint();
          if (index === null) items.push(next);
          else items[index] = next;
          this.selected = list.scope + next.key;
          this.destination = next.fields ? builderListId(this.selected) : list.path;
          this.changed();
          d.close();
        } catch (error) {
          showError(error);
        }
      },
      { kind: "primary", disabled: this.readonly },
    );
    const d = modal(
      this.readonly
        ? "Field configuration"
        : original
          ? "Edit field"
          : "Add field",
      form,
      [],
      { wide: true },
    );
    this.openDialog = d;
    d.addEventListener("close", () => { if (this.openDialog === d) this.openDialog = null; }, { once: true });
    d.querySelector(".dialog-actions").append(button(this.readonly ? "Done" : "Cancel", () => d.close()));
    if (!this.readonly) d.querySelector(".dialog-actions").append(save);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!this.readonly) save.click();
    });
  }
  preview() {
    try {
      this.validate();
      const renderer = new FormRenderer({
        definition: clone(this.definition),
        data: this.previewData(),
        title: this.definition.title,
        metadata: this.metadata,
      });
      renderer.setReview({});
      const viewport = new DocumentViewport(renderer.root, {
        title: "Form preview",
      });
      const d = modal("Live form preview", viewport.root, [], { wide: true });
      this.modalViewport = viewport;
      this.openDialog = d;
      d.addEventListener("close", () => {
        viewport.destroy();
        if (this.modalViewport === viewport) this.modalViewport = null;
        if (this.openDialog === d) this.openDialog = null;
      }, { once: true });
    } catch (error) {
      showError(error);
    }
  }
}
