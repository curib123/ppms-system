/** Real HTTP and real browser acceptance tests. No API responses are mocked.
 * Headless Chromium cannot verify a physical device's on-screen keyboard.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { chooseOption, assertSharedTheme, verifyDesignSystem } from "./design_browser.mjs";
import { verifyViewport } from "./viewport_browser.mjs";
import { verifyBuilder } from "./builder_browser.mjs";

const base = process.env.PPMS_UI_URL;
const password = process.env.PPMS_UI_PASSWORD;
if (!base || !password) throw new Error("Run through tests/ui_integration.py");
const artifacts = process.env.PPMS_UI_ARTIFACTS || "test-results";
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const results = [],
  errors = [];
const contexts = [];
let adminToken;
async function api(path, { method = "GET", body, token = adminToken } = {}) {
  const response = await fetch(base + "/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.ok(
    response.ok,
    `${method} ${path} failed (${response.status}): ${data.error || "API error"}`,
  );
  return data;
}
async function until(check, message, timeout = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
async function newPage(mobile = false) {
  const context = await browser.newContext(
    mobile
      ? {
          viewport: { width: 412, height: 915 },
          deviceScaleFactor: 1,
          isMobile: true,
          hasTouch: true,
        }
      : { viewport: { width: 1440, height: 1050 } },
  );
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (error) => errors.push(error.message));
  return { page, context };
}
async function login(page, username, mobile = false) {
  await page.goto(base + (mobile ? "/mobile" : "/admin"));
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  if (mobile)
    await page
      .getByLabel("Offline unlock passphrase")
      .fill("UI acceptance vault passphrase 2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "Form library", exact: true })
    .waitFor();
}
async function openForm(page, code) {
  await page.locator('.main-nav [data-page="forms"]').click();
  await page
    .locator(".form-card")
    .filter({ hasText: code })
    .getByRole("button", { name: "Open form", exact: true })
    .click();
  await page
    .locator("#workspace > .section-heading")
    .getByRole("button", { name: "New record", exact: true })
    .waitFor();
}
async function openListedRecord(page, id) {
  await page
    .locator(".record-list tbody tr")
    .filter({ hasText: id })
    .getByRole("button", { name: "Open", exact: true })
    .click();
  await page
    .locator('.form-document [data-path="entries.0.description"]')
    .waitFor();
}
async function fillRecord(page, description, quantity) {
  assert.equal(
    await page
      .locator('.form-document [data-path="productionDate"]')
      .inputValue(),
    await page.locator('.record-identification input[type="date"]').inputValue(),
    "A new form must initialize its production date from record identification",
  );
  assert.match(
    await page
      .locator('.form-document [data-path="productionDate"]')
      .inputValue(),
    /^\d{4}-\d{2}-\d{2}$/,
  );
  await page
    .locator('.form-document [data-path="entries.0.description"]')
    .fill(description);
  await page
    .locator('.form-document [data-path="entries.0.quantity"]')
    .fill(String(quantity));
  await page.locator('.form-document [data-path="shift"]').selectOption("DAY");
  assert.equal(
    await page
      .locator('.form-document [data-path="totalQuantity"]')
      .textContent(),
    String(quantity),
  );
}
async function documentGeometry(page, { mobile = false } = {}) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.deepEqual(
    await page.locator("#workspace").evaluate((node) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const placeholders = [];
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent.trim();
        if (/^(?:null|undefined)+$/.test(text)) placeholders.push(text);
      }
      return placeholders;
    }),
    [],
    "Optional fields must not render missing values as literal text",
  );
  const dimensions = await page.locator(".document-viewer").evaluate((node) => {
    const form = node.querySelector(".form-document"),
      viewport = node.querySelector(".document-viewport");
    const input = form.querySelector("input"),
      bounds = form.getBoundingClientRect();
    return {
      width: form.offsetWidth,
      stageWidth: node.querySelector(".document-stage").offsetWidth,
      visibleWidth: bounds.width,
      viewportWidth: viewport.clientWidth,
      scrollWidth: viewport.scrollWidth,
      scale:
        Number(node.querySelector(".zoom-label").value.replace("%", "")) / 100,
      inputFont: Number.parseFloat(getComputedStyle(input).fontSize),
    };
  });
  assert.equal(
    dimensions.width,
    1030,
    "A two-column form must not expand through intrinsic table/grid sizing",
  );
  assert.equal(dimensions.stageWidth, 1030);
  assert.ok(
    Math.abs(dimensions.visibleWidth - dimensions.width * dimensions.scale) < 6,
  );
  assert.ok(
    dimensions.scrollWidth <=
      Math.max(
        dimensions.viewportWidth,
        Math.ceil(dimensions.visibleWidth) + 32,
      ) +
        32,
    "Unscaled content leaked outside the zoom spacer",
  );
  assert.ok(dimensions.scale >= 0.9, "The initial form must remain readable");
  if (mobile) {
    assert.equal(dimensions.scale, 1);
    assert.ok(
      dimensions.inputFont >= 16,
      "Mobile input text must avoid focus auto-zoom",
    );
  }
  return dimensions;
}
async function pinch(page) {
  const viewport = page.locator(".document-viewport");
  await viewport.scrollIntoViewIfNeeded();
  const box = await viewport.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + Math.min(150, box.height / 2);
  const initial = await page.locator(".zoom-label").textContent();
  const cdp = await page.context().newCDPSession(page);
  const touches = (distance) => [
    { id: 1, x: x - distance / 2, y, radiusX: 5, radiusY: 5 },
    { id: 2, x: x + distance / 2, y, radiusX: 5, radiusY: 5 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touches(70),
  });
  for (const distance of [80, 95, 110, 130])
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: touches(distance),
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  await until(
    async () => (await page.locator(".zoom-label").textContent()) !== initial,
    "Two-finger touch gesture did not zoom",
  );
}
async function deviceFor(page, username, formId) {
  const registered = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/devices") &&
      response.request().method() === "POST",
  );
  await login(page, username, true);
  const device = await (await registered).json();
  await api(`/forms/${formId}/lease`, {
    method: "PUT",
    body: { deviceId: device.id, expectedLeaseVersion: 0 },
  });
  await page.getByRole("button", { name: "Device setup", exact: true }).click();
  await page
    .getByRole("button", { name: "Refresh assignments", exact: true })
    .click();
  return device;
}

try {
  adminToken = (
    await api("/auth/login", {
      method: "POST",
      body: { username: "admin", password },
      token: null,
    })
  ).token;
  const { page: admin } = await newPage();
  await login(admin, "admin");
  await admin.screenshot({
    path: `${artifacts}/admin-library.png`,
    fullPage: true,
  });

  // Exercise the visual builder itself, then verify the resulting real API schema.
  const code = "UI-" + Date.now().toString(36).toUpperCase();
  await admin.getByRole("button", { name: "Create form", exact: true }).click();
  const formDialog = admin.getByRole("dialog");
  await formDialog.getByLabel("Form code", { exact: true }).fill(code);
  await formDialog
    .getByLabel("Title", { exact: true })
    .fill("Production acceptance register");
  const createdFormResponse = admin.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/forms") &&
      response.request().method() === "POST",
  );
  await formDialog
    .getByRole("button", { name: "Create form", exact: true })
    .click();
  const form = await (await createdFormResponse).json();
  await admin
    .locator(".builder-section")
    .nth(0)
    .getByRole("button", { name: "Add field", exact: true })
    .click();
  const fieldDialog = admin.getByRole("dialog");
  await fieldDialog.getByLabel("Label", { exact: true }).fill("Shift");
  await fieldDialog
    .getByLabel("Stable field key", { exact: true })
    .fill("shift");
  await chooseOption(fieldDialog, "Input type", "select");
  await fieldDialog
    .getByLabel("Options, one per line", { exact: true })
    .fill("DAY | Day shift\nNIGHT | Night shift");
  await fieldDialog
    .getByRole("button", { name: "Add field", exact: true })
    .click();
  await admin.setViewportSize({ width: 412, height: 915 });
  const sectionInputs = await admin.locator(".builder-section .section-name").evaluateAll((nodes) =>
    nodes.map((node) => ({ font: Number.parseFloat(getComputedStyle(node).fontSize),
      height: node.getBoundingClientRect().height })));
  assert.equal(sectionInputs.length, 3);
  assert.ok(sectionInputs.every((input) => input.font >= 16 && input.height >= 44),
    "Mobile builder section inputs must stay readable and touch-sized");
  await admin.screenshot({ path: `${artifacts}/builder-mobile.png`, fullPage: true });
  await admin.setViewportSize({ width: 1440, height: 1050 });
  const templateResponse = admin.waitForResponse(
    (response) =>
      response.url().endsWith(`/forms/${form.id}/templates`) &&
      response.request().method() === "POST",
  );
  await admin.getByRole("button", { name: "Save draft", exact: true }).click();
  const template = await (await templateResponse).json();
  assert.deepEqual(
    template.definitionJson.sections.map((section) => section.key),
    ["header", "main", "summary"],
  );
  assert.equal(
    template.definitionJson.sections[0].items.find(
      (field) => field.key === "shift",
    ).type,
    "select",
  );
  await admin.getByRole("button", { name: "Publish", exact: true }).click();
  await admin
    .getByRole("button", { name: "Publish version", exact: true })
    .click();
  await admin.getByRole("button", { name: "Duplicate", exact: true }).waitFor();
  await admin.screenshot({
    path: `${artifacts}/form-builder.png`,
    fullPage: true,
  });
  results.push(
    "visual builder creates and publishes a reusable three-section schema",
  );

  await openForm(admin, code);
  await admin
    .locator("#workspace > .section-heading")
    .getByRole("button", { name: "New record", exact: true })
    .click();
  await fillRecord(admin, "Desktop production entry", 7);
  const initialProductionDate = await admin
    .locator('.form-document [data-path="productionDate"]')
    .inputValue();
  await documentGeometry(admin);
  await admin
    .getByLabel("Batch identifier", { exact: true })
    .fill("UI-DESKTOP");
  const savedResponse = admin.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/records") &&
      response.request().method() === "POST",
  );
  await admin.getByRole("button", { name: "Save record", exact: true }).click();
  const saved = await (await savedResponse).json();
  assert.equal(saved.result.status, "APPLIED");
  const recordId = saved.result.recordId;
  await until(
    async () =>
      (await admin.locator(".save-message").textContent()).includes(
        "Saved to the server",
      ),
    "Online save was not confirmed",
  );
  assert.equal(
    (await api(`/records/${recordId}`)).revision.dataJson.totalQuantity,
    7,
  );
  assert.equal(
    (await api(`/records/${recordId}`)).revision.dataJson.productionDate,
    initialProductionDate,
  );
  const submittedResponse = admin.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/records/${recordId}/submit`) &&
      response.request().method() === "POST",
  );
  await admin.getByRole("button", { name: "Submit record", exact: true }).click();
  assert.equal((await (await submittedResponse).json()).result.status, "APPLIED");
  await until(
    async () =>
      (await admin.locator(".save-message").textContent()).includes(
        "Submitted to the server",
      ),
    "The required production date did not allow a complete record to submit",
  );
  await admin
    .locator(".back-row")
    .getByRole("button", { name: "Records", exact: true })
    .click();
  await openListedRecord(admin, recordId);
  await admin.getByRole("button", { name: "Review", exact: true }).click();
  await admin
    .getByRole("dialog")
    .getByLabel("Review status", { exact: true })
    .selectOption("APPROVED");
  await admin
    .getByRole("dialog")
    .getByLabel("Position", { exact: true })
    .fill("Quality supervisor");
  await admin.getByRole("button", { name: "Save review", exact: true }).click();
  await until(
    async () =>
      (await api(`/records/${recordId}`)).reviewReference.status === "APPROVED",
    "Review was not persisted",
  );
  await admin
    .locator('.form-document [data-path="entries.0.quantity"]')
    .fill("8");
  await admin.getByRole("button", { name: "Save record", exact: true }).click();
  await until(
    async () =>
      (await api(`/records/${recordId}`)).revision.dataJson.totalQuantity === 8,
    "Approved record was not editable",
  );
  assert.equal(
    (await api(`/records/${recordId}`)).reviewReference.isCurrent,
    false,
  );
  await until(
    async () =>
      (await admin
        .locator(".record-heading .status-pending-review")
        .count()) === 1,
    "The record header did not refresh its review status after the edit",
  );
  assert.equal(
    await admin
      .locator("#workspace")
      .evaluate((node) =>
        [...node.childNodes].some(
          (child) =>
            child.nodeType === Node.TEXT_NODE &&
            child.textContent.trim() === "null",
        ),
      ),
    false,
  );
  await documentGeometry(admin);
  await admin.screenshot({
    path: `${artifacts}/record-review.png`,
    fullPage: true,
  });
  results.push(
    "server-backed record entry, automatic totals, nonblocking approval and stale-review indication",
  );

  for (const user of ["alice", "bob"])
    await api(`/forms/${form.id}/access/test-${user}`, {
      method: "PUT",
      body: {
        canView: true,
        canCreate: true,
        canEdit: true,
        canPublish: false,
        isActive: true,
      },
    });
  const { page: mobile, context: mobileContext } = await newPage(true);
  const aliceDevice = await deviceFor(mobile, "alice", form.id);
  await openForm(mobile, code);
  await mobile
    .locator("#workspace > .section-heading")
    .getByRole("button", { name: "New record", exact: true })
    .click();
  await fillRecord(mobile, "Offline personnel entry", 4);
  await documentGeometry(mobile, { mobile: true });
  await mobile
    .getByLabel("Batch identifier", { exact: true })
    .fill("UI-OFFLINE");
  await mobile
    .getByRole("button", { name: "Fullscreen form", exact: true })
    .click();
  await until(
    async () =>
      mobile
        .locator(".document-viewer")
        .evaluate(
          (node) =>
            node.matches(":fullscreen") ||
            node.classList.contains("is-fullscreen") ||
            node.classList.contains("fallback-fullscreen"),
        ),
    "Fullscreen did not open",
  );
  await pinch(mobile);
  const pinchedScale = await mobile.locator(".zoom-label").textContent();
  const description = mobile.locator(
    '.form-document [data-path="entries.0.description"]',
  );
  await description.scrollIntoViewIfNeeded();
  await description.tap();
  assert.equal(
    await description.evaluate((node) => document.activeElement === node),
    true,
    "Touch did not focus an editable cell after pinch",
  );
  await mobile.keyboard.press("End");
  await mobile.keyboard.type(" after pinch");
  await mobile
    .locator('.form-document [data-path="shift"]')
    .selectOption("NIGHT");
  assert.equal(
    await mobile.locator('.form-document [data-path="shift"]').inputValue(),
    "NIGHT",
  );
  const zoomAfterTyping = await mobile.locator(".zoom-label").textContent();
  assert.equal(
    zoomAfterTyping,
    pinchedScale,
    "Editing reset the pinch zoom level",
  );
  assert.ok(
    await description.evaluate((node) => {
      const bounds = node.getBoundingClientRect(),
        viewport = node.closest(".document-viewport").getBoundingClientRect();
      return (
        bounds.right > viewport.left &&
        bounds.left < viewport.right &&
        bounds.bottom > viewport.top &&
        bounds.top < viewport.bottom
      );
    }),
    "The active field is outside the fullscreen viewport",
  );
  await mobile.screenshot({ path: `${artifacts}/mobile-fullscreen.png` });
  await mobile
    .getByRole("button", { name: /Fullscreen form|Exit fullscreen/ })
    .click();
  await mobile.evaluate(() => navigator.serviceWorker.ready);
  await until(
    async () => mobile.evaluate(() => !!navigator.serviceWorker.controller),
    "Offline shell did not activate",
  );
  await mobileContext.setOffline(true);
  await mobile
    .getByRole("button", { name: "Save & queue", exact: true })
    .click();
  await until(
    async () =>
      (await mobile.locator(".save-message").textContent()).includes("queued"),
    "Offline draft was not queued",
  );
  const mobileId = (
    await mobile.locator(".record-heading p").textContent()
  ).split(" · ")[0];
  await mobile.reload();
  await mobile.getByLabel("Username", { exact: true }).fill("alice");
  await mobile
    .getByLabel("Offline unlock passphrase")
    .fill("UI acceptance vault passphrase 2026");
  await mobile
    .getByRole("button", { name: "Unlock saved workspace", exact: true })
    .click();
  await mobile.getByRole("heading", { name: "Form library", exact: true }).waitFor();
  await assertSharedTheme(mobile);
  await openForm(mobile, code);
  await openListedRecord(mobile, mobileId);
  assert.equal(
    await mobile
      .locator('.form-document [data-path="entries.0.quantity"]')
      .inputValue(),
    "4",
  );
  assert.ok(
    (
      await mobile
        .locator('.form-document [data-path="entries.0.description"]')
        .inputValue()
    ).includes("after pinch"),
  );
  results.push(
    "fullscreen two-finger pinch, touch focus, dropdowns, typing and encrypted offline reload",
  );

  // Publish a newer schema while the earlier template's local record is offline.
  const nextTemplate = await api(`/templates/${template.id}/duplicate`, {
    method: "POST",
    body: { versionLabel: "Offline compatibility successor" },
  });
  await api(`/templates/${nextTemplate.id}/publish`, {
    method: "POST",
    body: { expectedEditHash: nextTemplate.editHash },
  });
  await mobileContext.setOffline(false);
  await mobile.locator(".connection-indicator").click();
  await mobile
    .getByRole("dialog")
    .getByLabel("Password", { exact: true })
    .fill(password);
  await mobile
    .getByRole("button", { name: "Sign in and synchronize", exact: true })
    .click();
  await until(
    async () =>
      (await mobile.locator(".record-sync-status").textContent())
        .toLowerCase()
        .includes("synced"),
    "Reconnected draft did not receive a durable synchronization confirmation",
    45000,
  );
  const synchronized = await api(`/records/${mobileId}`);
  assert.equal(synchronized.record.templateVersionId, template.id);
  assert.equal(Number(synchronized.record.currentRevisionNo), 1);
  assert.equal(synchronized.revision.dataJson.totalQuantity, 4);
  await mobile.getByRole("button", { name: "Sync now", exact: true }).click();
  await until(
    async () =>
      (await mobile.locator(".record-sync-status").textContent())
        .toLowerCase()
        .includes("synced"),
    "Idempotent refresh did not finish",
  );
  assert.equal(
    Number((await api(`/records/${mobileId}`)).record.currentRevisionNo),
    1,
  );
  results.push(
    "network reconnection, server-confirmed durable receipt, retry without duplicates and pinned old schema",
  );

  // Independent personnel devices share one form, then explicitly reconcile a stale edit.
  const { page: bob, context: bobContext } = await newPage(true);
  const bobDevice = await deviceFor(bob, "bob", form.id);
  assert.notEqual(aliceDevice.id, bobDevice.id);
  const assignment = await api(`/forms/${form.id}/assignments`);
  assert.ok(
    assignment.leases.some((lease) => lease.deviceId === aliceDevice.id),
  );
  assert.ok(assignment.leases.some((lease) => lease.deviceId === bobDevice.id));
  await openForm(bob, code);
  await openListedRecord(bob, mobileId);
  await bobContext.setOffline(true);
  await bob
    .locator('.form-document [data-path="entries.0.quantity"]')
    .fill("12");
  await bob.getByRole("button", { name: "Save & queue", exact: true }).click();
  await until(
    async () =>
      (await bob.locator(".save-message").textContent()).includes("queued"),
    "Second device did not queue its offline update",
  );
  await mobile
    .locator('.form-document [data-path="entries.0.quantity"]')
    .fill("9");
  await mobile
    .getByRole("button", { name: "Save & queue", exact: true })
    .click();
  await until(
    async () =>
      Number((await api(`/records/${mobileId}`)).record.currentRevisionNo) ===
      2,
    "First device update was not committed",
  );
  await bobContext.setOffline(false);
  await bob.getByRole("button", { name: "Sync now", exact: true }).click();
  await bob
    .getByRole("button", { name: "Compare versions", exact: true })
    .waitFor();
  assert.equal(
    (await api(`/records/${mobileId}`)).revision.dataJson.totalQuantity,
    9,
  );
  assert.equal(
    await bob
      .locator('.form-document [data-path="entries.0.quantity"]')
      .inputValue(),
    "12",
  );
  await bob
    .getByRole("button", { name: "Compare versions", exact: true })
    .click();
  await bob
    .getByRole("dialog")
    .getByLabel("Resolution reason", { exact: true })
    .fill(
      "Reviewed both device revisions and retained the current server quantity",
    );
  await bob
    .getByRole("button", { name: "Keep server version", exact: true })
    .click();
  await until(
    async () =>
      (await api(`/records/${mobileId}/conflicts`)).items.length === 0,
    "Conflict resolution was not committed",
  );
  results.push(
    "two authorized personnel devices detect concurrent edits and preserve both versions until explicit resolution",
  );

  // Drive a real server update into an already dirty editor. Its original base
  // must remain pinned, even when the latest server revision is pulled.
  await mobile
    .locator('.form-document [data-path="entries.0.description"]')
    .fill("Unsaved local description");
  await until(
    async () =>
      (await mobile.locator(".save-message").textContent()).includes(
        "Saved locally",
      ),
    "Dirty edit did not persist",
  );
  const beforeRemote = await api(`/records/${mobileId}`);
  const remoteData = structuredClone(beforeRemote.revision.dataJson);
  remoteData.entries[0].quantity = 30;
  await api(`/records/${mobileId}`, {
    method: "PATCH",
    body: {
      clientMutationId: crypto.randomUUID(),
      baseRevisionNo: Number(beforeRemote.record.currentRevisionNo),
      dataJson: remoteData,
    },
  });
  const remotePull = mobile.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/sync/pull") && response.status() === 200,
  );
  await mobile.getByRole("button", { name: "Sync now", exact: true }).click();
  await remotePull;
  assert.equal(
    await mobile
      .locator('.form-document [data-path="entries.0.description"]')
      .inputValue(),
    "Unsaved local description",
  );
  await mobile
    .getByRole("button", { name: "Save & queue", exact: true })
    .click();
  await mobile
    .getByRole("button", { name: "Compare versions", exact: true })
    .waitFor();
  assert.equal(
    (await api(`/records/${mobileId}`)).revision.dataJson.totalQuantity,
    30,
  );
  results.push(
    "background pulls cannot upgrade the edit base of a stale dirty document or silently overwrite server data",
  );

  // Component-level browser checks use the same production modules, without
  // replacing any network business logic or using an alternative renderer.
  const { page: rendering } = await newPage();
  await rendering.goto(base + "/admin");
  const metrics = await rendering.evaluate(async () => {
    const { FormRenderer } = await import("/assets/ppms/renderer.js");
    const { newDefinition } = await import("/assets/ppms/schema.js");
    const definition = newDefinition("Large table acceptance");
    definition.sections[1].items[0].maxRows = 1000;
    const started = performance.now();
    const renderer = new FormRenderer({
      definition,
      data: {
        entries: Array.from({ length: 1000 }, (_, i) => ({
          description: "Record " + i,
          quantity: i,
        })),
      },
    });
    document.getElementById("app").replaceChildren(renderer.root);
    const first = renderer.root.querySelector(
      '[data-path="entries.0.description"]',
    );
    first.focus();
    first.value = "Typed without reconstructing the table";
    first.dispatchEvent(new Event("input", { bubbles: true }));
    return {
      rows: renderer.root.querySelectorAll(".entry-table tbody tr").length,
      total: renderer.getData().totalQuantity,
      sameInput:
        first ===
        renderer.root.querySelector('[data-path="entries.0.description"]'),
      focused: document.activeElement === first,
      milliseconds: performance.now() - started,
    };
  });
  assert.equal(metrics.rows, 40);
  assert.equal(metrics.total, 499500);
  assert.equal(metrics.sameInput, true);
  assert.equal(metrics.focused, true);
  results.push(
    "1,000-row form computes accurate totals while rendering 40 rows and retaining input identity during typing",
  );
  const design = await verifyDesignSystem({
    admin, newPage, base, artifacts, openForm, openListedRecord, recordId, code,
  });
  results.push(...design.checks);
  const viewport = await verifyViewport({ newPage, base, artifacts });
  results.push(...viewport.checks);
  const builder = await verifyBuilder({ newPage, login, api, artifacts });
  results.push(...builder.checks);
  assert.deepEqual(errors, [], "Unexpected uncaught browser errors");
  await writeFile(
    `${artifacts}/ui-results.json`,
    JSON.stringify(
      {
        passed: results.length,
        checks: results,
        largeForm: metrics,
        designThemes: design.themes,
        fullscreenThemes: viewport.colors,
        builderThemes: builder.themes,
        physicalKeyboardVerified: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        passed: results.length,
        checks: results,
        largeForm: metrics,
        designThemes: design.themes,
        fullscreenThemes: viewport.colors,
        builderThemes: builder.themes,
        physicalKeyboardVerified: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  // Screenshots contain synthetic fixture records only. Never export credentials,
  // browser storage, request headers, or a Playwright trace with bearer tokens.
  for (let i = 0; i < contexts.length; i++) {
    const page = contexts[i].pages()[0];
    if (page && (await page.locator("#workspace").count()))
      await page
        .screenshot({ path: `${artifacts}/failure-${i}.png`, fullPage: true })
        .catch(() => {});
  }
  throw error;
} finally {
  await Promise.all(contexts.map((context) => context.close()));
  await browser.close();
}
