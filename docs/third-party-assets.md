# Admin assets and development tools

The PHP application serves compiled CSS and a local jQuery file. It makes no
CDN requests and needs no Node process in production.

| Package | Pinned version | Use | License |
| --- | --- | --- | --- |
| Tailwind CSS / CLI | 4.3.3 | Development CSS compilation | MIT |
| jQuery | 3.7.1 | Locally served admin interaction helpers | MIT |
| Playwright Test | 1.64.1 | Development browser verification | Apache-2.0 |

Run `npm ci` and `npm run build:admin` to reproduce `public/assets/css/admin.css`,
`public/assets/vendor/jquery.min.js` and their license notices. The lockfile pins
transitive packages and integrity hashes. First-party JavaScript stays under
`public/assets/js/`; downloaded dependencies stay under `public/assets/vendor/`
and are excluded from Topos analysis.

Run `npx playwright install chromium` once, then
`python tests/run_admin_browser.py` for browser verification. The Python owner
starts a private MariaDB, creates only its own disposable database/accounts,
launches a loopback PHP server, runs `npm run test:admin`, and tears them down.
No configured application database is used. Screenshots go to ignored
`.quality/browser/`; traces and saved authentication state are disabled.

Direct Playwright execution requires `PPMS_TEST_BASE_URL`, fixture-only
`PPMS_TEST_USERNAME` / `PPMS_TEST_PASSWORD`, `PPMS_TEST_DISPOSABLE=1`, and a
matching `PPMS_TEST_FIXTURE_ID` marker supplied by the test-only temporary
router. The normal application has no marker endpoint. Tests refuse an
unmarked server and do not use operational credentials.

Primary references: [Tailwind CLI](https://tailwindcss.com/docs/installation/tailwind-cli),
[jQuery releases](https://releases.jquery.com/jquery/),
[Playwright configuration](https://playwright.dev/docs/test-configuration).
