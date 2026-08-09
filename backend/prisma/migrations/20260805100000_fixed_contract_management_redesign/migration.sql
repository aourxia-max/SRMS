ALTER TABLE `contracts`
  MODIFY COLUMN `contract_no` VARCHAR(120) NOT NULL,
  ADD COLUMN `external_contract_no` VARCHAR(80) NULL AFTER `contract_no`;

ALTER TABLE `rent_bills`
  MODIFY COLUMN `bill_no` VARCHAR(140) NOT NULL;

CREATE TABLE `contract_drafts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_id` INT UNSIGNED NULL,
  `payload` JSON NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  `created_by` INT UNSIGNED NOT NULL,
  `confirmed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `contract_drafts_room_id_idx` (`room_id`),
  KEY `contract_drafts_created_by_status_updated_at_idx` (`created_by`, `status`, `updated_at`),
  CONSTRAINT `contract_drafts_room_id_fkey`
    FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `contract_drafts_created_by_fkey`
    FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `contract_files` (
  `contract_id` INT UNSIGNED NOT NULL,
  `file_asset_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`contract_id`, `file_asset_id`),
  KEY `contract_files_file_asset_id_idx` (`file_asset_id`),
  CONSTRAINT `contract_files_contract_id_fkey`
    FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `contract_files_file_asset_id_fkey`
    FOREIGN KEY (`file_asset_id`) REFERENCES `file_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
