<?php
// Disposable test database only. No accounts or password hashes are checked in.
if (PHP_SAPI !== 'cli') { exit(1); }
mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$database = getenv('DB_DATABASE');
if (strpos($database, 'ppms_ci3_test_') !== 0) { exit(1); }
$db = new mysqli(getenv('DB_HOST'), getenv('DB_USERNAME'), getenv('DB_PASSWORD'), $database, (int) getenv('DB_PORT'));
$db->set_charset('utf8mb4');
$statement = $db->prepare('INSERT INTO User (id,email,username,displayName,passwordHash,role,updatedAt) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))');
$password = password_hash(getenv('PPMS_TEST_PASSWORD'), PASSWORD_DEFAULT);
foreach (array('admin' => 'ADMIN', 'alice' => 'PERSONNEL', 'bob' => 'PERSONNEL', 'outsider' => 'PERSONNEL', 'fsqa' => 'FSQA', 'supervisor' => 'SUPERVISOR', 'manager' => 'PLANT_MANAGER') as $name => $role) {
    $id = 'test-'.$name;
    $email = $name.'@example.test';
    $statement->bind_param('ssssss', $id, $email, $name, $name, $password, $role);
    $statement->execute();
}
// These disposable HTTP/browser fixtures replace PPM-001/002 with small test
// schemas. Explicitly retire only their original seeded active relationships
// before doing so; publication must never bypass production connection guards.
// All other seed relationships and the production seed files remain unchanged.
$db->query("UPDATE PpmTraceConnection c
    JOIN PpmForm sourceForm ON sourceForm.id=c.sourcePpmFormId
    JOIN PpmForm targetForm ON targetForm.id=c.targetPpmFormId
    SET c.status='DISABLED',c.updatedAt=UTC_TIMESTAMP(3)
    WHERE c.status='ACTIVE' AND (sourceForm.ppmCode IN ('PPM-001','PPM-002') OR targetForm.ppmCode IN ('PPM-001','PPM-002'))");
$forms = $db->query('SELECT f.id,f.ppmCode,a.id AS areaPpmAssignmentId FROM PpmForm f JOIN AreaPpmAssignment a ON a.ppmFormId=f.id')->fetch_all(MYSQLI_ASSOC);
echo json_encode(array('forms' => $forms), JSON_THROW_ON_ERROR);
