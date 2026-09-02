ALTER TABLE `file_assets`
  MODIFY `category` ENUM('TENANT_ID','CONTRACT','PAYMENT_PROOF','CONTRACT_VOID_PROOF','DEPOSIT_REFUND_PROOF','PRICING_REBATE_PROOF','PROPERTY_AFFAIR','IMPORT','EXPORT','BACKUP','FINANCE_EXPORT') NOT NULL;

CREATE TABLE `property_affairs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affair_no` VARCHAR(32) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `category` VARCHAR(80) NULL,
  `priority` ENUM('NORMAL','IMPORTANT','URGENT') NOT NULL DEFAULT 'NORMAL',
  `status` ENUM('PENDING','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `content` TEXT NOT NULL,
  `responsible_user_id` INT UNSIGNED NULL,
  `responsible_snapshot` VARCHAR(50) NULL,
  `external_handler_name` VARCHAR(100) NULL,
  `external_phone` VARCHAR(50) NULL,
  `external_contact` VARCHAR(200) NULL,
  `completed_at` DATETIME(3) NULL,
  `cancelled_at` DATETIME(3) NULL,
  `created_by` INT UNSIGNED NOT NULL,
  `updated_by` INT UNSIGNED NOT NULL,
  `deleted_at` DATETIME(3) NULL,
  `deleted_by` INT UNSIGNED NULL,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `property_affairs_affair_no_key` (`affair_no`),
  KEY `property_affairs_status_deleted_at_updated_at_idx` (`status`, `deleted_at`, `updated_at`),
  KEY `property_affairs_priority_updated_at_idx` (`priority`, `updated_at`),
  KEY `property_affairs_responsible_user_id_status_idx` (`responsible_user_id`, `status`),
  KEY `property_affairs_category_updated_at_idx` (`category`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `property_affair_daily_sequences` (
  `date_key` CHAR(8) NOT NULL,
  `current_value` INT NOT NULL,
  PRIMARY KEY (`date_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `property_affair_buildings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affair_id` INT UNSIGNED NOT NULL,
  `building_id` INT UNSIGNED NOT NULL,
  `target_label` VARCHAR(200) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `property_affair_buildings_affair_id_building_id_key` (`affair_id`, `building_id`),
  KEY `property_affair_buildings_building_id_idx` (`building_id`),
  CONSTRAINT `property_affair_buildings_affair_id_fkey`
    FOREIGN KEY (`affair_id`) REFERENCES `property_affairs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `property_affair_rooms` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affair_id` INT UNSIGNED NOT NULL,
  `room_id` INT UNSIGNED NOT NULL,
  `target_label` VARCHAR(200) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `property_affair_rooms_affair_id_room_id_key` (`affair_id`, `room_id`),
  KEY `property_affair_rooms_room_id_idx` (`room_id`),
  CONSTRAINT `property_affair_rooms_affair_id_fkey`
    FOREIGN KEY (`affair_id`) REFERENCES `property_affairs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `property_affair_tenants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affair_id` INT UNSIGNED NOT NULL,
  `tenant_id` INT UNSIGNED NOT NULL,
  `target_label` VARCHAR(200) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `property_affair_tenants_affair_id_tenant_id_key` (`affair_id`, `tenant_id`),
  KEY `property_affair_tenants_tenant_id_idx` (`tenant_id`),
  CONSTRAINT `property_affair_tenants_affair_id_fkey`
    FOREIGN KEY (`affair_id`) REFERENCES `property_affairs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `property_affair_contracts` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affair_id` INT UNSIGNED NOT NULL,
  `contract_id` INT UNSIGNED NOT NULL,
  `target_label` VARCHAR(200) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `property_affair_contracts_affair_id_contract_id_key` (`affair_id`, `contract_id`),
  KEY `property_affair_contracts_contract_id_idx` (`contract_id`),
  CONSTRAINT `property_affair_contracts_affair_id_fkey`
    FOREIGN KEY (`affair_id`) REFERENCES `property_affairs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `property_affair_progresses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `affair_id` INT UNSIGNED NOT NULL,
  `content` TEXT NOT NULL,
  `status_before` ENUM('PENDING','IN_PROGRESS','COMPLETED','CANCELLED') NULL,
  `status_after` ENUM('PENDING','IN_PROGRESS','COMPLETED','CANCELLED') NULL,
  `created_by` INT UNSIGNED NOT NULL,
  `created_by_snapshot` VARCHAR(50) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `property_affair_progresses_affair_id_created_at_idx` (`affair_id`, `created_at`),
  CONSTRAINT `property_affair_progresses_affair_id_fkey`
    FOREIGN KEY (`affair_id`) REFERENCES `property_affairs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `property_affair_files` (
  `affair_id` INT UNSIGNED NOT NULL,
  `file_asset_id` INT UNSIGNED NOT NULL,
  `created_by` INT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`affair_id`, `file_asset_id`),
  CONSTRAINT `property_affair_files_affair_id_fkey`
    FOREIGN KEY (`affair_id`) REFERENCES `property_affairs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `property_affair_files_file_asset_id_fkey`
    FOREIGN KEY (`file_asset_id`) REFERENCES `file_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
