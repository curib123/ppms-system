"""Verify source coverage, native editable links and the actual exported PDF."""
from collections import Counter
import hashlib
import json
import xml.etree.ElementTree as ET

import pymupdf as fitz

from build_ppm_flow import build_pages
from ppm_source import DESTINATION, ROOT, build_source


OUT = ROOT / 'docs/process-flow'


def segment_crosses_box(first, last, node):
    left, right = node['x'] + 1, node['x'] + node['w'] - 1
    top, bottom = node['y'] + 1, node['y'] + node['h'] - 1
    if first[0] == last[0]:
        return left < first[0] < right and max(min(first[1], last[1]), top) < min(max(first[1], last[1]), bottom)
    if first[1] == last[1]:
        return top < first[1] < bottom and max(min(first[0], last[0]), left) < min(max(first[0], last[0]), right)
    raise AssertionError('Unexpected non-orthogonal connector')


def verify():
    source = build_source()
    assert json.loads(DESTINATION.read_text(encoding='utf-8')) == source, 'Source metadata is stale'
    assert source['counts']['forms'] == 26
    assert source['counts']['formStatuses'] == {'ACTIVE': 24, 'RESERVED': 2}
    assert source['counts']['connectionStatuses'] == {'ACTIVE': 35, 'DISABLED': 1, 'PENDING_VALIDATION': 17, 'RESERVED': 3}
    expected = {row['name']: row for row in source['connections'] if row['status'] == 'ACTIVE' and row['matchesCurrentTemplates']}
    assert len(expected) == 33
    document = fitz.open(OUT / 'PPMS_Default_PPM_Process_Flow.pdf')
    assert len(document) == 9
    assert len(document.get_toc()) == 9
    text = '\n'.join(page.get_text() for page in document)
    for form in source['forms']:
        assert form['code'] in document[4].get_text(), 'Missing form: ' + form['code']
    for row in source['connections']:
        assert row['name'] in text, 'Missing connection name: ' + row['name']
    for path in ('entries[].packingCode', 'entries[].productCode', 'entries[].rollCode'):
        assert path in document[8].get_text(), 'Missing configuration gap: ' + path
    for page in document:
        assert abs(page.rect.width - 1190.5512) < 0.1 and abs(page.rect.height - 841.8898) < 0.1
        assert not page.get_images(), 'PDF diagram was rasterized'
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                for span in line['spans']:
                    assert page.rect.contains(fitz.Rect(span['bbox'])), 'Clipped text in PDF'
    print('PDF: 9 vector A3 landscape pages, bookmarks, all 26 form codes and all 56 connection names.')

    editable = ET.parse(OUT / 'PPMS_Default_PPM_Process_Flow.drawio').getroot()
    assert len(editable.findall('diagram')) == 9
    names_seen = Counter()
    for diagram in editable.findall('diagram'):
        cells = {cell.attrib['id']: cell for cell in diagram.findall('.//mxCell')}
        assert not diagram.findall('.//mxCell[@style="image"]'), 'Editable diagram contains flattened images'
        for cell in cells.values():
            for name in cell.attrib.get('connectionNames', '').split():
                assert name in expected, 'Invented/inactive relationship: ' + name
                row = expected[name]
                assert cells[cell.attrib['source']].attrib['formCode'] == row['source'], name
                assert cells[cell.attrib['target']].attrib['formCode'] == row['target'], name
                if row['sameForm']:
                    assert cell.attrib['crossRecord'] == 'true', 'Unmarked same-record restriction'
                names_seen[name] += 1
    assert names_seen == Counter({name: 1 for name in expected}), 'Trace mapping omitted or duplicated'
    print('Editable file: all 33 current mappings have correct form endpoints; same-form links marked as cross-record.')

    for page in build_pages(source):
        page.validate_bounds()
        nodes = list(page.nodes.values())
        for index, node in enumerate(nodes):
            box = fitz.Rect(node['x'], node['y'], node['x'] + node['w'], node['y'] + node['h'])
            for other in nodes[index + 1:]:
                other_box = fitz.Rect(other['x'], other['y'], other['x'] + other['w'], other['y'] + other['h'])
                assert not box.intersects(other_box), f'Overlapping nodes: {page.key} {node["key"]} {other["key"]}'
        for edge in (element for element in page.elements if element['kind'] == 'edge'):
            for node in nodes:
                if node['key'] in (edge['source'], edge['target']):
                    continue
                for first, last in zip(edge['points'], edge['points'][1:]):
                    assert not segment_crosses_box(first, last, node), f'Connector crosses unrelated node: {page.key} {edge["source"]}->{edge["target"]} via {node["key"]}'
        svg = OUT / 'pages' / (page.key + '.svg')
        ET.parse(svg)
        preview = OUT / 'previews' / (page.key + '.png')
        pixmap = fitz.Pixmap(preview)
        assert pixmap.width == 1680 and pixmap.height >= 1187, 'Unexpected preview dimensions'
    print('Layout: page bounds, node separation, connector clearance, SVG XML and all 9 PDF previews checked.')

    artifacts = sorted(path for path in OUT.rglob('*') if path.is_file() and path.name != 'verification.json')
    receipt = {
        'scope': 'Static source and generated-document validation; no application/database writes or client playthrough',
        'pages': len(document), 'formCodes': 26, 'savedConnections': 56, 'mappedCurrentConnections': 33,
        'artifactSha256': {str(path.relative_to(OUT)).replace('\\', '/'): hashlib.sha256(path.read_bytes()).hexdigest() for path in artifacts},
    }
    (OUT / 'source/verification.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('PASS: source/verification.json written with artifact fingerprints.')


if __name__ == '__main__':
    verify()
