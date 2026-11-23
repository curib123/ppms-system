-- Scope each acknowledged feed to the target form as well as source and device.
-- Preserve the original cursor table for upgrade provenance; only this new table
-- is used by current clients. Copy before removing the one-form device index.
CREATE TABLE IF NOT EXISTS SyncFormPullCursor (
    deviceId VARCHAR(191) NOT NULL,
    ppmFormId VARCHAR(191) NOT NULL,
    sourcePpmFormId VARCHAR(191) NOT NULL,
    lastEventSequence BIGINT NOT NULL DEFAULT 0 CHECK (lastEventSequence >= 0),
    updatedAt DATETIME(3) NOT NULL,
    PRIMARY KEY (deviceId,ppmFormId,sourcePpmFormId),
    CONSTRAINT fk_form_cursor_device FOREIGN KEY (deviceId) REFERENCES ClientDevice(id) ON DELETE RESTRICT,
    CONSTRAINT fk_form_cursor_target FOREIGN KEY (ppmFormId) REFERENCES PpmForm(id) ON DELETE RESTRICT,
    CONSTRAINT fk_form_cursor_source FOREIGN KEY (sourcePpmFormId) REFERENCES PpmForm(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT IGNORE INTO SyncFormPullCursor (deviceId,ppmFormId,sourcePpmFormId,lastEventSequence,updatedAt)
    SELECT c.deviceId,l.ppmFormId,c.sourcePpmFormId,c.lastEventSequence,c.updatedAt
    FROM SyncPullCursor c JOIN PpmFormDeviceLease l ON l.deviceId=c.deviceId;

SET @ppms_multi_form_upgrade = (SELECT IF(COUNT(*)=0,
    'CREATE INDEX idx_form_lease_device ON PpmFormDeviceLease (deviceId)', 'SELECT 1')
    FROM information_schema.statistics WHERE table_schema=DATABASE()
    AND table_name='PpmFormDeviceLease' AND index_name='idx_form_lease_device');
PREPARE ppms_multi_form_statement FROM @ppms_multi_form_upgrade;
EXECUTE ppms_multi_form_statement;
DEALLOCATE PREPARE ppms_multi_form_statement;

SET @ppms_multi_form_upgrade = (SELECT IF(COUNT(*)>0,
    'ALTER TABLE PpmFormDeviceLease DROP INDEX uq_form_device', 'SELECT 1')
    FROM information_schema.statistics WHERE table_schema=DATABASE()
    AND table_name='PpmFormDeviceLease' AND index_name='uq_form_device');
PREPARE ppms_multi_form_statement FROM @ppms_multi_form_upgrade;
EXECUTE ppms_multi_form_statement;
DEALLOCATE PREPARE ppms_multi_form_statement;
