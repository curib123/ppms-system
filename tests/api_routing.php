<?php
/** Controller contract checks without a database; integration tests cover services. */
define('BASEPATH', __DIR__.'/../system/');
require __DIR__.'/../application/libraries/Ppms_values.php';

class CI_Controller
{
    public $input, $output, $load, $ppms_store;
    public $ppms_auth_service, $ppms_device_service, $ppms_form_service;
    public $ppms_template_service, $ppms_sync_service, $ppms_record_service;
    public $ppms_trace_service, $ppms_pull_service, $ppms_workflow_service;
}

function log_message($level, $message) { $GLOBALS['api_logs'][] = array($level, $message); }
require __DIR__.'/../application/controllers/Api.php';

class RoutingInput
{
    public $verb, $headers, $raw_input_stream;
    public function method($uppercase) { return $this->verb; }
    public function get_request_header($name) { return $this->headers[$name] ?? NULL; }
    public function ip_address() { return '127.0.0.9'; }
}

class RoutingOutput
{
    public $status, $headers = array(), $type, $body;
    public function set_status_header($status) { $this->status = $status; return $this; }
    public function set_header($header) { $this->headers[] = $header; return $this; }
    public function set_content_type($type) { $this->type = $type; return $this; }
    public function set_output($body) { $this->body = $body; return $this; }
}

class RoutingService
{
    private $name, $loader;
    public function __construct($name, $loader) { $this->name = $name; $this->loader = $loader; }
    public function __call($method, $arguments)
    {
        $call = $this->name.'.'.$method;
        $this->loader->calls[] = array($call, $arguments);
        if ($this->loader->failure && $this->loader->failure[0] === $call) { throw $this->loader->failure[1]; }
        if ($call === 'ppms_auth_service.authenticate') {
            if ($arguments[0] !== 'Bearer controller-test') { throw new Ppms_problem('UNAUTHENTICATED', 401); }
            return array('id' => 'actor');
        }
        // credential() records transport credentials; lease checks belong to the real service.
        if ($call === 'ppms_device_service.credential') { return; }
        return array('service' => $this->name, 'method' => $method, 'arguments' => $arguments);
    }
}

class RoutingStore
{
    public function rows($sql)
    {
        routingEquals("SELECT id,code,name FROM ProductionArea WHERE status='ACTIVE' ORDER BY code", $sql, 'Active area query');
        return array(array('id' => 'area-1', 'code' => 'A', 'name' => 'Area'));
    }
}

class RoutingLoader
{
    public $calls = array(), $failure;
    private $controller, $transitive;
    public function __construct($controller, $transitive) { $this->controller = $controller; $this->transitive = $transitive; }
    public function library($name)
    {
        if ($this->controller->$name) { return; }
        $this->controller->$name = new RoutingService($name, $this);
        // Compatibility mode characterizes the original eager, transitive loading.
        // The normal run provides only explicitly requested controller dependencies.
        if ($this->transitive && $name === 'ppms_auth_service') { $this->model('Ppms_store_model', 'ppms_store'); }
        if ($this->transitive && $name === 'ppms_sync_service') {
            $this->library('ppms_record_service');
            $this->library('ppms_trace_service');
        }
    }
    public function model($name, $alias)
    {
        routingEquals('Ppms_store_model', $name, 'Area model');
        routingEquals('ppms_store', $alias, 'Area model alias');
        $this->controller->$alias = new RoutingStore();
    }
}

$GLOBALS['routing_checks'] = 0;
function routingEquals($expected, $actual, $label)
{
    $GLOBALS['routing_checks']++;
    if ($expected !== $actual) {
        throw new RuntimeException($label.': expected '.json_encode($expected).', got '.json_encode($actual));
    }
}

function routingRequest($verb, $path, $input = array(), $options = array())
{
    $controller = new Api();
    $controller->input = new RoutingInput();
    $controller->input->verb = $verb;
    $controller->input->headers = array_replace(array('Content-Type' => 'application/json', 'Authorization' => 'Bearer controller-test'), $options['headers'] ?? array());
    $controller->input->raw_input_stream = $options['raw'] ?? json_encode((object) $input);
    $controller->output = new RoutingOutput();
    $controller->load = new RoutingLoader($controller, in_array('--allow-transitive', $GLOBALS['argv'], TRUE));
    $controller->load->failure = $options['failure'] ?? NULL;
    $parts = explode('/', $path);
    $controller->_remap(array_shift($parts), $parts);
    routingEquals('application/json', $controller->output->type, $verb.' '.$path.' response type');
    routingEquals(array('Cache-Control: no-store', 'X-Content-Type-Options: nosniff'), $controller->output->headers, $verb.' '.$path.' response headers');
    return array($controller->output->status, json_decode($controller->output->body, TRUE, 64, JSON_THROW_ON_ERROR), $controller->load->calls);
}

function routingProblem($verb, $path, $status, $error, $options = array(), $input = array())
{
    $response = routingRequest($verb, $path, $input, $options);
    routingEquals($status, $response[0], $verb.' '.$path.' problem status');
    routingEquals($error, $response[1]['error'], $verb.' '.$path.' problem code');
    return $response;
}

$actor = array('id' => 'actor');
$payload = array('marker' => 'Unicode µ / value');
// Public URLs, verbs, owning service operations and positional arguments.
$routes = array(
    array('GET', 'me', 'auth', 'publicUser', array($actor)),
    array('POST', 'auth/logout', 'auth', 'logout', array($actor)),
    array('POST', 'devices', 'device', 'register', array($actor, $payload)),
    array('POST', 'devices/device-1/revoke', 'device', 'revoke', array($actor, 'device-1', $payload)),
    array('POST', 'devices/device-1/credentials', 'device', 'rotateCredential', array($actor, 'device-1', $payload)),
    array('GET', 'forms', 'form', 'listing', array($actor)),
    array('POST', 'forms', 'form', 'create', array($actor, $payload)),
    array('PUT', 'forms/form-1/areas/area-1', 'form', 'assignArea', array($actor, 'form-1', 'area-1', $payload)),
    array('PUT', 'forms/form-1/lease', 'device', 'assignLease', array($actor, 'form-1', $payload)),
    array('PUT', 'forms/form-1/access/user-1', 'device', 'assignUser', array($actor, 'form-1', 'user-1', $payload)),
    array('POST', 'sync/grants', 'device', 'grant', array($actor, $payload)),
    array('GET', 'forms/form-1/templates', 'template', 'versions', array($actor, 'form-1')),
    array('POST', 'forms/form-1/templates', 'template', 'create', array($actor, 'form-1', $payload)),
    array('PATCH', 'templates/template-1', 'template', 'update', array($actor, 'template-1', $payload)),
    array('POST', 'templates/template-1/publish', 'template', 'publish', array($actor, 'template-1')),
    array('POST', 'sync/batches', 'sync', 'push', array($actor, $payload)),
    array('GET', 'records/record-1', 'record', 'view', array($actor, 'record-1')),
    array('GET', 'forms/form-1/revalidations', 'record', 'revalidations', array($actor, 'form-1')),
    array('PUT', 'templates/template-1/rules', 'trace', 'rules', array($actor, 'template-1', $payload)),
    array('PUT', 'forms/form-1/connections', 'trace', 'connection', array($actor, 'form-1', $payload)),
    array('POST', 'records/record-1/publish', 'trace', 'publish', array($actor, 'record-1', $payload)),
    array('POST', 'records/record-1/corrections', 'record', 'correct', array($actor, 'record-1', $payload)),
    array('POST', 'sync/bootstrap', 'pull', 'bootstrap', array($actor, $payload)),
    array('POST', 'sync/pull', 'pull', 'pull', array($actor, $payload)),
    array('POST', 'sync/ack', 'pull', 'acknowledge', array($actor, $payload)),
    array('POST', 'records/record-1/review', 'workflow', 'review', array($actor, 'record-1', $payload)),
    array('POST', 'revalidations/items/item-1/resolve', 'workflow', 'resolveItem', array($actor, 'item-1', $payload))
);

foreach ($routes as $route) {
    list($verb, $path, $service, $operation, $arguments) = $route;
    $response = routingRequest($verb, $path, $payload);
    routingEquals(200, $response[0], $verb.' '.$path.' status');
    routingEquals(array('service' => 'ppms_'.$service.'_service', 'method' => $operation, 'arguments' => $arguments), $response[1], $verb.' '.$path.' dispatch');
    // Ending anchors, segment boundaries and unsupported verbs remain 404s.
    foreach (array($path.'/', $path.'/extra') as $invalid) { routingProblem($verb, $invalid, 404, 'ENDPOINT_NOT_FOUND'); }
    foreach (array('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS') as $unsupported) {
        $supported = FALSE;
        foreach ($routes as $candidate) { if ($candidate[1] === $path && $candidate[0] === $unsupported) { $supported = TRUE; } }
        if (!$supported) { routingProblem($unsupported, $path, 404, 'ENDPOINT_NOT_FOUND'); }
    }
}

$areas = routingRequest('GET', 'areas');
routingEquals(200, $areas[0], 'Areas status');
routingEquals(array('items' => array(array('id' => 'area-1', 'code' => 'A', 'name' => 'Area'))), $areas[1], 'Areas response');
routingProblem('POST', 'areas', 404, 'ENDPOINT_NOT_FOUND');
foreach (array('forms//templates', 'records/', 'devices//revoke', 'forms/f/areas/', 'revalidations/items//resolve') as $invalid) {
    routingProblem('POST', $invalid, 404, 'ENDPOINT_NOT_FOUND');
}
routingProblem('POST', "devices/device-1/revoke\n", 404, 'ENDPOINT_NOT_FOUND');
// An ID is any non-slash sequence, including a final newline; do not tighten it.
$unusualId = routingRequest('GET', "records/record-1\n");
routingEquals(200, $unusualId[0], 'Original non-slash ID expression');
routingEquals(array($actor, "record-1\n"), $unusualId[1]['arguments'], 'Original ID is forwarded unchanged');

$login = routingRequest('POST', 'auth/login', $payload, array('headers' => array('Authorization' => NULL)));
routingEquals(200, $login[0], 'Anonymous login status');
routingEquals(array('service' => 'ppms_auth_service', 'method' => 'login', 'arguments' => array($payload, '127.0.0.9')), $login[1], 'Login bypasses authentication');
routingProblem('POST', 'unknown', 415, 'JSON_CONTENT_TYPE_REQUIRED', array('headers' => array('Content-Type' => 'text/plain', 'Authorization' => NULL)));
routingProblem('POST', 'auth/login', 400, 'INVALID_JSON', array('raw' => '{'));
routingProblem('PATCH', 'unknown', 400, 'INVALID_JSON', array('raw' => '{', 'headers' => array('Authorization' => NULL)));
routingProblem('PUT', 'unknown', 413, 'PAYLOAD_TOO_LARGE', array('raw' => str_repeat('x', 2 * 1024 * 1024 + 1), 'headers' => array('Authorization' => NULL)));
routingProblem('POST', 'unknown', 422, 'JSON_OBJECT_REQUIRED', array('raw' => '[]', 'headers' => array('Authorization' => NULL)));
routingProblem('GET', 'unknown', 401, 'UNAUTHENTICATED', array('headers' => array('Authorization' => NULL)));
routingProblem('POST', 'unknown', 401, 'UNAUTHENTICATED', array('headers' => array('Authorization' => NULL)), array('deviceId' => 'device-1'));
routingProblem('POST', 'unknown', 404, 'ENDPOINT_NOT_FOUND', array(), array('deviceId' => 'device-1'));
$charset = routingRequest('POST', 'auth/login', $payload, array('headers' => array('Content-Type' => 'Application/JSON; charset=utf-8')));
routingEquals(200, $charset[0], 'JSON media type parameters');

$deviceInput = array('deviceId' => 'device-1');
$credentialOptions = array('headers' => array('X-PPMS-Device-Token' => 'transport-token'));
foreach (array('unknown', 'forms', 'sync/batches') as $path) {
    $response = routingRequest('POST', $path, $deviceInput, $credentialOptions);
    routingEquals(array('ppms_auth_service.authenticate', array('Bearer controller-test')), $response[2][0], 'Authentication before credentials');
    routingEquals(array('ppms_device_service.credential', array('device-1', 'transport-token')), $response[2][1], 'Credential transport before '.$path);
}
foreach (array(array('GET', 'me'), array('POST', 'auth/logout'), array('POST', 'auth/login')) as $early) {
    $response = routingRequest($early[0], $early[1], $deviceInput);
    routingEquals(200, $response[0], 'Early auth endpoint');
    foreach ($response[2] as $call) { routingEquals(FALSE, $call[0] === 'ppms_device_service.credential', 'Auth endpoint skips device credentials'); }
}
$nullDevice = routingRequest('POST', 'unknown', array('deviceId' => NULL));
routingEquals(1, count($nullDevice[2]), 'Null device ID follows isset semantics');

$failure = array('failure' => array('ppms_form_service.create', new Ppms_problem('SPECIFIC_ERROR', 409, array('field' => 'value'))));
$problem = routingProblem('POST', 'forms', 409, 'SPECIFIC_ERROR', $failure);
routingEquals(array('field' => 'value'), $problem[1]['details'], 'Problem details survive boundary');
$GLOBALS['api_logs'] = array();
$unavailable = routingProblem('POST', 'forms', 503, 'SERVICE_UNAVAILABLE', array('failure' => array('ppms_form_service.create', new RuntimeException('secret database text', 42))));
routingEquals(array('error' => 'SERVICE_UNAVAILABLE'), $unavailable[1], 'Unexpected exceptions remain private');
routingEquals(array(array('error', 'PPMS API failure: RuntimeException code 42')), $GLOBALS['api_logs'], 'Unexpected exception log omits sensitive text');

echo 'API routing checks passed: '.$GLOBALS['routing_checks']." assertions.\n";
