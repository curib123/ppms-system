/** Mouse/fullscreen acceptance uses the production renderer, not an image preview. */
import assert from "node:assert/strict";

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function scaleOf(page) {
  return page.locator(".form-document").evaluate((node) =>
    node.getBoundingClientRect().width / node.offsetWidth);
}

async function scrollOf(page) {
  return page.locator(".document-viewport").evaluate((node) => ({
    left: node.scrollLeft, top: node.scrollTop,
  }));
}

async function paperPoint(page) {
  return page.locator(".document-viewport").evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    for (const xRatio of [0.3, 0.45, 0.6]) {
      for (const yRatio of [0.18, 0.3, 0.45, 0.6]) {
        const x = bounds.left + bounds.width * xRatio;
        const y = bounds.top + bounds.height * yRatio;
        const target = document.elementFromPoint(x, y);
        if (target?.closest(".form-document") &&
            !target.closest("input,textarea,select,button,a,label,[contenteditable],[role=button],[role=combobox]"))
          return { x, y };
      }
    }
    throw new Error("No visible noninteractive paper area for a real mouse gesture");
  });
}

async function documentPoint(page, point) {
  return page.locator(".form-document").evaluate((node, pointer) => {
    const bounds = node.getBoundingClientRect();
    const scale = bounds.width / node.offsetWidth;
    return { x: (pointer.x - bounds.left) / scale,
      y: (pointer.y - bounds.top) / scale };
  }, point);
}

async function wheel(page, amount, { control = false } = {}) {
  const point = await paperPoint(page);
  await page.mouse.move(point.x, point.y);
  if (control) await page.keyboard.down("Control");
  try { await page.mouse.wheel(0, amount); }
  finally { if (control) await page.keyboard.up("Control"); }
  await settle(page);
  return point;
}

async function drag(page, start, { button = "left", dx = -80, dy = -80 } = {}) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  await page.mouse.up({ button });
  await settle(page);
}

function luminance(rgb) {
  const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

async function assertPaper(page, fullscreen) {
  const colors = await page.locator(".document-viewer").evaluate((viewer) => {
    const paper = viewer.querySelector(".form-document");
    const field = paper.querySelector("input");
    return {
      viewer: getComputedStyle(viewer).backgroundColor,
      toolbar: getComputedStyle(viewer.querySelector(".document-toolbar")).backgroundColor,
      toolbarText: getComputedStyle(viewer.querySelector(".document-toolbar-label")).color,
      viewerScheme: getComputedStyle(viewer).colorScheme,
      paper: getComputedStyle(paper).backgroundColor,
      text: getComputedStyle(paper).color,
      paperScheme: getComputedStyle(paper).colorScheme,
      inputScheme: getComputedStyle(field).colorScheme,
      field: getComputedStyle(field).backgroundColor,
      fieldText: getComputedStyle(field).color,
    };
  });
  assert.equal(colors.paper, "rgb(255, 255, 255)", "Form paper must always stay white");
  assert.equal(colors.paperScheme, "light");
  assert.equal(colors.inputScheme, "light", "Native paper controls must use a light appearance");
  assert.ok((1.05 / (luminance(colors.text) + 0.05)) >= 4.5, "Paper text must remain readable");
  assert.ok((luminance(colors.field) + 0.05) / (luminance(colors.fieldText) + 0.05) >= 4.5,
    "Paper input contrast must not inherit dark-theme foregrounds");
  if (fullscreen) {
    assert.equal(colors.viewerScheme, "dark");
    assert.ok(luminance(colors.viewer) < 0.04, "Fullscreen canvas must remain dark");
    assert.ok(luminance(colors.toolbar) < 0.04, "Fullscreen toolbar must remain dark");
    assert.ok((luminance(colors.toolbarText) + 0.05) / (luminance(colors.toolbar) + 0.05) >= 4.5,
      "Dark fullscreen toolbar text contrast");
  }
  return colors;
}

async function preference(page) {
  return page.evaluate(async () => {
    const theme = await import("/assets/ppms/theme.js");
    return { choice: theme.getThemePreference(),
      scheme: getComputedStyle(document.documentElement).colorScheme };
  });
}

async function setTheme(page, theme) {
  await page.evaluate(async (value) =>
    (await import("/assets/ppms/theme.js")).setThemePreference(value), theme);
  await settle(page);
}

async function mouseEditing(page) {
  const before = await scaleOf(page);
  const point = await paperPoint(page);
  const anchor = await documentPoint(page, point);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, -180);
  await page.waitForFunction((previous) => {
    const paper = document.querySelector(".form-document");
    return paper.getBoundingClientRect().width / paper.offsetWidth > previous + 0.1;
  }, before);
  const enlarged = await scaleOf(page), anchored = await documentPoint(page, point);
  assert.ok(enlarged > before);
  assert.ok(Math.abs(anchored.x - anchor.x) < 2 && Math.abs(anchored.y - anchor.y) < 2,
    "Mouse-wheel zoom must preserve the document point under the cursor");

  const panStart = await paperPoint(page), initialScroll = await scrollOf(page);
  await drag(page, panStart);
  const panned = await scrollOf(page);
  assert.ok(panned.left > initialScroll.left + 40, "Left-drag must pan horizontally");
  assert.ok(panned.top > initialScroll.top + 40, "Left-drag must pan vertically");
  assert.equal(await page.locator(".document-viewport.dragging").count(), 0);
  await page.mouse.move(panStart.x + 50, panStart.y + 50);
  await settle(page);
  assert.deepEqual(await scrollOf(page), panned, "Pointer release must stop panning");

  const operator = page.locator('.form-document [data-path="operator"]');
  await operator.scrollIntoViewIfNeeded();
  await operator.click();
  assert.equal(await operator.evaluate((node) => document.activeElement === node), true);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Mouse entry preserved");
  assert.equal(await operator.inputValue(), "Mouse entry preserved");
  assert.equal(await scaleOf(page), enlarged, "Clicking and typing must preserve the zoom level");
  const inputBox = await operator.boundingBox();
  await page.mouse.move(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2);
  await page.mouse.wheel(0, 80);
  await settle(page);
  assert.equal(await scaleOf(page), enlarged, "Unmodified wheel over an input must stay native");
  await operator.scrollIntoViewIfNeeded();
  const middleBox = await operator.boundingBox(), beforeMiddle = await scrollOf(page);
  await drag(page, { x: middleBox.x + middleBox.width / 2, y: middleBox.y + middleBox.height / 2 },
    { button: "middle", dx: -50, dy: -50 });
  const afterMiddle = await scrollOf(page);
  assert.ok(afterMiddle.top > beforeMiddle.top + 20, "Middle-button drag must pan even over inputs");
  assert.equal(await operator.inputValue(), "Mouse entry preserved", "Middle pan must never edit the field");
  assert.equal(await page.locator(".document-viewport.dragging").count(), 0);

  const shift = page.locator('.form-document [data-path="shift"]');
  await shift.scrollIntoViewIfNeeded();
  await shift.click();
  assert.equal(await shift.evaluate((node) => document.activeElement === node), true);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await shift.inputValue(), "NIGHT");
  assert.equal(await scaleOf(page), enlarged);
  await wheel(page, 70);
  assert.ok(await scaleOf(page) < enlarged, "Mouse wheel must also zoom out");
}

export async function verifyViewport({ newPage, base, artifacts }) {
  const { page } = await newPage();
  // Leave horizontal room to pan after the first zoom without clamping its
  // cursor anchor at the scroll boundary of an otherwise fitted document.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(base + "/admin");
  await page.evaluate(async () => {
    const { FormRenderer } = await import("/assets/ppms/renderer.js");
    const { DocumentViewport } = await import("/assets/ppms/viewport.js");
    const { newDefinition } = await import("/assets/ppms/schema.js");
    const { el } = await import("/assets/ppms/ui.js");
    const definition = newDefinition("Fullscreen production register");
    definition.sections[0].items.push(
      { key: "operator", label: "Operator", type: "text" },
      { key: "shift", label: "Shift", type: "select", options: [
        { value: "DAY", label: "Day shift" }, { value: "NIGHT", label: "Night shift" },
      ] },
    );
    const renderer = new FormRenderer({ definition, data: {
      productionDate: "2026-11-23", operator: "Initial operator", shift: "DAY",
      entries: Array.from({ length: 22 }, (_, i) => ({ description: `Production row ${i + 1}`, quantity: i + 1 })),
    } });
    const viewer = new DocumentViewport(renderer.root, { title: "Mouse navigation acceptance" });
    document.getElementById("app").replaceChildren(
      el("main", { class: "workspace", id: "workspace" }, viewer.root));
  });
  await settle(page);
  const checks = [], colors = [];
  for (const scheme of ["light", "dark"]) {
    await setTheme(page, scheme);
    await assertPaper(page, false);
    const beforeTheme = await preference(page), beforeScale = await scaleOf(page);
    await page.getByRole("button", { name: "Fullscreen form", exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement?.classList.contains("document-viewer"));
    assert.equal(await scaleOf(page), beforeScale, "Entering fullscreen must preserve zoom");
    assert.equal(await page.getByRole("button", { name: "Exit fullscreen", exact: true }).getAttribute("aria-pressed"), "true");
    colors.push({ scheme, mode: "native", ...await assertPaper(page, true) });
    await page.screenshot({ path: `${artifacts}/fullscreen-${scheme}-white-form.png` });
    if (scheme === "light") await mouseEditing(page);
    const exitScale = await scaleOf(page);
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await scaleOf(page), exitScale, "Leaving fullscreen must preserve zoom");
    assert.deepEqual(await preference(page), beforeTheme, "Fullscreen must not rewrite app appearance");
    await assertPaper(page, false);
    await page.getByRole("button", { name: "Fit", exact: true }).click();
  }
  checks.push("white paper and a dark fullscreen workspace remain consistent in both app appearances");
  checks.push("real mouse wheel zoom, cursor anchoring, left/middle panning and native field editing preserve document state");

  const embeddedScale = await scaleOf(page);
  await wheel(page, 100);
  assert.equal(await scaleOf(page), embeddedScale, "Embedded plain-wheel scrolling must not zoom");
  await wheel(page, -80, { control: true });
  assert.ok(await scaleOf(page) > embeddedScale, "Ctrl+wheel must also zoom an embedded document");

  // History and conflict previews share this production modal. Fullscreen owns
  // the first Escape, so returning to the preview must not close its dialog.
  await page.evaluate(async () => {
    const { modal } = await import("/assets/ppms/ui.js");
    modal("History viewport acceptance", document.querySelector(".document-viewer"), [], { wide: true });
  });
  const parentDialog = page.getByRole("dialog", { name: "History viewport acceptance", exact: true });
  // Browser denial is the one injected capability boundary. The actual fallback
  // button, mouse gesture and Escape handling still run through production code.
  await page.locator(".document-viewer").evaluate((node) => {
    node.requestFullscreen = () => Promise.reject(new DOMException("Fullscreen unavailable", "NotAllowedError"));
  });
  for (const scheme of ["light", "dark"]) {
    await setTheme(page, scheme);
    const beforeTheme = await preference(page), beforeScale = await scaleOf(page);
    await page.getByRole("button", { name: "Fullscreen form", exact: true }).click();
    await page.locator(".document-viewer.fallback-fullscreen").waitFor();
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);
    assert.equal(await scaleOf(page), beforeScale);
    colors.push({ scheme, mode: "fallback", ...await assertPaper(page, true) });
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.screenshot({ path: `${artifacts}/fullscreen-fallback-${scheme}.png` });
    const zoomBefore = await scaleOf(page);
    await wheel(page, -50);
    assert.ok(await scaleOf(page) > zoomBefore, "Mouse wheel must work in fallback fullscreen");
    const exitScale = await scaleOf(page);
    await page.keyboard.press("Escape");
    await page.locator(".document-viewer.fallback-fullscreen").waitFor({ state: "detached" });
    assert.equal(await parentDialog.isVisible(), true, "Exiting fullscreen must preserve its parent dialog");
    assert.equal(await scaleOf(page), exitScale);
    assert.deepEqual(await preference(page), beforeTheme);
    assert.equal(await page.getByRole("button", { name: "Fullscreen form", exact: true }).getAttribute("aria-pressed"), "false");
    await assertPaper(page, false);
  }
  checks.push("embedded mouse scrolling and modifier zoom coexist with dark fallback fullscreen and Escape recovery inside a dialog");
  return { checks, colors };
}
