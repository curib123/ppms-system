/** Shared design-system acceptance in a real browser, using production modules. */
import assert from "node:assert/strict";

export async function chooseOption(scope, label, option, query = option) {
  const control = scope.getByRole("combobox", { name: label, exact: true });
  if (await control.evaluate((node) => node.tagName === "SELECT")) {
    await control.selectOption({ label: option });
    return;
  }
  await control.fill(query);
  await scope.getByRole("option", { name: option, exact: true }).click();
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function luminance(color) {
  const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}

function contrast(a, b) {
  const light = luminance(a), dark = luminance(b);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

export async function assertSharedTheme(page, scheme = "light") {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.mouse.move(0, 0);
  await settle(page);
  const colors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    document.body.append(probe);
    const resolve = (token) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const result = {
      scheme: root.colorScheme,
      primary: resolve("--primary"),
      onPrimary: resolve("--on-primary"),
      canvas: resolve("--canvas"),
      surface: resolve("--surface"),
      ink: resolve("--ink"),
      muted: resolve("--muted"),
      actualCanvas: getComputedStyle(document.body).backgroundColor,
      tokenPresent: root.getPropertyValue("--primary").trim().length > 0,
      primaryButtons: [...document.querySelectorAll(".button.primary")]
        .filter((button) => !button.disabled)
        .map((button) => ({
          background: getComputedStyle(button).backgroundColor,
          text: getComputedStyle(button).color,
        })),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
    probe.remove();
    return result;
  });
  assert.ok(colors.tokenPresent, "Shared theme stylesheet did not load");
  assert.ok(colors.scheme.includes(scheme), `Expected ${scheme} color scheme`);
  assert.equal(colors.actualCanvas, colors.canvas);
  const [red, green, blue] = colors.primary.match(/[\d.]+/g).map(Number);
  assert.ok(red > green * 1.25 && red > blue * 1.15, "Primary theme must be red");
  assert.ok(contrast(colors.ink, colors.canvas) >= 4.5, "Body text contrast");
  assert.ok(contrast(colors.muted, colors.surface) >= 4.5, "Secondary text contrast");
  assert.ok(contrast(colors.onPrimary, colors.primary) >= 4.5, "Primary button contrast");
  for (const button of colors.primaryButtons) {
    assert.equal(button.background, colors.primary, "A page has a divergent primary button");
    assert.equal(button.text, colors.onPrimary, "Primary text must use its semantic token");
  }
  assert.equal(colors.overflow, false, "Page overflow must stay inside its document/table scroller");
  return { scheme, primary: colors.primary, canvas: colors.canvas };
}

async function controlFixture(page, base) {
  await page.goto(base + "/admin");
  await page.evaluate(async () => {
    const { el, field, searchInput, searchableSelect, button, modal } =
      await import("/assets/ppms/ui.js");
    const host = document.getElementById("app");
    const search = searchInput("", { "aria-label": "Find production records" });
    const select = searchableSelect([
      { value: "", label: "All production areas" },
      { value: "mixing", label: "Mixing room" },
      { value: "packing", label: "Packing room" },
      { value: "closed", label: "Closed area", disabled: true },
    ], "mixing", { name: "area", required: true });
    const form = el("form", { id: "control-fixture", class: "workspace" },
      el("h1", {}, "Shared production controls"),
      field("Production area", select), field("Record search", search),
      button("Next action", () => {}),
      button("Open selection dialog", () => modal("Choose an area", field("Dialog area",
        searchableSelect([{ value: "a", label: "Area A" }, { value: "b", label: "Area B" }], "a")))),
    );
    form.addEventListener("submit", (event) => event.preventDefault());
    form.dataset.commits = "0";
    select.addEventListener("change", () => {
      form.dataset.commits = String(Number(form.dataset.commits) + 1);
    });
    host.replaceChildren(form);
  });
}

export async function verifyDesignSystem({
  admin, newPage, base, artifacts, openForm, openListedRecord, recordId, code,
}) {
  const checks = [], themes = [];
  // Real page coverage: all application routes use the same tokens and controls.
  const pages = [
    ["forms", "Form library"], ["records", "Records"],
    ["trace", "Traceability"], ["sync", "Synchronization"],
    ["people", "People & access"], ["settings", "System settings"],
  ];
  for (const scheme of ["light", "dark"]) {
    for (const [route, heading] of pages) {
      await admin.locator(`.main-nav [data-page="${route}"]`).click();
      await admin.getByRole("heading", { name: heading, exact: true }).first().waitFor();
      themes.push({ route, ...await assertSharedTheme(admin, scheme) });
      if (["forms", "records", "settings"].includes(route)) {
        await admin.screenshot({ path: `${artifacts}/${route}-${scheme}.png`, fullPage: true });
      }
    }
  }
  checks.push("all six administration routes share red light/dark tokens and accessible text contrast");

  await admin.locator(".user-button").click();
  const account = admin.getByRole("dialog");
  await account.getByLabel("Theme", { exact: true }).selectOption("light");
  assert.equal(await admin.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "light");
  await account.getByLabel("Theme", { exact: true }).selectOption("system");
  await assertSharedTheme(admin, "dark");
  await account.getByRole("button", { name: "Close", exact: true }).click();

  // Filters are exercised against the live API, not a second client-side data model.
  await admin.locator('.main-nav [data-page="records"]').click();
  await admin.getByRole("heading", { name: "Records", exact: true }).waitFor();
  const formFilter = admin.getByRole("combobox", { name: "Filter by form", exact: true });
  assert.equal(await formFilter.evaluate((node) => node.tagName), "INPUT");
  await formFilter.fill(code);
  const formOption = admin.getByRole("option").filter({ hasText: code });
  await formOption.click();
  await admin.locator(".record-list tbody tr").filter({ hasText: recordId }).waitFor();
  const recordSearch = admin.getByRole("searchbox").first();
  await recordSearch.fill("no-such-ppms-record");
  await admin.getByRole("heading", { name: "No matching records", exact: true }).waitFor();
  await recordSearch.fill("");
  await admin.locator(".record-list tbody tr").filter({ hasText: recordId }).waitFor();
  await openListedRecord(admin, recordId);
  await assertSharedTheme(admin, "dark");
  await admin.screenshot({ path: `${artifacts}/record-dark.png`, fullPage: true });
  await admin.getByRole("button", { name: "Review", exact: true }).click();
  await admin.getByRole("dialog").waitFor();
  await assertSharedTheme(admin, "dark");
  await admin.screenshot({ path: `${artifacts}/review-dialog-dark.png` });
  await admin.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  checks.push("shared searchable form filter and record search return real API results and empty states");

  const { page: controls } = await newPage();
  await controlFixture(controls, base);
  const area = controls.getByRole("combobox", { name: "Production area", exact: true });
  const fixture = controls.locator("#control-fixture");
  const selected = () => controls.locator(".searchable-select").first().evaluate((node) => node.value);
  assert.equal(await selected(), "mixing");
  await area.fill("pack");
  assert.equal(await selected(), "mixing", "Typing a filter must not change the selected ID");
  assert.equal(await fixture.getAttribute("data-commits"), "0");
  assert.equal(await controls.getByRole("option").count(), 1);
  await area.press("Escape");
  assert.equal(await area.inputValue(), "Mixing room");
  assert.equal(await area.getAttribute("aria-expanded"), "false");
  await area.fill("pack");
  await area.press("ArrowDown");
  const activeOption = await area.getAttribute("aria-activedescendant");
  assert.ok(activeOption);
  assert.equal(await controls.locator(`[id="${activeOption}"]`).getAttribute("role"), "option");
  await area.press("Enter");
  assert.equal(await selected(), "packing");
  assert.equal(await fixture.getAttribute("data-commits"), "1");
  assert.equal(await fixture.evaluate((node) => new FormData(node).get("area")), "packing");
  await area.fill("nothing matches");
  await controls.locator(".searchable-select-empty").filter({ hasText: "No matching options" }).waitFor();
  await area.press("Enter");
  assert.equal(await selected(), "packing", "Unmatched text must never become a filter ID");
  await area.press("Tab");
  assert.equal(await area.getAttribute("aria-expanded"), "false");
  assert.equal(await area.inputValue(), "Packing room");
  await area.fill("closed");
  const disabled = controls.getByRole("option", { name: "Closed area", exact: true });
  assert.equal(await disabled.getAttribute("aria-disabled"), "true");
  await area.press("ArrowDown");
  await area.press("Enter");
  assert.equal(await selected(), "packing");
  await area.press("Escape");
  const search = controls.getByRole("searchbox", { name: "Record search", exact: true });
  await search.fill("batch 102");
  await search.locator("..").getByRole("button", { name: /Clear/ }).click();
  assert.equal(await search.inputValue(), "");
  assert.equal(await search.evaluate((node) => node === document.activeElement), true);
  await controls.getByRole("button", { name: "Open selection dialog", exact: true }).click();
  const dialog = controls.getByRole("dialog");
  const dialogArea = dialog.getByRole("combobox", { name: "Dialog area", exact: true });
  await dialogArea.fill("Area B");
  await dialogArea.press("Escape");
  assert.equal(await dialog.isVisible(), true, "Closing dropdown must not close its parent dialog");
  assert.equal(await dialogArea.inputValue(), "Area A");
  await dialogArea.press("Escape");
  await dialog.waitFor({ state: "detached" });
  assert.equal(await dialog.count(), 0);
  checks.push("shared controls preserve committed values, keyboard navigation, labels, form values and dialog focus");

  // Separate mobile context avoids disturbing the offline conflict fixture.
  const { page: touch } = await newPage(true);
  await touch.goto(base + "/mobile");
  for (const scheme of ["light", "dark"]) {
    await assertSharedTheme(touch, scheme);
    await touch.screenshot({ path: `${artifacts}/mobile-login-${scheme}.png`, fullPage: true });
  }
  await controlFixture(touch, base);
  const touchArea = touch.getByRole("combobox", { name: "Production area", exact: true });
  await touchArea.tap();
  await touchArea.fill("pack");
  const packing = touch.getByRole("option", { name: "Packing room", exact: true });
  const optionBox = await packing.boundingBox();
  assert.ok(optionBox.height >= 44, "Mobile option targets must be at least 44px");
  assert.ok(optionBox.x >= 0 && optionBox.x + optionBox.width <= 413, "Mobile dropdown spills outside the screen");
  await packing.tap();
  assert.equal(await touchArea.inputValue(), "Packing room");
  await assertSharedTheme(touch, "dark");
  await touch.screenshot({ path: `${artifacts}/mobile-controls-dark.png`, fullPage: true });
  // Appearance is device-local and survives navigation without becoming account data.
  await touch.evaluate(async () => {
    const theme = await import("/assets/ppms/theme.js");
    theme.setThemePreference("light");
  });
  await touch.reload();
  assert.equal(await touch.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "light");
  await touch.evaluate(async () => (await import("/assets/ppms/theme.js")).setThemePreference("system"));
  await assertSharedTheme(touch, "dark");
  checks.push("mobile login and shared controls support touch targets, dark mode and persistent appearance preference");
  const missing = await touch.goto(base + "/ppms-design-missing-page");
  assert.equal(missing.status(), 404);
  await assertSharedTheme(touch, "light");
  await assertSharedTheme(touch, "dark");
  await touch.screenshot({ path: `${artifacts}/error-mobile-dark.png`, fullPage: true });
  checks.push("HTML error pages load the shared theme with responsive light/dark appearance");
  await assertSharedTheme(admin, "light");
  return { checks, themes };
}
