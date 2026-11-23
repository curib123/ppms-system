<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';
require_once __DIR__.'/Ppms_form_engine.php';

/** Interpret versioned definitions rather than hardcoding individual PPM forms. */
class Ppms_form_validator
{
    private $engine;
    public function fields($definition)
    {
        Ppms_values::object($definition);
        if ((isset($definition->schemaVersion) && !in_array($definition->schemaVersion, array(1,2), TRUE)) || (isset($definition->fields) && isset($definition->sections))) { throw new Ppms_problem('INVALID_TEMPLATE_SHAPE'); }
        if (($definition->schemaVersion ?? 1) === 2 && !isset($definition->sections)) { throw new Ppms_problem('THREE_FORM_SECTIONS_REQUIRED'); }
        if (isset($definition->fields) && !isset($definition->sections)) { return $definition->fields; }
        if (!isset($definition->sections) || !is_array($definition->sections) || !$definition->sections || count($definition->sections) > 100) {
            throw new Ppms_problem('TEMPLATE_FIELDS_REQUIRED');
        }
        $fields = array();
        $sections = array();
        foreach ($definition->sections as $section) {
            Ppms_values::object($section);
            $key = Ppms_values::text((array) $section, 'key', 128);
            if (isset($sections[$key]) || !isset($section->items) || !is_array($section->items)) { throw new Ppms_problem('INVALID_TEMPLATE_SECTION'); }
            if (($definition->schemaVersion ?? 1) === 2 && $key === 'main' && !$section->items) { throw new Ppms_problem('MAIN_FIELDS_REQUIRED'); }
            $sections[$key] = TRUE;
            $fields = array_merge($fields, $section->items);
        }
        if (($definition->schemaVersion ?? 1) === 2 && array_keys($sections) !== array('header','main','summary')) { throw new Ppms_problem('THREE_FORM_SECTIONS_REQUIRED'); }
        return $fields;
    }
    public function definition($definition)
    {
        $fields = $this->fields($definition);
        $this->validateFields($fields, 0);
        (new Ppms_form_engine())->compile($fields);
        return $definition;
    }
    private function validateFields($fields, $depth)
    {
        if (!is_array($fields) || !$fields || count($fields) > 200 || $depth > 3) { throw new Ppms_problem('INVALID_TEMPLATE_FIELDS'); }
        $keys = array();
        foreach ($fields as $field) {
            Ppms_values::object($field);
            $key = Ppms_values::text((array) $field, 'key', 128);
            Ppms_values::text((array) $field, 'label', 512);
            if (!preg_match('/^[A-Za-z][A-Za-z0-9_-]*$/D', $key) || in_array($key, array('constructor','prototype','__proto__'), TRUE) || isset($keys[$key])) { throw new Ppms_problem('DUPLICATE_OR_INVALID_FIELD_KEY'); }
            $keys[$key] = TRUE;
            if (!in_array($field->type ?? '', array('text','textarea','number','integer','boolean','date','time','datetime','select','multiselect','trace-code','repeatable','table','group'), TRUE)) {
                throw new Ppms_problem('UNSUPPORTED_FIELD_TYPE');
            }
            foreach (array('required', 'readOnly', 'traceCritical', 'allowRemoval') as $flag) {
                if (isset($field->$flag) && !is_bool($field->$flag)) { throw new Ppms_problem('INVALID_FIELD_FLAG'); }
            }
            if (in_array($field->type, array('repeatable','table','group'), TRUE)) {
                $this->validateFields($field->fields ?? NULL, $depth + 1);
                foreach (array('minRows', 'maxRows') as $bound) {
                    if (isset($field->$bound) && (!is_int($field->$bound) || $field->$bound < 0 || $field->$bound > 1000)) { throw new Ppms_problem('INVALID_ROW_BOUND'); }
                }
                if (($field->minRows ?? 0) > ($field->maxRows ?? 100) || ($field->maxRows ?? 100) < 1) { throw new Ppms_problem('INVALID_ROW_BOUND'); }
            }
            if (in_array($field->type, array('select','multiselect'), TRUE)) {
                if (!isset($field->options) || !is_array($field->options) || !$field->options || count($field->options) > 500) { throw new Ppms_problem('SELECT_OPTIONS_REQUIRED'); }
                $values = array();
                foreach ($field->options as $option) {
                    $value = is_string($option) ? $option : Ppms_values::text((array) $option, 'value', 256);
                    if (in_array($value, $values, TRUE)) { throw new Ppms_problem('DUPLICATE_SELECT_OPTION'); }
                    $values[] = $value;
                }
            }
            if (isset($field->validation)) {
                Ppms_values::object($field->validation);
                $rules = $field->validation;
                foreach (array('min','max','step','minLength','maxLength') as $rule) {
                    if (isset($rules->$rule) && (!is_numeric($rules->$rule) || is_string($rules->$rule) || !is_finite((float) $rules->$rule))) { throw new Ppms_problem('INVALID_VALIDATION_BOUND'); }
                }
                if ((isset($rules->min, $rules->max) && $rules->min > $rules->max)
                    || (isset($rules->step) && $rules->step <= 0)
                    || (isset($rules->minLength) && (!is_int($rules->minLength) || $rules->minLength < 0))
                    || (isset($rules->maxLength) && (!is_int($rules->maxLength) || $rules->maxLength < 1 || $rules->maxLength > 16384))
                    || (isset($rules->minLength, $rules->maxLength) && $rules->minLength > $rules->maxLength)) {
                    throw new Ppms_problem('INVALID_VALIDATION_BOUND');
                }
                if (isset($rules->pattern) && (!is_string($rules->pattern) || strlen($rules->pattern) > 256 || @preg_match($this->pattern($rules->pattern), '') === FALSE)) { throw new Ppms_problem('INVALID_VALIDATION_PATTERN'); }
            }
            if (property_exists($field, 'defaultValue')) {
                if ($field->type === 'trace-code') { throw new Ppms_problem('TRACE_DEFAULT_PROHIBITED'); }
                $this->validateData(array($field), (object) array($key => $field->defaultValue), FALSE, '', NULL, (object) array($key => $field->defaultValue), array());
            }
        }
    }
    /** Return the authoritative values after defaults and calculations. */
    public function payload($definition, $data, $complete = FALSE, $previous = NULL, $serverPaths = array())
    {
        $this->definition($definition);
        $fields = $this->fields($definition);
        $this->engine = new Ppms_form_engine();
        $prepared = $this->engine->prepare($fields, Ppms_values::object($data));
        $this->validateData($fields, $prepared, $complete, '', $previous, $prepared, $serverPaths);
        // Browsers encode 1.0 as 1. Preserve the recorded JSON representation
        // when no semantic value changed, avoiding false trace retirement.
        return $previous instanceof stdClass && Ppms_values::equivalent($prepared, $previous) ? $previous : $prepared;
    }
    private function validateData($fields, $data, $complete, $prefix, $previous, $root, $serverPaths)
    {
        $known = array();
        foreach ($fields as $field) { $known[$field->key] = $field; }
        foreach (get_object_vars($data) as $key => $value) {
            if (!isset($known[$key])) { $this->invalid($prefix.$key, 'UNKNOWN_FIELD'); }
        }
        foreach ($fields as $field) {
            $key = $field->key;
            $path = $prefix.$key;
            $value = $data->$key ?? NULL;
            $protected = ($field->readOnly ?? FALSE) && !isset($field->calculation) && !in_array($path, $serverPaths, TRUE);
            if ($protected && $previous && !Ppms_values::equivalent($value, $previous->$key ?? NULL)) { $this->invalid($path, 'READ_ONLY_FIELD'); }
            if ($protected && !$previous && property_exists($data, $key)
                && (!property_exists($field, 'defaultValue') || !Ppms_values::equivalent($value, $field->defaultValue))) { $this->invalid($path, 'READ_ONLY_FIELD'); }
            $empty = $value === NULL || $value === '' || ($value === array() && in_array($field->type, array('repeatable','table','multiselect'), TRUE));
            $engine = $this->engine ?? new Ppms_form_engine();
            $scope = preg_replace('/\.\d+(?=\.|$)/', '[]', $prefix);
            $visible = !isset($field->visibleWhen) || $engine->condition($field->visibleWhen, $root, $data, $scope);
            $required = ($field->required ?? FALSE) || (isset($field->requiredWhen) && $engine->condition($field->requiredWhen, $root, $data, $scope));
            if ($complete && $visible && $required && $empty) { $this->invalid($path, 'REQUIRED_FIELD'); }
            if ($complete && $visible && in_array($field->type, array('repeatable','table'), TRUE) && ($field->minRows ?? 0) > 0 && ($empty || (is_array($value) && count($value) < $field->minRows))) { $this->invalid($path, 'INVALID_ROW_COUNT'); }
            if ($empty) {
                if (isset($field->fields) && !($field->allowRemoval ?? FALSE) && isset($previous->$key)) { $this->protectedRemoval($field, $previous->$key, $path); }
                continue;
            }
            if ($field->type === 'group') {
                $this->validateData($field->fields, Ppms_values::object($value), $complete && $visible, $path.'.', $previous->$key ?? NULL, $root, $serverPaths);
                continue;
            }
            if (in_array($field->type, array('repeatable','table'), TRUE)) {
                if (!is_array($value) || count($value) > ($field->maxRows ?? 100) || ($complete && $visible && count($value) < ($field->minRows ?? 0))) { $this->invalid($path, 'INVALID_ROW_COUNT'); }
                $matchedRows = array();
                foreach ($value as $index => $row) {
                    $oldRow = $previous->$key[$index] ?? NULL;
                    if (($field->allowRemoval ?? FALSE) && isset($previous->$key) && is_array($previous->$key)) {
                        $signature = $this->protectedSignature($field->fields, $row, $path.'.'.$index.'.', $serverPaths);
                        if ($signature !== array()) {
                            $oldRow = NULL;
                            foreach ($previous->$key as $oldIndex => $candidate) {
                                if (isset($matchedRows[$oldIndex])) { continue; }
                                if (Ppms_values::equivalent($signature, $this->protectedSignature($field->fields, $candidate, $path.'.'.$index.'.', $serverPaths))) {
                                    $oldRow = $candidate; $matchedRows[$oldIndex] = TRUE; break;
                                }
                            }
                        }
                    }
                    $this->validateData($field->fields, Ppms_values::object($row), $complete && $visible, $path.'.'.$index.'.', $oldRow, $root, $serverPaths);
                }
                if (!($field->allowRemoval ?? FALSE) && isset($previous->$key) && is_array($previous->$key)) {
                    foreach ($previous->$key as $index => $oldRow) {
                        if (!array_key_exists($index, $value)) { $this->protectedChildren($field->fields, $oldRow, $path.'.'.$index); }
                    }
                }
                continue;
            }
            $valid = TRUE;
            switch ($field->type) {
                case 'number': case 'integer':
                    $valid = (is_int($value) || is_float($value)) && is_finite((float) $value) && ($field->type !== 'integer' || floor($value) == $value);
                    break;
                case 'boolean': $valid = is_bool($value); break;
                case 'multiselect':
                    $options = array_map(function ($item) { return is_string($item) ? $item : $item->value; }, $field->options);
                    $valid = is_array($value) && count(array_unique($value, SORT_REGULAR)) === count($value);
                    if ($valid) { foreach ($value as $item) { if (!in_array($item, $options, TRUE)) { $valid = FALSE; } } }
                    break;
                default: $valid = is_string($value) && mb_strlen($value) <= 16384;
            }
            if (!$valid) { $this->invalid($path, 'INVALID_FIELD_TYPE'); }
            if ($field->type === 'date') {
                try { Ppms_values::date($value); } catch (Ppms_problem $error) { $this->invalid($path, 'INVALID_DATE'); }
            }
            if ($field->type === 'time' && !preg_match('/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/D', $value)) { $this->invalid($path, 'INVALID_TIME'); }
            if ($field->type === 'datetime') {
                try { Ppms_values::date(substr($value, 0, 10)); } catch (Ppms_problem $error) { $this->invalid($path, 'INVALID_DATETIME'); }
                if (!preg_match('/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))?$/D', $value)) { $this->invalid($path, 'INVALID_DATETIME'); }
            }
            if ($field->type === 'select') {
                $options = array_map(function ($item) { return is_string($item) ? $item : $item->value; }, $field->options);
                if (!in_array($value, $options, TRUE)) { $this->invalid($path, 'INVALID_SELECT_OPTION'); }
            }
            $rules = $field->validation ?? new stdClass();
            if (is_int($value) || is_float($value)) {
                if ((isset($rules->min) && $value < $rules->min) || (isset($rules->max) && $value > $rules->max)
                    || (isset($rules->step) && abs($value / $rules->step - round($value / $rules->step)) > 1e-9)) { $this->invalid($path, 'OUT_OF_RANGE'); }
            }
            if (is_string($value) && ((isset($rules->minLength) && mb_strlen($value) < $rules->minLength)
                || (isset($rules->maxLength) && mb_strlen($value) > $rules->maxLength)
                || (isset($rules->pattern) && @preg_match($this->pattern($rules->pattern), $value) !== 1))) { $this->invalid($path, 'TEXT_VALIDATION_FAILED'); }
        }
    }
    private function protectedSignature($fields, $row, $prefix, $serverPaths)
    {
        $values = array();
        foreach ($fields as $field) {
            $path = $prefix.$field->key;
            $value = is_object($row) ? ($row->{$field->key} ?? NULL) : NULL;
            if (($field->readOnly ?? FALSE) && !isset($field->calculation) && !in_array($path, $serverPaths, TRUE)) { $values[$path] = $value; }
            elseif (isset($field->fields) && $field->type === 'group') { $values += $this->protectedSignature($field->fields, $value, $path.'.', $serverPaths); }
            elseif (isset($field->fields) && is_array($value)) {
                foreach ($value as $index => $child) { $values += $this->protectedSignature($field->fields, $child, $path.'.'.$index.'.', $serverPaths); }
            }
        }
        return $values;
    }
    private function protectedRemoval($field, $old, $path)
    {
        if ($field->type === 'group') { $this->protectedChildren($field->fields, $old, $path); }
        elseif (is_array($old)) {
            foreach ($old as $index => $row) { $this->protectedChildren($field->fields, $row, $path.'.'.$index); }
        }
    }
    private function protectedChildren($fields, $old, $prefix)
    {
        if (!is_object($old)) { return; }
        foreach ($fields as $field) {
            $key = $field->key;
            if (!property_exists($old, $key)) { continue; }
            if (($field->readOnly ?? FALSE) && !isset($field->calculation) && $old->$key !== NULL) { $this->invalid($prefix.'.'.$key, 'READ_ONLY_FIELD'); }
            if (isset($field->fields) && !($field->allowRemoval ?? FALSE)) { $this->protectedRemoval($field, $old->$key, $prefix.'.'.$key); }
        }
    }
    private function pattern($value) { return '~(*LIMIT_MATCH=10000)(*LIMIT_RECURSION=1000)'.str_replace('~', '\\~', $value).'~u'; }
    private function invalid($path, $reason) { throw new Ppms_problem($reason, 422, array('field' => $path)); }
}
