-- Each authorized device has its own form membership and monotonic lease.
-- Record revisions, not device exclusivity, arbitrate concurrent edits.
SET @ppms_device_membership_upgrade = (SELECT IF(
    GROUP_CONCAT(column_name ORDER BY seq_in_index)='ppmFormId,deviceId',
    'SELECT 1', 'ALTER TABLE PpmFormDeviceLease DROP PRIMARY KEY, ADD PRIMARY KEY (ppmFormId,deviceId)')
    FROM information_schema.statistics WHERE table_schema=DATABASE()
    AND table_name='PpmFormDeviceLease' AND index_name='PRIMARY');
PREPARE ppms_device_membership_statement FROM @ppms_device_membership_upgrade;
EXECUTE ppms_device_membership_statement;
DEALLOCATE PREPARE ppms_device_membership_statement;
