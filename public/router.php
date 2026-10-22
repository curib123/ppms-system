<?php
// Router for PHP's development server. Always start it with -t public.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = realpath(__DIR__.rawurldecode($path ?: '/'));
if ($file !== FALSE && strpos($file, __DIR__.DIRECTORY_SEPARATOR) === 0
    && is_file($file) && strtolower(pathinfo($file, PATHINFO_EXTENSION)) !== 'php') {
    return FALSE;
}
require __DIR__.'/index.php';
