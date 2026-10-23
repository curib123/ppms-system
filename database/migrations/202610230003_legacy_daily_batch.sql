-- The earlier experimental SyncDailyBatch did not have these service fields.
-- Conditional DDL supports both MySQL 8 and MariaDB 10.4 and can be resumed.
SET @ppms_batch_upgrade = (SELECT IF(COUNT(*)=0,
    'ALTER TABLE `SyncDailyBatch` ADD COLUMN `leaseVersion` INT NOT NULL DEFAULT 1',
    'SELECT 1') FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='SyncDailyBatch' AND column_name='leaseVersion');
PREPARE ppms_batch_statement FROM @ppms_batch_upgrade;
EXECUTE ppms_batch_statement;
DEALLOCATE PREPARE ppms_batch_statement;

SET @ppms_batch_upgrade = (SELECT IF(COUNT(*)=0,
    'ALTER TABLE `SyncDailyBatch` ADD COLUMN `payloadHash` VARCHAR(64) NOT NULL DEFAULT ''''',
    'SELECT 1') FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='SyncDailyBatch' AND column_name='payloadHash');
PREPARE ppms_batch_statement FROM @ppms_batch_upgrade;
EXECUTE ppms_batch_statement;
DEALLOCATE PREPARE ppms_batch_statement;

SET @ppms_batch_upgrade = (SELECT IF(COUNT(*)=0,
    'ALTER TABLE `SyncDailyBatch` ADD COLUMN `resultJson` JSON NULL',
    'SELECT 1') FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='SyncDailyBatch' AND column_name='resultJson');
PREPARE ppms_batch_statement FROM @ppms_batch_upgrade;
EXECUTE ppms_batch_statement;
DEALLOCATE PREPARE ppms_batch_statement;
