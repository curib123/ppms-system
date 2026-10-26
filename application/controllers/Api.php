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
        if ($method === 'POST' && preg_match('#^(records/[^/]+/review|revalidations/items/[^/]+/resolve)$#D', $path)
            && $this->input->get_request_header('X-PPMS-Device-Token') !== NULL
            && !array_key_exists('deviceId', $input) && !array_key_exists('leaseVersion', $input)) {
            throw new Ppms_problem('DEVICE_CONTEXT_REQUIRED', 400);
        }
        if (isset($input['deviceId'])) {
            $this->load->library('ppms_device_service');
            $this->ppms_device_service->credential($input['deviceId'], $this->input->get_request_header('X-PPMS-Device-Token'));
        }
        $resource = explode('/', $path, 2)[0];
        switch ($resource) {
            case 'devices': return $this->devices($method, $path, $actor, $input);
            case 'forms':
            case 'areas': return $this->forms($method, $path, $actor, $input);
            case 'templates': return $this->templates($method, $path, $actor, $input);
            case 'records': return $this->records($method, $path, $actor, $input);
            case 'sync': return $this->synchronization($method, $path, $actor, $input);
            case 'revalidations': return $this->revalidations($method, $path, $actor, $input);
        }
        throw new Ppms_problem('ENDPOINT_NOT_FOUND', 404);
    }

    private function devices($method, $path, $actor, $input)
    {
        if ($method === 'POST' && $path === 'devices') {
            $this->load->library('ppms_device_service');
            return $this->ppms_device_service->register($actor, $input);
        }
        if ($method === 'POST' && preg_match('#^devices/([^/]+)/revoke$#D', $path, $match)) {
            $this->load->library('ppms_device_service');
            return $this->ppms_device_service->revoke($actor, $match[1], $input);
        }
        if ($method === 'POST' && preg_match('#^devices/([^/]+)/credentials$#D', $path, $match)) {
            $this->load->library('ppms_device_service');
            return $this->ppms_device_service->rotateCredential($actor, $match[1], $input);
        }
        throw new Ppms_problem('ENDPOINT_NOT_FOUND', 404);
    }

    private function forms($method, $path, $actor, $input)
    {
        if ($path === 'forms') {
            if ($method === 'GET') {
                $this->load->library('ppms_form_service');
                return $this->ppms_form_service->listing($actor);
            }
            if ($method === 'POST') {
                $this->load->library('ppms_form_service');
                return $this->ppms_form_service->create($actor, $input);
            }
        }
        if ($method === 'GET' && $path === 'areas') {
            $this->load->model('Ppms_store_model', 'ppms_store');
            return array('items' => $this->ppms_store->rows('SELECT id,code,name FROM ProductionArea WHERE status=\'ACTIVE\' ORDER BY code'));
        }
        if ($method === 'PUT' && preg_match('#^forms/([^/]+)/areas/([^/]+)$#D', $path, $match)) {
            $this->load->library('ppms_form_service');
            return $this->ppms_form_service->assignArea($actor, $match[1], $match[2], $input);
        }
        if ($method === 'PUT' && preg_match('#^forms/([^/]+)/lease$#D', $path, $match)) {
            $this->load->library('ppms_device_service');
            return $this->ppms_device_service->assignLease($actor, $match[1], $input);
        }
        if ($method === 'PUT' && preg_match('#^forms/([^/]+)/access/([^/]+)$#D', $path, $match)) {
            $this->load->library('ppms_device_service');
            return $this->ppms_device_service->assignUser($actor, $match[1], $match[2], $input);
        }
        if (preg_match('#^forms/([^/]+)/templates$#D', $path, $match)) {
            if ($method === 'GET') {
                $this->load->library('ppms_template_service');
                return $this->ppms_template_service->versions($actor, $match[1]);
            }
            if ($method === 'POST') {
                $this->load->library('ppms_template_service');
                return $this->ppms_template_service->create($actor, $match[1], $input);
            }
        }
        if ($method === 'GET' && preg_match('#^forms/([^/]+)/revalidations$#D', $path, $match)) {
            $this->load->library('ppms_record_service');
            return $this->ppms_record_service->revalidations($actor, $match[1]);
        }
        if ($method === 'PUT' && preg_match('#^forms/([^/]+)/connections$#D', $path, $match)) {
            $this->load->library('ppms_trace_service');
            return $this->ppms_trace_service->connection($actor, $match[1], $input);
        }
        throw new Ppms_problem('ENDPOINT_NOT_FOUND', 404);
    }

    private function templates($method, $path, $actor, $input)
    {
        if ($method === 'PATCH' && preg_match('#^templates/([^/]+)$#D', $path, $match)) {
            $this->load->library('ppms_template_service');
            return $this->ppms_template_service->update($actor, $match[1], $input);
        }
        if ($method === 'POST' && preg_match('#^templates/([^/]+)/publish$#D', $path, $match)) {
            $this->load->library('ppms_template_service');
            return $this->ppms_template_service->publish($actor, $match[1]);
        }
        if ($method === 'PUT' && preg_match('#^templates/([^/]+)/rules$#D', $path, $match)) {
            $this->load->library('ppms_trace_service');
            return $this->ppms_trace_service->rules($actor, $match[1], $input);
        }
        throw new Ppms_problem('ENDPOINT_NOT_FOUND', 404);
    }

    private function records($method, $path, $actor, $input)
    {
        if ($method === 'GET' && preg_match('#^records/([^/]+)$#D', $path, $match)) {
            $this->load->library('ppms_record_service');
            return $this->ppms_record_service->view($actor, $match[1]);
        }
        if ($method === 'POST' && preg_match('#^records/([^/]+)/publish$#D', $path, $match)) {
            $this->load->library('ppms_trace_service');
            return $this->ppms_trace_service->publish($actor, $match[1], $input);
        }
        if ($method === 'POST' && preg_match('#^records/([^/]+)/corrections$#D', $path, $match)) {
            $this->load->library('ppms_record_service');
            return $this->ppms_record_service->correct($actor, $match[1], $input);
        }
        if ($method === 'POST' && preg_match('#^records/([^/]+)/review$#D', $path, $match)) {
            $this->load->library('ppms_workflow_service');
            return $this->ppms_workflow_service->review($actor, $match[1], $input);
        }
        throw new Ppms_problem('ENDPOINT_NOT_FOUND', 404);
    }

    private function synchronization($method, $path, $actor, $input)
    {
        if ($method === 'POST' && $path === 'sync/grants') {
            $this->load->library('ppms_device_service');
            return $this->ppms_device_service->grant($actor, $input);
        }
        if ($method === 'POST' && $path === 'sync/batches') {
            $this->load->library('ppms_sync_service');
            return $this->ppms_sync_service->push($actor, $input);
        }
        if ($method === 'POST' && $path === 'sync/bootstrap') {
            $this->load->library('ppms_pull_service');
            return $this->ppms_pull_service->bootstrap($actor, $input);
        }
        if ($method === 'POST' && $path === 'sync/pull') {
            $this->load->library('ppms_pull_service');
            return $this->ppms_pull_service->pull($actor, $input);
        }
        if ($method === 'POST' && $path === 'sync/ack') {
            $this->load->library('ppms_pull_service');
            return $this->ppms_pull_service->acknowledge($actor, $input);
        }
        throw new Ppms_problem('ENDPOINT_NOT_FOUND', 404);
    }

    private function revalidations($method, $path, $actor, $input)
    {
        if ($method === 'POST' && preg_match('#^revalidations/items/([^/]+)/resolve$#D', $path, $match)) {
            $this->load->library('ppms_workflow_service');
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
