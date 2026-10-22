<?php
// Router for PHP's development server. Always start it with -t public.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = realpath(__DIR__.rawurldecode($path ?: '/'));
if ($file !== FALSE && strpos($file, __DIR__.DIRECTORY_SEPARATOR) === 0
    && is_file($file) && strtolower(pathinfo($file, PATHINFO_EXTENSION)) !== 'php') {
    return FALSE;
}
// PHP's server otherwise treats virtual paths containing dots as SCRIPT_NAME,
// causing CI3 to strip the entire requested URI and select the default controller.
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = __DIR__.'/index.php';
$_SERVER['PHP_SELF'] = '/index.php'.($path ?: '/');
require __DIR__.'/index.php';
