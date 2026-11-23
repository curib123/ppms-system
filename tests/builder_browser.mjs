/** Visual builder acceptance uses real mouse/keyboard input and the live API. */
import assert from "node:assert/strict";
import { assertSharedTheme } from "./design_browser.mjs";

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const list = (page, path) => page.locator(`.builder-drop-list[data-list-path="${path}"]`);
const card = (page, path) => page.locator(`.builder-field[data-field-path="${path}"]`);
const slot = (page, path, index) =>
  page.locator(`.builder-drop-slot[data-list-path="${path}"][data-drop-index="${index}"]`);

async function keys(page, path) {
  return list(page, path).locator(":scope > .builder-field")
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.fieldKey));
}

async function drag(page, source, destination) {
  await source.scrollIntoViewIfNeeded();
  await destination.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  assert.ok(from, "The visible builder must expose a drag source");
  const x = from.x + from.width / 2, y = from.y + from.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y + 8, { steps: 4 });
  // Drag styling can expand insertion targets; measure after the gesture begins.
  const to = await destination.boundingBox();
  assert.ok(to, "The visible builder must expose a drop target");
  const targetX = to.x + to.width / 2, targetY = to.y + to.height / 2;
  await page.mouse.move(targetX, targetY, { steps: 16 });
  // A second move over the destination lets native HTML dragover resolve before drop.
  await page.mouse.move(targetX + 1, targetY, { steps: 2 });
  await page.mouse.up();
  await settle(page);
}

async function configure(page, path) {
  await card(page, path).getByRole("button", { name: /^Configure / }).first().click();
  return page.locator('.builder-inspector[aria-label="Field settings"]');
}

function section(definition, key) {
  return definition.sections.find((item) => item.key === key);
}

function rootField(definition, key) {
  return definition.sections.flatMap((item) => item.items).find((item) => item.key === key);
}

async function responseJson(response) {
  assert.ok(response.ok(), `Builder request failed (${response.status()})`);
  return response.json();
}

async function save(page, endpoint, method) {
  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/v1" + endpoint &&
    candidate.request().method() === method);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saved = await responseJson(await response);
  await page.getByRole("button", { name: "Publish", exact: true }).waitFor();
  await settle(page);
  return saved;
}

async function reopen(page, code, label) {
  await page.getByRole("heading", { name: "Form library", exact: true }).waitFor();
  await page.locator(".form-card").filter({ hasText: code })
    .getByRole("button", { name: "Configure form", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `${code} · Templates`, exact: true });
  await dialog.locator(".template-row").filter({ hasText: label })
    .getByRole("button", { name: "Edit", exact: true }).click();
  await page.locator(".builder").waitFor();
}

export async function verifyBuilder({ newPage, login, api, artifacts }) {
  const { page } = await newPage();
  await page.setViewportSize({ width: 1440, height: 1200 });
  await login(page, "admin");
  const checks = [], themes = [];
  const code = "VIS-" + Date.now().toString(36).toUpperCase();
  const title = "Visual builder acceptance register";
  await page.getByRole("button", { name: "Create form", exact: true }).click();
  const create = page.getByRole("dialog");
  await create.getByLabel("Form code", { exact: true }).fill(code);
  await create.getByLabel("Title", { exact: true }).fill(title);
  const created = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/v1/forms" &&
    response.request().method() === "POST");
  await create.getByRole("button", { name: "Create form", exact: true }).click();
  const form = await responseJson(await created);
  await page.locator(".builder-palette").waitFor();
  await page.getByLabel("Version label", { exact: true }).fill("Visual builder v1");

  const headerBefore = await keys(page, "header");
  await drag(page, page.locator('.builder-palette [data-palette-type="text"]'),
    slot(page, "header", headerBefore.length));
  const headerAfter = await keys(page, "header");
  assert.equal(headerAfter.length, headerBefore.length + 1, "Palette drag must add a real field");
  const textKey = headerAfter.find((key) => !headerBefore.includes(key));
  assert.ok(textKey);
  let inspector = await configure(page, textKey);
  const label = inspector.getByLabel("Field label", { exact: true });
  const labelNode = await label.elementHandle();
  await label.fill("");
  await label.pressSequentially("Batch notes", { delay: 5 });
  assert.equal(await label.inputValue(), "Batch notes");
  assert.ok(await labelNode.evaluate((node) => node.isConnected && node === document.activeElement),
    "Inspector typing must retain its original focused input");
  await labelNode.dispose();
  await inspector.getByLabel("Required field", { exact: true }).check();
  await inspector.getByLabel("Help text", { exact: true }).fill("Notes entered by personnel");
  assert.equal(await card(page, textKey).getAttribute("data-field-key"), textKey,
    "Changing a label must not rename a stored field key");

  const columnsBefore = await keys(page, "entries");
  await drag(page, page.locator('.builder-palette [data-palette-type="number"]'),
    slot(page, "entries", columnsBefore.length));
  const columnsAfter = await keys(page, "entries");
  assert.equal(columnsAfter.length, columnsBefore.length + 1);
  const numberKey = columnsAfter.find((key) => !columnsBefore.includes(key));
  assert.ok(numberKey);
  inspector = await configure(page, `entries[].${numberKey}`);
  await inspector.getByLabel("Field label", { exact: true }).fill("Net weight");
  await inspector.getByLabel("Help text", { exact: true }).fill("Measured weight");
  await drag(page, card(page, `entries[].${numberKey}`).getByRole("button", { name: "Drag Net weight", exact: true }),
    slot(page, "entries", 0));
  assert.deepEqual(await keys(page, "entries"), [numberKey, ...columnsBefore],
    "Dragging a column must change its order without changing the existing columns");
  const handle = card(page, `entries[].${numberKey}`).getByRole("button", { name: "Drag Net weight", exact: true });
  await handle.focus();
  await handle.press("Alt+ArrowDown");
  await settle(page);
  assert.deepEqual(await keys(page, "entries"), [columnsBefore[0], numberKey, columnsBefore[1]]);
  assert.equal(await handle.evaluate((node) => node === document.activeElement), true,
    "Keyboard reordering must keep its handle focused for the next move");
  await card(page, `entries[].${numberKey}`).getByRole("button", { name: "Move field down", exact: true }).click();
  assert.deepEqual(await keys(page, "entries"), [...columnsBefore, numberKey]);

  const summaryBefore = await keys(page, "summary");
  await drag(page, card(page, textKey).getByRole("button", { name: "Drag Batch notes", exact: true }),
    slot(page, "summary", summaryBefore.length));
  assert.deepEqual(await keys(page, "header"), headerBefore);
  assert.deepEqual(await keys(page, "summary"), [...summaryBefore, textKey],
    "Moving a root field between sections must retain its stable key");
  await drag(page, card(page, "entries[].quantity").getByRole("button", { name: "Drag Quantity", exact: true }),
    slot(page, "header", headerBefore.length));
  assert.deepEqual(await keys(page, "entries"), [...columnsBefore, numberKey],
    "A column cannot silently become a root field and break its data path");
  assert.deepEqual(await keys(page, "header"), headerBefore);
  checks.push("real palette and field drags add and reorder visual fields while keyboard controls preserve stable data paths");

  await card(page, "entries[].quantity").getByRole("button", { name: "Remove field", exact: true }).click();
  await settle(page);
  assert.equal(await card(page, "entries[].quantity").count(), 1,
    "A field used by the summary cannot be removed accidentally");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await card(page, textKey).getByRole("button", { name: "Edit field", exact: true }).click();
  const advanced = page.getByRole("dialog");
  assert.equal(await advanced.getByLabel("Stable field key", { exact: true }).isDisabled(), true);
  await advanced.getByRole("button", { name: "Close", exact: true }).click();
  await card(page, textKey).getByRole("button", { name: "Remove field", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await card(page, textKey).count(), 1);
  await card(page, textKey).getByRole("button", { name: "Remove field", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove", exact: true }).click();
  await card(page, textKey).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await card(page, textKey).waitFor();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await card(page, textKey).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await card(page, textKey).waitFor();

  await page.getByRole("button", { name: "Try form", exact: true }).click();
  const preview = page.locator(".form-document");
  await preview.locator(`[data-path="${textKey}"]`).waitFor();
  assert.equal(await preview.locator(`[data-path="${textKey}"]`).getAttribute("aria-required"), "true");
  await preview.locator(`[data-path="${textKey}"]`).fill("Preview values must not become defaults");
  await preview.locator('[data-path="entries.0.quantity"]').fill("7");
  assert.equal(await preview.locator('[data-path="totalQuantity"]').textContent(), "7",
    "The preview must use the same calculation renderer as live records");
  await page.getByRole("button", { name: "Design form", exact: true }).click();
  await card(page, textKey).waitFor();
  checks.push("field settings retain focus, referenced fields are protected, removal supports undo, and live preview computes real totals");

  for (const scheme of ["light", "dark"]) {
    themes.push({ screen: "visual-builder", ...await assertSharedTheme(page, scheme) });
    await page.screenshot({ path: `${artifacts}/visual-builder-${scheme}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 412, height: 915 });
  await assertSharedTheme(page, "dark");
  const sectionInputs = await page.locator(".builder-section .section-name").evaluateAll((nodes) =>
    nodes.map((node) => ({ font: Number.parseFloat(getComputedStyle(node).fontSize),
      height: node.getBoundingClientRect().height })));
  assert.equal(sectionInputs.length, 3);
  assert.ok(sectionInputs.every((input) => input.font >= 16 && input.height >= 44));
  const fieldsBeforeClick = await page.locator(".builder-field").count();
  const addText = page.locator('.builder-palette [data-palette-type="text"]');
  await addText.click();
  await settle(page);
  assert.equal(await page.locator(".builder-field").count(), fieldsBeforeClick + 1,
    "The palette must support click-based creation without dragging");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.locator(".builder-field").count(), fieldsBeforeClick);
  await page.screenshot({ path: `${artifacts}/visual-builder-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await assertSharedTheme(page, "light");

  let createRequests = 0;
  const countCreates = (request) => {
    if (new URL(request.url()).pathname === `/api/v1/forms/${form.id}/templates` && request.method() === "POST")
      createRequests++;
  };
  page.on("request", countCreates);
  await page.getByLabel("Form title", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await settle(page);
  assert.equal(createRequests, 0, "An invalid draft must not be submitted to the server");
  await page.getByLabel("Form title", { exact: true }).fill(title);
  page.off("request", countCreates);
  const saved = await save(page, `/forms/${form.id}/templates`, "POST");
  assert.equal(typeof saved.editHash, "string");
  assert.deepEqual(saved.definitionJson.sections.map((item) => item.key), ["header", "main", "summary"]);
  assert.equal(rootField(saved.definitionJson, textKey).label, "Batch notes");
  assert.equal(rootField(saved.definitionJson, textKey).required, true);
  assert.equal(rootField(saved.definitionJson, textKey).defaultValue, undefined);
  assert.deepEqual(rootField(saved.definitionJson, "entries").fields.map((item) => item.key), [...columnsBefore, numberKey]);
  assert.equal(rootField(saved.definitionJson, "entries").fields.find((item) => item.key === numberKey).type, "number");
  assert.equal(rootField(saved.definitionJson, "totalQuantity").calculation.path, "entries[].quantity");
  assert.deepEqual(section(saved.definitionJson, "summary").items.map((item) => item.key), [...summaryBefore, textKey]);
  await page.locator(".back-row").getByRole("button", { name: "Forms", exact: true }).click();
  await reopen(page, code, "Visual builder v1");
  assert.deepEqual(await keys(page, "entries"), [...columnsBefore, numberKey]);
  inspector = await configure(page, textKey);
  assert.equal(await inspector.getByLabel("Field label", { exact: true }).inputValue(), "Batch notes");
  assert.equal(await inspector.getByLabel("Required field", { exact: true }).isChecked(), true);
  checks.push("the responsive visual builder uses shared themes and saves an exact reusable schema that reloads from the central API");

  const current = await api(`/templates/${saved.id}`);
  await inspector.getByLabel("Field label", { exact: true }).fill("Local unsaved label");
  const remote = await api(`/templates/${saved.id}`, {
    method: "PATCH", body: { versionLabel: "Remote revision", expectedEditHash: current.editHash },
  });
  assert.notEqual(remote.editHash, current.editHash);
  const conflict = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/v1/templates/${saved.id}` && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  assert.equal((await conflict).status(), 409);
  await settle(page);
  assert.equal(await inspector.getByLabel("Field label", { exact: true }).inputValue(), "Local unsaved label",
    "A stale save must leave the administrator's unsaved work available");
  assert.equal(await page.locator(".builder").evaluate((node) => node.inert), false);
  const afterConflict = await api(`/templates/${saved.id}`);
  assert.equal(afterConflict.versionLabel, "Remote revision");
  assert.equal(rootField(afterConflict.definitionJson, textKey).label, "Batch notes");
  await page.locator(".back-row").getByRole("button", { name: "Forms", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await inspector.getByLabel("Field label", { exact: true }).inputValue(), "Local unsaved label");
  await page.locator(".back-row").getByRole("button", { name: "Forms", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leave form", exact: true }).click();
  await reopen(page, code, "Remote revision");
  inspector = await configure(page, textKey);
  assert.equal(await inspector.getByLabel("Field label", { exact: true }).inputValue(), "Batch notes");
  checks.push("concurrent template edits return a conflict without overwriting the server or discarding local work, and navigation requires a deliberate choice");

  const publishedResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/v1/templates/${saved.id}/publish` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish version", exact: true }).click();
  const published = await responseJson(await publishedResponse);
  await page.getByRole("button", { name: "Duplicate", exact: true }).waitFor();
  assert.ok(published.publishedAt);
  assert.equal(await page.getByLabel("Form title", { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Save draft", exact: true }).count(), 0);
  assert.equal(await page.locator('.builder [draggable="true"]:visible').count(), 0,
    "Published templates must not expose draggable mutation controls");
  const duplicateResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/v1/templates/${saved.id}/duplicate` && response.request().method() === "POST");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  const duplicate = await responseJson(await duplicateResponse);
  assert.notEqual(duplicate.id, published.id);
  assert.equal(duplicate.publishedAt, null);
  assert.deepEqual(duplicate.definitionJson, published.definitionJson);
  await page.getByRole("button", { name: "Save draft", exact: true }).waitFor();
  inspector = await configure(page, textKey);
  await inspector.getByLabel("Field label", { exact: true }).fill("Copy notes");
  const copied = await save(page, `/templates/${duplicate.id}`, "PATCH");
  assert.equal(rootField(copied.definitionJson, textKey).label, "Copy notes");
  assert.deepEqual((await api(`/templates/${published.id}`)).definitionJson, published.definitionJson,
    "Editing a copied version must leave the published schema used by existing records unchanged");
  checks.push("published templates stay immutable while duplication creates an independently editable version with the same stable field identifiers");
  return { checks, themes };
}
