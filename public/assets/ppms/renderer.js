import {
  el,
  button,
  iconButton,
  formatNumber,
  modal,
  textInput,
  showError,
  dateLabel,
} from "./ui.js";
import {
  clone,
  sectionsOf,
  defaultData,
  fieldsOf,
  readPath,
  writePath,
  recompute,
  compileCalculations,
  condition,
  issues,
} from "./schema.js";

export class FormRenderer {
  constructor({
    definition,
    data,
    readonly = false,
    permissions = {},
    traceInputs = {},
    traceSelections = [],
    onChange = () => {},
    title,
    metadata = {},
    isExisting = false,
  }) {
    this.definition = definition;
    this.compiled = compileCalculations(definition);
    this.data = clone(data || defaultData(fieldsOf(definition)));
    this.readonly = readonly;
    this.permissions = permissions;
    this.traceInputs = traceInputs;
    this.selections = new Map(
      traceSelections.map((s) => [
        s.inputPath || s.downstreamInputKey,
        {
          inputPath: s.inputPath || s.downstreamInputKey,
          connectionId: s.connectionId,
          sourceTraceOutputId: s.sourceTraceOutputId,
        },
      ]),
    );
    this.onChange = onChange;
    this.controls = [];
    this.tables = new Map();
    this.originalRows = new WeakSet();
    if (isExisting) {
      const mark = (fields, local) => {
        for (const f of fields) {
          const value = Object.hasOwn(local, f.key) ? local[f.key] : undefined;
          if (f.type === "group" && value) mark(f.fields, value);
          if (["table", "repeatable"].includes(f.type))
            for (const row of value || []) {
              this.originalRows.add(row);
              mark(f.fields, row);
            }
        }
      };
      mark(fieldsOf(definition), this.data);
    }
    this.root = el("article", { class: "form-document" });
    // Give percentage-width tables and fractional grid columns a definite
    // containing width. Intrinsic max-content sizing can otherwise inflate the
    // document as nested controls and columns resolve one another's widths.
    const tableWidth = (fields) => {
      let width = 0;
      for (const field of fields || []) {
        if (["table", "repeatable"].includes(field.type)) {
          const columns = (field.fields || []).reduce(
            (total, column) =>
              total +
              Math.max(
                column.type === "group" ? 480 : 180,
                column.type === "textarea"
                  ? 240
                  : ["trace-code", "datetime"].includes(column.type)
                    ? 220
                    : tableWidth(column.fields),
              ),
            0,
          );
          width = Math.max(width, columns + 170);
        } else if (field.fields)
          width = Math.max(width, tableWidth(field.fields));
      }
      return width;
    };
    this.root.style.setProperty(
      "--document-width",
      `${Math.max(1030, tableWidth(fieldsOf(definition)))}px`,
    );
    const meta = [
      metadata.documentNumber,
      metadata.revisionNumber ? `Rev ${metadata.revisionNumber}` : null,
      metadata.seriesNumber ? `Series ${metadata.seriesNumber}` : null,
      metadata.pageNumber ? `Page ${metadata.pageNumber}` : null,
    ].filter(Boolean);
    this.root.append(
      el(
        "header",
        { class: "form-document-heading" },
        el(
          "div",
          { class: "document-brand" },
          "PPMS",
          el("span", {}, "PRODUCTION RECORD"),
        ),
        el("h2", {}, title || definition.title || "Production form"),
        meta.length
          ? el("p", { class: "document-metadata" }, meta.join(" · "))
          : null,
      ),
    );
    for (const section of sectionsOf(definition)) {
      const node = el(
        "section",
        { class: `form-section form-${section.key}` },
        el(
          "div",
          { class: "form-section-title" },
          el("h3", {}, section.label || section.key),
          el(
            "span",
            {},
            section.key === "main"
              ? "RECORDS"
              : section.key === "summary"
                ? "TOTALS"
                : "DETAILS",
          ),
        ),
      );
      const grid = el("div", { class: "form-fields" });
      for (const f of section.items || [])
        grid.append(
          this.renderField(f, this.data, "", false, fieldsOf(definition)),
        );
      if (!(section.items || []).length)
        grid.append(
          el(
            "p",
            { class: "section-placeholder" },
            section.key === "summary"
              ? "No additional summary fields."
              : section.key === "header"
                ? "Identification is shown in the record header."
                : "No fields configured.",
          ),
        );
      node.append(grid);
      this.root.append(node);
    }
    this.calculationMessage = el("p", {
      class: "notice",
      role: "alert",
      hidden: true,
    });
    this.root.prepend(this.calculationMessage);
    this.reviewHost = el("section", { class: "review-reference" });
    this.root.append(this.reviewHost);
    this.refresh();
  }
  renderField(
    field,
    local,
    prefix,
    inTable,
    scope = fieldsOf(this.definition),
    lockedParent = false,
  ) {
    const path = prefix + field.key;
    const stored = Object.hasOwn(local, field.key)
      ? local[field.key]
      : undefined;
    if (["table", "repeatable"].includes(field.type))
      return this.renderTable(field, local, prefix, scope, lockedParent);
    if (field.type === "group") {
      if (!Object.hasOwn(local, field.key) || !local[field.key])
        local[field.key] = {};
      const group = el(
        "fieldset",
        { class: "form-group" },
        el("legend", {}, field.label),
      );
      const grid = el("div", { class: "form-fields" });
      for (const f of field.fields || [])
        grid.append(
          this.renderField(
            f,
            local[field.key],
            path + ".",
            false,
            field.fields,
            lockedParent || field.readOnly,
          ),
        );
      group.append(grid);
      this.controls.push({ field, local, path, scope, wrapper: group });
      return group;
    }
    const id = `field-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Math.random().toString(16).slice(2, 7)}`;
    const wrapper = el("div", {
      class: `document-field ${inTable ? "cell-field" : ""}`,
      dataset: { fieldPath: path },
    });
    const label = el(
      "label",
      { htmlFor: id, class: inTable ? "sr-only" : "document-field-label" },
      field.label,
      field.required
        ? el("span", { class: "required-marker", "aria-hidden": "true" }, " *")
        : null,
    );
    const locked =
      this.readonly ||
      lockedParent ||
      Boolean(field.calculation) ||
      (field.readOnly && field.type !== "trace-code");
    let control;
    if (field.calculation) {
      control = el("output", {
        id,
        class: "calculated-value",
        "aria-label": field.label,
      });
    } else if (field.type === "boolean") {
      control = el("input", {
        id,
        type: "checkbox",
        checked: stored === true,
        disabled: locked,
      });
    } else if (field.type === "select" || field.type === "multiselect") {
      control = el("select", {
        id,
        multiple: field.type === "multiselect",
        disabled: locked,
      });
      if (field.type === "select")
        control.append(el("option", { value: "" }, "Select…"));
      for (const o of field.options || []) {
        const value = typeof o === "string" ? o : o.value;
        control.append(
          el(
            "option",
            {
              value,
              selected: Array.isArray(stored)
                ? stored.includes(value)
                : stored === value,
            },
            typeof o === "string" ? o : o.label || value,
          ),
        );
      }
    } else if (field.type === "trace-code") {
      control = this.traceControl(field, path, local, id);
      control.disabled = this.readonly || lockedParent;
    } else if (field.type === "textarea") {
      control = el("textarea", {
        id,
        value: stored ?? "",
        rows: inTable ? 2 : 3,
        readOnly: locked,
        placeholder: field.placeholder || "",
      });
    } else {
      const type = ["number", "integer"].includes(field.type)
        ? "number"
        : field.type === "datetime"
          ? "datetime-local"
          : ["date", "time"].includes(field.type)
            ? field.type
            : "text";
      control = el("input", {
        id,
        type,
        value: stored ?? "",
        readOnly: locked,
        placeholder: field.placeholder || "",
        inputMode: ["number", "integer"].includes(field.type)
          ? "decimal"
          : undefined,
      });
      if (type === "number") {
        control.step =
          field.validation?.step ?? (field.type === "integer" ? 1 : "any");
        if (field.validation?.min !== undefined)
          control.min = field.validation.min;
        if (field.validation?.max !== undefined)
          control.max = field.validation.max;
      }
      if (field.type === "datetime" && stored)
        control.value = String(stored).replace(/Z$|[+-]\d\d:\d\d$/, "");
    }
    control.setAttribute(
      "aria-label",
      `${field.label}${inTable ? " · row " + ((Number(prefix.split(".").at(-2)) || 0) + 1) : ""}`,
    );
    control.dataset.path = path;
    if (field.validation?.maxLength)
      control.maxLength = field.validation.maxLength;
    if (!field.calculation && field.type !== "trace-code")
      control.addEventListener(
        field.type === "select" ||
          field.type === "multiselect" ||
          field.type === "boolean"
          ? "change"
          : "input",
        () => {
          let value = control.value;
          if (field.type === "boolean") value = control.checked;
          if (field.type === "multiselect")
            value = [...control.selectedOptions].map((o) => o.value);
          if (["number", "integer"].includes(field.type))
            value = value === "" ? null : Number(value);
          if (field.type === "datetime" && value) {
            const suffix =
              String(
                Object.hasOwn(local, field.key) ? local[field.key] || "" : "",
              ).match(/(?:Z|[+-]\d{2}:\d{2})$/)?.[0] || "";
            value += suffix;
          }
          local[field.key] = value;
          this.changed(path);
        },
      );
    const issue = el("span", { class: "field-error", id: id + "-error" });
    control.setAttribute("aria-describedby", issue.id);
    wrapper.append(
      label,
      control,
      field.unit ? el("span", { class: "field-unit" }, field.unit) : null,
      field.helpText && !inTable
        ? el("span", { class: "field-hint" }, field.helpText)
        : null,
      issue,
    );
    if (
      field.type === "trace-code" &&
      this.traceInputs.search &&
      !this.readonly &&
      !lockedParent
    )
      wrapper.append(
        button(
          "Find source",
          () => this.findTrace(field, path, local, control),
          { small: true, glyph: "search" },
        ),
      );
    this.controls.push({ field, local, path, scope, wrapper, control, issue });
    return wrapper;
  }
  traceControl(field, path, local, id) {
    const pattern = path.replace(/\.\d+(?=\.|$)/g, "[]");
    const connections = (this.traceInputs.connections || []).filter(
      (c) => c.targetInputKey === pattern && c.status === "ACTIVE",
    );
    const options = [];
    for (const c of connections)
      for (const output of this.traceInputs.outputs || []) {
        if (
          output.outputKey === c.sourceOutputKey &&
          (output.sourcePpmFormId || output.ppmFormId) === c.sourcePpmFormId &&
          ["PUBLISHED", "LINKED_DOWNSTREAM"].includes(output.status)
        )
          options.push({ c, output });
      }
    const control = el("select", { id });
    control.append(
      el("option", { value: "" }, field.placeholder || "Select source output…"),
    );
    const current = this.selections.get(path);
    if (
      Object.hasOwn(local, field.key) &&
      local[field.key] &&
      !options.some((o) => o.output.id === current?.sourceTraceOutputId)
    )
      control.append(
        el(
          "option",
          { value: "__existing", selected: true },
          `${local[field.key]} · existing reference`,
        ),
      );
    for (const { c, output } of options)
      control.append(
        el(
          "option",
          {
            value: c.id + "|" + output.id,
            dataset: {
              connectionId: c.id,
              outputId: output.id,
              outputCode: output.outputCode,
            },
            selected:
              current?.sourceTraceOutputId === output.id &&
              current.connectionId === c.id,
          },
          `${output.outputCode} · ${output.recordId.slice(0, 10)}${output.quantity != null ? " · " + output.quantity + " " + (output.unit || "") : ""}`,
        ),
      );
    control.addEventListener("change", () => {
      if (control.value === "__existing") return;
      const choice = control.selectedOptions[0]?.dataset;
      if (choice?.connectionId && choice?.outputId) {
        local[field.key] = choice.outputCode;
        this.selections.set(path, {
          inputPath: path,
          connectionId: choice.connectionId,
          sourceTraceOutputId: choice.outputId,
        });
      } else {
        delete local[field.key];
        this.selections.delete(path);
      }
      this.changed(path);
    });
    return control;
  }
  renderTable(field, local, prefix, scope, lockedParent = false) {
    const path = prefix + field.key;
    if (!Array.isArray(local[field.key])) local[field.key] = [];
    const block = el("div", {
      class: "form-table-block",
      dataset: { tablePath: path },
    });
    const info = el("span", { class: "table-count" });
    const add = button(
      "Add row",
      () => {
        if (local[field.key].length >= (field.maxRows || 100)) return;
        local[field.key].push(defaultData(field.fields || []));
        state.page = Math.floor((local[field.key].length - 1) / state.pageSize);
        draw();
        this.changed(path);
        requestAnimationFrame(() =>
          block
            .querySelector(
              "tbody tr:last-child input,tbody tr:last-child select",
            )
            ?.focus(),
        );
      },
      {
        small: true,
        glyph: "plus",
        disabled: this.readonly || lockedParent || field.readOnly,
      },
    );
    const toolbar = el(
      "div",
      { class: "table-toolbar" },
      el("div", {}, el("h4", {}, field.label), info),
      add,
    );
    const scroll = el("div", {
      class: "table-scroll",
      tabIndex: 0,
      "aria-label": `${field.label} table`,
    });
    const table = el("table", { class: "entry-table" });
    const head = el(
      "tr",
      {},
      el("th", { scope: "col", class: "row-number" }, "#"),
    );
    for (const f of field.fields || [])
      head.append(
        el(
          "th",
          { scope: "col" },
          f.label,
          f.required ? el("span", { class: "required-marker" }, " *") : null,
        ),
      );
    head.append(
      el(
        "th",
        { scope: "col", class: "row-action" },
        el("span", { class: "sr-only" }, "Row actions"),
      ),
    );
    const body = el("tbody");
    table.append(el("thead", {}, head), body);
    scroll.append(table);
    const pager = el("div", { class: "table-pagination" });
    const state = { page: 0, pageSize: 40, draw: null };
    this.tables.set(path, state);
    const draw = () => {
      this.controls = this.controls.filter(
        (c) => !c.path.startsWith(path + "."),
      );
      body.replaceChildren();
      const rows = local[field.key],
        pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
      state.page = Math.min(state.page, pages - 1);
      for (
        let i = state.page * state.pageSize;
        i < Math.min(rows.length, (state.page + 1) * state.pageSize);
        i++
      ) {
        const row = rows[i];
        const tr = el(
          "tr",
          {},
          el("th", { scope: "row", class: "row-number" }, i + 1),
        );
        for (const f of field.fields || [])
          tr.append(
            el(
              "td",
              {},
              this.renderField(
                f,
                row,
                `${path}.${i}.`,
                true,
                field.fields,
                lockedParent || field.readOnly,
              ),
            ),
          );
        const del = iconButton(
          `Remove row ${i + 1}`,
          "trash",
          () => {
            rows.splice(i, 1);
            const next = new Map();
            for (const [key, selection] of this.selections) {
              const match = key.startsWith(path + ".")
                ? key.slice(path.length + 1).match(/^(\d+)(\..*)$/)
                : null;
              if (!match) {
                next.set(key, selection);
                continue;
              }
              const index = Number(match[1]);
              if (index === i) continue;
              const newKey = `${path}.${index > i ? index - 1 : index}${match[2]}`;
              next.set(newKey, { ...selection, inputPath: newKey });
            }
            this.selections = next;
            draw();
            this.changed(path);
          },
          {
            disabled:
              this.readonly ||
              lockedParent ||
              field.readOnly ||
              (this.originalRows.has(row) &&
                !field.allowRemoval &&
                this.protectedFields(field.fields, row)),
          },
        );
        tr.append(el("td", { class: "row-action" }, del));
        body.append(tr);
      }
      if (!rows.length)
        body.append(
          el(
            "tr",
            {},
            el(
              "td",
              {
                colSpan: (field.fields?.length || 0) + 2,
                class: "table-empty",
              },
              "No entries yet. Add a row to begin.",
            ),
          ),
        );
      info.textContent = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;
      add.disabled =
        this.readonly ||
        lockedParent ||
        field.readOnly ||
        rows.length >= (field.maxRows || 100);
      pager.replaceChildren();
      if (pages > 1)
        pager.append(
          button(
            "Previous",
            () => {
              state.page--;
              draw();
            },
            { small: true, disabled: state.page === 0 },
          ),
          el(
            "span",
            {},
            `${state.page + 1} / ${pages} · ${state.pageSize} rows per view`,
          ),
          button(
            "Next",
            () => {
              state.page++;
              draw();
            },
            { small: true, disabled: state.page >= pages - 1 },
          ),
        );
      this.refresh();
    };
    state.draw = draw;
    draw();
    this.controls.push({ field, local, path, scope, wrapper: block });
    block.append(toolbar, scroll, pager);
    return block;
  }
  async findTrace(field, path, local, control) {
    const query = textInput("", {
        type: "search",
        placeholder: "Search exact production code…",
        "aria-label": "Source code search",
      }),
      results = el("div");
    const pattern = path.replace(/\.\d+(?=\.|$)/g, "[]");
    const form = el(
      "form",
      { class: "trace-search" },
      query,
      button("Search", null, { type: "submit", glyph: "search" }),
    );
    const d = modal(
      "Select source · " + field.label,
      el("div", {}, form, results),
      [],
      { wide: true },
    );
    const search = async () => {
      try {
        const response = await this.traceInputs.search(query.value);
        results.replaceChildren();
        const connections = (
          response.connections || this.traceInputs.connections
        ).filter((c) => c.targetInputKey === pattern && c.status === "ACTIVE");
        const seen = new Set();
        for (const output of response.outputs || []) {
          const connection = connections.find(
            (c) =>
              c.id === output.connectionId ||
              (c.sourcePpmFormId ===
                (output.ppmFormId || output.sourcePpmFormId) &&
                c.sourceOutputKey === output.outputKey),
          );
          if (!connection || seen.has(connection.id + "|" + output.id))
            continue;
          seen.add(connection.id + "|" + output.id);
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
                  `${output.ppmCode || output.outputKey} · ${output.recordId}`,
                ),
              ),
              button(
                "Select source",
                () => {
                  const value = connection.id + "|" + output.id;
                  let option = [...control.options].find(
                    (o) => o.value === value,
                  );
                  if (!option) {
                    option = el(
                      "option",
                      {
                        value,
                        dataset: {
                          connectionId: connection.id,
                          outputId: output.id,
                          outputCode: output.outputCode,
                        },
                      },
                      `${output.outputCode} · ${output.recordId.slice(0, 10)}`,
                    );
                    control.append(option);
                  }
                  control.value = value;
                  local[field.key] = output.outputCode;
                  this.selections.set(path, {
                    inputPath: path,
                    connectionId: connection.id,
                    sourceTraceOutputId: output.id,
                  });
                  this.changed(path);
                  d.close();
                  control.focus();
                },
                { small: true, glyph: "check" },
              ),
            ),
          );
        }
        if (!results.childElementCount)
          results.append(
            el(
              "p",
              { class: "muted" },
              "No eligible source outputs match this field.",
            ),
          );
        if (response.total > response.outputs.length)
          results.append(
            el(
              "p",
              { class: "muted" },
              "Refine the code search to find additional sources.",
            ),
          );
      } catch (error) {
        showError(error);
      }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      search();
    });
    query.focus();
  }
  protectedFields(fields, data) {
    return fields.some((field) => {
      const own = data && Object.hasOwn(data, field.key);
      const value = own ? data[field.key] : undefined;
      return (
        (field.readOnly && !field.calculation && own) ||
        (field.type === "group" &&
          this.protectedFields(field.fields, value || {})) ||
        (["table", "repeatable"].includes(field.type) &&
          Array.isArray(value) &&
          value.some((row) => this.protectedFields(field.fields, row)))
      );
    });
  }
  changed(path) {
    this.refresh();
    this.onChange(this.data, this.getSelections(), path);
  }
  refresh() {
    try {
      recompute(this.definition, this.data, this.compiled);
      this.calculationError = null;
    } catch (error) {
      this.calculationError = error;
    }
    if (this.calculationMessage) {
      this.calculationMessage.hidden = !this.calculationError;
      this.calculationMessage.textContent =
        this.calculationError?.message || "";
    }
    for (const c of this.controls) {
      const visible = condition(
        c.field.visibleWhen,
        c.local,
        this.data,
        c.scope,
      );
      c.wrapper.hidden = !visible;
      if (c.control) {
        const required =
          c.field.required ||
          (!!c.field.requiredWhen &&
            condition(c.field.requiredWhen, c.local, this.data, c.scope));
        c.control.setAttribute("aria-required", String(Boolean(required)));
        if (c.field.calculation)
          c.control.value = formatNumber(c.local[c.field.key]);
      }
    }
  }
  validate(complete = false) {
    const errors = issues(this.definition, this.data, complete);
    if (this.calculationError)
      errors.unshift({ path: "", message: this.calculationError.message });
    for (const c of this.controls) {
      const issue = errors.find((e) => e.path === c.path);
      if (c.issue) c.issue.textContent = issue?.message || "";
      c.control?.setAttribute("aria-invalid", String(Boolean(issue)));
    }
    if (errors.length) {
      for (const [path, table] of this.tables) {
        const error = errors.find((e) => e.path.startsWith(path + "."));
        if (error) {
          const row = Number(error.path.slice(path.length + 1).split(".")[0]);
          if (Number.isFinite(row)) {
            table.page = Math.floor(row / table.pageSize);
            table.draw();
          }
        }
      }
      const control = this.controls.find((c) => c.path === errors[0].path);
      control?.control?.focus();
    }
    return errors;
  }
  showServerError(error) {
    const path = error?.details?.field;
    const c = this.controls.find((x) => x.path === path);
    if (c) {
      c.control?.setAttribute("aria-invalid", "true");
      if (c.issue)
        c.issue.textContent = String(error.error || error.message)
          .replaceAll("_", " ")
          .toLowerCase();
      c.control?.focus();
    }
  }
  getData() {
    return clone(this.data);
  }
  getSelections() {
    return [...this.selections.values()].map(clone);
  }
  setReview(reference = {}) {
    this.reviewHost.replaceChildren(
      el(
        "div",
        { class: "review-reference-title" },
        el("h3", {}, "Review reference"),
        el(
          "span",
          { class: "badge" },
          String(reference.status || "PENDING_REVIEW")
            .toLowerCase()
            .replaceAll("_", " "),
        ),
      ),
      el(
        "div",
        { class: "review-reference-details" },
        el(
          "div",
          {},
          el("span", {}, "Reviewer"),
          el("strong", {}, reference.reviewerName || "Not assigned"),
        ),
        el(
          "div",
          {},
          el("span", {}, "Position"),
          el("strong", {}, reference.reviewerPosition || "—"),
        ),
        el(
          "div",
          {},
          el("span", {}, "Reviewed"),
          el(
            "strong",
            {},
            dateLabel(reference.reviewedAt || reference.reviewDate),
          ),
        ),
      ),
      reference.reviewedRevisionNo && reference.isCurrent === false
        ? el(
            "p",
            { class: "review-stale" },
            `Reviewed revision ${reference.reviewedRevisionNo}. Newer edits have not been reviewed.`,
          )
        : null,
      reference.remarks ? el("p", {}, reference.remarks) : null,
    );
  }
}
