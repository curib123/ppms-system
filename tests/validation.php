<?php
define('BASEPATH', __DIR__.'/../system/');
require __DIR__.'/../application/libraries/Ppms_form_validator.php';
$validator = new Ppms_form_validator();
$definition = json_decode('{"fields":[{"key":"number","label":"Number","type":"number","required":true,"validation":{"min":0,"max":100}},{"key":"ok","label":"OK","type":"boolean","required":true},{"key":"choice","label":"Choice","type":"select","options":[{"value":"A","label":"A"}]},{"key":"date","label":"Date","type":"date"},{"key":"rows","label":"Rows","type":"repeatable","maxRows":2,"fields":[{"key":"n","label":"N","type":"integer","required":true}]}]}');
function expectProblem($work) {
    try { $work(); } catch (Ppms_problem $error) { return; }
    throw new RuntimeException('Invalid data was accepted.');
}
$validator->definition($definition);
$validator->payload($definition, (object) array('number' => 0, 'ok' => FALSE), TRUE);
$validator->payload($definition, new stdClass(), FALSE);
foreach (array('{"number":"2","ok":false}', '{"number":101,"ok":false}', '{"number":0}',
    '{"number":0,"ok":false,"extra":1}', '{"number":0,"ok":false,"choice":"B"}',
    '{"number":0,"ok":false,"date":"2026-02-30"}', '{"number":0,"ok":false,"date":[]}', '{"number":0,"ok":false,"rows":[{"n":1.5}]}') as $json) {
    expectProblem(function () use ($validator, $definition, $json) { $validator->payload($definition, json_decode($json), TRUE); });
}
expectProblem(function () use ($validator) { $validator->definition(json_decode('{"fields":[{"key":"x","label":"X","type":"text"},{"key":"x","label":"X","type":"text"}]}')); });
expectProblem(function () use ($validator) {
    $definition = json_decode('{"fields":[{"key":"rows","label":"Rows","type":"table","minRows":1,"fields":[{"key":"n","label":"N","type":"integer"}]}]}');
    $validator->payload($definition, (object) array('rows' => array()), TRUE);
});
expectProblem(function () use ($validator) { $validator->definition(json_decode('{"fields":[{"key":"n","label":"N","type":"number","defaultValue":"not a number"}]}')); });
expectProblem(function () use ($validator) { $validator->definition(json_decode('{"fields":[{"key":"source","label":"Source","type":"trace-code","defaultValue":"invented"}]}')); });
if (Ppms_values::hash(json_decode('{"a":1,"b":{"c":2,"d":3}}')) !== Ppms_values::hash(json_decode('{"b":{"d":3,"c":2},"a":1}'))) {
    throw new RuntimeException('Object key order changed a mutation identity.');
}
echo "Template validation checks passed.\n";
