<?php
// Isolated regression fixture: emulate an atomic password/reset transaction.
if (PHP_SAPI !== 'cli' || strpos((string) getenv('DB_DATABASE'), 'ppms_ci3_test_') !== 0) { exit(1); }
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$db = new mysqli(getenv('DB_HOST'), getenv('DB_USERNAME'), getenv('DB_PASSWORD'), getenv('DB_DATABASE'), (int) getenv('DB_PORT'));
$db->begin_transaction();
$statement = $db->prepare('SELECT id FROM User WHERE username=? FOR UPDATE');
$name = $argv[1]; $statement->bind_param('s', $name); $statement->execute();
$id = $statement->get_result()->fetch_row()[0];
echo "READY\n"; fflush(STDOUT); fgets(STDIN);
$hash = password_hash(getenv('PPMS_TEST_NEW_PASSWORD'), PASSWORD_DEFAULT);
$statement = $db->prepare('UPDATE User SET passwordHash=?,authVersion=authVersion+1,updatedAt=UTC_TIMESTAMP(3) WHERE id=?');
$statement->bind_param('ss', $hash, $id); $statement->execute();
$statement = $db->prepare('UPDATE AuthSession SET revokedAt=UTC_TIMESTAMP(3) WHERE userId=?');
$statement->bind_param('s', $id); $statement->execute();
$db->commit();
