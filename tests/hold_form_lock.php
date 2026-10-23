<?php
// Deliberately coordinate concurrent real requests; never run against app data.
if (PHP_SAPI !== 'cli' || strpos(getenv('DB_DATABASE'), 'ppms_ci3_test_') !== 0) { exit(1); }
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$db = new mysqli(getenv('DB_HOST'), getenv('DB_USERNAME'), getenv('DB_PASSWORD'), getenv('DB_DATABASE'), (int) getenv('DB_PORT'));
$db->begin_transaction();
$statement = $db->prepare(($argv[2] ?? '') === 'mutation'
    ? 'SELECT id FROM SyncMutationReceipt WHERE clientMutationId=? FOR UPDATE'
    : 'SELECT id FROM PpmForm WHERE id=? FOR UPDATE');
$statement->bind_param('s', $argv[1]);
$statement->execute();
echo "READY\n";
flush();
fgets(STDIN);
$db->rollback();
