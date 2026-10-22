# PPMS MySQL / MariaDB database

The application uses CodeIgniter 3's **mysqli** driver. Supported targets are
MySQL **8.0.16+** and MariaDB **10.4+**; local verification uses MariaDB 10.4.32.

`schema.sql` creates all 28 original PPMS application tables with InnoDB,
utf8mb4, and the case-sensitive utf8mb4_bin collation. `default_data.sql`
contains the 182 original default rows, preserving IDs, timestamps, template
JSON values, links, and settings:

| Table | Rows |
| --- | ---: |
| ProductionArea | 7 |
| PpmForm | 26 |
| AreaPpmAssignment | 26 |
| PpmTemplateVersion | 26 |
| TraceCodeRule | 26 |
| PpmTraceConnection | 56 |
| SystemSetting | 15 |

No live accounts, password hashes, records, sessions, or audit logs are seeded.
All five original user roles are retained in the User.role ENUM.

## Install

Create an empty database, configure `application/config/local.php`, then run:

```powershell
php index.php setup install
php index.php setup verify
```

The installer validates SQL hashes and serializes installation with a named
MySQL lock. It refuses databases containing tables, views, routines, or events.
DDL commits implicitly; it therefore creates the schema first and seeds inside
a transaction. On failure after the empty check it rolls back seed changes and
removes only the known tables belonging to that new installation. Web requests
cannot run setup commands. Existing populated databases are never cleaned up.

For a manual import into a fresh database, in a shell supporting input redirection:

```sh
mysql --default-character-set=utf8mb4 -u root -p ppms_ci3 < database/schema.sql
mysql --default-character-set=utf8mb4 -u root -p ppms_ci3 < database/default_data.sql
```

Manual imports do not have the installer's integrity checks or failure cleanup.
To use an existing converted MySQL/MariaDB database, connect to it and skip
imports. `setup check` is read-only; `setup verify` checks an exact fresh baseline,
so it should run before operational data is added.

## Conversion decisions

- Original table and column names are retained and backtick-quoted.
- PostgreSQL ENUM types become native column ENUMs with all original values.
- JSONB becomes validated JSON. JSON objects, arrays, strings, booleans, and
  numeric values are preserved; JSON serialization whitespace is not significant.
- timestamp(3) without time zone becomes DATETIME(3), retaining milliseconds.
- Boolean columns become TINYINT(1) with CHECK constraints restricting 0/1.
- NUMERIC(18,6) becomes DECIMAL(18,6); integers remain signed INT.
- Primary, foreign, unique, and other indexed text columns, plus text columns
  with defaults, become VARCHAR(191). This bounds identifiers/business keys to
  191 characters and supports full composite InnoDB indexes without prefixes.
  Other text remains TEXT. The binary collation keeps key comparisons sensitive
  to case and accents; MySQL/MariaDB padding rules still apply to VARCHAR keys.
- All primary/foreign keys and unique indexes retain their relationships and
  delete/update actions. The original nonunique retention partial index becomes
  an index on (status, archivedAt, closedAt, id); the query predicate is unchanged.
- PostgreSQL-specific CHECK expressions use equivalent IN, TRIM, and REGEXP
  expressions. Strict SQL mode prevents silent truncation or invalid ENUMs.

## Source and reproducibility

`source/postgresql/` preserves the exact previous schema SQL, seed SQL, and
manifest. `source/schema.prisma`, `source/migrations/`, and the original seed
scripts retain their PostgreSQL definitions for provenance; they are archives,
not active MySQL migrations. Do not execute them against this application's DB.

Rebuild the active MySQL SQL and manifest without connecting to a server:

```powershell
python scripts/convert_database.py
```

`manifest.json` records original source provenance, file SHA-256 hashes,
column types, expected table counts, and canonical data fingerprints. Default
verification normalizes JSON object-key ordering, numeric exponent formatting,
and timestamp precision so equivalent MySQL/MariaDB representations compare
correctly. It detects changes to default values, not just changes in row counts.
