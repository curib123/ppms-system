<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

/** Interpret versioned definitions rather than hardcoding individual PPM forms. */
class Ppms_form_validator
{
    public function fields($definition)
    {
        Ppms_values::object($definition);
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
            $sections[$key] = TRUE;
            $fields = array_merge($fields, $section->items);
        }
        return $fields;
    }
    public function definition($definition)
    {
        $this->validateFields($this->fields($definition), 0);
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
            if (!preg_match('/^[A-Za-z][A-Za-z0-9_-]*$/D', $key) || isset($keys[$key])) { throw new Ppms_problem('DUPLICATE_OR_INVALID_FIELD_KEY'); }
            $keys[$key] = TRUE;
            if (!in_array($field->type ?? '', array('text','textarea','number','integer','boolean','date','time','datetime','select','multiselect','trace-code','repeatable','table','group'), TRUE)) {
                throw new Ppms_problem('UNSUPPORTED_FIELD_TYPE');
            }
            foreach (array('required', 'readOnly', 'traceCritical') as $flag) {
                if (isset($field->$flag) && !is_bool($field->$flag)) { throw new Ppms_problem('INVALID_FIELD_FLAG'); }
            }
            if (in_array($field->type, array('repeatable','table','group'), TRUE)) {
                $this->validateFields($field->fields ?? NULL, $depth + 1);
                foreach (array('minRows', 'maxRows') as $bound) {
                    if (isset($field->$bound) && (!is_int($field->$bound) || $field->$bound < 0 || $field->$bound > 1000)) { throw new Ppms_problem('INVALID_ROW_BOUND'); }
                }
                if (($field->minRows ?? 0) > ($field->maxRows ?? 100)) { throw new Ppms_problem('INVALID_ROW_BOUND'); }
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
        }
    }
    public function payload($definition, $data, $complete = FALSE, $previous = NULL)
    {
        $this->definition($definition);
        $this->validateData($this->fields($definition), Ppms_values::object($data), $complete, '', $previous);
    }
    private function validateData($fields, $data, $complete, $prefix, $previous)
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
            if (($field->readOnly ?? FALSE) && $previous && Ppms_values::hash($value) !== Ppms_values::hash($previous->$key ?? NULL)) { $this->invalid($path, 'READ_ONLY_FIELD'); }
            $empty = $value === NULL || $value === '' || $value === array();
            if ($complete && ($field->required ?? FALSE) && $empty) { $this->invalid($path, 'REQUIRED_FIELD'); }
            if ($empty) { continue; }
            if ($field->type === 'group') {
                $this->validateData($field->fields, Ppms_values::object($value), $complete, $path.'.', $previous->$key ?? NULL);
                continue;
            }
            if (in_array($field->type, array('repeatable','table'), TRUE)) {
                if (!is_array($value) || count($value) > ($field->maxRows ?? 100) || ($complete && count($value) < ($field->minRows ?? 0))) { $this->invalid($path, 'INVALID_ROW_COUNT'); }
                foreach ($value as $index => $row) {
                    $this->validateData($field->fields, Ppms_values::object($row), $complete, $path.'.'.$index.'.', $previous->$key[$index] ?? NULL);
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
                if (!preg_match('/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/D', $value)) { $this->invalid($path, 'INVALID_DATETIME'); }
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
    private function pattern($value) { return '~(*LIMIT_MATCH=10000)(*LIMIT_RECURSION=1000)'.str_replace('~', '\\~', $value).'~u'; }
    private function invalid($path, $reason) { throw new Ppms_problem($reason, 422, array('field' => $path)); }
}
