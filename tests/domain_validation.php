<?php
define('BASEPATH', __DIR__.'/../system/');
require __DIR__.'/../application/libraries/Ppms_form_validator.php';
require __DIR__.'/../application/libraries/Ppms_trace_service.php';
$validator = new Ppms_form_validator();
$checks = 0;
function check($value, $message) { global $checks; $checks++; if (!$value) { throw new RuntimeException($message); } }
function reject($callback, $code) {
    try { $callback(); } catch (Ppms_problem $error) { check($error->getMessage() === $code, 'Expected '.$code.', received '.$error->getMessage()); return; }
    throw new RuntimeException('Expected '.$code);
}
function obj($value) { return json_decode(json_encode($value)); }
$schema = obj(array('schemaVersion' => 2, 'sections' => array(
    array('key' => 'header', 'items' => array(array('key'=>'kind','label'=>'Kind','type'=>'select','options'=>array('SALE','SAMPLE')), array('key'=>'quantity','label'=>'Header quantity','type'=>'number'))),
    array('key' => 'main', 'items' => array(array('key'=>'rows','label'=>'Rows','type'=>'table','maxRows'=>1000,'fields'=>array(
        array('key'=>'quantity','label'=>'Quantity','type'=>'number','required'=>TRUE),
        array('key'=>'price','label'=>'Price','type'=>'number','requiredWhen'=>array('path'=>'kind','operator'=>'eq','value'=>'SALE')),
        array('key'=>'amount','label'=>'Amount','type'=>'number','calculation'=>array('op'=>'multiply','args'=>array(array('path'=>'quantity'),array('path'=>'price')))),
        array('key'=>'note','label'=>'Note','type'=>'text','required'=>TRUE,'visibleWhen'=>array('path'=>'quantity','operator'=>'gt','value'=>10))
    )))),
    array('key' => 'summary', 'items' => array(
        array('key'=>'total','label'=>'Total','type'=>'number','calculation'=>array('op'=>'sum','path'=>'rows[].amount')),
        array('key'=>'count','label'=>'Count','type'=>'integer','calculation'=>array('op'=>'count','path'=>'rows')),
        array('key'=>'average','label'=>'Average','type'=>'number','calculation'=>array('op'=>'divide','args'=>array(array('path'=>'total'),array('path'=>'count'))))
    ))
)));
$result = $validator->payload($schema, obj(array('kind'=>'SALE','quantity'=>99,'rows'=>array(array('quantity'=>2,'price'=>3,'amount'=>999),array('quantity'=>4,'price'=>5)), 'total'=>999)), TRUE);
check($result->total === 26 && $result->count === 2 && $result->average == 13, 'Server did not recompute row and summary dependencies.');
check($result->rows[0]->amount === 6, 'Forged calculated value was retained.');
$partial = $validator->payload($schema, obj(array('kind'=>'SALE','quantity'=>99,'rows'=>array(array('price'=>3)))), FALSE);
check($partial->rows[0]->amount === NULL, 'Missing row quantity incorrectly inherited header quantity.');
reject(function () use ($validator,$schema) { $validator->payload($schema,obj(array('kind'=>'SALE','rows'=>array(array('quantity'=>1)))),TRUE); }, 'REQUIRED_FIELD');
$validator->payload($schema,obj(array('kind'=>'SAMPLE','rows'=>array(array('quantity'=>1)))),TRUE); $checks++;
reject(function () use ($validator,$schema) { $validator->payload($schema,obj(array('kind'=>'SAMPLE','rows'=>array(array('quantity'=>11)))),TRUE); }, 'REQUIRED_FIELD');
$empty = $validator->payload($schema,obj(array('rows'=>array())),FALSE);
check($empty->total === 0 && $empty->count === 0 && $empty->average === NULL, 'Empty summaries have incorrect values.');
$cycle = obj(array('fields'=>array(array('key'=>'a','label'=>'A','type'=>'number','calculation'=>array('path'=>'b')),array('key'=>'b','label'=>'B','type'=>'number','calculation'=>array('path'=>'a')))));
reject(function () use ($validator,$cycle) { $validator->definition($cycle); }, 'CALCULATION_CYCLE');
$missing = obj(array('fields'=>array(array('key'=>'a','label'=>'A','type'=>'number','calculation'=>array('path'=>'absent')))));
reject(function () use ($validator,$missing) { $validator->definition($missing); }, 'EXPRESSION_FIELD_NOT_DEFINED');
$engine = (new Ppms_form_engine())->compile(array((object) array('key'=>'n','label'=>'N','type'=>'number')));
check($engine->condition((object) array('path'=>'n','operator'=>'eq','value'=>1), (object) array('n'=>1.0), (object) array('n'=>1.0)), 'Equivalent JSON numbers differ in a condition.');
check(!$engine->condition((object) array('path'=>'n','operator'=>'eq','value'=>'1'), (object) array('n'=>1), (object) array('n'=>1)), 'Numeric string was coerced by a condition.');
$protected = obj(array('fields'=>array(array('key'=>'sample','label'=>'Sample','type'=>'group','fields'=>array(array('key'=>'reference','label'=>'Reference','type'=>'text','readOnly'=>TRUE,'defaultValue'=>'LOCKED'))))));
$previous = obj(array('sample'=>array('reference'=>'LOCKED')));
reject(function () use ($validator,$protected,$previous) { $validator->payload($protected,new stdClass(),FALSE,$previous); }, 'READ_ONLY_FIELD');
reject(function () use ($validator,$protected,$previous) { $validator->payload($protected,obj(array('sample'=>array('reference'=>'changed'))),FALSE,$previous); }, 'READ_ONLY_FIELD');
$table = obj(array('fields'=>array(array('key'=>'rows','label'=>'Rows','type'=>'table','fields'=>array(array('key'=>'reference','label'=>'Reference','type'=>'text','readOnly'=>TRUE))))));
reject(function () use ($validator,$table) { $validator->payload($table,obj(array('rows'=>array())),FALSE,obj(array('rows'=>array(array('reference'=>'fixed'))))); }, 'READ_ONLY_FIELD');
$table->fields[0]->allowRemoval = TRUE;
$validator->payload($table,obj(array('rows'=>array())),FALSE,obj(array('rows'=>array(array('reference'=>'fixed'))))); $checks++;
$validator->payload($table,obj(array('rows'=>array(array('reference'=>'second')))),FALSE,obj(array('rows'=>array(array('reference'=>'first'),array('reference'=>'second'))))); $checks++;
reject(function () use ($validator,$table) { $validator->payload($table,obj(array('rows'=>array(array('reference'=>'invented')))),FALSE,obj(array('rows'=>array(array('reference'=>'first'),array('reference'=>'second'))))); }, 'READ_ONLY_FIELD');
reject(function () use ($validator) { $validator->definition(obj(array('fields'=>array(array('key'=>'constructor','label'=>'Unsafe','type'=>'text'))))); }, 'DUPLICATE_OR_INVALID_FIELD_KEY');
$datetime = obj(array('fields'=>array(array('key'=>'at','label'=>'At','type'=>'datetime'))));
foreach (array('2026-11-23T12:00:00+99:99','2026-11-23T12:00:00+14:01','2026-11-23T12:00:00-25:00','2026-02-30T12:00:00Z') as $value) {
    reject(function () use ($validator,$datetime,$value) { $validator->payload($datetime,obj(array('at'=>$value))); }, 'INVALID_DATETIME');
}
$validator->payload($datetime,obj(array('at'=>'2026-11-23T12:00:00+14:00'))); $checks++;
foreach (array('BATCH-2026-001','2026-A','0007') as $batch) { check(Ppms_values::decode(array('batchNo'=>$batch))['batchNo'] === $batch, 'Text batch number was cast.'); }
$reflection = new ReflectionClass(Ppms_trace_service::class);
$trace = $reflection->newInstanceWithoutConstructor();
$property = $reflection->getProperty('validator'); $property->setValue($trace,$validator);
$rule = array('status'=>'ACTIVE','sourceType'=>'SYSTEM_GENERATED','outputKey'=>'lot','formulaTemplate'=>'LOT-{{missingField}}','configurationJson'=>new stdClass());
reject(function () use ($trace,$rule,$datetime) { $trace->validateRule($rule,$datetime); }, 'TRACE_BINDING_FIELD_NOT_DEFINED');
$rule['formulaTemplate'] = 'LOT-{{record.batchNo}}-{{sequence}}';
$trace->validateRule($rule,$datetime); $checks++;
$nested = obj(array('fields'=>array(array('key'=>'groups','label'=>'Groups','type'=>'table','fields'=>array(
    array('key'=>'lots','label'=>'Lots','type'=>'table','fields'=>array(array('key'=>'code','label'=>'Code','type'=>'text'),array('key'=>'quantity','label'=>'Quantity','type'=>'number'))),
    array('key'=>'samples','label'=>'Samples','type'=>'table','fields'=>array(array('key'=>'quantity','label'=>'Quantity','type'=>'number')))
)))));
$nestedRule = array('status'=>'ACTIVE','sourceType'=>'MANUAL_EXTERNAL','outputKey'=>'lot','configurationJson'=>obj(array('outputPath'=>'groups[].lots[].code','quantityPath'=>'groups[].samples[].quantity')));
reject(function () use ($trace,$nestedRule,$nested) { $trace->validateRule($nestedRule,$nested); }, 'TRACE_BINDING_FIELD_NOT_DEFINED');
$nestedRule['configurationJson']->quantityPath = 'groups[].lots[].quantity';
$trace->validateRule($nestedRule,$nested); $checks++;
$nestedRule['configurationJson']->outputFormat = 'YYYYMMDD';
reject(function () use ($trace,$nestedRule,$nested) { $trace->validateRule($nestedRule,$nested); }, 'TRACE_DATE_FIELD_REQUIRED');
$literal = array('status'=>'ACTIVE','sourceType'=>'SYSTEM_GENERATED','outputKey'=>'lot','formulaTemplate'=>'LOT-{{date}}','configurationJson'=>obj(array('bindings'=>array('date'=>array('source'=>'LITERAL','value'=>'invalid-date','dateOffsetDays'=>1)))));
reject(function () use ($trace,$literal,$datetime) { $trace->validateRule($literal,$datetime); }, 'INVALID_DATE');
$input = stream_get_contents(STDIN);
$templates = $input === '' ? array() : json_decode($input,TRUE,64,JSON_THROW_ON_ERROR);
foreach ($templates as $template) {
    $definition = obj($template['definitionJson']);
    $validator->definition($definition); $checks++;
    foreach ($template['rules'] ?? array() as $row) { $row['configurationJson'] = obj($row['configurationJson']); $trace->validateRule($row,$definition); $checks++; }
}
echo json_encode(array('status'=>'passed','checks'=>$checks,'templates'=>count($templates)),JSON_THROW_ON_ERROR).PHP_EOL;
