"""Small shared canvas for vector PDF, SVG and editable diagrams.net pages."""
from html import escape
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import pymupdf as fitz


WIDTH, HEIGHT = 1680, 1188
INK = '#172B45'
MUTED = '#52647A'
BLUE = '#2563A6'
TEAL = '#087E83'
AMBER = '#98610A'
RED = '#AD4141'
LINE = '#CCD7E2'
FONTS = {key: fitz.Font(name) for key, name in (('regular', 'helv'), ('bold', 'hebo'), ('mono', 'cour'))}


def rgb(color):
    return tuple(int(color[index:index + 2], 16) / 255 for index in (1, 3, 5))


def lines_for(text, width, size, face='regular'):
    lines = []
    for paragraph in str(text).split('\n'):
        current = ''
        for word in paragraph.split(' '):
            candidate = (current + ' ' + word).strip()
            if FONTS[face].text_length(candidate, fontsize=size) <= width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                if FONTS[face].text_length(word, fontsize=size) > width:
                    raise ValueError('Text token exceeds its column: ' + word)
                current = word
        lines.append(current)
    return lines


class Page:
    def __init__(self, key, title, subtitle, number):
        self.key, self.title, self.number = key, title, number
        self.elements = []
        self.nodes = {}
        self.text(64, 38, 850, 'PPMS  /  PROCESS DOCUMENTATION', 15, BLUE, 'bold')
        self.text(1300, 38, 316, '27 OCTOBER 2026  /  DEFAULTS', 14, MUTED, 'bold', align='right')
        self.text(64, 87, 1552, title, 39, INK, 'bold')
        self.text(64, 150, 1552, subtitle, 18, MUTED)
        self.rect(64, 200, 1552, 3, fill=LINE, stroke=None)
        self.rect(64, 200, 150, 3, fill=TEAL, stroke=None)
        self.rect(64, 1135, 1552, 1, fill=LINE, stroke=None)
        self.text(64, 1151, 1200, 'Default seed + current CI3 service rules  |  Editable source included  |  See accuracy notes', 14, MUTED)
        self.text(1490, 1150, 126, f'{number:02d}  /  09', 15, BLUE, 'bold', align='right')

    def rect(self, x, y, w, h, fill='#FFFFFF', stroke=LINE, radius=0, layer=0):
        self.elements.append(dict(kind='rect', x=x, y=y, w=w, h=h, fill=fill, stroke=stroke, radius=radius, layer=layer))

    def text(self, x, y, w, text, size=17, color=INK, face='regular', align='left', layer=3):
        lines = lines_for(text, w, size, face)
        height = len(lines) * size * 1.3
        self.elements.append(dict(kind='text', x=x, y=y, w=w, h=height, text=str(text),
                                  lines=lines, size=size, color=color, face=face, align=align, layer=layer))
        return height

    def panel(self, x, y, w, h, label, fill='#F3F7FA'):
        self.rect(x, y, w, h, fill, stroke=None, radius=12)
        self.text(x + 18, y + 15, w - 36, label, 15, MUTED, 'bold')

    def node(self, key, x, y, w, h, title, body, code=None, accent=BLUE, fill='#FFFFFF', shape='rect'):
        if key in self.nodes:
            raise ValueError('Duplicate node key: ' + key)
        node = dict(kind='node', key=key, x=x, y=y, w=w, h=h, title=title, body=body,
                    formCode=code, accent=accent, fill=fill, shape=shape, layer=2)
        self.nodes[key] = node
        self.elements.append(node)
        return key

    def edge(self, source, target, points, label='', label_at=None, names=(), color=BLUE, kind='trace', cross_record=False):
        self.elements.append(dict(kind='edge', source=source, target=target, points=points,
                                  label=label, connectionNames=list(names), color=color,
                                  semanticKind=kind, crossRecord=cross_record, layer=1))
        if label and label_at:
            x, y, width = label_at
            label_lines = lines_for(label, width - 12, 14)
            height = len(label_lines) * 18 + 5
            actual_width = max(FONTS['regular'].text_length(line, fontsize=14) for line in label_lines)
            self.rect(x - 6, y - 2, actual_width + 12, height, '#FFFFFF', stroke=None, radius=3, layer=2)
            self.text(x, y, width, label, 14, color)

    def note(self, x, y, w, text, color=TEAL, fill='#EDF8F7', size=16):
        height = len(lines_for(text, w - 36, size)) * size * 1.3 + 28
        self.rect(x, y, w, height, fill, stroke=None, radius=8)
        self.text(x + 18, y + 12, w - 36, text, size, color)

    def node_text(self, node):
        inset = node['w'] * 0.25 if node['shape'] == 'diamond' else 16
        usable = node['w'] - 2 * inset
        title_size = 18
        title_lines = lines_for(node['title'], usable, title_size, 'bold')
        body_lines = lines_for(node['body'], usable, 16)
        total = (len(title_lines) * title_size * 1.3 + len(body_lines) * 16 * 1.3 + (6 if node['body'] else 0))
        if total + 18 > node['h']:
            raise ValueError('Node text exceeds height: ' + node['key'])
        y = node['y'] + (node['h'] - total) / 2
        for text_lines, size, face, color in ((title_lines, title_size, 'bold', node['accent']), (body_lines, 16, 'regular', INK)):
            for line in text_lines:
                yield dict(x=node['x'] + inset, y=y, w=usable, text=line, size=size, face=face, color=color)
                y += size * 1.3
            y += 6

    def validate_bounds(self):
        for element in self.elements:
            if element['kind'] == 'edge':
                for x, y in element['points']:
                    if not (0 <= x <= WIDTH and 0 <= y <= HEIGHT):
                        raise ValueError('Connector outside page: ' + self.key)
            else:
                if not (0 <= element['x'] and 0 <= element['y'] and element['x'] + element['w'] <= WIDTH
                        and element['y'] + element['h'] <= HEIGHT):
                    raise ValueError('Element outside page: ' + self.key + ' ' + str(element))
            if element['kind'] == 'node':
                list(self.node_text(element))

    def pdf(self, doc):
        page = doc.new_page(width=WIDTH, height=HEIGHT)
        for element in sorted(self.elements, key=lambda item: item['layer']):
            kind = element['kind']
            if kind == 'rect':
                page.draw_rect(fitz.Rect(element['x'], element['y'], element['x'] + element['w'], element['y'] + element['h']),
                               color=rgb(element['stroke']) if element['stroke'] else None,
                               fill=rgb(element['fill']), width=1, radius=element['radius'] / min(element['w'], element['h']) if element['radius'] else None)
            elif kind == 'text':
                for index, line in enumerate(element['lines']):
                    self.pdf_text(page, dict(element, text=line, y=element['y'] + index * element['size'] * 1.3))
            elif kind == 'node':
                x, y, w, h = (element[key] for key in ('x', 'y', 'w', 'h'))
                if element['shape'] == 'diamond':
                    page.draw_polyline([(x + w / 2, y), (x + w, y + h / 2), (x + w / 2, y + h), (x, y + h / 2), (x + w / 2, y)], color=rgb(element['accent']), fill=rgb(element['fill']), width=1.7)
                else:
                    page.draw_rect(fitz.Rect(x, y, x + w, y + h), color=rgb(element['accent']), fill=rgb(element['fill']), width=1.5, radius=0.1)
                for block in self.node_text(element):
                    self.pdf_text(page, block)
            elif kind == 'edge':
                dashed = element['semanticKind'] == 'operational'
                points = element['points']
                page.draw_polyline(points, color=rgb(element['color']), width=2, dashes='[7 5]' if dashed else None)
                page.draw_polyline(arrow(points), color=rgb(element['color']), fill=rgb(element['color']), width=1)
        return page

    @staticmethod
    def pdf_text(page, block):
        size, face = block['size'], block['face']
        x = block['x']
        if block.get('align') == 'right':
            x += block['w'] - FONTS[face].text_length(block['text'], fontsize=size)
        page.insert_text((x, block['y'] + FONTS[face].ascender * size), block['text'],
                         fontname={'regular': 'helv', 'bold': 'hebo', 'mono': 'cour'}[face],
                         fontsize=size, color=rgb(block['color']))

    def svg(self):
        parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" viewBox="0 0 {WIDTH} {HEIGHT}">',
                 '<rect width="100%" height="100%" fill="white"/>', f'<title>{escape(self.title)}</title>']
        for element in sorted(self.elements, key=lambda item: item['layer']):
            kind = element['kind']
            if kind == 'rect':
                parts.append(f'<rect x="{element["x"]}" y="{element["y"]}" width="{element["w"]}" height="{element["h"]}" rx="{element["radius"]}" fill="{element["fill"]}" stroke="{element["stroke"] or "none"}"/>')
            elif kind == 'text':
                for index, line in enumerate(element['lines']):
                    parts.append(svg_text(dict(element, text=line, y=element['y'] + index * element['size'] * 1.3)))
            elif kind == 'node':
                x, y, w, h = (element[key] for key in ('x', 'y', 'w', 'h'))
                if element['shape'] == 'diamond':
                    points = [(x + w / 2, y), (x + w, y + h / 2), (x + w / 2, y + h), (x, y + h / 2)]
                    parts.append(f'<polygon points="{point_string(points)}" fill="{element["fill"]}" stroke="{element["accent"]}" stroke-width="1.7"/>')
                else:
                    parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" fill="{element["fill"]}" stroke="{element["accent"]}" stroke-width="1.5"/>')
                parts.extend(svg_text(block) for block in self.node_text(element))
            elif kind == 'edge':
                dash = ' stroke-dasharray="7 5"' if element['semanticKind'] == 'operational' else ''
                parts.append(f'<polyline points="{point_string(element["points"])}" fill="none" stroke="{element["color"]}" stroke-width="2"{dash}/>')
                parts.append(f'<polygon points="{point_string(arrow(element["points"]))}" fill="{element["color"]}"/>')
        return '\n'.join(parts) + '\n</svg>\n'

    def drawio(self, parent):
        diagram = ET.SubElement(parent, 'diagram', id=self.key, name=f'{self.number:02d} {self.title}')
        model = ET.SubElement(diagram, 'mxGraphModel', dx=str(WIDTH), dy=str(HEIGHT), grid='1', gridSize='10',
                              guides='1', tooltips='1', connect='1', arrows='1', fold='1', page='1', pageScale='1',
                              pageWidth=str(WIDTH), pageHeight=str(HEIGHT), math='0', shadow='0')
        root = ET.SubElement(model, 'root')
        ET.SubElement(root, 'mxCell', id='0')
        ET.SubElement(root, 'mxCell', id='1', parent='0')
        for index, element in enumerate(sorted(self.elements, key=lambda item: item['layer'])):
            kind = element['kind']
            cell_id = element['key'] if kind == 'node' else f'item{index}'
            attrs = dict(id=cell_id, parent='1')
            if kind in ('rect', 'text', 'node'):
                attrs['vertex'] = '1'
                if kind == 'rect':
                    attrs.update(value='', style=f'rounded={int(bool(element["radius"]))};arcSize=10;fillColor={element["fill"]};strokeColor={element["stroke"] or "none"};')
                elif kind == 'text':
                    attrs.update(value=element['text'], style=f'text;html=0;whiteSpace=wrap;align={element["align"]};verticalAlign=top;spacing=0;fontFamily=Helvetica;fontSize={element["size"]};fontColor={element["color"]};fontStyle={int(element["face"] == "bold")};')
                else:
                    label = f'<b style="color:{element["accent"]};font-size:18px">{escape(element["title"])}</b><br/><span style="font-size:16px">{escape(element["body"]).replace(chr(10), "<br/>")}</span>'
                    attrs.update(value=label, style=f'{"rhombus" if element["shape"] == "diamond" else "rounded=1"};whiteSpace=wrap;html=1;align=left;verticalAlign=middle;spacing=16;arcSize=10;fontFamily=Helvetica;fontColor={INK};fillColor={element["fill"]};strokeColor={element["accent"]};strokeWidth=1.5;')
                    if element['formCode']:
                        attrs['formCode'] = element['formCode']
                cell = ET.SubElement(root, 'mxCell', **attrs)
                ET.SubElement(cell, 'mxGeometry', x=str(element['x']), y=str(element['y']), width=str(element['w']), height=str(element['h']), **{'as': 'geometry'})
            elif kind == 'edge':
                source, target = self.nodes[element['source']], self.nodes[element['target']]
                first, last = element['points'][0], element['points'][-1]
                style = f'edgeStyle=none;html=0;endArrow=block;endFill=1;strokeWidth=2;strokeColor={element["color"]};'
                style += f'exitX={(first[0] - source["x"]) / source["w"]};exitY={(first[1] - source["y"]) / source["h"]};entryX={(last[0] - target["x"]) / target["w"]};entryY={(last[1] - target["y"]) / target["h"]};exitPerimeter=0;entryPerimeter=0;'
                if element['semanticKind'] == 'operational':
                    style += 'dashed=1;'
                attrs.update(value='', edge='1', source=element['source'], target=element['target'], style=style,
                             connectionNames=' '.join(element['connectionNames']), semanticKind=element['semanticKind'],
                             crossRecord=str(element['crossRecord']).lower())
                cell = ET.SubElement(root, 'mxCell', **attrs)
                geom = ET.SubElement(cell, 'mxGeometry', relative='1', **{'as': 'geometry'})
                array = ET.SubElement(geom, 'Array', **{'as': 'points'})
                for x, y in element['points'][1:-1]:
                    ET.SubElement(array, 'mxPoint', x=str(x), y=str(y))


def point_string(points):
    return ' '.join(f'{x:g},{y:g}' for x, y in points)


def arrow(points):
    (px, py), (x, y) = points[-2:]
    angle = math.atan2(y - py, x - px)
    return [(x, y), (x - 10 * math.cos(angle) + 4 * math.sin(angle), y - 10 * math.sin(angle) - 4 * math.cos(angle)),
            (x - 10 * math.cos(angle) - 4 * math.sin(angle), y - 10 * math.sin(angle) + 4 * math.cos(angle)), (x, y)]


def svg_text(block):
    x = block['x']
    if block.get('align') == 'right':
        x += block['w'] - FONTS[block['face']].text_length(block['text'], fontsize=block['size'])
    y = block['y'] + FONTS[block['face']].ascender * block['size']
    return f'<text x="{x:g}" y="{y:g}" font-family="Helvetica,Arial,sans-serif" font-size="{block["size"]}" font-weight="{"700" if block["face"] == "bold" else "400"}" fill="{block["color"]}">{escape(block["text"])}</text>'


def save_pages(pages, destination):
    destination = Path(destination)
    (destination / 'pages').mkdir(exist_ok=True)
    (destination / 'previews').mkdir(exist_ok=True)
    source_doc = fitz.open()
    editable = ET.Element('mxfile', host='app.diagrams.net', agent='PPMS documentation generator', version='24.7.17', type='device')
    for page in pages:
        page.validate_bounds()
        page.pdf(source_doc)
        page.drawio(editable)
        (destination / 'pages' / (page.key + '.svg')).write_text(page.svg(), encoding='utf-8', newline='\n')
    final_doc = fitz.open()
    for index, page in enumerate(pages):
        target = final_doc.new_page(width=1190.5512, height=841.8898)
        target.show_pdf_page(target.rect, source_doc, index)
    final_doc.set_metadata({'title': 'PPMS Default PPM Process Flow', 'author': 'PPMS',
                            'subject': 'Canonical PPM forms, trace links, record workflow and configuration limitations',
                            'keywords': 'PPMS, PPM, process flow, default forms, traceability'})
    final_doc.set_toc([[1, page.title, index + 1] for index, page in enumerate(pages)])
    pdf_path = destination / 'PPMS_Default_PPM_Process_Flow.pdf'
    final_doc.save(pdf_path, garbage=4, deflate=True, no_new_id=True)
    for index, page in enumerate(pages):
        final_doc[index].get_pixmap(matrix=fitz.Matrix(WIDTH / final_doc[index].rect.width, WIDTH / final_doc[index].rect.width), alpha=False).save(destination / 'previews' / (page.key + '.png'))
    ET.indent(editable, space='  ')
    xml = ET.tostring(editable, encoding='utf-8', xml_declaration=True).replace(b'\r\n', b'\n')
    (destination / 'PPMS_Default_PPM_Process_Flow.drawio').write_bytes(xml)
    return pdf_path
