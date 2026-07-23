CREATE TABLE `tenants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_type` ENUM('INDIVIDUAL', 'COMPANY') NOT NULL DEFAULT 'INDIVIDUAL',
  `name` VARCHAR(100) NOT NULL,
  `phone` VARCHAR(30) NULL,
  `id_type` VARCHAR(50) NULL,
  `id_no_ciphertext` TEXT NULL,
  `id_no_hash` CHAR(64) NULL,
  `id_no_last4` CHAR(4) NULL,
  `contact_address` VARCHAR(300) NULL,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `remark` VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  KEY `tenants_name_status_idx` (`name`, `status`),
  KEY `tenants_phone_idx` (`phone`),
  KEY `tenants_id_no_hash_idx` (`id_no_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `file_assets` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `storage_key` VARCHAR(500) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `stored_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `extension` VARCHAR(20) NOT NULL,
  `size_bytes` BIGINT UNSIGNED NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `category` ENUM('TENANT_ID', 'CONTRACT', 'PAYMENT_PROOF', 'DEPOSIT_REFUND_PROOF', 'PRICING_REBATE_PROOF', 'IMPORT', 'EXPORT', 'BACKUP') NOT NULL,
  `uploaded_by` INT UNSIGNED NOT NULL,
  `uploaded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `locked_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `file_assets_storage_key_key` (`storage_key`),
  KEY `file_assets_category_uploaded_at_idx` (`category`, `uploaded_at`),
  CONSTRAINT `file_assets_uploaded_by_fkey` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `tenant_files` (
  `tenant_id` INT UNSIGNED NOT NULL,
  `file_asset_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `file_asset_id`),
  CONSTRAINT `tenant_files_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`),
  CONSTRAINT `tenant_files_file_asset_id_fkey` FOREIGN KEY (`file_asset_id`) REFERENCES `file_assets`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
