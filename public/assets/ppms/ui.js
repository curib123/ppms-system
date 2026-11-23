import { el, icon } from "./dom.js";
export { el, icon } from "./dom.js";
export { searchInput, searchableSelect } from "./controls.js";

export function button(
  label,
  action,
  {
    kind = "",
    glyph = null,
    small = false,
    type = "button",
    disabled = false,
    title,
  } = {},
) {
  return el(
    "button",
    {
      type,
      class: `button ${kind} ${small ? "small" : ""}`,
      disabled,
      title: title || label,
      onclick: action,
    },
    glyph ? icon(glyph) : null,
    el("span", {}, label),
  );
}
export function iconButton(label, glyph, action, attrs = {}) {
  return el(
    "button",
    {
      type: "button",
      class: "icon-button",
      "aria-label": label,
      title: label,
      onclick: action,
      ...attrs,
    },
    icon(glyph),
  );
}
let fieldSequence = 0;
export function field(label, input, hint = null) {
  const labelId = `control-label-${++fieldSequence}`;
  const control = input.control || input;
  if (!control.id) control.id = `${labelId}-input`;
  control.setAttribute("aria-labelledby", labelId);
  if (hint) control.setAttribute("aria-describedby", `${labelId}-hint`);
  input.labelledBy?.(labelId);
  return el(
    input.control ? "div" : "label",
    { class: "field" },
    el(
      input.control ? "label" : "span",
      { class: "field-label", id: labelId, ...(input.control ? { htmlFor: control.id } : {}) },
      label,
    ),
    input,
    hint
      ? el("span", { class: "field-hint", id: `${labelId}-hint` }, hint)
      : null,
  );
}
export function textInput(value = "", attrs = {}) {
  return el("input", { type: "text", value: value ?? "", ...attrs });
}
export function select(options, value, attrs = {}) {
  const s = el("select", attrs);
  for (const item of options) {
    const v = typeof item === "object" ? item.value : item;
    const t = typeof item === "object" ? item.label : item;
    s.append(el("option", { value: v }, t));
  }
  s.value = value ?? "";
  return s;
}
export function badge(status) {
  const t = String(status || "PENDING_REVIEW");
  return el(
    "span",
    { class: `badge status-${t.toLowerCase().replaceAll("_", "-")}` },
    t.toLowerCase().replaceAll("_", " "),
  );
}
export function notify(message, kind = "success") {
  const host = document.getElementById("notifications");
  const notice = el(
    "div",
    { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" },
    icon(kind === "error" ? "warning" : "check"),
    el("span", {}, message),
  );
  host?.append(notice);
  setTimeout(() => notice.remove(), kind === "error" ? 12000 : 6000);
}
export function errorMessage(error) {
  return String(
    error?.details?.field
      ? `${error.error || error.message}: ${error.details.field}`
      : error?.error || error?.message || "Unable to complete the operation",
  )
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (x) => x.toUpperCase());
}
export function showError(error) {
  notify(errorMessage(error), "error");
}
export function empty(title, detail = "", action = null) {
  return el(
    "div",
    { class: "empty-state" },
    icon("form"),
    el("h3", {}, title),
    detail ? el("p", {}, detail) : null,
    action,
  );
}
export function sectionTitle(title, description = "", actions = []) {
  return el(
    "div",
    { class: "section-heading" },
    el(
      "div",
      {},
      el("h1", {}, title),
      description ? el("p", {}, description) : null,
    ),
    el("div", { class: "actions" }, actions),
  );
}
export function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(
    String(value).includes("T") ? value : String(value).replace(" ", "T") + "Z",
  );
  return Number.isNaN(date.getTime())
    ? String(value)
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
export function modal(title, content, actions = [], { wide = false } = {}) {
  const titleId = `dialog-title-${++fieldSequence}`;
  const dialog = el("dialog", {
    class: wide ? "dialog wide" : "dialog",
    "aria-labelledby": titleId,
    "data-screen-label": title,
  });
  dialog.append(
    el(
      "div",
      { class: "dialog-heading" },
      el("h2", { id: titleId }, title),
      iconButton("Close", "close", () => dialog.close()),
    ),
    el("div", { class: "dialog-body" }, content),
    el("div", { class: "dialog-actions" }, actions),
  );
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
export async function confirmAction(title, message, label = "Continue") {
  return new Promise((resolve) => {
    const d = modal(title, el("p", {}, message));
    d.querySelector(".dialog-actions").append(
      button("Cancel", () => d.close()),
      button(
        label,
        () => {
          resolve(true);
          d.close();
        },
        { kind: "primary" },
      ),
    );
    d.addEventListener("close", () => resolve(false), { once: true });
  });
}
export async function busy(node, fn) {
  if (node) node.disabled = true;
  try {
    return await fn();
  } finally {
    if (node?.isConnected) node.disabled = false;
  }
}
export function readJSON(text, label = "JSON") {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}
export function debounce(fn, delay = 250) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}
export function formatNumber(value) {
  return typeof value === "number"
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(
        value,
      )
    : String(value ?? "—");
}
