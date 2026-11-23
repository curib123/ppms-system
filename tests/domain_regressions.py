"""Focused real HTTP regressions for dynamic forms, immutable records and trace integrity."""
import json
import secrets
import subprocess
import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

import api_integration as harness
from integration import PHP, ROOT, TEST_ARGS, sql


class DomainRegressions(unittest.TestCase):
    api = harness.PpmApiIntegration.api
    login = harness.PpmApiIntegration.login
    stop_server = harness.PpmApiIntegration.__dict__['stop_server']

    @classmethod
    def setUpClass(cls):
        harness.PpmApiIntegration.setUpClass.__func__(cls)
        case = cls()
        case.login('admin')
        case.login('outsider')
        cls.today = datetime.now(ZoneInfo('Asia/Manila')).date().isoformat()
        cls.area = case.api('GET', '/areas')['items'][0]['id']

    def new_form(self, definition, rules=None):
        form = self.api('POST', '/forms', {'ppmCode': 'TEST-' + secrets.token_hex(5), 'title': 'Domain regression', 'areaId': self.area})
        template = self.api('POST', '/forms/' + form['id'] + '/templates', {'definitionJson': definition,
            'documentNumber': 'DOC-001', 'revisionNumber': '01', 'seriesNumber': '2026', 'pageNumber': '1 of 1', 'sourceFileHash': 'a' * 64})
        if rules:
            self.api('PUT', '/templates/' + template['id'] + '/rules', {'rules': rules})
        self.api('POST', '/templates/' + template['id'] + '/publish', {})
        assignment = sql("SELECT id FROM AreaPpmAssignment WHERE ppmFormId='" + form['id'] + "' LIMIT 1")
        return {'form': form['id'], 'template': template['id'], 'assignment': assignment}

    def record(self, form, data, selections=None, **extra):
        body = {'recordId': secrets.token_hex(16), 'clientMutationId': secrets.token_hex(16), 'baseRevisionNo': 0,
                'ppmFormId': form['form'], 'templateVersionId': form['template'], 'areaPpmAssignmentId': form['assignment'],
                'productionDate': self.today, 'dataJson': data, 'traceSelections': selections or []}
        body.update(extra)
        result = self.api('POST', '/records', body)
        self.assertEqual(result['result']['status'], 'APPLIED', result)
        return result['record']

    def edit(self, view, data, selections=None, **extra):
        body = {'clientMutationId': secrets.token_hex(16), 'baseRevisionNo': view['record']['currentRevisionNo'],
                'dataJson': data, 'traceSelections': selections or []}
        body.update(extra)
        result = self.api('PATCH', '/records/' + view['record']['id'], body)
        self.assertEqual(result['result']['status'], 'APPLIED', result)
        return result['record']

    def publish(self, view):
        result = self.api('POST', '/records/' + view['record']['id'] + '/publish', {'baseRevisionNo': view['record']['currentRevisionNo']})
        self.assertTrue(result['outputs'])
        return result['outputs'][0]

    @staticmethod
    def external_rule(key='lot', path='code', unique=False):
        return {'outputKey': key, 'outputLabel': 'Lot', 'sourceType': 'MANUAL_EXTERNAL', 'status': 'ACTIVE',
                'requiresUniqueBusinessCode': unique, 'configurationJson': {'outputPath': path}}

    def connect(self, source, target, path='source', output='lot', approval=True):
        return self.api('PUT', '/forms/' + target['form'] + '/connections', {'sourcePpmFormId': source['form'],
            'sourceOutputKey': output, 'targetInputKey': path, 'connectionName': 'Exact source', 'status': 'ACTIVE', 'requiresApprovalBeforeUse': approval})

    @staticmethod
    def selection(connection, output, path='source'):
        return {'connectionId': connection['id'], 'sourceTraceOutputId': output['id'], 'inputPath': path}

    def test_01_all_seed_definitions_and_rules_compile(self):
        templates = []
        for row in self.forms.values():
            for template in self.api('GET', '/forms/' + row['id'] + '/templates')['items']:
                rules = self.api('GET', '/templates/' + template['id'] + '/rules')['items']
                templates.append({'definitionJson': template['definitionJson'], 'rules': rules})
        self.assertEqual(len(templates), 26)
        result = subprocess.run(PHP + ['tests/domain_validation.php'], cwd=ROOT, env=self.env,
            input=json.dumps(templates), text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary['templates'], 26)
        self.assertGreaterEqual(summary['checks'], 49)

    def test_02_dynamic_calculations_metadata_review_edit_and_tombstone(self):
        schema = {'schemaVersion': 2, 'sections': [
            {'key': 'header', 'items': [{'key': 'name', 'label': 'Name', 'type': 'text', 'required': True}]},
            {'key': 'main', 'items': [{'key': 'rows', 'label': 'Entries', 'type': 'table', 'maxRows': 1000, 'fields': [
                {'key': 'quantity', 'label': 'Quantity', 'type': 'number'}, {'key': 'price', 'label': 'Price', 'type': 'number'},
                {'key': 'amount', 'label': 'Amount', 'type': 'number', 'calculation': {'op': 'multiply', 'args': [{'path': 'quantity'}, {'path': 'price'}]}}
            ]}]},
            {'key': 'summary', 'items': [{'key': 'total', 'label': 'Total', 'type': 'number', 'calculation': {'op': 'sum', 'path': 'rows[].amount'}}]}
        ]}
        form = self.new_form(schema)
        record = self.record(form, {'name': 'Test', 'rows': [{'quantity': 3, 'price': 4, 'amount': 999}], 'total': 999}, batchNo='0007')
        self.assertEqual(record['revision']['dataJson']['total'], 12)
        self.assertEqual(record['record']['batchNo'], '0007')
        row = self.api('GET', '/records?formId=' + form['form'] + '&q=0007')['items'][0]
        self.assertEqual(row['record']['batchNo'], '0007')
        self.assertNotIn('revisions', row)
        reviewed = self.api('POST', '/records/' + record['record']['id'] + '/review', {
            'status': 'APPROVED', 'baseRevisionNo': 1, 'expectedReviewVersion': 0, 'reviewerPosition': 'Quality Manager'})
        self.assertTrue(reviewed['reviewReference']['isCurrent'])
        record = self.edit(reviewed, {'name': 'Changed', 'rows': [{'quantity': 4, 'price': 4}]})
        self.assertEqual(record['revision']['dataJson']['total'], 16)
        self.assertEqual(record['reviewReference']['status'], 'PENDING_REVIEW')
        self.assertFalse(record['reviewReference']['isCurrent'])
        self.assertEqual(self.api('GET', '/records/' + record['record']['id'] + '/history?limit=1')['total'], 2)
        template = self.api('GET', '/forms/' + form['form'] + '/templates')['items'][0]
        self.assertEqual(template['documentNumber'], 'DOC-001')
        copied = self.api('POST', '/templates/' + template['id'] + '/duplicate', {'revisionNumber': '02'})
        self.assertEqual(copied['definitionJson'], schema)
        self.assertEqual(copied['revisionNumber'], '02')
        self.assertEqual(copied['sourceFileHash'], 'a' * 64)
        self.assertFalse(copied['isActive'])
        self.api('GET', '/records/' + record['record']['id'], user='outsider', expected=403)
        request = {'clientMutationId': secrets.token_hex(16), 'baseRevisionNo': 2, 'reason': 'Duplicate entry'}
        deleted = self.api('DELETE', '/records/' + record['record']['id'], request)
        self.assertEqual(deleted['result']['status'], 'APPLIED')
        self.assertTrue(deleted['record']['deleted'])
        self.assertEqual(self.api('DELETE', '/records/' + record['record']['id'], request)['result'], deleted['result'])
        self.assertEqual(self.api('GET', '/records?formId=' + form['form'])['total'], 0)
        self.assertEqual(self.api('GET', '/records?formId=' + form['form'] + '&includeDeleted=true')['total'], 1)
        event = json.loads(sql("SELECT payloadJson FROM SyncChangeEvent WHERE recordId='" + record['record']['id'] + "' ORDER BY sequence DESC LIMIT 1"))
        self.assertTrue(event['deleted'])
        self.assertNotIn('revisions', event)

    def test_03_seed_warehouse_readonly_source_selection_and_submit(self):
        source = self.new_form({'fields': [{'key': 'code', 'label': 'Code', 'type': 'text', 'required': True}]}, [self.external_rule()])
        output = self.publish(self.record(source, {'code': '20261201'}))
        seed = self.forms['WH-STOCK-RELEASE']
        template = next(row for row in self.api('GET', '/forms/' + seed['id'] + '/templates')['items'] if row['isActive'])
        target = {'form': seed['id'], 'template': template['id'], 'assignment': seed['areaPpmAssignmentId']}
        connection = self.connect(source, target, 'releaseEntries[].consumeBeforeDate')
        row = {'customerName': 'Customer', 'productSize': 'Small', 'quantity': 2, 'uom': 'BOX', 'productionDate': self.today,
               'timeReleased': '10:00', 'poNumber': 'PO-1', 'receiptNumber': 'R-1', 'vehicleType': 'CLOSE',
               'shipmentType': 'DELIVERY', 'driver': 'Driver', 'vehiclePlateNumber': 'ABC123'}
        selected = self.selection(connection, output, 'releaseEntries.0.consumeBeforeDate')
        record = self.record(target, {'releaseEntries': [row]}, [selected])
        self.assertEqual(record['revision']['dataJson']['releaseEntries'][0]['consumeBeforeDate'], '20261201')
        submitted = self.api('POST', '/records/' + record['record']['id'] + '/submit', {
            'clientMutationId': secrets.token_hex(16), 'baseRevisionNo': 1})
        self.assertEqual(submitted['result']['status'], 'APPLIED', submitted)
        self.assertEqual(submitted['record']['record']['status'], 'SUBMITTED')
        self.assertEqual(len(submitted['record']['traceLinks']), 1)
        inputs = self.api('GET', '/forms/' + target['form'] + '/trace-inputs?q=20261201&limit=1')
        self.assertEqual(len(inputs['outputs']), 1)

    def test_04_provenance_only_change_retires_output_and_reaches_dependents(self):
        source = self.new_form({'fields': [{'key': 'code', 'label': 'Code', 'type': 'text'}]}, [self.external_rule()])
        middle = self.new_form({'fields': [{'key': 'source', 'label': 'Source', 'type': 'trace-code'}]}, [self.external_rule(path='source')])
        target = self.new_form({'fields': [{'key': 'source', 'label': 'Source', 'type': 'trace-code'}]})
        ab, bc = self.connect(source, middle), self.connect(middle, target)
        a1, a2 = self.record(source, {'code': 'LOT-SAME'}), self.record(source, {'code': 'LOT-SAME'})
        o1, o2 = self.publish(a1), self.publish(a2)
        b = self.record(middle, {'source': 'LOT-SAME'}, [self.selection(ab, o1)])
        bo = self.publish(b)
        c = self.record(target, {'source': 'LOT-SAME'}, [self.selection(bc, bo)])
        graph = self.api('GET', '/trace/' + o1['id'] + '/tree')
        self.assertTrue(any(n['recordId'] == c['record']['id'] for n in graph['nodes']))
        self.assertTrue(any(e['source'] == o1['id'] for e in graph['edges']))
        self.assertTrue(self.api('GET', '/trace/' + o1['id'] + '/tree?maxNodes=1')['truncated'])
        self.api('GET', '/trace/' + o1['id'] + '/tree', user='outsider', expected=404)
        b = self.edit(b, {'source': 'LOT-SAME'}, [self.selection(ab, o2)])
        self.assertEqual(sql("SELECT status FROM PpmTraceOutput WHERE id='" + bo['id'] + "'"), 'SUPERSEDED')
        impacts = self.api('GET', '/records/' + c['record']['id'])['revalidations']
        self.assertGreater(len(impacts), 0)
        event = json.loads(sql("SELECT payloadJson FROM SyncChangeEvent WHERE recordId='" + c['record']['id'] + "' ORDER BY sequence DESC LIMIT 1"))
        self.assertGreater(len(event['revalidations']), 0)
        self.assertNotIn('revisions', event)
        # Simulate a legacy live output from B's older revision. Traversal must
        # follow that exact revision even though B's current source is now A2.
        sql("UPDATE PpmTraceOutput SET status='LINKED_DOWNSTREAM' WHERE id='" + bo['id'] + "'")
        self.edit(a1, {'code': 'LOT-CHANGED'})
        self.assertEqual(sql("SELECT status FROM PpmTraceOutput WHERE id='" + bo['id'] + "'"), 'SUPERSEDED')
        self.assertGreater(len(self.api('GET', '/records/' + c['record']['id'])['revalidations']), len(impacts))

    def test_05_sequence_namespace_survives_versions_and_old_offline_schema(self):
        rule = {'outputKey': 'lot', 'outputLabel': 'Lot', 'sourceType': 'SYSTEM_GENERATED', 'status': 'ACTIVE',
                'formulaTemplate': 'SEQ-{{sequence}}', 'sequencePadding': 3, 'resetPeriod': 'NONE', 'requiresUniqueBusinessCode': True, 'configurationJson': {}}
        form = self.new_form({'fields': [{'key': 'name', 'label': 'Name', 'type': 'text'}]}, [rule])
        first = self.record(form, {'name': 'First'})
        original = self.publish(first)
        self.assertEqual(original['outputCode'], 'SEQ-001')
        submitted = self.api('POST', '/records/' + first['record']['id'] + '/submit', {
            'clientMutationId': secrets.token_hex(16), 'baseRevisionNo': 1})
        self.assertEqual(submitted['result']['status'], 'APPLIED')
        self.assertEqual(self.publish(submitted['record'])['id'], original['id'])
        copy = self.api('POST', '/templates/' + form['template'] + '/duplicate', {})
        self.api('POST', '/templates/' + copy['id'] + '/publish', {})
        newer = dict(form, template=copy['id'])
        self.assertEqual(self.publish(self.record(newer, {'name': 'Second'}))['outputCode'], 'SEQ-002')
        old = self.record(form, {'name': 'Created offline on original template'})
        self.assertEqual(old['record']['templateVersionId'], form['template'])
        self.assertEqual(self.publish(old)['outputCode'], 'SEQ-003')

    def test_06_semantic_rule_validation_prevents_sealing_bad_configuration(self):
        form = self.new_form({'fields': [{'key': 'name', 'label': 'Name', 'type': 'text'}]})
        draft = self.api('POST', '/templates/' + form['template'] + '/duplicate', {})
        bad = {'outputKey': 'lot', 'outputLabel': 'Lot', 'sourceType': 'SYSTEM_GENERATED', 'status': 'ACTIVE',
               'formulaTemplate': 'LOT-{{missingField}}', 'configurationJson': {}}
        result = self.api('PUT', '/templates/' + draft['id'] + '/rules', {'rules': [bad]}, expected=422)
        self.assertEqual(result['error'], 'TRACE_BINDING_FIELD_NOT_DEFINED')
        good = dict(bad, formulaTemplate='LOT-{{name}}')
        self.api('PUT', '/templates/' + draft['id'] + '/rules', {'rules': [good]})
        changed = self.api('PATCH', '/templates/' + draft['id'], {'expectedDefinitionHash': draft['definitionHash'],
            'definitionJson': {'fields': [{'key': 'different', 'label': 'Different', 'type': 'text'}]}})
        self.api('POST', '/templates/' + draft['id'] + '/publish', {}, expected=422)
        self.assertFalse(self.api('GET', '/forms/' + form['form'] + '/templates')['items'][0]['isActive'])
        self.api('PATCH', '/templates/' + draft['id'], {'expectedDefinitionHash': changed['definitionHash'], 'definitionJson': draft['definitionJson']})
        self.api('POST', '/templates/' + draft['id'] + '/publish', {})

    def test_07_conflict_reason_is_in_committed_event(self):
        form = self.new_form({'fields': [{'key': 'name', 'label': 'Name', 'type': 'text'}]})
        record = self.record(form, {'name': 'Original'})
        record = self.edit(record, {'name': 'Server'})
        conflicting = self.api('PATCH', '/records/' + record['record']['id'], {'clientMutationId': secrets.token_hex(16), 'baseRevisionNo': 1, 'dataJson': {'name': 'Local'}})
        self.assertEqual(conflicting['result']['status'], 'CONFLICT')
        resolved = self.api('POST', '/records/' + record['record']['id'] + '/resolve-conflict', {'clientMutationId': secrets.token_hex(16),
            'baseRevisionNo': 2, 'conflictId': conflicting['result']['conflictId'], 'resolutionType': 'MANUAL_MERGE',
            'reason': 'Review both edits', 'dataJson': {'name': 'Merged'}})
        self.assertEqual(resolved['result']['status'], 'APPLIED', resolved)
        self.assertEqual(resolved['record']['revision']['correctionReason'], 'Review both edits')
        event = json.loads(sql("SELECT payloadJson FROM SyncChangeEvent WHERE recordId='" + record['record']['id'] + "' ORDER BY sequence DESC LIMIT 1"))
        self.assertEqual(event['revision']['correctionReason'], 'Review both edits')
        self.assertEqual(event['openConflictCount'], 0)
        self.assertNotIn('revisions', event)

    def test_08_large_form_summary_and_bounded_record_history(self):
        form = self.new_form({'schemaVersion': 2, 'sections': [
            {'key': 'header', 'items': []}, {'key': 'main', 'items': [{'key': 'rows', 'label': 'Rows', 'type': 'table', 'maxRows': 1000,
                'fields': [{'key': 'n', 'label': 'N', 'type': 'integer'}]}]},
            {'key': 'summary', 'items': [{'key': 'total', 'label': 'Total', 'type': 'number', 'calculation': {'op': 'sum', 'path': 'rows[].n'}}]}]})
        values = {'rows': [{'n': n} for n in range(1000)]}
        record = self.record(form, values)
        self.assertEqual(record['revision']['dataJson']['total'], 499500)
        self.assertEqual(self.api('GET', '/records?formId=' + form['form'] + '&limit=1')['limit'], 1)
        history = self.api('GET', '/records/' + record['record']['id'] + '/history?limit=1')
        self.assertEqual(len(history['items']), 1)

    def test_09_template_pages_preserve_exact_old_version_access(self):
        form = self.new_form({'fields': [{'key': 'name', 'label': 'Name', 'type': 'text'}]})
        for _ in range(11):
            self.api('POST', '/templates/' + form['template'] + '/duplicate', {})
        page = self.api('GET', '/forms/' + form['form'] + '/templates?summary=true')
        self.assertEqual(len(page['items']), 10)
        self.assertTrue(page['hasMore'])
        self.assertEqual(page['total'], 12)
        self.assertNotIn('definitionJson', page['items'][0])
        self.assertNotIn(form['template'], [row['id'] for row in page['items']])
        exact = self.api('GET', '/templates/' + form['template'])
        self.assertEqual(exact['definitionJson']['fields'][0]['key'], 'name')
        self.assertEqual(self.api('GET', '/forms/' + form['form'] + '/templates?page=2')['items'][-1]['id'], form['template'])
        self.api('GET', '/templates/' + form['template'], user='outsider', expected=403)

    def test_10_connection_cap_preserves_update_and_disable(self):
        source = self.new_form({'fields': [{'key': 'code', 'label': 'Code', 'type': 'text'}]}, [self.external_rule(key='lot' + str(n)) for n in range(65)])
        target = self.new_form({'fields': [{'key': 'source', 'label': 'Source', 'type': 'trace-code'}]})
        for n in range(64):
            self.connect(source, target, output='lot' + str(n))
        edge = {'sourcePpmFormId': source['form'], 'sourceOutputKey': 'lot64', 'targetInputKey': 'source', 'connectionName': 'Too many', 'status': 'ACTIVE'}
        self.assertEqual(self.api('PUT', '/forms/' + target['form'] + '/connections', edge, expected=422)['error'], 'TRACE_CONNECTION_LIMIT')
        self.connect(source, target, output='lot0')
        edge.update(sourceOutputKey='lot0', status='DISABLED')
        self.api('PUT', '/forms/' + target['form'] + '/connections', edge)
        self.connect(source, target, output='lot64')

    def test_11_daily_sequence_and_legacy_counter_floor(self):
        rule = {'outputKey': 'lot', 'outputLabel': 'Lot', 'sourceType': 'SYSTEM_GENERATED', 'status': 'ACTIVE',
                'formulaTemplate': 'DAY-{{sequence}}', 'sequencePadding': 3, 'resetPeriod': 'DAILY', 'requiresUniqueBusinessCode': True, 'configurationJson': {}}
        form = self.new_form({'fields': [{'key': 'name', 'label': 'Name', 'type': 'text'}]}, [rule])
        self.assertEqual(self.publish(self.record(form, {'name': 'First'}))['outputCode'], 'DAY-001')
        copied = self.api('POST', '/templates/' + form['template'] + '/duplicate', {})
        self.api('POST', '/templates/' + copied['id'] + '/publish', {})
        newer = dict(form, template=copied['id'])
        self.assertEqual(self.publish(self.record(newer, {'name': 'Second'}))['outputCode'], 'DAY-002')
        sql("INSERT INTO CodeSequence (id,codeRuleId,periodKey,currentValue,updatedAt) SELECT 'legacy-" + secrets.token_hex(5) + "',id,'" + self.today + "',9,UTC_TIMESTAMP(3) FROM TraceCodeRule WHERE templateVersionId='" + form['template'] + "' LIMIT 1")
        self.assertEqual(self.publish(self.record(newer, {'name': 'Preserve historical counter'}))['outputCode'], 'DAY-010')

    def test_12_form_listing_keeps_concurrent_device_memberships_distinct(self):
        form = self.new_form({'fields': [{'key': 'name', 'label': 'Name', 'type': 'text'}]})
        devices = [self.api('POST', '/devices', {'deviceUuid': secrets.token_hex(16), 'displayName': 'Concurrent domain device'}) for _ in range(2)]
        for device in devices:
            self.api('PUT', '/forms/' + form['form'] + '/lease', {'deviceId': device['id'], 'expectedLeaseVersion': 0})
        listed = [item for item in self.api('GET', '/forms')['items'] if item['id'] == form['form']]
        self.assertEqual(len(listed), 1)
        self.assertEqual({lease['deviceId'] for lease in listed[0]['leases']}, {device['id'] for device in devices})
        self.assertTrue(all(lease['leaseVersion'] == 1 for lease in listed[0]['leases']))
        self.assertIsNone(listed[0]['deviceId'])
        self.assertIsNone(listed[0]['leaseVersion'])
        self.api('POST', '/devices/' + devices[0]['id'] + '/revoke', {'reason': 'End one device membership'})
        listed = next(item for item in self.api('GET', '/forms')['items'] if item['id'] == form['form'])
        self.assertEqual(len(listed['leases']), 1)
        self.assertEqual(listed['deviceId'], devices[1]['id'])
        self.assertEqual(listed['leaseVersion'], 1)

    def test_13_inactive_form_history_remains_admin_readable_without_writes(self):
        form = self.new_form({'fields': [{'key': 'name', 'label': 'Name', 'type': 'text'}]})
        record = self.record(form, {'name': 'Historical record'})
        listed = next(item for item in self.api('GET', '/forms')['items'] if item['id'] == form['form'])
        self.api('PATCH', '/forms/' + form['form'], {'expectedUpdatedAt': listed['updatedAt'], 'status': 'INACTIVE'})
        history = self.api('GET', '/records/' + record['record']['id'] + '/history')
        self.assertEqual(history['items'][0]['dataJson']['name'], 'Historical record')
        self.assertEqual(self.api('GET', '/records?formId=' + form['form'])['total'], 1)
        result = self.api('PATCH', '/records/' + record['record']['id'], {'clientMutationId': secrets.token_hex(16),
            'baseRevisionNo': 1, 'dataJson': {'name': 'Should remain unchanged'}}, expected=403)
        self.assertEqual(result['error'], 'FORM_UNAVAILABLE')
        review = self.api('POST', '/records/' + record['record']['id'] + '/review', {'status': 'APPROVED',
            'expectedRevisionNo': 1, 'expectedReviewVersion': 0}, expected=403)
        self.assertEqual(review['error'], 'FORM_UNAVAILABLE')
        self.api('GET', '/records/' + record['record']['id'] + '/history', user='outsider', expected=403)
        self.assertEqual(self.api('GET', '/records/' + record['record']['id'])['record']['currentRevisionNo'], 1)

    def test_14_numeric_roundtrip_preserves_readonly_value_and_publication(self):
        form = self.new_form({'fields': [{'key': 'code', 'label': 'Code', 'type': 'text'},
            {'key': 'fixed', 'label': 'Fixed quantity', 'type': 'number', 'readOnly': True, 'defaultValue': 1.0}]}, [self.external_rule()])
        original = self.record(form, {'code': 'ROUNDTRIP', 'fixed': 1.0})
        output = self.publish(original)
        echoed = self.edit(original, {'code': 'ROUNDTRIP', 'fixed': 1})
        self.assertEqual(echoed['revision']['dataHash'], original['revision']['dataHash'])
        self.assertEqual(self.publish(echoed)['id'], output['id'])
        self.assertEqual(sql("SELECT status FROM PpmTraceOutput WHERE id='" + output['id'] + "'"), 'PUBLISHED')

    def test_15_large_history_uses_byte_bound_and_cursor_without_skips(self):
        form = self.new_form({'fields': [{'key': 'name', 'label': 'Name', 'type': 'text'},
            {'key': 'rows', 'label': 'Rows', 'type': 'table', 'maxRows': 100,
             'fields': [{'key': 'note', 'label': 'Note', 'type': 'text'}]}]})
        values = {'name': 'Revision 1', 'rows': [{'note': 'x' * 12000} for _ in range(100)]}
        record = self.record(form, values)
        for revision in range(2, 6):
            values['name'] = 'Revision ' + str(revision)
            record = self.edit(record, values)
        self.assertEqual(record['historyTotal'], 5)
        self.assertTrue(record['historyHasMore'])
        self.assertEqual(record['revisions'], [])
        self.assertEqual(len(record['revision']['dataJson']['rows']), 100)
        seen = []
        cursor = None
        while True:
            path = '/records/' + record['record']['id'] + '/history?limit=100'
            if cursor is not None:
                path += '&beforeRevisionNo=' + str(cursor)
            page = self.api('GET', path)
            self.assertEqual(len(page['items']), 1, 'Each large record should exceed the default multi-item page budget.')
            self.assertEqual(page['total'], 5)
            seen.extend(item['revisionNo'] for item in page['items'])
            if not page['hasMore']:
                self.assertIsNone(page['nextBeforeRevisionNo'])
                break
            cursor = page['nextBeforeRevisionNo']
            self.assertEqual(cursor, seen[-1])
            self.assertLess(len(seen), 6)
        self.assertEqual(seen, [5, 4, 3, 2, 1])
        second = self.record(form, values)
        listed = self.api('GET', '/records?formId=' + form['form'] + '&limit=100')
        self.assertTrue(listed['summary'])
        self.assertEqual(len(listed['items']), 2)
        self.assertTrue(all('dataJson' not in item['revision'] for item in listed['items']))
        first_page = self.api('GET', '/records?formId=' + form['form'] + '&summary=false&limit=100')
        self.assertEqual(len(first_page['items']), 1)
        self.assertTrue(first_page['hasMore'])
        self.assertEqual(first_page['nextOffset'], 1)
        next_page = self.api('GET', '/records?formId=' + form['form'] + '&summary=false&limit=100&offset=' + str(first_page['nextOffset']))
        self.assertFalse(next_page['hasMore'])
        self.assertEqual({item['record']['id'] for item in first_page['items'] + next_page['items']},
            {record['record']['id'], second['record']['id']})


if __name__ == '__main__':
    unittest.main(argv=[__file__] + TEST_ARGS, verbosity=2)
