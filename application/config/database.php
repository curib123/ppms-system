<?php
defined('BASEPATH') OR exit('No direct script access allowed');
require_once APPPATH.'config/environment.php';

$active_group = 'default';
$query_builder = TRUE;

// CI3's PDO PostgreSQL driver quotes the existing mixed-case Prisma identifiers.
$db['default'] = array(
    'dsn' => 'pgsql:host='.ppms_config('DB_HOST', '127.0.0.1')
        .';port='.ppms_config('DB_PORT', '5432')
        .';dbname='.ppms_config('DB_DATABASE', 'ppms_ci3')
        .';sslmode='.ppms_config('DB_SSLMODE', 'prefer')
        .';connect_timeout=5',
    'hostname' => ppms_config('DB_HOST', '127.0.0.1'),
    'port' => ppms_config('DB_PORT', '5432'),
    'username' => ppms_config('DB_USERNAME', 'ppms'),
    'password' => ppms_config('DB_PASSWORD'),
    'database' => ppms_config('DB_DATABASE', 'ppms_ci3'),
    'dbdriver' => 'pdo',
    'subdriver' => 'pgsql',
    'schema' => 'public',
    'sslmode' => ppms_config('DB_SSLMODE', 'prefer'),
    'dbprefix' => '',
    'pconnect' => FALSE,
    'db_debug' => FALSE,
    'cache_on' => FALSE,
    'cachedir' => '',
    'char_set' => 'utf8',
    'dbcollat' => '',
    'swap_pre' => '',
    'encrypt' => FALSE,
    'compress' => FALSE,
    'stricton' => FALSE,
    'failover' => array(),
    'save_queries' => FALSE,
    'options' => array(PDO::ATTR_TIMEOUT => 5),
);
