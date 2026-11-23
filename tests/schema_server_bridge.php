<?php
/** CLI-only parity harness: synthetic cases from stdin, no database access. */
if (PHP_SAPI !== 'cli') { http_response_code(404); exit(1); }
define('BASEPATH', __DIR__.'/../system/');
require_once __DIR__.'/../application/libraries/Ppms_form_validator.php';
require_once __DIR__.'/../application/libraries/Ppms_form_engine.php';
$cases = json_decode(stream_get_contents(STDIN), FALSE, 64, JSON_THROW_ON_ERROR);
$validator = new Ppms_form_validator();
$results = array();
foreach ($cases as $case) {
    $fields = $validator->fields($case->definition);
    $engine = new Ppms_form_engine();
    $prepared = $engine->prepare($fields, $case->data);
    $conditions = array();
    foreach ($case->conditions ?? array() as $rule) {
        $conditions[] = $engine->condition($rule, $prepared, $prepared);
    }
    $results[] = array('data' => $prepared, 'conditions' => $conditions);
}
echo json_encode($results, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION);
