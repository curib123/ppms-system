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
    '{"number":0,"ok":false,"date":"2026-02-30"}', '{"number":0,"ok":false,"rows":[{"n":1.5}]}') as $json) {
    expectProblem(function () use ($validator, $definition, $json) { $validator->payload($definition, json_decode($json), TRUE); });
}
expectProblem(function () use ($validator) { $validator->definition(json_decode('{"fields":[{"key":"x","label":"X","type":"text"},{"key":"x","label":"X","type":"text"}]}')); });
echo "Template validation checks passed.\n";
