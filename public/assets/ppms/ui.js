const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  form: "M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7",
  plus: "M12 5v14 M5 12h14",
  search: "M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  back: "M19 12H5 M11 6l-6 6 6 6",
  check: "M5 12l4 4L19 6",
  close: "M6 6l12 12 M18 6L6 18",
  cloud:
    "M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11 M12 12v9 M8 16l4-4 4 4",
  sync: "M20 7a9 9 0 0 0-15-2L2 8 M2 3v5h5 M4 17a9 9 0 0 0 15 2l3-3 M22 21v-5h-5",
  users:
    "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M18 3a4 4 0 0 1 0 8 M18 14a4 4 0 0 1 4 4v3",
  settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  trace:
    "M9 3h6v6H9z M2 16h6v6H2z M16 16h6v6h-6z M12 9v4 M5 13h14 M5 13v3 M19 13v3",
  logout: "M9 3H3v18h6 M9 12h12 M16 7l5 5-5 5",
  lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
  edit: "M15 4l5 5 M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z",
  copy: "M8 8h13v13H8z M16 8V3H3v13h5",
  trash: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  expand: "M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6",
  minus: "M5 12h14",
  history: "M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2",
  chevron: "M9 5l7 7-7 7",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  warning: "M12 3L2 21h20z M12 9v5 M12 17v1",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  mobile: "M7 2h10v20H7z M10 18h4",
  calendar: "M4 5h16v16H4z M8 2v6 M16 2v6 M4 10h16",
  save: "M4 3h13l4 4v14H3V3z M7 3v6h10V3 M7 21v-8h10v8",
};
export function icon(name, label) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.65",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: "icon",
  }))
    svg.setAttribute(key, value);
  svg.setAttribute(label ? "aria-label" : "aria-hidden", label || "true");
  const p = document.createElementNS(svg.namespaceURI, "path");
  p.setAttribute("d", paths[name] || paths.form);
  svg.append(p);
  return svg;
}
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key in node && !key.startsWith("aria")) node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined && child !== false)
      node.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return node;
}
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
  input.setAttribute("aria-labelledby", labelId);
  if (hint) input.setAttribute("aria-describedby", `${labelId}-hint`);
  return el(
    "label",
    { class: "field" },
    el("span", { class: "field-label", id: labelId }, label),
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
  const dialog = el("dialog", { class: wide ? "dialog wide" : "dialog" });
  dialog.append(
    el(
      "div",
      { class: "dialog-heading" },
      el("h2", {}, title),
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
