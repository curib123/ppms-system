# Repository instructions

Always commit each small, complete change with a descriptive commit message.
Use CodeIgniter's native MySQLi driver with MySQL/MariaDB. Preserve the PPMS
table/column names, enum values, constraints, and default data when converting
the archived PostgreSQL source. Use `public/` as the web document root. Never commit local
credentials, live database dumps, password hashes, sessions, or operational data.

## Shared frontend design

Use the centralized red design system documented in `docs/design-system.md` for
every application screen and HTML view. Keep color literals in
`public/assets/ppms/theme.css`; use semantic tokens in component/page styles.
Preserve matching light/dark states and the clean, minimal visual hierarchy.
Import reusable controls from `ui.js`, including `searchInput` for searches and
`searchableSelect` for filters and longer option lists. Keep native controls inside
the zoomable form document. Do not duplicate per-page search/dropdown markup.
Add new frontend modules to the offline shell and run `tests/design_system.py`.
Use the existing browser acceptance suite when changing control interactions.
