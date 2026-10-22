<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/** Environment variables override the optional, untracked local configuration. */
function ppms_config($key, $default = '')
{
    static $local;
    if ($local === NULL) {
        $path = APPPATH.'config/local.php';
        $local = is_file($path) ? require $path : array();
        if (!is_array($local)) {
            throw new RuntimeException('application/config/local.php must return an array.');
        }
    }

    $value = getenv($key);
    return $value !== FALSE ? $value : (array_key_exists($key, $local) ? $local[$key] : $default);
}
