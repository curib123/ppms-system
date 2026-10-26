# Simple, trackable backend implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Track each complete task and commit it separately.

**Goal:** Make PPMS easier to navigate and add repeatable, honest quality checks.

**Architecture:** Retain CI3's JSON boundary, domain services and MySQLi model.
Group API handlers by resource. Keep Topos in optional development tooling.

**Tech stack:** CodeIgniter 3, native MySQLi, Python standard library, optional
Docker and Topos v0.14.0. Future browser stack: Tailwind, Chart.js, CSS, jQuery.

**Spec:** [Approved design](../specs/2026-10-26-simple-trackable-backend-design.md).

## Global constraints

- Preserve API URLs, methods, bodies, status/error codes and permissions.
- Preserve tables, defaults, transactions, locks and device verification.
- Keep `public/` as document root and `system/` unchanged.
- Never commit credentials, hashes, sessions or operational data.
- Topos does not parse PHP; structural findings are advisory.
- Commit every small, complete change with a descriptive message.

## Review focus

- Unknown routes and unsupported methods must still return authenticated 404s.
- Device credentials must still be checked before dispatch for every deviceId.
- Invalid JSON, login and unauthenticated errors must keep their precedence.
- A failed analyzer or PHP lint must produce a nonzero command exit.
- Unsupported PHP and unavailable Topos pillars must never appear as passes.

## Tasks

### 1. Group API handlers and make service ownership explicit

Files: `application/controllers/Api.php`, relevant existing API tests.

- [ ] Record baseline `python tests/run_with_mariadb.py` results.
- [ ] Add route/transport characterization coverage where absent and verify
  against the original controller before editing it.
- [ ] Keep `_remap` unchanged; dispatch by resource into private handlers.
  Preserve exact existing path regexes and load each called service explicitly.
- [ ] Run PHP lint and disposable MariaDB API integration tests; inspect diff.
- [ ] Commit this complete refactor.

### 2. Add optional Topos quality checks

Files: `scripts/check_quality.py`, `tools/topos/Dockerfile`,
`tests/quality.py`, `.gitignore`, `docs/code-quality.md`, `README.md`.

- [ ] Write and run failing tests for real syntax failure, analyzer failure,
  unsupported coverage and safe source selection.
- [ ] Implement tracked first-party PHP lint and Python syntax checks. Add
  optional native/Docker Topos execution and ignored versioned JSON reports.
  Pin v0.14.0 and verify its release checksum in the Docker build.
- [ ] Run runner tests and a real Topos analysis; inspect supported-file results.
- [ ] Document one local command and one command including Topos; commit.

### 3. Map the code and verify the complete result

Files: `docs/architecture.md`, `README.md`, this plan.

- [ ] Document resource -> owning service -> core tables -> behavioral tests,
  existing offline server guarantees and the future browser-client boundary.
- [ ] Run the combined quality command, standalone validation/conversion and
  the complete disposable MariaDB suite.
- [ ] Obtain an independent diff review; fix material findings.
- [ ] Record verification, mark tasks complete and commit the documentation.
