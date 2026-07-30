-- CreateTable
CREATE TABLE `MobileMoneyTransaction` (
    `id` VARCHAR(36) NOT NULL,
    `fedapayId` INTEGER NOT NULL,
    `documentId` VARCHAR(36) NOT NULL,
    `paymentId` VARCHAR(36) NULL,
    `amount` INTEGER NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `phoneNumber` VARCHAR(32) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `fedapayReference` VARCHAR(64) NULL,
    `failureReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `createdByUserId` VARCHAR(36) NULL,

    UNIQUE INDEX `MobileMoneyTransaction_fedapayId_key`(`fedapayId`),
    INDEX `MobileMoneyTransaction_documentId_idx`(`documentId`),
    INDEX `MobileMoneyTransaction_status_idx`(`status`),
    INDEX `MobileMoneyTransaction_createdByUserId_idx`(`createdByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MobileMoneyTransaction` ADD CONSTRAINT `MobileMoneyTransaction_documentId_fkey` FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MobileMoneyTransaction` ADD CONSTRAINT `MobileMoneyTransaction_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MobileMoneyTransaction` ADD CONSTRAINT `MobileMoneyTransaction_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
