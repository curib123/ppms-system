const { test, expect } = require('@playwright/test');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');

const username = process.env.PPMS_TEST_USERNAME;
const password = process.env.PPMS_TEST_PASSWORD;

async function signIn(page) {
  await page.goto('/admin/login');
  await page.getByLabel('Username', { exact: true }).fill(username);
  const input = page.getByLabel('Password', { exact: true });
  await expect(input).toBeVisible();
  // No saved authentication state or trace contains this ephemeral credential.
  await input.evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
}

async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.beforeAll(async ({ request }) => {
  const response = await request.get('/__ppms_browser_fixture');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ fixtureId: process.env.PPMS_TEST_FIXTURE_ID });
});

test('login, responsive navigation, account and CSRF logout', async ({ page, context }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByRole('heading', { name: 'Sign in to PPMS' })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByLabel('Username', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  const showPassword = page.getByRole('button', { name: 'Show password', exact: true });
  await showPassword.click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  mkdirSync('.quality/browser', { recursive: true });
  await page.screenshot({ path: join('.quality/browser', `task3-login-${testInfo.project.name}.png`), fullPage: true });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) {
    await menu.click();
    await expect(page.getByRole('button', { name: 'Close navigation', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveAttribute('aria-expanded', 'false');
  }
  const cookie = (await context.cookies()).find(item => item.name === 'ppms_admin_session');
  expect(cookie).toBeTruthy();
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe('Lax');
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  expect(storage).toEqual({ local: 0, session: 0 });
  expect(await page.content()).not.toMatch(/Bearer [a-f0-9]{64}|X-PPMS-Device-Token/);
  await page.screenshot({ path: join('.quality/browser', `task3-home-${testInfo.project.name}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
  expect(errors).toEqual([]);
});

test('invalid credentials show an error and stale AJAX sessions return to login', async ({ page, context }) => {
  await page.goto('/admin/login');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill('incorrect-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await signIn(page);
  const other = await context.newPage();
  await other.goto('/admin');
  await other.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(other).toHaveURL(/\/admin\/login/);
  await other.close();
  const status = await page.evaluate(async () => {
    const response = await fetch('/admin', { headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' } });
    return response.status;
  });
  expect(status).toBe(401);
  await page.evaluate(() => {
    window.jQuery.get('/admin').fail(() => {});
  });
  await expect(page).toHaveURL(/\/admin\/login/);
});
