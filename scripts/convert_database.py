"""Rebuild MySQL/MariaDB schema, seed SQL, and manifest from archived PPMS SQL.

No server, credentials, or third-party Python packages are needed.
This converter accepts the checked-in PostgreSQL dump's grammar and fails
on unknown column types or constraints instead of silently dropping them.
"""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1] / 'database'
SOURCE = ROOT / 'source/postgresql'


def identifier(value):
    return '`' + value.replace('`', '``') + '`'


def quoted(value):
    return 'CONVERT(X\'' + value.encode('utf-8').hex() + '\' USING utf8mb4)'


def index_column(value):
    match = re.fullmatch(r'"?(\w+)"?(?: (ASC|DESC))?', value.strip())
    if not match:
        raise ValueError('Unsupported index column: ' + value)
    return match.group(1), (' ' + match.group(2)) if match.group(2) else ''


def canonical(row, types):
    result = {}
    for key, value in row.items():
        if value is None:
            result[key] = None
        elif types[key] == 'json':
            result[key] = json.loads(value)
        elif types[key] == 'datetime':
            date, _, fraction = value.partition('.')
            result[key] = date + '.' + (fraction + '000')[:3]
        elif types[key] == 'boolean':
            result[key] = '1' if value == 'true' else '0'
        else:
            result[key] = str(value)
    return json.dumps(result, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def convert():
    schema = (SOURCE / 'schema.sql').read_text(encoding='utf-8')
    data = (SOURCE / 'default_data.sql').read_text(encoding='utf-8')
    original = json.loads((SOURCE / 'manifest.json').read_text(encoding='utf-8'))
    enums = {name: ', '.join(re.findall(r"'[^']*'", body)) for name, body in
             re.findall(r'CREATE TYPE public\."(\w+)" AS ENUM \((.*?)\);', schema, re.S)}
    indexes = re.findall(r'CREATE (UNIQUE )?INDEX "(\w+)" ON public\."(\w+)" USING btree \((.*?)\)(.*?);', schema)
    indexed = {}
    for _, _, table, columns, _ in indexes:
        indexed.setdefault(table, set()).update(index_column(c)[0] for c in columns.split(','))
    for table, column in re.findall(r'ALTER TABLE ONLY public\."(\w+)"\s+ADD CONSTRAINT "\w+" PRIMARY KEY \((\w+)\);', schema):
        indexed.setdefault(table, set()).add(column)
    for table, columns in re.findall(r'ALTER TABLE ONLY public\."(\w+)"\s+ADD CONSTRAINT "\w+" FOREIGN KEY \(([^)]+)\)', schema):
        indexed.setdefault(table, set()).update(c.strip().strip('"') for c in columns.split(','))

    statements = []
    types = {}
    for table, body in re.findall(r'CREATE TABLE public\."(\w+)" \(\n(.*?)\n\);', schema, re.S):
        types[table] = {}
        columns = []
        for raw in body.splitlines():
            raw = raw.strip().rstrip(',')
            if raw.startswith('CONSTRAINT'):
                check = re.sub(r'::(?:public\."\w+"|text)', '', raw)
                check = re.sub(r'"(\w+)"', r'`\1`', check).replace('btrim(', 'TRIM(')
                check = re.sub(r'= ANY \(ARRAY\[(.*?)\]\)', r'IN (\1)', check)
                check = check.replace(' ~ ', ' REGEXP ')
                # key is reserved in MySQL; quote this original unquoted PG identifier.
                check = re.sub(r'(?<![`\w])key(?![`\w])', '`key`', check)
                if '::' in check or 'ARRAY[' in check or 'ANY ' in check:
                    raise ValueError('Unsupported constraint: ' + raw)
                columns.append('    ' + check)
                continue
            match = re.fullmatch(r'(?:"(\w+)"|(\w+)) (.*)', raw)
            if not match:
                raise ValueError('Unsupported column: ' + raw)
            name, definition = match.group(1) or match.group(2), match.group(3)
            definition = re.sub(r'::(?:public\."\w+"|text)', '', definition)
            kind = 'string'
            if definition.startswith('text'):
                # Bounded keys allow complete InnoDB indexes, without lossy prefixes.
                target = 'VARCHAR(191)' if name in indexed.get(table, set()) or 'DEFAULT' in definition else 'TEXT'
                definition = re.sub(r'^text', target, definition)
            elif definition.startswith('public.'):
                enum = re.match(r'public\."(\w+)"', definition).group(1)
                definition = re.sub(r'^public\."\w+"', 'ENUM(' + enums[enum] + ')', definition)
            elif definition.startswith('timestamp(3) without time zone'):
                kind = 'datetime'
                definition = definition.replace('timestamp(3) without time zone', 'DATETIME(3)')
                definition = definition.replace('CURRENT_TIMESTAMP', 'CURRENT_TIMESTAMP(3)')
            elif definition.startswith('jsonb'):
                kind = 'json'
                definition = definition.replace('jsonb', 'JSON', 1)
            elif definition.startswith('boolean'):
                kind = 'boolean'
                definition = definition.replace('boolean', 'TINYINT(1)', 1).replace('true', '1').replace('false', '0')
                definition += ' CHECK (' + identifier(name) + ' IN (0, 1))'
            elif definition.startswith('integer'):
                kind = 'integer'
                definition = definition.replace('integer', 'INT', 1)
            elif definition.startswith('numeric(18,6)'):
                kind = 'decimal'
                definition = definition.replace('numeric(18,6)', 'DECIMAL(18,6)', 1)
            else:
                raise ValueError('Unsupported type: ' + raw)
            types[table][name] = kind
            columns.append('    ' + identifier(name) + ' ' + definition)
        statements.append('CREATE TABLE ' + identifier(table) + ' (\n' + ',\n'.join(columns)
                          + '\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;')

    for table, body in re.findall(r'ALTER TABLE ONLY public\."(\w+)"\s+(ADD CONSTRAINT .*?);', schema, re.S):
        body = body.replace('public.', '')
        body = re.sub(r'"(\w+)"', r'`\1`', body)
        body = re.sub(r'\((id)\)', r'(`\1`)', body)
        statements.append('ALTER TABLE ' + identifier(table) + ' ' + body + ';')
    for unique, name, table, columns, tail in indexes:
        cols = [identifier(index_column(c)[0]) + index_column(c)[1] for c in columns.split(',')]
        if tail.strip():
            if name != 'PpmRecord_retention_eligible_idx' or unique:
                raise ValueError('Unsupported filtered index: ' + name)
            # Same retention predicate is supported by a normal covering index.
            cols = ['`status`', '`archivedAt`'] + cols
        statements.append('CREATE ' + unique + 'INDEX ' + identifier(name) + ' ON '
                          + identifier(table) + ' (' + ', '.join(cols) + ');')
    if len(types) != 28:
        raise ValueError('Expected all 28 application tables')
    header = '-- PPMS MySQL 8.0.16+ / MariaDB 10.4+; generated by scripts/convert_database.py.\n'
    (ROOT / 'schema.sql').write_text(header + 'SET NAMES utf8mb4;\n\n' + '\n\n'.join(statements) + '\n', encoding='utf-8', newline='\n')

    rows = {table: [] for table in types}
    inserts = []
    # Pg_dump emits standard-conforming string literals, with doubled apostrophes.
    insert_pattern = r'INSERT INTO public\."(\w+)" \(([^)]+)\) VALUES\s*((?:(?:\'(?:[^\']|\'\')*\')|[^;\'])*);'
    for table, columns, values in re.findall(insert_pattern, data, re.S):
        names = [c.strip().strip('"') for c in columns.split(',')]
        sql_rows = []
        for tuple_match in re.finditer(r"\((?:(?:'(?:[^']|'')*')|[^')])*\)", values, re.S):
            tokens = re.findall(r"'(?:[^']|'')*'|NULL|true|false|-?\d+(?:\.\d+)?", tuple_match.group(0))
            if len(tokens) != len(names):
                raise ValueError('Cannot parse complete seed row for ' + table)
            row = {}
            literals = []
            for name, token in zip(names, tokens):
                if token.startswith("'"):
                    row[name] = token[1:-1].replace("''", "'")
                    literals.append(quoted(row[name]))
                elif token == 'NULL':
                    row[name] = None
                    literals.append('NULL')
                else:
                    row[name] = token
                    literals.append({'true': '1', 'false': '0'}.get(token, token))
            rows[table].append(canonical(row, types[table]))
            sql_rows.append('(' + ', '.join(literals) + ')')
        inserts.append('INSERT INTO ' + identifier(table) + ' (' + ', '.join(map(identifier, names))
                       + ') VALUES\n' + ',\n'.join(sql_rows) + ';')
    counts = {table: len(values) for table, values in rows.items()}
    if counts != original['tableCounts']:
        raise ValueError('Seed conversion lost or added rows: ' + repr(counts))
    (ROOT / 'default_data.sql').write_text(header + 'SET NAMES utf8mb4;\n\n' + '\n\n'.join(inserts) + '\n', encoding='utf-8', newline='\n')
    hashes = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted(ROOT.rglob('*')) if p.is_file() and (p.parts[-1] in ['schema.sql', 'default_data.sql'] or 'source' in p.relative_to(ROOT).parts)}
    manifest = {'databaseDriver': 'mysqli', 'targets': ['MySQL >= 8.0.16', 'MariaDB >= 10.4'],
                'sourceRepository': original['sourceRepository'], 'sourceCommit': original['sourceCommit'],
                'conversionNotes': ['Indexed/defaulted TEXT becomes VARCHAR(191); other TEXT stays TEXT.',
                    'JSONB becomes JSON, timestamp(3) becomes DATETIME(3), enums retain every value.',
                    'The nonunique retention partial index becomes a full covering index.',
                    'Original PostgreSQL artifacts are archived under source/postgresql.'],
                'tableCounts': counts, 'columnTypes': types,
                'tableDataSha256': {t: hashlib.sha256('\n'.join(sorted(v)).encode('utf-8')).hexdigest() for t, v in rows.items()},
                'sha256': hashes}
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('Converted 28 tables,', sum(counts.values()), 'seed rows, and', len(indexes), 'indexes.')


if __name__ == '__main__':
    convert()
