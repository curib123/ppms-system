/** Shared display preferences only. No credentials or form data are stored here. */
const preferenceKey = "ppms-ui-theme";
const preferences = new Set(["system", "light", "dark"]);
let preference = "system";
let initialized = false;
let media;

export function getThemePreference() {
  return preference;
}

function applyTheme() {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = getComputedStyle(root).getPropertyValue("--primary").trim();
  document.dispatchEvent(new CustomEvent("ppms:themechange", {
    detail: { preference, dark: preference === "dark" ||
      (preference === "system" && media?.matches) },
  }));
}

export function setThemePreference(value) {
  if (!preferences.has(value)) throw new TypeError("Unknown theme preference");
  preference = value;
  try { localStorage.setItem(preferenceKey, preference); } catch { /* Optional. */ }
  applyTheme();
}

export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  try {
    const saved = localStorage.getItem(preferenceKey);
    if (preferences.has(saved)) preference = saved;
  } catch { /* Browser policies may disable optional display preferences. */ }
  media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", applyTheme);
  window.addEventListener("storage", (event) => {
    if (event.key !== preferenceKey && event.key !== null) return;
    preference = preferences.has(event.newValue) ? event.newValue : "system";
    applyTheme();
  });
  applyTheme();
}

initializeTheme();
