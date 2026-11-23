import {
  el,
  button,
  iconButton,
  field,
  textInput,
  searchableSelect,
  modal,
  showError,
  notify,
  confirmAction,
} from "./ui.js";
import {
  clone,
  newDefinition,
  asV2,
  FIELD_TYPES,
  fieldsOf,
  defaultData,
  walkFields,
} from "./schema.js";
import { FormRenderer } from "./renderer.js";
import { DocumentViewport } from "./viewport.js";

const metadataKeys = [
  "documentNumber",
  "revisionNumber",
  "seriesNumber",
  "pageNumber",
  "sourceFileName",
  "sourceFileHash",
];
const labels = {
  documentNumber: "Document number",
  revisionNumber: "Revision number",
  seriesNumber: "Series number",
  pageNumber: "Page number",
  sourceFileName: "Source filename",
  sourceFileHash: "Source SHA-256",
};
export class FormBuilder {
  constructor({
    form,
    template,
    onSave,
    onPublish,
    onDuplicate,
    onRules,
    onConnections,
    onDirty = () => {},
  }) {
    this.onDirty = onDirty;
    this.dirty = false;
    this.form = form;
    this.template = template;
    this.definition = template
      ? asV2(template.definitionJson)
      : newDefinition(form.title);
    this.metadata = {};
    for (const k of metadataKeys) this.metadata[k] = template?.[k] ?? "";
    this.metadata.versionLabel = template?.versionLabel ?? "";
    this.readonly = !!template?.publishedAt;
    this.onSave = onSave;
    this.onPublish = onPublish;
    this.onDuplicate = onDuplicate;
    this.root = el("div", {
      class: "builder",
      "data-screen-label": "Form builder",
    });
    const title = textInput(this.definition.title || form.title, {
      disabled: this.readonly,
    });
    title.addEventListener("input", () => {
      this.definition.title = title.value;
      this.dirty = true;
    });
    const version = textInput(this.metadata.versionLabel, {
      disabled: this.readonly,
      placeholder: "e.g. November production form",
    });
    version.addEventListener("input", () => {
      this.metadata.versionLabel = version.value;
      this.dirty = true;
    });
    const heading = el(
      "div",
      { class: "builder-heading" },
      el(
        "div",
        {},
        el("span", { class: "eyebrow" }, form.ppmCode),
        el(
          "h2",
          {},
          this.readonly
            ? "Published template"
            : template
              ? "Edit draft template"
              : "New template",
        ),
        el(
          "p",
          {},
          this.readonly
            ? "Existing records keep this exact version. Duplicate it to make changes."
            : "Configure the same form used by personnel and reviewers.",
        ),
      ),
      el(
        "div",
        { class: "actions" },
        onConnections
          ? button("Connections", onConnections, { glyph: "trace" })
          : null,
        onRules && template
          ? button("Trace outputs", onRules, { glyph: "settings" })
          : null,
        button("Preview", () => this.preview(), { glyph: "eye" }),
        this.readonly
          ? button("Duplicate", () => onDuplicate(template), {
              kind: "primary",
              glyph: "copy",
            })
          : button(
              "Save draft",
              async (e) => {
                const trigger = e.currentTarget;
                try {
                  trigger.disabled = true;
                  await this.save();
                } catch (error) {
                  showError(error);
                } finally {
                  trigger.disabled = false;
                }
              },
              { kind: "primary", glyph: "save" },
            ),
        !this.readonly && template
          ? button("Publish", () => this.publish(), { glyph: "check" })
          : null,
      ),
    );
    const details = el(
      "details",
      { class: "builder-metadata" },
      el("summary", {}, "Document details"),
    );
    const metaGrid = el("div", { class: "field-grid" });
    for (const key of metadataKeys) {
      const input = textInput(this.metadata[key], { disabled: this.readonly });
      input.addEventListener("input", () => {
        this.metadata[key] = input.value;
        this.dirty = true;
      });
      metaGrid.append(field(labels[key], input));
    }
    details.append(metaGrid);
    this.structure = el("div", { class: "builder-sections" });
    this.root.append(
      heading,
      el(
        "div",
        { class: "builder-title-grid" },
        field("Form title", title),
        field("Version label", version),
      ),
      details,
      this.structure,
    );
    this.renderSections();
  }
  async save() {
    if (!this.definition.title.trim()) throw new Error("Give the form a title");
    let count = 0;
    walkFields(fieldsOf(this.definition), () => count++);
    if (!count) throw new Error("Add at least one field");
    const payload = {
      definitionJson: clone(this.definition),
      ...Object.fromEntries(
        Object.entries(this.metadata).filter(([, v]) => v !== ""),
      ),
    };
    if (this.template)
      payload.expectedDefinitionHash = this.template.definitionHash;
    this.root.inert = true;
    try {
      const saved = await this.onSave(payload, this.template);
      this.template = saved;
      this.dirty = false;
      notify("Draft template saved");
      return saved;
    } finally {
      this.root.inert = false;
    }
  }
  get dirty() {
    return this._dirty || false;
  }
  set dirty(value) {
    this._dirty = value;
    this.onDirty?.(value);
  }
  async publish() {
    if (
      !(await confirmAction(
        "Publish this version?",
        "New records will use this version. Existing records keep their current template. Published versions cannot be edited.",
        "Publish version",
      ))
    )
      return;
    try {
      if (this.dirty) await this.save();
      await this.onPublish(this.template);
      notify("Template published");
    } catch (error) {
      showError(error);
    }
  }
  renderSections() {
    this.structure.replaceChildren();
    for (const section of this.definition.sections) {
      const label = textInput(section.label || section.key, {
        class: "section-name",
        disabled: this.readonly,
        "aria-label": `${section.key} section label`,
      });
      label.addEventListener("input", () => {
        section.label = label.value;
        this.dirty = true;
      });
      const list = el("div", { class: "builder-field-list" });
      this.fieldList(section.items, list);
      const card = el(
        "section",
        { class: "builder-section" },
        el(
          "header",
          {},
          el(
            "span",
            { class: "section-index" },
            section.key === "header"
              ? "01"
              : section.key === "main"
                ? "02"
                : "03",
          ),
          el(
            "div",
            {},
            label,
            el(
              "p",
              {},
              section.key === "header"
                ? "Identification and context"
                : section.key === "main"
                  ? "Tables, rows and production entries"
                  : "Totals, inventory and calculated summaries",
            ),
          ),
          !this.readonly
            ? button("Add field", () => this.editField(section.items), {
                small: true,
                glyph: "plus",
              })
            : null,
        ),
        list,
      );
      this.structure.append(card);
    }
  }
  fieldList(items, container, depth = 0) {
    if (!items.length) {
      container.append(
        el("p", { class: "builder-empty" }, "No fields in this section yet."),
      );
      return;
    }
    items.forEach((f, index) => {
      const item = el("div", { class: "builder-field" });
      const glyph = ["table", "repeatable", "group"].includes(f.type)
        ? "grid"
        : f.calculation
          ? "settings"
          : "form";
      const controls = el(
        "div",
        { class: "actions" },
        iconButton(
          this.readonly ? "View field" : "Edit field",
          this.readonly ? "eye" : "edit",
          () => this.editField(items, index),
        ),
      );
      if (!this.readonly) {
        controls.append(
          iconButton(
            "Move field up",
            "back",
            () => {
              [items[index - 1], items[index]] = [
                items[index],
                items[index - 1],
              ];
              this.changed();
            },
            { disabled: index === 0 },
          ),
          iconButton(
            "Move field down",
            "arrow",
            () => {
              [items[index + 1], items[index]] = [
                items[index],
                items[index + 1],
              ];
              this.changed();
            },
            { disabled: index === items.length - 1 },
          ),
          iconButton("Remove field", "trash", async () => {
            if (
              await confirmAction(
                "Remove field?",
                `${f.label} will be removed from this draft template.`,
                "Remove",
              )
            ) {
              items.splice(index, 1);
              this.changed();
            }
          }),
        );
      }
      item.append(
        el(
          "div",
          { class: "builder-field-line" },
          el(
            "span",
            { class: "field-type-icon" },
            glyph === "grid" ? "▦" : f.calculation ? "Σ" : "Aa",
          ),
          el(
            "div",
            { class: "builder-field-text" },
            el("strong", {}, f.label),
            el(
              "span",
              {},
              `${f.key} · ${f.type}${f.required ? " · required" : ""}${f.calculation ? " · calculated" : ""}`,
            ),
          ),
          controls,
        ),
      );
      if (f.fields) {
        const nested = el("div", { class: "builder-nested" });
        this.fieldList(f.fields, nested, depth + 1);
        if (!this.readonly && depth < 2)
          nested.append(
            button("Add column", () => this.editField(f.fields), {
              small: true,
              glyph: "plus",
            }),
          );
        item.append(nested);
      }
      container.append(item);
    });
  }
  changed() {
    this.dirty = true;
    this.renderSections();
  }
  editField(items, index = null) {
    const original = index === null ? null : items[index];
    const f = clone(original || { key: "", label: "", type: "text" });
    const key = textInput(f.key, {
      required: true,
      pattern: "[A-Za-z][A-Za-z0-9_-]*",
      disabled: this.readonly,
    });
    const label = textInput(f.label, {
      required: true,
      disabled: this.readonly,
    });
    const type = searchableSelect(FIELD_TYPES, f.type, {
      disabled: this.readonly,
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
      calcGroup,
      visible.node,
      requiredWhen.node,
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
          if (index === null) items.push(next);
          else items[index] = next;
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
    d.querySelector(".dialog-actions").append(button("Close", () => d.close()));
    if (!this.readonly) d.querySelector(".dialog-actions").append(save);
  }
  preview() {
    try {
      const renderer = new FormRenderer({
        definition: this.definition,
        data: defaultData(fieldsOf(this.definition)),
        title: this.definition.title,
        metadata: this.metadata,
      });
      renderer.setReview({});
      const viewport = new DocumentViewport(renderer.root, {
        title: "Form preview",
      });
      const d = modal("Live form preview", viewport.root, [], { wide: true });
      d.addEventListener("close", () => viewport.destroy(), { once: true });
    } catch (error) {
      showError(error);
    }
  }
}
