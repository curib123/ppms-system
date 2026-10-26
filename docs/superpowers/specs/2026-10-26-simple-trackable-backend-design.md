# Simple, trackable PPMS backend

Date: 2026-10-26

## Intent and scope

Make the existing CodeIgniter 3 backend easier to follow and give maintainers a
repeatable quality check. The user selected backend simplification and Topos
checks first. The full browser application is a separate task.

Keep native MySQLi, MySQL/MariaDB, the existing schema and default data,
`public/` as the document root, and the current API and business rules.
The requested browser stack remains Tailwind, Chart.js, native CSS and jQuery;
this pass does not add unused browser dependencies.

## Approaches

1. **Incremental cleanup and checks (selected).** Keep CI3's existing
   controllers, services and persistence model. Improve API ownership and add
   an optional development tool. Small commits and the existing integration
   suite make the result reviewable.
2. **Build the full offline browser application now.** This also needs login,
   dynamic rendering, IndexedDB, a durable queue and reconciliation screens.
   It is a larger feature project; the user chose the first approach.

Rewriting the backend or adding another application framework would work
against the simplicity goal and is outside this design.

## Proposed changes

### API navigation

Keep `Api::_remap` as the single JSON/authentication/error boundary. Group
dispatch into short private handlers for authentication, devices, forms,
templates, records, synchronization and revalidation. Match the same HTTP
methods and path expressions as today. Each matched endpoint explicitly loads
the service it calls, rather than relying on another service's constructor.
Use ordinary PHP methods, with no generic router, container or dynamic registry.

Keep device credential verification before dispatch whenever the request
contains `deviceId`. Preserve all response bodies, error codes, permissions,
transaction boundaries, lock ordering and URL behavior.

### Quality checks

Add one documented command for first-party PHP syntax checks and Topos
structural analysis of supported first-party sources. Exclude CI3's vendored
`system/`, local configuration, operational data and generated artifacts.

Pin Topos to the verified upstream v0.14.0 release. For this Windows workspace,
provide an optional Linux Docker runner with checksum verification. A native
Topos executable can be used on supported hosts. Keep this tool entirely out
of the PHP application runtime and avoid global agent configuration changes.

Topos currently supports Python, Rust, JavaScript, TypeScript, C++ and Go; it
does **not** parse PHP. Report this limitation explicitly. PHP lint and the
existing behavioral suites remain required. Topos findings are advisory;
analysis failures must be visible, and unavailable metrics must not be
presented as passes. Skip COMPOSABLE with `--no-composable` initially to avoid
adding GitNexus and its dependency graph. Save local reports under an ignored
directory, identifying the tool version and source revision.

### Traceability

Add a concise architecture guide mapping API resource -> service -> tables ->
behavioral test. Document implemented backend behavior separately from the
future offline browser client. Update README with the check commands and map.

## Verification and commits

1. Record the existing disposable-MariaDB test results before changing PHP.
2. Test the quality runner's real failure handling and run the pinned Topos
   binary against supported first-party files.
3. After API cleanup, run PHP lint, standalone validator/conversion checks and
   the complete disposable-MariaDB installer, migration and API suites.
4. Review the diff for unchanged paths, authorization and transaction logic.
5. Commit every small, complete change with a descriptive message. Never stage
   credentials, password hashes, sessions, databases or operational data.

## Upstream evidence

- [Topos v0.14.0 release](https://github.com/Krv-Labs/topos/releases/tag/v0.14.0)
- [Supported languages](https://github.com/Krv-Labs/topos/blob/297a01301610124544a1b8a08123359ab32cb55e/topos/engine/src/graphs/ast/languages.rs)
- [Installation](https://github.com/Krv-Labs/topos/blob/297a01301610124544a1b8a08123359ab32cb55e/docs/source/installation.rst)
- [CLI reference](https://github.com/Krv-Labs/topos/blob/297a01301610124544a1b8a08123359ab32cb55e/docs/source/cli.rst)

The grouping and Docker runner are implementation recommendations, not
upstream requirements. The user approved this design and implementation on
2026-10-26.
