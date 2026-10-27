"""Build the source-backed PPM document, with native editable diagram elements."""
import json

from flow_canvas import AMBER, BLUE, INK, MUTED, RED, TEAL, Page, save_pages
from ppm_source import DESTINATION, ROOT, build_source


OUT = ROOT / 'docs/process-flow'


def trace(index):
    return f'REV84-FORM-{index:03d}'


def ingredients(data):
    page = Page('01-ingredients', 'Ingredients to mixing',
                'Current code relationships, grouped by production activity. Arrows select exact published source evidence.', 1)
    page.text(80, 242, 1050, 'PEANUT SECTION', 16, BLUE, 'bold')
    nodes = [
        ('p21', 80, 300, 'PPM-021', 'Raw peanut\nreceiving'),
        ('p04', 330, 300, 'PPM-004', 'Raw peanut\nsorting'),
        ('p07', 580, 300, 'PPM-007', 'Final roasting'),
        ('p08', 830, 300, 'PPM-008', 'Peanut grinding'),
        ('p09', 1080, 300, 'PPM-009', 'Ground peanuts'),
    ]
    for key, x, y, code, body in nodes:
        page.node(key, x, y, 200, 96, code, body, code=code)
    for source, target, number, label, x in (
            ('p21', 'p04', 1, 'Receiving ref', 230), ('p04', 'p07', 2, 'Sorting code', 480),
            ('p07', 'p08', 3, 'Roasting code', 730), ('p08', 'p09', 4, 'Grinding code', 980)):
        a, b = page.nodes[source], page.nodes[target]
        page.edge(source, target, [(a['x'] + 200, 348), (b['x'], 348)],
                  label, (x - 44, 405, 210), [trace(number)])
    page.note(80, 455, 1175,
              'RESERVED: PPM-005 Peanut Blanching and PPM-006 Pre-roasted Sorting. Their branch is not active.', AMBER, '#FFF6E6')
    page.text(80, 525, 1100, 'EGG PREPARATION', 16, BLUE, 'bold')
    page.node('p01', 80, 580, 220, 105, 'PPM-001', 'Egg preparation', code='PPM-001')
    page.node('p02', 420, 580, 220, 105, 'PPM-002', 'Eggwhites\nPail / pitcher', code='PPM-002')
    page.node('p03', 420, 780, 220, 96, 'PPM-003', 'Eggyolk', code='PPM-003')
    page.node('p20', 800, 780, 240, 96, 'PPM-020', 'Frozen eggyolk\nNo onward code link', code='PPM-020')
    page.edge('p01', 'p02', [(300, 632), (420, 632)], 'Pail / pitcher', (308, 600, 110), [trace(6), trace(7)])
    page.edge('p01', 'p03', [(190, 685), (190, 828), (420, 828)], 'Eggyolk code', (205, 797, 190), [trace(8)])
    page.edge('p03', 'p20', [(640, 828), (800, 828)], 'Eggyolk code', (651, 794, 160), [trace(16)])
    page.text(80, 908, 1060, 'SCALING & MIXING  /  SUGAR AND VANILLA', 16, BLUE, 'bold')
    page.node('p26', 80, 967, 220, 96, 'PPM-026', 'Sugar receiving', code='PPM-026')
    page.node('p10', 420, 967, 220, 96, 'PPM-010', 'Sugar', code='PPM-010')
    page.node('p19', 800, 967, 240, 96, 'PPM-019', 'Vanilla', code='PPM-019')
    page.edge('p26', 'p10', [(300, 1015), (420, 1015)], 'Receiving ref', (310, 982, 180), [trace(13)])
    page.node('p11', 1350, 620, 265, 225, 'PPM-011',
              'Mixing - Meringue\n\nMeringue entries\nMixture entries\nGround peanut lots', code='PPM-011', accent=TEAL, fill='#EDF8F7')
    page.edge('p09', 'p11', [(1280, 348), (1482, 348), (1482, 620)], 'Ground peanut code', (1300, 314, 300), [trace(5)], color=TEAL)
    page.edge('p01', 'p11', [(190, 580), (190, 560), (1280, 560), (1280, 655), (1350, 655)],
              'Direct eggwhite / pitcher source', (940, 532, 345), [trace(9), trace(10)], color=TEAL)
    page.edge('p02', 'p11', [(640, 632), (1180, 632), (1180, 713), (1350, 713)],
              'Pail / pitcher code', (840, 601, 250), [trace(11), trace(12)], color=TEAL)
    page.edge('p10', 'p20', [(530, 967), (530, 914), (920, 914), (920, 876)],
              'Sugar for frozen eggyolk', (575, 882, 330), [trace(17)])
    page.edge('p10', 'p11', [(640, 1015), (700, 1015), (700, 945), (1135, 945), (1135, 772), (1350, 772)],
              'Sugar code', (1150, 742, 190), [trace(14)], color=TEAL)
    page.edge('p19', 'p11', [(1040, 1015), (1230, 1015), (1230, 820), (1350, 820)],
              'Vanilla code', (1215, 858, 170), [trace(15)], color=TEAL)
    page.edge('p11', 'p11', [(1615, 730), (1640, 730), (1640, 935), (1482, 935), (1482, 845)],
              'Meringue: another record', (1340, 955, 290), [trace(18)], color=AMBER, cross_record=True)
    page.note(80, 1080, 1535, 'Same-form arrows require a different eligible source record. Review does not gate trace use. Full keys and statuses: pages 6-8.', size=15)
    return page


def finishing(data):
    page = Page('02-finishing', 'Forming, baking, packing and release',
                'Solid arrows are current trace mappings. The two dashed arrows show physical activity order inferred from field labels.', 2)
    page.text(80, 234, 1000, 'PRODUCTION ACTIVITIES', 16, BLUE, 'bold')
    for key, x, code, body in (
            ('mix', 80, 'PPM-011', 'Mixing - Meringue'), ('form', 430, 'PPM-012', 'Forming operations'),
            ('bake', 780, 'PPM-013', 'Baking monitoring'), ('receive', 1130, 'PPM-014', 'Baked receiving')):
        page.node(key, x, 340, 230, 100, code, body, code=code)
    page.edge('mix', 'form', [(310, 390), (430, 390)], 'Mixing code', (318, 355, 180), [trace(19)])
    page.edge('mix', 'bake', [(195, 340), (195, 305), (895, 305), (895, 340)],
              'Mixing code direct to baking', (475, 277, 340), [trace(20)])
    page.edge('mix', 'receive', [(195, 340), (195, 265), (1245, 265), (1245, 340)],
              'Mixing code direct to baked receiving', (870, 238, 400), [trace(21)])
    page.edge('form', 'bake', [(660, 390), (780, 390)], 'To oven', (672, 414, 120), color=MUTED, kind='operational')
    page.edge('bake', 'receive', [(1010, 390), (1130, 390)], 'Baked transfer', (1022, 414, 170), color=MUTED, kind='operational')
    page.node('staff', 430, 500, 230, 100, 'PPM-023', 'Forming personnel\nSession reference', code='PPM-023', accent=TEAL)
    page.edge('form', 'staff', [(545, 440), (545, 500)], 'Internal session', (573, 465, 220), [trace(31)], color=TEAL)
    page.node('oil', 80, 500, 230, 100, 'PPM-022', 'Pan greaser\nOil usage stream', code='PPM-022', accent=TEAL)
    page.edge('oil', 'oil', [(80, 550), (52, 550), (52, 638), (195, 638), (195, 600)],
              'Oil from another record', (75, 611, 300), [trace(30)], color=AMBER, cross_record=True)
    page.note(840, 492, 770, 'PPM-013 and PPM-023 have no default output rules. Pan greaser has no configured link to other production forms.', size=16)
    page.text(80, 665, 1100, 'PACKING  /  EXACT BAKED AND FOIL-ROLL SOURCES', 16, BLUE, 'bold')
    page.node('bakedSource', 80, 750, 220, 100, 'PPM-014', 'Baked code\nSame form as above', code='PPM-014')
    page.node('coding', 430, 750, 220, 100, 'PPM-024', 'Product coding\nRoll code output', code='PPM-024')
    page.node('printed', 780, 720, 220, 100, 'PPM-015', 'Primary packing\nPrinted foil input', code='PPM-015')
    page.node('plain', 780, 960, 220, 100, 'PPM-016', 'Primary packing\nPlain foil input', code='PPM-016')
    page.node('secondary', 1130, 825, 220, 100, 'PPM-017', 'Secondary packing', code='PPM-017')
    page.node('tertiary', 1390, 825, 220, 100, 'PPM-018', 'Tertiary packing', code='PPM-018')
    page.node('warehouse', 1310, 1010, 300, 90, 'WH-STOCK-RELEASE', 'Stock releasing form', code='WH-STOCK-RELEASE', accent=TEAL, fill='#EDF8F7')
    page.edge('bakedSource', 'coding', [(300, 800), (430, 800)], 'Baked code', (310, 764, 150), [trace(24)])
    page.edge('bakedSource', 'printed', [(190, 750), (190, 705), (890, 705), (890, 720)],
              'Baked code', (565, 679, 180), [trace(22)])
    page.edge('bakedSource', 'plain', [(190, 850), (190, 1080), (890, 1080), (890, 1060)],
              'Baked code', (440, 1048, 180), [trace(23)])
    page.edge('coding', 'printed', [(650, 800), (710, 800), (710, 770), (780, 770)],
              'Printed foil roll', (660, 735, 195), [trace(25)])
    page.edge('coding', 'plain', [(540, 850), (540, 1010), (780, 1010)],
              'Plain foil roll', (566, 978, 195), [trace(26)])
    page.edge('printed', 'secondary', [(1000, 770), (1070, 770), (1070, 852), (1130, 852)],
              'Consume-before', (1010, 734, 225), [trace(27)])
    page.edge('plain', 'secondary', [(1000, 1010), (1070, 1010), (1070, 895), (1130, 895)],
              'Consume-before', (1010, 1020, 225), [trace(28)])
    page.edge('secondary', 'tertiary', [(1350, 875), (1390, 875)], names=[trace(29)])
    page.edge('secondary', 'warehouse', [(1240, 925), (1240, 1055), (1310, 1055)],
              'Consume-before code', (1095, 969, 225), ['WAREHOUSE-PPM-017-STOCK-RELEASE'], color=TEAL)
    page.edge('tertiary', 'warehouse', [(1500, 925), (1500, 1010)],
              'Consume-before', (1390, 943, 220), ['WAREHOUSE-PPM-018-STOCK-RELEASE'], color=TEAL)
    return page


def record_workflow(data):
    page = Page('03-record-workflow', 'One PPM record: entry to downstream use',
                'Personnel entry belongs to Flutter. The existing CI3 API enforces author, device, template, revision and trace checks.', 3)
    page.panel(64, 235, 1552, 230, 'PERSONNEL / FLUTTER CLIENT RESPONSIBILITY', '#F1F6FC')
    for key, x, title, body in (
            ('login', 80, 'Sign in individually', 'Use assigned device\nand current form access'),
            ('template', 430, 'Open assigned PPM', 'Use active published\ntemplate and area'),
            ('draft', 780, 'Save draft locally', 'Keep original author\nand pinned version'),
            ('entry', 1130, 'Fill rows and sources', 'Select exact eligible\npublished output IDs')):
        page.node(key, x, 313, 280, 110, title, body)
    for first, second, x in (('login', 'template', 360), ('template', 'draft', 710), ('draft', 'entry', 1060)):
        page.edge(first, second, [(x, 368), (page.nodes[second]['x'], 368)], color=BLUE, kind='workflow')
    page.node('queue', 1130, 515, 280, 105, 'Sync draft, then submit', 'Immutable batch + mutation IDs\nServer submits saved draft data', accent=TEAL)
    page.edge('entry', 'queue', [(1270, 423), (1270, 515)], color=TEAL, kind='workflow')
    page.node('valid', 780, 490, 240, 155, 'Inputs\nvalid?', '', accent=AMBER, fill='#FFF9ED', shape='diamond')
    page.node('revision', 430, 490, 240, 155, 'Revision\nmatches?', '', accent=AMBER, fill='#FFF9ED', shape='diamond')
    page.node('submitted', 80, 515, 280, 105, 'Commit submitted revision', 'Record: SUBMITTED\nImmutable content + audit', accent=TEAL, fill='#EDF8F7')
    page.edge('queue', 'valid', [(1130, 568), (1020, 568)], color=TEAL, kind='workflow')
    page.edge('valid', 'revision', [(780, 568), (670, 568)], 'Yes', (708, 532, 75), color=TEAL, kind='workflow')
    page.edge('revision', 'submitted', [(430, 568), (360, 568)], 'Yes', (366, 532, 70), color=TEAL, kind='workflow')
    page.node('rejected', 780, 735, 280, 115, 'REJECTED: fix and retry', 'Correct fields, access or lease;\nuse a fresh mutation after fix', accent=RED, fill='#FFF2EF')
    page.node('conflict', 430, 735, 280, 115, 'CONFLICT: reconcile', 'Keep server, merge, or apply\nlocal data as a new revision', accent=AMBER, fill='#FFF9ED')
    page.edge('valid', 'rejected', [(900, 645), (900, 735)], 'No', (918, 669, 80), color=RED, kind='workflow')
    page.edge('revision', 'conflict', [(550, 645), (550, 735)], 'No', (568, 669, 80), color=AMBER, kind='workflow')
    page.node('publish', 80, 770, 280, 115, 'Publish configured outputs', 'Separate authorized action\nNo unresolved trace impact', accent=TEAL, fill='#EDF8F7')
    page.edge('submitted', 'publish', [(220, 620), (220, 770)], 'No review prerequisite', (82, 680, 300), color=TEAL, kind='workflow')
    page.node('downstream', 430, 960, 355, 100, 'Next PPM selects the output', 'Active connection + matching code\nPublished, current eligible source', accent=TEAL, fill='#EDF8F7')
    page.edge('publish', 'downstream', [(220, 885), (220, 1010), (430, 1010)], color=TEAL, kind='workflow')
    page.panel(1120, 705, 496, 380, 'INDEPENDENT GUIDANCE / SUBMITTED REVISION', '#F3F7FA')
    for key, y, title, body in (
            ('checked', 766, 'Checked / FSQA', 'Confirm or request correction'),
            ('reviewed', 869, 'Reviewed / SUPERVISOR', 'Confirm or request correction'),
            ('approved', 972, 'Approved / PLANT_MANAGER', 'Confirm or request correction')):
        page.node(key, 1140, y, 456, 86, title, body, accent=BLUE)
    page.note(80, 1080, 1000, 'Drafts: record ACTIVE / revision DRAFT. Submission and publication are separate. Reviews stay on the exact content revision.', size=15)
    page.text(1135, 641, 475, 'Each role may act independently.\nADMIN may explicitly name any stage.', 16, MUTED)
    return page


def corrections(data):
    page = Page('04-corrections', 'Corrections and downstream revalidation',
                'A review note and an actual data correction follow different paths. Preserve original evidence and immutable history.', 4)
    page.node('issue', 80, 320, 250, 100, 'Input issue found', 'Personnel or reviewer\nidentifies a problem')
    page.node('content', 410, 290, 230, 160, 'Content\nchange?', '', accent=AMBER, fill='#FFF9ED', shape='diamond')
    page.edge('issue', 'content', [(330, 370), (410, 370)], kind='workflow')
    page.node('guidance', 800, 265, 300, 110, 'Append quality guidance', 'APPROVE or RETURN event\nRETURN requires a reason')
    page.node('noImpact', 1240, 265, 350, 110, 'Content and trace unchanged', 'No new content revision\nNo retirement or revalidation', accent=TEAL, fill='#EDF8F7')
    page.edge('content', 'guidance', [(525, 290), (525, 242), (950, 242), (950, 265)], 'No / review only', (610, 214, 230), kind='workflow')
    page.edge('guidance', 'noImpact', [(1100, 320), (1240, 320)], kind='workflow', color=TEAL)
    page.node('authorize', 410, 510, 280, 110, 'Authorize correction', 'Current access + mobile lease\nBase revision + reason')
    page.node('newRevision', 800, 510, 300, 110, 'Append corrected revision', 'Record ACTIVE / CORRECTED\nPinned template; keep history', accent=TEAL, fill='#EDF8F7')
    page.node('retire', 1240, 510, 350, 110, 'Retire affected trace outputs', 'When data changes + outputs exist:\ntraverse linked downstream records', accent=AMBER, fill='#FFF9ED')
    page.edge('content', 'authorize', [(525, 450), (525, 510)], 'Yes', (548, 468, 80), kind='workflow')
    page.edge('authorize', 'newRevision', [(690, 565), (800, 565)], kind='workflow')
    page.edge('newRevision', 'retire', [(1100, 565), (1240, 565)], kind='workflow', color=AMBER)
    page.note(80, 659, 1510, 'Resubmit the corrected source, then publish fresh eligible outputs. Existing links remain historical; superseded outputs cannot be selected for new work.', size=17)
    page.text(80, 740, 1450, 'DOWNSTREAM IMPACT RESOLUTION  /  REVIEWER ROLE + FORM ACCESS + CURRENT REVISION', 16, BLUE, 'bold')
    page.node('impact', 80, 870, 250, 110, 'Open impact items', 'One task per affected link\nUnresolved impact blocks publish', accent=AMBER, fill='#FFF9ED')
    page.node('closed', 410, 845, 230, 160, 'Closed\nrecord?', '', accent=AMBER, fill='#FFF9ED', shape='diamond')
    page.node('replace', 800, 795, 300, 120, 'REPLACED_SOURCE', 'Correct + submit using a different\neligible source in current revision;\nthen resolve with notes', accent=TEAL, fill='#EDF8F7')
    page.node('historical', 800, 975, 300, 105, 'ACCEPT_HISTORICAL', 'Closed records only\nRecord the decision + notes', accent=AMBER, fill='#FFF9ED')
    page.node('resolved', 1240, 875, 350, 125, 'Resolve each impact item', 'Parent impact becomes RESOLVED\nwhen every item is resolved.\nPublication remains a separate step.', accent=TEAL, fill='#EDF8F7')
    page.edge('impact', 'closed', [(330, 925), (410, 925)], kind='workflow', color=AMBER)
    page.edge('closed', 'replace', [(525, 845), (525, 812), (745, 812), (745, 855), (800, 855)], 'No', (650, 780, 80), kind='workflow', color=TEAL)
    page.edge('closed', 'historical', [(525, 1005), (525, 1055), (750, 1055), (750, 1028), (800, 1028)], 'Yes', (650, 1020, 80), kind='workflow', color=AMBER)
    page.edge('replace', 'resolved', [(1100, 855), (1170, 855), (1170, 910), (1240, 910)], kind='workflow', color=TEAL)
    page.edge('historical', 'resolved', [(1100, 1028), (1170, 1028), (1170, 960), (1240, 960)], kind='workflow', color=AMBER)
    return page


def table(page, headers, widths, rows, y=290, row_height=39, font_size=15, states=None):
    x_start = 64
    page.rect(x_start, y, sum(widths), 43, '#EAF0F7', stroke=None, radius=4)
    x = x_start
    for label, width in zip(headers, widths):
        page.text(x + 11, y + 11, width - 22, label, 14, BLUE, 'bold')
        x += width
    y += 43
    for index, row in enumerate(rows):
        page.rect(x_start, y, sum(widths), row_height, '#F7F9FC' if index % 2 == 0 else '#FFFFFF', stroke=None)
        x = x_start
        for col, (value, width) in enumerate(zip(row, widths)):
            color = INK
            if col == len(widths) - 1 and states:
                color = states.get(str(value), MUTED)
            padding = 5 if row_height < 37 else 9
            height = page.text(x + 11, y + padding, width - 22, value, font_size, color,
                               'bold' if col == 0 or col == len(widths) - 1 else 'regular')
            if height + padding + 4 > row_height:
                raise ValueError(f'Table row too tall: {page.key} / {value}')
            x += width
        y += row_height
    return y


def form_register(data):
    page = Page('05-form-register', 'Default form register',
                'All 26 defaults: 24 active forms and two reserved forms. Template v3 is distinct from each controlled paper revision.', 5)
    rows = []
    for form in data['forms']:
        limits = '1-200 rows'
        if form['code'] == 'PPM-011':
            limits = 'Meringue 100 / mixture 100 / lots 300'
        rows.append((form['code'], form['title'], form['area'], form['status'],
                     f'v{form["templateVersion"]} / {form["paperRevision"]}', limits))
    table(page, ['FORM CODE', 'CONTROLLED TITLE', 'AREA', 'STATE', 'VERSION / REV', 'ROW LIMITS'],
          [185, 385, 220, 120, 160, 482], rows, y=250, row_height=29, font_size=14,
          states={'ACTIVE': TEAL, 'RESERVED': AMBER})
    page.note(64, 1070, 1552, 'Minimum one row per required group on submit. No PPM-025 is present. The 26th default is WH-STOCK-RELEASE. Duplicate form titles retain their distinct codes.', size=15)
    return page


def connection_pages(data):
    active = [row for row in data['connections'] if row['status'] == 'ACTIVE']
    pages = []
    for offset, chunk in enumerate((active[:18], active[18:])):
        number = offset + 6
        page = Page(f'0{number}-active-connections', f'Active connection register / {offset + 1} of 2',
                    'Exact saved keys. ACTIVE is the stored status; Current path means the mapping matches the present template and output rule.', number)
        page.note(64, 231, 1552, '35 saved ACTIVE connections = 33 current mappings + 2 obsolete top-level input paths. Same-form mappings require a different source record.', AMBER, '#FFF6E6', 16)
        rows = []
        for row in chunk:
            flag = 'Other record' if row['sameForm'] else ('Current path' if row['matchesCurrentTemplates'] else 'Mapping gap')
            rows.append((row['name'], row['source'], row['output'], row['target'], row['input'], flag))
        table(page, ['CONNECTION NAME', 'SOURCE', 'OUTPUT KEY', 'TARGET', 'TARGET INPUT PATH', 'PATH CHECK'],
              [310, 130, 240, 190, 465, 217], rows, y=320, row_height=39, font_size=14,
              states={'Current path': TEAL, 'Other record': AMBER, 'Mapping gap': RED})
        page.text(80, 1085, 1500, 'Each selected row stores the exact source output ID, source revision and concrete downstream input path. A matching code string alone is insufficient.', 15, MUTED)
        pages.append(page)
    return pages


def inactive_connections(data):
    page = Page('08-inactive-connections', 'Reserved, pending and disabled connections',
                'These 21 saved relationships are retained in the default seed. They are excluded from current trace source selection.', 8)
    rows = [(row['name'], row['source'], row['output'], row['target'], row['input'], row['status'])
            for row in data['connections'] if row['status'] != 'ACTIVE']
    table(page, ['CONNECTION NAME', 'SOURCE', 'OUTPUT KEY', 'TARGET', 'TARGET INPUT PATH', 'STORED STATUS'],
          [210, 160, 270, 170, 465, 277], rows, y=290, row_height=35, font_size=14,
          states={'PENDING_VALIDATION': AMBER, 'RESERVED': MUTED, 'DISABLED': RED})
    page.note(64, 1082, 1552, 'Pending links are not missing arrows to add automatically. Validate real source output rules and current target fields before activation.', AMBER, '#FFF6E6', 15)
    return page


def accuracy_notes(data):
    page = Page('09-accuracy-notes', 'Accuracy notes and source authority',
                'This document describes the checked-in defaults and current guards. It does not certify that every seeded route is operational.', 9)
    page.panel(64, 235, 755, 260, '01 / REQUIRED INPUTS WITH NO ACTIVE SOURCE', '#FFF6E6')
    page.text(84, 293, 715, 'PPM-017: entries[].packingCode\nPPM-024: entries[].productCode\nPPM-024: entries[].rollCode', 18, AMBER, 'bold')
    page.text(84, 394, 715, 'The runtime requires an exact active source selection for populated trace fields. No supplier form or connection is invented here.', 17)
    page.panel(64, 520, 755, 247, '02 / SAME-FORM SOURCES NEED ANOTHER RECORD', '#FFF6E6')
    page.text(84, 577, 715, 'PPM-011 meringueCode -> mixture meringueCode\nPPM-022 oilCode -> usageOilCode', 18, AMBER, 'bold')
    page.text(84, 649, 715, 'Same-record source selection is explicitly rejected. Verify the separate-record / first-record bootstrap arrangement for these streams before rollout.', 17)
    page.panel(64, 792, 755, 310, '03 / PRESERVE THE ACTUAL CONFIGURATION', '#F1F6FC')
    page.text(84, 850, 715,
              'CONN-004 and CONN-005 remain ACTIVE in the seed, but their target paths are obsolete. The diagrams use the corresponding current row paths.\n\nPPM-005 / PPM-006 stay RESERVED. PPM-025 is absent. No onward source link is configured for frozen eggyolk or an external pan-greaser handoff.', 17)
    page.panel(850, 235, 766, 360, '04 / RUNTIME AND CLIENT BOUNDARIES', '#EDF8F7')
    page.text(872, 293, 722,
              'Checked, Reviewed and Approved are independent guidance on the exact content revision. Review does not gate an otherwise eligible published source.\n\nCorrections return the record to ACTIVE with a CORRECTED revision. Resubmission and publication remain separate. Unresolved genuine trace impacts still block publication.\n\nFlutter local entry and the admin panel are planned client work in this checkout; this PDF is not proof of client delivery.', 17)
    page.panel(850, 620, 766, 482, '05 / SOURCE INDEX AND REPRODUCTION', '#F3F7FA')
    paths = [
        'database/default_data.sql + database/manifest.json',
        'application/libraries/Ppms_record_service.php',
        'application/libraries/Ppms_trace_service.php',
        'application/libraries/Ppms_workflow_service.php',
        'application/libraries/Ppms_sync_service.php',
        'docs/architecture.md + docs/flutter-client-contract.md',
        'docs/superpowers/specs/2026-10-26-simple-trackable-backend-design.md',
        'docs/superpowers/plans/2026-10-26-simple-trackable-backend.md',
    ]
    y = 675
    for path in paths:
        page.text(872, y, 722, path, 13.5, MUTED)
        y += 31
    page.text(872, 944, 722, 'Full SHA-256 values: source/default-ppm-flow.json\nBuild and validation commands: README.md\nAll shapes, labels and connectors: included .drawio file', 16)
    page.text(872, 1035, 722, 'No live database was queried or changed.\nNo existing PDF was supplied; this is a new source-based document.', 16, TEAL, 'bold')
    return page


def build_pages(data):
    return [ingredients(data), finishing(data), record_workflow(data), corrections(data), form_register(data),
            *connection_pages(data), inactive_connections(data), accuracy_notes(data)]


if __name__ == '__main__':
    source = build_source()
    if not DESTINATION.exists() or json.loads(DESTINATION.read_text(encoding='utf-8')) != source:
        raise SystemExit('Refresh source metadata first: python scripts/documentation/ppm_source.py')
    pages = build_pages(source)
    path = save_pages(pages, OUT)
    print(f'Built {len(pages)} A3 landscape pages: {path}')
    print('Editable diagrams.net file, SVG pages and PDF-rendered PNG previews included.')
