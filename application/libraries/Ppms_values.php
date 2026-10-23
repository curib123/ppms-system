<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once __DIR__.'/Ppms_problem.php';

/** Shared boundary validation and deterministic JSON encoding. */
class Ppms_values
{
    public static function id() { return bin2hex(random_bytes(16)); }
    public static function now() { return gmdate('Y-m-d H:i:s'); }
    public static function json($value)
    {
        return json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR);
    }
    public static function canonical($value)
    {
        if (is_object($value)) {
            $properties = get_object_vars($value);
            ksort($properties, SORT_STRING);
            $result = new stdClass();
            foreach ($properties as $key => $child) { $result->$key = self::canonical($child); }
            return $result;
        }
        if (is_array($value)) {
            if ($value && array_keys($value) !== range(0, count($value) - 1)) { return self::canonical((object) $value); }
            return array_map(array(__CLASS__, 'canonical'), $value);
        }
        return $value;
    }
    public static function hash($value) { return hash('sha256', self::json(self::canonical($value))); }
    public static function text($input, $key, $max = 191)
    {
        $value = $input[$key] ?? NULL;
        if (!is_string($value) || trim($value) === '' || mb_strlen($value) > $max || preg_match('/[\x00-\x1f]/', $value)) {
            throw new Ppms_problem('INVALID_FIELD', 422, array('field' => $key));
        }
        return trim($value);
    }
    public static function integer($input, $key, $min = 0, $max = PHP_INT_MAX)
    {
        $value = $input[$key] ?? NULL;
        if (!is_int($value) || $value < $min || $value > $max) {
            throw new Ppms_problem('INVALID_INTEGER', 422, array('field' => $key));
        }
        return $value;
    }
    public static function date($value)
    {
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)
            || !checkdate((int) substr($value, 5, 2), (int) substr($value, 8, 2), (int) substr($value, 0, 4))) {
            throw new Ppms_problem('INVALID_DATE');
        }
        return $value;
    }
    public static function object($value)
    {
        if (!$value instanceof stdClass) { throw new Ppms_problem('JSON_OBJECT_REQUIRED'); }
        return $value;
    }
    public static function decode($row)
    {
        if (!$row) { return $row; }
        foreach ($row as $key => $value) {
            if ($value !== NULL && substr($key, -4) === 'Json') {
                $row[$key] = json_decode($value, FALSE, 64, JSON_THROW_ON_ERROR);
            }
        }
        foreach (array('versionNo', 'leaseVersion', 'revisionNo', 'currentRevisionNo', 'batchNo') as $key) {
            if (isset($row[$key])) { $row[$key] = (int) $row[$key]; }
        }
        return $row;
    }
}
