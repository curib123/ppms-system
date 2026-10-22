<?php
// Test-only CLI helper; Python uses this instead of requiring a MySQL client library.
if (PHP_SAPI !== 'cli') { exit(1); }
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
try {
    $request = json_decode(stream_get_contents(STDIN), TRUE, 512, JSON_THROW_ON_ERROR);
    $connection = mysqli_init();
    $connection->options(MYSQLI_OPT_CONNECT_TIMEOUT, 3);
    $connection->real_connect(getenv('DB_HOST') ?: '127.0.0.1', getenv('DB_USERNAME') ?: 'root',
        getenv('DB_PASSWORD') ?: '', $request['database'], (int) (getenv('DB_PORT') ?: 3306));
    $connection->set_charset('utf8mb4');
    $connection->query("SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");
    $result = $connection->query($request['sql']);
    echo json_encode($result instanceof mysqli_result ? $result->fetch_all(MYSQLI_NUM) : array(), JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    fwrite(STDERR, 'Test database query failed (code '.(int) $error->getCode().').'.PHP_EOL);
    exit(1);
}
