"""Read the sealed default seed for documentation; never connect to a database."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / 'docs/process-flow/source/default-ppm-flow.json'
SOURCE_FILES = (
    'database/default_data.sql',
    'database/schema.sql',
    'database/manifest.json',
    'application/libraries/Ppms_record_service.php',
    'application/libraries/Ppms_trace_service.php',
    'application/libraries/Ppms_workflow_service.php',
    'application/libraries/Ppms_sync_service.php',
    'docs/architecture.md',
    'docs/flutter-client-contract.md',
    'docs/superpowers/specs/2026-10-26-simple-trackable-backend-design.md',
    'docs/superpowers/plans/2026-10-26-simple-trackable-backend.md',
)
TOKEN = re.compile(r"CONVERT\(X'[0-9a-fA-F]*' USING utf8mb4\)|NULL|-?\d+(?:\.\d+)?")


def seed_tables():
    manifest = json.loads((ROOT / 'database/manifest.json').read_text(encoding='utf-8'))
    for filename, expected in manifest['sha256'].items():
        actual = hashlib.sha256((ROOT / 'database' / filename).read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError('Default SQL differs from its sealed manifest: ' + filename)
    sql = (ROOT / 'database/default_data.sql').read_text(encoding='utf-8')
    tables = {}
    for table, columns, body in re.findall(
            r'INSERT INTO `(\w+)` \(([^)]+)\) VALUES\s*(.*?);', sql, re.S):
        names = re.findall(r'`([^`]+)`', columns)
        rows = []
        for line in body.splitlines():
            if not line.strip():
                continue
            if TOKEN.sub('', line).strip('(), \t\r\n'):
                raise ValueError('Unsupported seed literal in ' + table)
            values = []
            for token in TOKEN.findall(line):
                if token.startswith('CONVERT'):
                    value = bytes.fromhex(token.split("'")[1]).decode('utf-8')
                elif token == 'NULL':
                    value = None
                else:
                    value = float(token) if '.' in token else int(token)
                values.append(value)
            if len(values) != len(names):
                raise ValueError('Incomplete seed row in ' + table)
            rows.append(dict(zip(names, values)))
        tables.setdefault(table, []).extend(rows)
    for table, count in manifest['tableCounts'].items():
        if len(tables.get(table, [])) != count:
            raise ValueError('Seed row count differs from manifest: ' + table)
    return tables


def template_fields(definition):
    if 'fields' in definition:
        return definition['fields']
    return [field for section in definition['sections'] for field in section['items']]


def field_paths(fields, prefix=''):
    for field in fields:
        path = prefix + field['key']
        if field['type'] in ('repeatable', 'table', 'group'):
            suffix = '.' if field['type'] == 'group' else '[].'
            yield from field_paths(field['fields'], path + suffix)
        else:
            yield path, field


def build_source():
    tables = seed_tables()
    areas = {row['id']: row['name'] for row in tables['ProductionArea']}
    area_by_form = {row['ppmFormId']: areas[row['areaId']] for row in tables['AreaPpmAssignment']}
    templates = {row['ppmFormId']: row for row in tables['PpmTemplateVersion']}
    codes = {row['id']: row['ppmCode'] for row in tables['PpmForm']}
    forms = []
    for row in sorted(tables['PpmForm'], key=lambda item: item['sortOrder']):
        template = templates[row['id']]
        fields = template_fields(json.loads(template['definitionJson']))
        leaves = dict(field_paths(fields))
        outputs = []
        for rule in tables['TraceCodeRule']:
            if rule['templateVersionId'] != template['id']:
                continue
            config = json.loads(rule['configurationJson'])
            outputs.append({
                'key': rule['outputKey'], 'label': rule['outputLabel'],
                'path': config.get('outputPath', rule['outputKey']),
                'sourceType': rule['sourceType'], 'status': rule['status'],
                'outputType': config.get('outputType', rule['sourceType']),
            })
        forms.append({
            'code': row['ppmCode'], 'title': row['title'], 'status': row['status'],
            'area': area_by_form[row['id']], 'templateVersion': template['versionNo'],
            'paperRevision': template['revisionNumber'],
            'templateActive': bool(template['isActive']),
            'groups': [{'key': field['key'], 'label': field['label'],
                        'minRows': field.get('minRows', 0), 'maxRows': field.get('maxRows', 100)}
                       for field in fields if field['type'] in ('repeatable', 'table')],
            'traceInputs': [{'path': path, 'required': field.get('required', False)}
                            for path, field in leaves.items() if field['type'] == 'trace-code'],
            'outputs': sorted(outputs, key=lambda item: item['key']),
        })
    by_code = {form['code']: form for form in forms}
    connections = []
    for row in sorted(tables['PpmTraceConnection'], key=lambda item: item['connectionName']):
        source = by_code[codes[row['sourcePpmFormId']]]
        target = by_code[codes[row['targetPpmFormId']]]
        rule = next((out for out in source['outputs'] if out['key'] == row['sourceOutputKey']), None)
        reasons = []
        if not rule or rule['status'] != 'ACTIVE':
            reasons.append('No active source output rule')
        if row['targetInputKey'] not in {field['path'] for field in target['traceInputs']}:
            reasons.append('Target path is absent from current trace inputs')
        if not source['templateActive'] or not target['templateActive']:
            reasons.append('A template is inactive')
        connections.append({
            'name': row['connectionName'], 'status': row['status'],
            'source': source['code'], 'output': row['sourceOutputKey'],
            'sourcePath': rule['path'] if rule else None,
            'target': target['code'], 'input': row['targetInputKey'],
            'matchesCurrentTemplates': not reasons, 'mappingIssues': reasons,
            'sameForm': source['code'] == target['code'],
        })
    active = [row for row in connections if row['status'] == 'ACTIVE']
    usable = [row for row in active if row['matchesCurrentTemplates']]
    unmapped = []
    for form in forms:
        if not form['templateActive']:
            continue
        for field in form['traceInputs']:
            if field['required'] and not any(row['target'] == form['code'] and row['input'] == field['path'] for row in usable):
                unmapped.append({'form': form['code'], 'input': field['path']})
    return {
        'title': 'PPMS default PPM process flow', 'documentDate': '2026-10-27',
        'scope': 'Checked-in default configuration and current service rules; no live operational data',
        'counts': {'areas': len(areas), 'forms': len(forms),
                   'formStatuses': dict(sorted(Counter(form['status'] for form in forms).items())),
                   'connections': len(connections),
                   'connectionStatuses': dict(sorted(Counter(row['status'] for row in connections).items())),
                   'activeMappingsMatchingTemplates': len(usable)},
        'forms': forms, 'connections': connections,
        'unmappedRequiredInputs': unmapped,
        'sourceSha256': {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in SOURCE_FILES},
    }


if __name__ == '__main__':
    source = build_source()
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(json.dumps(source, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(source['counts'], indent=2))
    print('Unmapped required trace inputs:', json.dumps(source['unmappedRequiredInputs']))
