CREATE TABLE IF NOT EXISTS `ClientDeviceCredential` (
    `deviceId` VARCHAR(191) NOT NULL PRIMARY KEY,
    `tokenHash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE KEY `uq_device_token_hash` (`tokenHash`),
    FOREIGN KEY (`deviceId`) REFERENCES `ClientDevice` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
