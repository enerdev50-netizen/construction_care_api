-- AlterTable
ALTER TABLE `material` ADD COLUMN `projectId` VARCHAR(36) NULL;

-- AlterTable
ALTER TABLE `payment` ADD COLUMN `type` VARCHAR(20) NOT NULL DEFAULT 'ACHATS';

-- CreateTable
CREATE TABLE `SiteLogEntry` (
    `id` VARCHAR(36) NOT NULL,
    `projectId` VARCHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `items` JSON NOT NULL,
    `createdById` VARCHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SiteLogEntry_projectId_idx`(`projectId`),
    UNIQUE INDEX `SiteLogEntry_projectId_date_key`(`projectId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Material_projectId_idx` ON `Material`(`projectId`);

-- AddForeignKey
ALTER TABLE `Material` ADD CONSTRAINT `Material_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SiteLogEntry` ADD CONSTRAINT `SiteLogEntry_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SiteLogEntry` ADD CONSTRAINT `SiteLogEntry_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
