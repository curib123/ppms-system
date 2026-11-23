-- Additive, resumable platform extensions. Baseline data and sealed migrations
-- remain unchanged. Run setup migrate with application writes paused.
CREATE TABLE IF NOT EXISTS PpmSequenceCounter (
    namespaceKey VARCHAR(191) NOT NULL,
    periodKey VARCHAR(191) NOT NULL,
    currentValue BIGINT NOT NULL DEFAULT 0,
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (namespaceKey,periodKey),
    CHECK (currentValue >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS ReviewReference (
    recordId VARCHAR(191) NOT NULL PRIMARY KEY,
    reviewerUserId VARCHAR(191) NULL,
    reviewerName VARCHAR(191) NOT NULL DEFAULT '',
    reviewerPosition VARCHAR(191) NOT NULL DEFAULT '',
    status ENUM('PENDING_REVIEW','UNDER_REVIEW','APPROVED','RETURNED_FOR_REVISION') NOT NULL DEFAULT 'PENDING_REVIEW',
    reviewedAt DATETIME(3) NULL,
    remarks TEXT NULL,
    version INT NOT NULL DEFAULT 1,
    reviewedRevisionNo INT NULL,
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedBy VARCHAR(191) NOT NULL,
    CONSTRAINT fk_review_record FOREIGN KEY (recordId) REFERENCES PpmRecord(id) ON DELETE RESTRICT,
    CONSTRAINT fk_review_user FOREIGN KEY (reviewerUserId) REFERENCES User(id) ON DELETE RESTRICT,
    CONSTRAINT fk_review_updater FOREIGN KEY (updatedBy) REFERENCES User(id) ON DELETE RESTRICT,
    INDEX idx_review_status (status,updatedAt,recordId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

SET @ppms_platform_upgrade = (SELECT IF(COUNT(*)=0,
    'ALTER TABLE SyncDailyBatch ADD COLUMN manifestJson JSON NULL', 'SELECT 1')
    FROM information_schema.columns WHERE table_schema=DATABASE()
    AND table_name='SyncDailyBatch' AND column_name='manifestJson');
PREPARE ppms_platform_statement FROM @ppms_platform_upgrade;
EXECUTE ppms_platform_statement;
DEALLOCATE PREPARE ppms_platform_statement;

SET @ppms_platform_upgrade = (SELECT IF(COUNT(*)=0,
    'ALTER TABLE User ADD COLUMN authVersion INT NOT NULL DEFAULT 1', 'SELECT 1')
    FROM information_schema.columns WHERE table_schema=DATABASE()
    AND table_name='User' AND column_name='authVersion');
PREPARE ppms_platform_statement FROM @ppms_platform_upgrade;
EXECUTE ppms_platform_statement;
DEALLOCATE PREPARE ppms_platform_statement;

ALTER TABLE SyncMutationReceipt MODIFY COLUMN operationType
    ENUM('CREATE_DRAFT','UPDATE_DRAFT','QUEUE_SUBMIT','LOCAL_TOMBSTONE','ATTACHMENT_UPLOAD_COMPLETE','CONFLICT_RESOLUTION','DELETE_RECORD') NOT NULL;

ALTER TABLE SyncChangeEvent MODIFY COLUMN eventType
    ENUM('TEMPLATE_PUBLISHED','RECORD_REVISION','TRACE_OUTPUT_PUBLISHED','TRACE_OUTPUT_RETIRED','RECORD_DELETED','CONFLICT_RESOLVED') NOT NULL;

SET @ppms_platform_upgrade = (SELECT IF(COUNT(*)=0,
    'CREATE INDEX idx_login_defense_expiry ON AuthLoginDefense (lastFailedAt,lockedUntil)', 'SELECT 1')
    FROM information_schema.statistics WHERE table_schema=DATABASE()
    AND table_name='AuthLoginDefense' AND index_name='idx_login_defense_expiry');
PREPARE ppms_platform_statement FROM @ppms_platform_upgrade;
EXECUTE ppms_platform_statement;
DEALLOCATE PREPARE ppms_platform_statement;
