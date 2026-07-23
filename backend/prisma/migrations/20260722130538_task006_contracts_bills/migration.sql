-- DropForeignKey
ALTER TABLE `file_assets` DROP FOREIGN KEY `file_assets_uploaded_by_fkey`;

-- DropForeignKey
ALTER TABLE `room_status_histories` DROP FOREIGN KEY `room_status_histories_room_id_fkey`;

-- DropForeignKey
ALTER TABLE `rooms` DROP FOREIGN KEY `rooms_building_id_fkey`;

-- DropForeignKey
ALTER TABLE `tenant_files` DROP FOREIGN KEY `tenant_files_file_asset_id_fkey`;

-- DropForeignKey
ALTER TABLE `tenant_files` DROP FOREIGN KEY `tenant_files_tenant_id_fkey`;

-- DropIndex
DROP INDEX `file_assets_uploaded_by_fkey` ON `file_assets`;

-- DropIndex
DROP INDEX `tenant_files_file_asset_id_fkey` ON `tenant_files`;

-- CreateTable
CREATE TABLE `contracts` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `contract_no` VARCHAR(40) NOT NULL,
    `room_id` INTEGER UNSIGNED NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `planned_move_in_date` DATE NULL,
    `monthly_rent` DECIMAL(14, 2) NOT NULL,
    `pricing_mode` ENUM('FIXED', 'TIERED_RETROACTIVE') NOT NULL,
    `payment_cycle_months` TINYINT UNSIGNED NOT NULL DEFAULT 1,
    `deposit_required` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT', 'ENDED', 'VOIDED') NOT NULL DEFAULT 'DRAFT',
    `billing_generated_at` DATETIME(3) NULL,
    `remark` VARCHAR(1000) NULL,

    UNIQUE INDEX `contracts_contract_no_key`(`contract_no`),
    INDEX `contracts_room_id_start_date_end_date_status_idx`(`room_id`, `start_date`, `end_date`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract_members` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `contract_id` INTEGER UNSIGNED NOT NULL,
    `tenant_id` INTEGER UNSIGNED NOT NULL,
    `member_role` ENUM('PRIMARY', 'SECONDARY') NOT NULL,
    `relationship` VARCHAR(50) NULL,
    `is_current` BOOLEAN NOT NULL DEFAULT true,
    `remark` VARCHAR(500) NULL,

    INDEX `contract_members_contract_id_member_role_is_current_idx`(`contract_id`, `member_role`, `is_current`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contract_pricing_tiers` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `contract_id` INTEGER UNSIGNED NOT NULL,
    `tier_name` VARCHAR(50) NOT NULL,
    `threshold_months` INTEGER NOT NULL,
    `monthly_rent` DECIMAL(14, 2) NOT NULL,
    `sort_order` INTEGER NOT NULL,
    `requires_fully_paid` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `contract_pricing_tiers_contract_id_threshold_months_key`(`contract_id`, `threshold_months`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `rent_bills` (
    `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
    `bill_no` VARCHAR(40) NOT NULL,
    `contract_id` INTEGER UNSIGNED NOT NULL,
    `period_seq` INTEGER NOT NULL,
    `period_start` DATE NOT NULL,
    `period_end` DATE NOT NULL,
    `due_date` DATE NOT NULL,
    `contract_pricing_tier_id` INTEGER UNSIGNED NULL,
    `unit_monthly_rent` DECIMAL(14, 2) NOT NULL,
    `base_rent_amount` DECIMAL(14, 2) NOT NULL,
    `rent_free_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `discount_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `adjustment_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `payable_amount` DECIMAL(14, 2) NOT NULL,
    `received_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `outstanding_amount` DECIMAL(14, 2) NOT NULL,
    `status` ENUM('PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'VOIDED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',

    UNIQUE INDEX `rent_bills_bill_no_key`(`bill_no`),
    INDEX `rent_bills_due_date_status_idx`(`due_date`, `status`),
    UNIQUE INDEX `rent_bills_contract_id_period_seq_key`(`contract_id`, `period_seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `rooms_room_status_deleted_at_idx` ON `rooms`(`room_status`, `deleted_at`);

-- AddForeignKey
ALTER TABLE `file_assets` ADD CONSTRAINT `file_assets_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_files` ADD CONSTRAINT `tenant_files_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tenant_files` ADD CONSTRAINT `tenant_files_file_asset_id_fkey` FOREIGN KEY (`file_asset_id`) REFERENCES `file_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_building_id_fkey` FOREIGN KEY (`building_id`) REFERENCES `buildings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_members` ADD CONSTRAINT `contract_members_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_members` ADD CONSTRAINT `contract_members_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `contract_pricing_tiers` ADD CONSTRAINT `contract_pricing_tiers_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rent_bills` ADD CONSTRAINT `rent_bills_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `rent_bills` ADD CONSTRAINT `rent_bills_contract_pricing_tier_id_fkey` FOREIGN KEY (`contract_pricing_tier_id`) REFERENCES `contract_pricing_tiers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_status_histories` ADD CONSTRAINT `room_status_histories_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `room_status_histories` RENAME INDEX `room_status_histories_room_changed_idx` TO `room_status_histories_room_id_changed_at_idx`;

-- RenameIndex
ALTER TABLE `rooms` RENAME INDEX `rooms_building_floor_house_idx` TO `rooms_building_id_floor_no_house_no_idx`;
