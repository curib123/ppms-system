<?php
defined('BASEPATH') OR exit('No direct script access allowed');

// Copy to local.php, which is ignored by Git. Environment variables take precedence.
return array(
    'APP_BASE_URL' => 'http://localhost:8085/',
    'APP_ENCRYPTION_KEY' => '', // Generate with: php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
    'DB_HOST' => '127.0.0.1',
    'DB_PORT' => '3306',
    'DB_DATABASE' => 'ppms_ci3',
    'DB_USERNAME' => 'root',
    'DB_PASSWORD' => '',
);
