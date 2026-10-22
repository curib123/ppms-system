<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once APPPATH.'config/environment.php';

$active_group = 'default';
$query_builder = TRUE;

// Native MySQLi driver for MySQL and XAMPP/MariaDB.
$db['default'] = array(
    'dsn' => '',
    'hostname' => ppms_config('DB_HOST', '127.0.0.1'),
    'port' => ppms_config('DB_PORT', '3306'),
    'username' => ppms_config('DB_USERNAME', 'root'),
    'password' => ppms_config('DB_PASSWORD'),
    'database' => ppms_config('DB_DATABASE', 'ppms_ci3'),
    'dbdriver' => 'mysqli',
    'dbprefix' => '',
    'pconnect' => FALSE,
    'db_debug' => FALSE,
    'cache_on' => FALSE,
    'cachedir' => '',
    'char_set' => 'utf8mb4',
    'dbcollat' => 'utf8mb4_bin',
    'swap_pre' => '',
    'encrypt' => FALSE,
    'compress' => FALSE,
    'stricton' => TRUE,
    'failover' => array(),
    'save_queries' => FALSE,
);
