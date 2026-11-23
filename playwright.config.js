const { defineConfig } = require('@playwright/test');

const baseURL = process.env.PPMS_TEST_BASE_URL;
const fixtureId = process.env.PPMS_TEST_FIXTURE_ID;
let url;
try { url = new URL(baseURL); } catch { throw new Error('Use python tests/run_admin_browser.py to start a disposable browser fixture.'); }
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:'
    || !/^[a-f0-9]{32}$/.test(fixtureId || '') || process.env.PPMS_TEST_DISPOSABLE !== '1'
    || !process.env.PPMS_TEST_USERNAME || !process.env.PPMS_TEST_PASSWORD) {
  throw new Error('Browser checks require an explicitly marked, loopback-only disposable PPMS fixture.');
}

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'admin_browser.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  globalTimeout: 180000,
  forbidOnly: true,
  reporter: 'list',
  outputDir: '.quality/browser/results',
  preserveOutput: 'never',
  use: { baseURL, browserName: 'chromium', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'landscape', use: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } }
  ]
});
