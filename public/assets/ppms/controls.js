import { el, icon } from "./dom.js";

let controlSequence = 0;
let activeDropdown = null;

function controlButton(label, glyph, className, action) {
  return el(
    "button",
    { type: "button", class: `icon-button ${className}`, "aria-label": label,
      title: label, onclick: action },
    icon(glyph),
  );
}

function inputFacade(root, control) {
  root.control = control;
  root.focus = (options) => control.focus(options);
  root.checkValidity = () => control.checkValidity();
  root.reportValidity = () => control.reportValidity();
  root.setCustomValidity = (message) => control.setCustomValidity(message);
  Object.defineProperty(root, "form", { get: () => control.form });
}

/** A labelled native search field with a shared icon, clear action and event API. */
export function searchInput(value = "", attrs = {}) {
  const { class: className = "", clearLabel = "Clear search", ...inputAttrs } = attrs;
  const control = el("input", {
    type: "search", autocomplete: "off", "aria-label": inputAttrs.placeholder || "Search",
    ...inputAttrs, value: value ?? "", class: `search-input-control ${className}`,
  });
  const root = el("div", { class: "search-input" }, icon("search"), control);
  const clear = controlButton(clearLabel, "close", "search-input-clear", () => {
    if (control.disabled || control.readOnly) return;
    control.value = "";
    update();
    control.focus({ preventScroll: true });
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  root.append(clear);
  inputFacade(root, control);
  function update() {
    clear.hidden = !control.value;
    clear.disabled = control.disabled || control.readOnly;
    root.dataset.disabled = String(control.disabled);
  }
  Object.defineProperties(root, {
    value: { get: () => control.value, set: (next) => { control.value = next ?? ""; update(); } },
    disabled: { get: () => control.disabled, set: (next) => { control.disabled = !!next; update(); } },
    required: { get: () => control.required, set: (next) => { control.required = !!next; } },
    readOnly: { get: () => control.readOnly, set: (next) => { control.readOnly = !!next; update(); } },
    name: { get: () => control.name, set: (next) => { control.name = next; } },
  });
  control.addEventListener("input", update);
  control.addEventListener("search", update);
  update();
  return root;
}

function normalizeOptions(options) {
  return options.map((item) => {
    const option = item !== null && typeof item === "object" ? item : { value: item, label: item };
    return { value: String(option.value ?? ""), label: String(option.label ?? option.value ?? ""),
      disabled: !!option.disabled };
  });
}

const searchableText = (text) => String(text).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Editable, finite-choice combobox. Typing only filters choices; a click or Enter
 * commits the actual option value. Escape/blur restore the committed label.
 * Callers use the wrapper's .value, .disabled and input/change events as with a
 * native select. .control is the labelled input; .setOptions() refreshes choices.
 */
export function searchableSelect(options, value, attrs = {}) {
  const id = `choice-${++controlSequence}`;
  const { class: className = "", name, oninput, onchange, ...inputAttrs } = attrs;
  const control = el("input", {
    type: "text", autocomplete: "off", autocorrect: "off", spellcheck: false,
    placeholder: "Select an option", "aria-label": "Choose an option", ...inputAttrs,
    class: `searchable-select-input ${className}`, role: "combobox",
    "aria-autocomplete": "list", "aria-haspopup": "listbox", "aria-expanded": "false",
    "aria-controls": `${id}-list`,
  });
  const hidden = el("input", { type: "hidden", name, hidden: true });
  const list = el("div", { id: `${id}-list`, class: "searchable-select-list", role: "listbox",
    "aria-label": inputAttrs["aria-label"] || "Available options" });
  const empty = el("div", { class: "searchable-select-empty", hidden: true }, "No matching options");
  const menu = el("div", { class: "searchable-select-menu", hidden: true }, list, empty);
  const status = el("span", { class: "searchable-select-status sr-only", role: "status", "aria-live": "polite" });
  const toggle = controlButton("Show options", "chevron", "searchable-select-toggle", () => {
    if (control.disabled || control.readOnly) return;
    control.focus({ preventScroll: true });
    if (opened) close(); else open();
  });
  toggle.tabIndex = -1;
  const root = el("div", { class: "searchable-select", dataset: { open: "false" } },
    el("div", { class: "searchable-select-control" }, control, toggle), hidden, menu, status);
  inputFacade(root, control);
  if (oninput) root.addEventListener("input", oninput);
  if (onchange) root.addEventListener("change", onchange);

  let choices = normalizeOptions(options);
  let selected = "", query = "", visible = [], active = -1, opened = false;
  let listeners = null, observer = null, boundForm = null;
  const initialValue = String(value ?? "");
  const usesPopover = typeof menu.showPopover === "function";
  if (usesPopover) menu.setAttribute("popover", "manual");
  const selectedOption = () => choices.find((option) => option.value === selected);
  const selectedLabel = () => selectedOption()?.label || "";

  function updateValidity() {
    control.setCustomValidity(control.required && !selected ? "Select an option from the list." : "");
    control.setAttribute("aria-required", String(control.required));
  }
  function applyValue(next) {
    const option = choices.find((item) => item.value === String(next ?? ""));
    selected = option?.value ?? "";
    hidden.value = selected;
    control.value = option?.label ?? "";
    query = "";
    updateValidity();
    bindForm();
  }
  function reset() {
    queueMicrotask(() => { close(); applyValue(initialValue); });
  }
  function bindForm() {
    const form = control.form;
    if (form === boundForm) return;
    boundForm?.removeEventListener("reset", reset);
    boundForm = form;
    boundForm?.addEventListener("reset", reset);
  }
  function setActive(index) {
    active = index;
    for (const [i, row] of [...list.children].entries()) row.classList.toggle("is-active", i === active);
    const row = list.children[active];
    if (!row) { control.removeAttribute("aria-activedescendant"); return; }
    control.setAttribute("aria-activedescendant", row.id);
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }
  function render(direction = 1) {
    const needle = searchableText(query.trim());
    visible = choices.filter((option) => !needle || searchableText(option.label).includes(needle));
    list.replaceChildren(...visible.map((option, index) => {
      const row = el("div", { class: "searchable-select-option", id: `${id}-option-${index}`,
        role: "option", "aria-selected": String(option.value === selected),
        "aria-disabled": String(option.disabled), "data-value": option.value },
        el("span", {}, option.label), el("span", { class: "searchable-select-check", hidden: option.value !== selected }, icon("check")));
      row.addEventListener("pointerdown", (event) => event.preventDefault());
      row.addEventListener("click", () => commit(index));
      row.addEventListener("pointermove", () => { if (!option.disabled) setActive(index); });
      return row;
    }));
    empty.hidden = visible.length !== 0;
    empty.textContent = choices.length ? "No matching options" : "No options available";
    status.textContent = visible.length ? `${visible.length} option${visible.length === 1 ? "" : "s"} available` : empty.textContent;
    const current = visible.findIndex((option) => !option.disabled && option.value === selected);
    const enabled = visible.flatMap((option, index) => option.disabled ? [] : [index]);
    setActive(current >= 0 && !needle ? current : (direction < 0 ? enabled.at(-1) : enabled[0]) ?? -1);
    if (opened) position();
  }
  function position() {
    if (!opened || !root.isConnected) { if (opened) close(); return; }
    const rect = root.firstElementChild.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth, height = viewport?.height || window.innerHeight;
    const margin = 8, gap = 6;
    const availableBelow = topEdge + height - rect.bottom - margin - gap;
    const availableAbove = rect.top - topEdge - margin - gap;
    const below = availableBelow >= 160 || availableBelow >= availableAbove;
    const maxHeight = Math.max(44, Math.min(304, below ? availableBelow : availableAbove));
    const menuWidth = Math.min(Math.max(rect.width, 220), width - margin * 2);
    menu.style.width = `${menuWidth}px`;
    menu.style.maxHeight = `${maxHeight}px`;
    list.style.maxHeight = `${Math.max(36, maxHeight - 10)}px`;
    const menuHeight = Math.min(menu.scrollHeight || 304, maxHeight);
    const left = Math.max(leftEdge + margin, Math.min(rect.left, leftEdge + width - menuWidth - margin));
    const top = Math.max(topEdge + margin, Math.min(below ? rect.bottom + gap : rect.top - menuHeight - gap,
      topEdge + height - menuHeight - margin));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }
  function close() {
    if (usesPopover && menu.matches(":popover-open")) menu.hidePopover();
    opened = false;
    menu.hidden = true;
    root.dataset.open = "false";
    control.setAttribute("aria-expanded", "false");
    control.removeAttribute("aria-activedescendant");
    control.value = selectedLabel();
    query = "";
    toggle.setAttribute("aria-label", "Show options");
    toggle.title = "Show options";
    listeners?.abort(); listeners = null;
    observer?.disconnect(); observer = null;
    if (activeDropdown?.root === root) activeDropdown = null;
  }
  function open(direction = 1, keepQuery = false) {
    if (control.disabled || control.readOnly || !root.isConnected) return;
    bindForm();
    if (opened) return;
    activeDropdown?.close();
    activeDropdown = { root, close };
    if (!keepQuery) query = "";
    opened = true;
    root.dataset.open = "true";
    menu.hidden = false;
    control.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Hide options");
    toggle.title = "Hide options";
    render(direction);
    if (usesPopover) menu.showPopover();
    position();
    setActive(active);
    listeners = new AbortController();
    const listenerOptions = { signal: listeners.signal };
    document.addEventListener("pointerdown", (event) => { if (!root.contains(event.target)) close(); },
      { ...listenerOptions, capture: true });
    window.addEventListener("resize", position, listenerOptions);
    window.addEventListener("scroll", position, { ...listenerOptions, capture: true });
    window.visualViewport?.addEventListener("resize", position, listenerOptions);
    window.visualViewport?.addEventListener("scroll", position, listenerOptions);
    observer = new MutationObserver(() => { if (!root.isConnected) close(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function commit(index) {
    const option = visible[index];
    if (!option || option.disabled || control.disabled || control.readOnly) return;
    const changed = selected !== option.value;
    applyValue(option.value);
    close();
    control.focus({ preventScroll: true });
    if (changed) {
      root.dispatchEvent(new Event("input", { bubbles: true }));
      root.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  function move(direction) {
    let next = active;
    do { next += direction; } while (visible[next]?.disabled);
    if (visible[next]) setActive(next);
  }
  toggle.addEventListener("pointerdown", (event) => event.preventDefault());
  control.addEventListener("focus", () => { bindForm(); control.select(); });
  control.addEventListener("click", () => open());
  control.addEventListener("input", (event) => {
    // Query text is never a committed option value or an application mutation.
    event.stopPropagation();
    query = control.value;
    if (opened) render(); else open(1, true);
  });
  control.addEventListener("change", (event) => event.stopPropagation());
  control.addEventListener("keydown", (event) => {
    if (event.isComposing || control.disabled || control.readOnly) return;
    if (event.key === "Escape" && opened) {
      event.preventDefault(); event.stopPropagation(); close(); return;
    }
    if (event.key === "Tab") { close(); return; }
    if (event.altKey && event.key === "ArrowUp" && opened) {
      event.preventDefault(); close(); return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (opened) move(direction); else open(direction);
    } else if (event.key === "Enter" && opened) {
      event.preventDefault(); event.stopPropagation(); commit(active);
    } else if (opened && !event.ctrlKey && !event.metaKey && ["Home", "End"].includes(event.key)) {
      event.preventDefault();
      const enabled = visible.flatMap((option, index) => option.disabled ? [] : [index]);
      setActive((event.key === "Home" ? enabled[0] : enabled.at(-1)) ?? -1);
    }
  });
  root.addEventListener("focusout", () => queueMicrotask(() => {
    if (opened && !root.contains(document.activeElement)) close();
  }));
  root.labelledBy = (labelId) => list.setAttribute("aria-labelledby", labelId);
  root.setOptions = (next) => {
    choices = normalizeOptions(next); applyValue(selected);
    if (opened) render();
  };
  root.close = close;
  Object.defineProperties(root, {
    value: { get: () => selected, set: (next) => { applyValue(next); if (opened) render(); } },
    disabled: { get: () => control.disabled, set: (next) => {
      control.disabled = hidden.disabled = toggle.disabled = !!next;
      root.dataset.disabled = String(!!next); if (next) close();
    } },
    required: { get: () => control.required, set: (next) => { control.required = !!next; updateValidity(); } },
    readOnly: { get: () => control.readOnly, set: (next) => { control.readOnly = !!next; if (next) close(); } },
    name: { get: () => hidden.name, set: (next) => { hidden.name = next; } },
  });
  applyValue(value);
  root.disabled = control.disabled;
  return root;
}
