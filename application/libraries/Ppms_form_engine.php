<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_values.php';

/** Bounded declarative expressions. No executable template code is accepted. */
class Ppms_form_engine
{
    private $map = array();
    private $order = array();

    public function compile($fields)
    {
        $this->map = array();
        $this->order = array();
        $this->index($fields, '');
        $dependencies = array();
        foreach ($this->map as $path => $entry) {
            $field = $entry['field'];
            foreach (array('visibleWhen', 'requiredWhen') as $name) {
                if (isset($field->$name)) { $this->conditionDefinition($field->$name, $entry['scope'], 0); }
            }
            if (isset($field->calculation)) {
                if (!in_array($field->type, array('number','integer'), TRUE)) { throw new Ppms_problem('CALCULATION_REQUIRES_NUMERIC_FIELD'); }
                $dependencies[$path] = $this->expressionDefinition($field->calculation, $entry['scope'], 0);
            }
        }
        $state = array();
        foreach (array_keys($dependencies) as $path) { $this->visit($path, $dependencies, $state); }
        return $this;
    }

    private function index($fields, $scope)
    {
        foreach ($fields as $field) {
            $path = $scope.$field->key;
            $this->map[$path] = array('field' => $field, 'scope' => $scope);
            if (isset($field->fields)) {
                $this->index($field->fields, $path.($field->type === 'group' ? '.' : '[].'));
            }
        }
    }

    private function reference($path, $scope)
    {
        if (!is_string($path) || strlen($path) > 191 || !preg_match('/^[A-Za-z][A-Za-z0-9_-]*(?:\[\]|\.[A-Za-z][A-Za-z0-9_-]*)*$/D', $path)) {
            throw new Ppms_problem('INVALID_EXPRESSION_PATH');
        }
        if ($scope !== '' && isset($this->map[$scope.$path])) { return $scope.$path; }
        if (isset($this->map[$path])) { return $path; }
        throw new Ppms_problem('EXPRESSION_FIELD_NOT_DEFINED', 422, array('field' => $path));
    }

    private function expressionDefinition($expression, $scope, $depth)
    {
        Ppms_values::object($expression);
        if ($depth > 12) { throw new Ppms_problem('EXPRESSION_TOO_DEEP'); }
        if (property_exists($expression, 'value')) {
            if (count(get_object_vars($expression)) !== 1 || (!is_int($expression->value) && !is_float($expression->value)) || !is_finite((float) $expression->value)) { throw new Ppms_problem('INVALID_EXPRESSION_LITERAL'); }
            return array();
        }
        if (isset($expression->path) && !isset($expression->op)) {
            $path = $this->reference($expression->path, $scope);
            if (!in_array($this->map[$path]['field']->type, array('number','integer'), TRUE)) { throw new Ppms_problem('EXPRESSION_REQUIRES_NUMERIC_FIELD'); }
            return array($path);
        }
        $op = $expression->op ?? '';
        if (in_array($op, array('sum','count','average','min','max'), TRUE)) {
            $path = $this->reference($expression->path ?? NULL, $scope);
            if ($op !== 'count' && !in_array($this->map[$path]['field']->type, array('number','integer'), TRUE)) { throw new Ppms_problem('EXPRESSION_REQUIRES_NUMERIC_FIELD'); }
            return array($path);
        }
        if (!in_array($op, array('add','subtract','multiply','divide','round'), TRUE)
            || !isset($expression->args) || !is_array($expression->args) || count($expression->args) < 1 || count($expression->args) > 20
            || (in_array($op, array('subtract','divide'), TRUE) && count($expression->args) !== 2)
            || ($op === 'round' && count($expression->args) > 2)) { throw new Ppms_problem('INVALID_CALCULATION'); }
        $dependencies = array();
        foreach ($expression->args as $arg) { $dependencies = array_merge($dependencies, $this->expressionDefinition($arg, $scope, $depth + 1)); }
        return array_unique($dependencies);
    }

    private function conditionDefinition($condition, $scope, $depth)
    {
        Ppms_values::object($condition);
        if ($depth > 8) { throw new Ppms_problem('CONDITION_TOO_DEEP'); }
        foreach (array('all','any') as $operator) {
            if (isset($condition->$operator)) {
                if (!is_array($condition->$operator) || !$condition->$operator || count($condition->$operator) > 20) { throw new Ppms_problem('INVALID_CONDITION'); }
                foreach ($condition->$operator as $child) { $this->conditionDefinition($child, $scope, $depth + 1); }
                return;
            }
        }
        $this->reference($condition->path ?? NULL, $scope);
        if (!in_array($condition->operator ?? '', array('eq','ne','gt','gte','lt','lte','in','notEmpty'), TRUE)) { throw new Ppms_problem('INVALID_CONDITION_OPERATOR'); }
        if ($condition->operator === 'in' && (!isset($condition->value) || !is_array($condition->value) || count($condition->value) > 100)) { throw new Ppms_problem('INVALID_CONDITION_VALUE'); }
        if ($condition->operator !== 'notEmpty' && !property_exists($condition, 'value')) { throw new Ppms_problem('INVALID_CONDITION_VALUE'); }
    }

    private function visit($path, $dependencies, &$state)
    {
        if (($state[$path] ?? 0) === 2) { return; }
        if (($state[$path] ?? 0) === 1) { throw new Ppms_problem('CALCULATION_CYCLE', 422, array('field' => $path)); }
        $state[$path] = 1;
        foreach ($dependencies[$path] as $child) { if (isset($dependencies[$child])) { $this->visit($child, $dependencies, $state); } }
        $state[$path] = 2;
        $this->order[] = $path;
    }

    public function prepare($fields, $data)
    {
        $this->compile($fields);
        $result = json_decode(Ppms_values::json(Ppms_values::object($data)));
        $this->defaults($fields, $result);
        foreach ($this->order as $pattern) {
            foreach ($this->concrete($result, $pattern) as $path) {
                $parts = explode('.', $path);
                array_pop($parts);
                $local = $parts ? $this->read($result, implode('.', $parts)) : $result;
                $entry = $this->map[$pattern];
                $value = $this->evaluate($entry['field']->calculation, $result, $local, $entry['scope']);
                if ($value !== NULL && !is_finite((float) $value)) { throw new Ppms_problem('CALCULATION_OUT_OF_RANGE', 422, array('field' => $path)); }
                $this->write($result, $path, $value);
            }
        }
        return $result;
    }

    private function defaults($fields, $data)
    {
        foreach ($fields as $field) {
            $key = $field->key;
            if (!property_exists($data, $key) && property_exists($field, 'defaultValue')) { $data->$key = json_decode(Ppms_values::json($field->defaultValue)); }
            if ($field->type === 'group' && isset($data->$key) && is_object($data->$key)) { $this->defaults($field->fields, $data->$key); }
            if (in_array($field->type, array('table','repeatable'), TRUE) && isset($data->$key) && is_array($data->$key)) {
                foreach ($data->$key as $row) { if (is_object($row)) { $this->defaults($field->fields, $row); } }
            }
        }
    }

    public function condition($condition, $root, $local, $scope = '')
    {
        foreach (array('all','any') as $operator) {
            if (isset($condition->$operator)) {
                foreach ($condition->$operator as $child) {
                    $value = $this->condition($child, $root, $local, $scope);
                    if ($operator === 'all' && !$value) { return FALSE; }
                    if ($operator === 'any' && $value) { return TRUE; }
                }
                return $operator === 'all';
            }
        }
        $value = $this->localRead($condition->path, $root, $local, $scope);
        $expected = $condition->value ?? NULL;
        switch ($condition->operator) {
            case 'eq': return $this->equal($value, $expected);
            case 'ne': return !$this->equal($value, $expected);
            case 'in':
                foreach ($expected as $candidate) { if ($this->equal($value, $candidate)) { return TRUE; } }
                return FALSE;
            case 'notEmpty': return $value !== NULL && $value !== '' && $value !== array();
            default:
                if ((!is_int($value) && !is_float($value)) || (!is_int($expected) && !is_float($expected))) { return FALSE; }
                if ($condition->operator === 'gt') { return $value > $expected; }
                if ($condition->operator === 'gte') { return $value >= $expected; }
                if ($condition->operator === 'lt') { return $value < $expected; }
                return $value <= $expected;
        }
    }
    private function equal($left, $right)
    {
        return Ppms_values::equivalent($left, $right);
    }

    private function evaluate($expression, $root, $local, $scope)
    {
        if (property_exists($expression, 'value')) { return $expression->value; }
        if (!isset($expression->op)) { return $this->numeric($this->localRead($expression->path, $root, $local, $scope)); }
        $op = $expression->op;
        if (in_array($op, array('sum','count','average','min','max'), TRUE)) {
            $raw = $this->localRead($expression->path, $root, $local, $scope);
            $values = is_array($raw) ? $raw : array($raw);
            if ($op === 'count') { return count(array_filter($values, function ($v) { return $v !== NULL && $v !== ''; })); }
            $values = array_values(array_filter($values, function ($v) { return (is_int($v) || is_float($v)) && is_finite((float) $v); }));
            if ($op === 'sum') { return array_sum($values); }
            if (!$values) { return NULL; }
            if ($op === 'average') { return array_sum($values) / count($values); }
            return $op === 'min' ? min($values) : max($values);
        }
        $values = array();
        foreach ($expression->args as $arg) {
            $value = $this->evaluate($arg, $root, $local, $scope);
            if ($value === NULL) { return NULL; }
            $values[] = $value;
        }
        switch ($op) {
            case 'add': return array_sum($values);
            case 'subtract': return $values[0] - $values[1];
            case 'multiply': return array_product($values);
            case 'divide': return $values[1] == 0 ? NULL : $values[0] / $values[1];
            case 'round':
                $digits = $values[1] ?? 0;
                if ($digits < 0 || $digits > 8 || floor($digits) != $digits) { throw new Ppms_problem('INVALID_ROUND_PRECISION'); }
                return round($values[0], (int) $digits, PHP_ROUND_HALF_UP);
        }
        throw new Ppms_problem('INVALID_CALCULATION');
    }

    private function numeric($value) { return (is_int($value) || is_float($value)) && is_finite((float) $value) ? $value : NULL; }
    private function localRead($path, $root, $local, $scope)
    {
        if ($scope !== '' && isset($this->map[$scope.$path])) { return $this->read($local, $path); }
        return $this->read($root, $path);
    }
    public function read($data, $path)
    {
        $parts = explode('.', str_replace('[]', '.*', $path));
        return $this->parts($data, $parts);
    }
    private function parts($data, $parts)
    {
        if (!$parts) { return $data; }
        $part = array_shift($parts);
        if ($part === '*') {
            $values = array();
            if (is_array($data)) {
                foreach ($data as $row) {
                    $value = $this->parts($row, $parts);
                    if (is_array($value) && in_array('*', $parts, TRUE)) { $values = array_merge($values, $value); }
                    else { $values[] = $value; }
                }
            }
            return $values;
        }
        $child = is_object($data) ? ($data->$part ?? NULL) : (is_array($data) && ctype_digit($part) ? ($data[(int) $part] ?? NULL) : NULL);
        return $this->parts($child, $parts);
    }
    public function concrete($data, $pattern)
    {
        $position = strpos($pattern, '[]');
        if ($position === FALSE) {
            $parent = strrpos($pattern, '.');
            return $parent === FALSE || is_object($this->read($data, substr($pattern, 0, $parent))) ? array($pattern) : array();
        }
        $prefix = substr($pattern, 0, $position);
        $rows = $this->read($data, $prefix);
        $paths = array();
        if (is_array($rows)) {
            foreach (array_keys($rows) as $index) { $paths = array_merge($paths, $this->concrete($data, $prefix.'.'.$index.substr($pattern, $position + 2))); }
        }
        return $paths;
    }
    public function write($data, $path, $value)
    {
        $parts = explode('.', $path);
        $last = array_pop($parts);
        $current =& $data;
        foreach ($parts as $part) {
            if (is_object($current) && property_exists($current, $part)) { $current =& $current->$part; }
            elseif (is_array($current) && ctype_digit($part) && array_key_exists((int) $part, $current)) { $current =& $current[(int) $part]; }
            else { throw new Ppms_problem('DATA_PATH_PARENT_MISSING', 422, array('field' => $path)); }
        }
        if (!is_object($current)) { throw new Ppms_problem('JSON_OBJECT_REQUIRED'); }
        $current->$last = $value;
    }
}
