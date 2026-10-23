-- Runtime extensions; the converted baseline and its original seeds stay intact.
CREATE TABLE IF NOT EXISTS `PpmFormDeviceLease` (
    `ppmFormId` VARCHAR(191) NOT NULL PRIMARY KEY,
    `deviceId` VARCHAR(191) NOT NULL,
    `leaseVersion` INT NOT NULL DEFAULT 1 CHECK (`leaseVersion` > 0),
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE KEY `uq_form_device` (`deviceId`),
    FOREIGN KEY (`ppmFormId`) REFERENCES `PpmForm` (`id`) ON DELETE RESTRICT,
    FOREIGN KEY (`deviceId`) REFERENCES `ClientDevice` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `SyncDailyBatch` (
    `id` VARCHAR(191) NOT NULL PRIMARY KEY,
    `ppmFormId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `leaseVersion` INT NOT NULL,
    `businessDate` DATE NOT NULL,
    `batchNo` INT NOT NULL CHECK (`batchNo` > 0),
    `status` ENUM('DRAFT','PUSHING','PARTIAL','ACCEPTED','CONFLICTED','REJECTED') NOT NULL DEFAULT 'DRAFT',
    `baseServerCursor` BIGINT NOT NULL DEFAULT 0,
    `mutationCount` INT NOT NULL DEFAULT 0,
    `acceptedCount` INT NOT NULL DEFAULT 0,
    `conflictCount` INT NOT NULL DEFAULT 0,
    `rejectedCount` INT NOT NULL DEFAULT 0,
    `payloadHash` VARCHAR(64) NOT NULL,
    `resultJson` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `pushedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    UNIQUE KEY `uq_form_day_batch` (`ppmFormId`,`businessDate`,`batchNo`),
    KEY `idx_batch_device_date` (`deviceId`,`businessDate`,`status`),
    FOREIGN KEY (`ppmFormId`) REFERENCES `PpmForm` (`id`) ON DELETE RESTRICT,
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT,
    FOREIGN KEY (`deviceId`) REFERENCES `ClientDevice` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `SyncPullCursor` (
    `deviceId` VARCHAR(191) NOT NULL,
    `sourcePpmFormId` VARCHAR(191) NOT NULL,
    `lastEventSequence` BIGINT NOT NULL DEFAULT 0 CHECK (`lastEventSequence` >= 0),
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`deviceId`,`sourcePpmFormId`),
    FOREIGN KEY (`deviceId`) REFERENCES `ClientDevice` (`id`) ON DELETE RESTRICT,
    FOREIGN KEY (`sourcePpmFormId`) REFERENCES `PpmForm` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS `SyncChangeEvent` (
    `sequence` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `ppmFormId` VARCHAR(191) NOT NULL,
    `eventType` ENUM('TEMPLATE_PUBLISHED','RECORD_REVISION','TRACE_OUTPUT_PUBLISHED','TRACE_OUTPUT_RETIRED') NOT NULL,
    `recordId` VARCHAR(191) NULL,
    `revisionId` VARCHAR(191) NULL,
    `outputKey` VARCHAR(191) NULL,
    `payloadJson` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY `idx_feed_form_sequence` (`ppmFormId`,`sequence`),
    FOREIGN KEY (`ppmFormId`) REFERENCES `PpmForm` (`id`) ON DELETE RESTRICT,
    FOREIGN KEY (`recordId`) REFERENCES `PpmRecord` (`id`) ON DELETE RESTRICT,
    FOREIGN KEY (`revisionId`) REFERENCES `PpmRecordRevision` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
