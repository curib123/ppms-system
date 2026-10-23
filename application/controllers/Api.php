<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** JSON-only, bearer-authenticated entry point; services own business rules. */
class Api extends CI_Controller
{
    public function _remap($resource, $segments = array())
    {
        try {
            $this->load->library('ppms_auth_service');
            $method = $this->input->method(TRUE);
            $path = $resource.($segments ? '/'.implode('/', $segments) : '');
            $input = array();
            if (in_array($method, array('POST', 'PUT', 'PATCH'), TRUE)) {
                if (stripos((string) $this->input->get_request_header('Content-Type'), 'application/json') !== 0) {
                    throw new Ppms_problem('JSON_CONTENT_TYPE_REQUIRED', 415);
                }
                $raw = $this->input->raw_input_stream;
                if (strlen($raw) > 2 * 1024 * 1024) { throw new Ppms_problem('PAYLOAD_TOO_LARGE', 413); }
                try { $input = (array) Ppms_values::object(json_decode($raw, FALSE, 64, JSON_THROW_ON_ERROR)); }
                catch (JsonException $error) { throw new Ppms_problem('INVALID_JSON', 400); }
            }
            if ($method === 'POST' && $path === 'auth/login') {
                $result = $this->ppms_auth_service->login($input, $this->input->ip_address());
            } else {
                $actor = $this->ppms_auth_service->authenticate($this->input->get_request_header('Authorization'));
                $result = $this->dispatch($method, $path, $actor, $input);
            }
            $this->respond(200, $result);
        } catch (Ppms_problem $error) {
            $this->respond($error->status, array('error' => $error->getMessage(), 'details' => (object) $error->details));
        } catch (Throwable $error) {
            // SQL errors can contain credentials or production data; expose neither.
            log_message('error', 'PPMS API failure: '.get_class($error).' code '.(int) $error->getCode());
            $this->respond(503, array('error' => 'SERVICE_UNAVAILABLE'));
        }
    }

    private function dispatch($method, $path, $actor, $input)
    {
        if ($method === 'GET' && $path === 'me') { return $this->ppms_auth_service->publicUser($actor); }
        if ($method === 'POST' && $path === 'auth/logout') { return $this->ppms_auth_service->logout($actor); }
        $this->load->library('ppms_device_service');
        if (isset($input['deviceId'])) {
            $this->ppms_device_service->credential($input['deviceId'], $this->input->get_request_header('X-PPMS-Device-Token'));
        }
        if ($method === 'POST' && $path === 'devices') { return $this->ppms_device_service->register($actor, $input); }
        if ($method === 'POST' && preg_match('#^devices/([^/]+)/revoke$#D', $path, $match)) {
            return $this->ppms_device_service->revoke($actor, $match[1], $input);
        }
        if ($method === 'POST' && preg_match('#^devices/([^/]+)/credentials$#D', $path, $match)) {
            return $this->ppms_device_service->rotateCredential($actor, $match[1], $input);
        }
        $this->load->library('ppms_form_service');
        if ($path === 'forms') {
            if ($method === 'GET') { return $this->ppms_form_service->listing($actor); }
            if ($method === 'POST') { return $this->ppms_form_service->create($actor, $input); }
        }
        if ($method === 'GET' && $path === 'areas') {
            return array('items' => $this->ppms_store->rows('SELECT id,code,name FROM ProductionArea WHERE status=\'ACTIVE\' ORDER BY code'));
        }
        if ($method === 'PUT' && preg_match('#^forms/([^/]+)/areas/([^/]+)$#D', $path, $match)) {
            return $this->ppms_form_service->assignArea($actor, $match[1], $match[2], $input);
        }
        if ($method === 'PUT' && preg_match('#^forms/([^/]+)/lease$#D', $path, $match)) {
            return $this->ppms_device_service->assignLease($actor, $match[1], $input);
        }
        if ($method === 'PUT' && preg_match('#^forms/([^/]+)/access/([^/]+)$#D', $path, $match)) {
            return $this->ppms_device_service->assignUser($actor, $match[1], $match[2], $input);
        }
        if ($method === 'POST' && $path === 'sync/grants') { return $this->ppms_device_service->grant($actor, $input); }
        $this->load->library('ppms_template_service');
        if (preg_match('#^forms/([^/]+)/templates$#D', $path, $match)) {
            if ($method === 'GET') { return $this->ppms_template_service->versions($actor, $match[1]); }
            if ($method === 'POST') { return $this->ppms_template_service->create($actor, $match[1], $input); }
        }
        if ($method === 'PATCH' && preg_match('#^templates/([^/]+)$#D', $path, $match)) {
            return $this->ppms_template_service->update($actor, $match[1], $input);
        }
        if ($method === 'POST' && preg_match('#^templates/([^/]+)/publish$#D', $path, $match)) {
            return $this->ppms_template_service->publish($actor, $match[1]);
        }
        $this->load->library('ppms_sync_service');
        if ($method === 'POST' && $path === 'sync/batches') { return $this->ppms_sync_service->push($actor, $input); }
        if ($method === 'GET' && preg_match('#^records/([^/]+)$#D', $path, $match)) {
            return $this->ppms_record_service->view($actor, $match[1]);
        }
        if ($method === 'GET' && preg_match('#^forms/([^/]+)/revalidations$#D', $path, $match)) {
            return $this->ppms_record_service->revalidations($actor, $match[1]);
        }
        if ($method === 'PUT' && preg_match('#^templates/([^/]+)/rules$#D', $path, $match)) {
            return $this->ppms_trace_service->rules($actor, $match[1], $input);
        }
        if ($method === 'PUT' && preg_match('#^forms/([^/]+)/connections$#D', $path, $match)) {
            return $this->ppms_trace_service->connection($actor, $match[1], $input);
        }
        if ($method === 'POST' && preg_match('#^records/([^/]+)/publish$#D', $path, $match)) {
            return $this->ppms_trace_service->publish($actor, $match[1], $input);
        }
        if ($method === 'POST' && preg_match('#^records/([^/]+)/corrections$#D', $path, $match)) {
            return $this->ppms_record_service->correct($actor, $match[1], $input);
        }
        $this->load->library('ppms_pull_service');
        if ($method === 'POST' && $path === 'sync/bootstrap') { return $this->ppms_pull_service->bootstrap($actor, $input); }
        if ($method === 'POST' && $path === 'sync/pull') { return $this->ppms_pull_service->pull($actor, $input); }
        if ($method === 'POST' && $path === 'sync/ack') { return $this->ppms_pull_service->acknowledge($actor, $input); }
        $this->load->library('ppms_workflow_service');
        if ($method === 'POST' && preg_match('#^records/([^/]+)/review$#D', $path, $match)) {
            return $this->ppms_workflow_service->review($actor, $match[1], $input);
        }
        if ($method === 'POST' && preg_match('#^revalidations/items/([^/]+)/resolve$#D', $path, $match)) {
            return $this->ppms_workflow_service->resolveItem($actor, $match[1], $input);
        }
        throw new Ppms_problem('ENDPOINT_NOT_FOUND', 404);
    }

    private function respond($status, $result)
    {
        $this->output->set_status_header($status)->set_header('Cache-Control: no-store')
            ->set_header('X-Content-Type-Options: nosniff')->set_content_type('application/json')
            ->set_output(json_encode($result, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }
}
