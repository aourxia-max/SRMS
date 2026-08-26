ALTER TABLE `file_assets`
  MODIFY `category` ENUM('TENANT_ID','CONTRACT','PAYMENT_PROOF','CONTRACT_VOID_PROOF','DEPOSIT_REFUND_PROOF','PRICING_REBATE_PROOF','IMPORT','EXPORT','BACKUP','FINANCE_EXPORT') NOT NULL;

CREATE TABLE `contract_void_requests` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_no` VARCHAR(40) NOT NULL,
  `contract_id` INT UNSIGNED NOT NULL,
  `status` ENUM('PENDING','COMPLETED','REJECTED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `reason` VARCHAR(500) NOT NULL,
  `impact_snapshot` JSON NOT NULL,
  `impact_hash` CHAR(64) NOT NULL,
  `active_contract_key` VARCHAR(80) NULL,
  `completed_contract_key` VARCHAR(80) NULL,
  `execution_batch_no` VARCHAR(40) NULL,
  `submission_idempotency_key` VARCHAR(100) NOT NULL,
  `execution_idempotency_key` VARCHAR(100) NULL,
  `result_snapshot` JSON NULL,
  `submitted_by` INT UNSIGNED NOT NULL,
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_by` INT UNSIGNED NULL,
  `completed_at` DATETIME(3) NULL,
  `rejected_by` INT UNSIGNED NULL,
  `rejected_at` DATETIME(3) NULL,
  `rejected_reason` VARCHAR(500) NULL,
  `cancelled_by` INT UNSIGNED NULL,
  `cancelled_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `contract_void_requests_request_no_key` (`request_no`),
  UNIQUE KEY `contract_void_requests_active_contract_key_key` (`active_contract_key`),
  UNIQUE KEY `contract_void_requests_completed_contract_key_key` (`completed_contract_key`),
  UNIQUE KEY `contract_void_requests_execution_batch_no_key` (`execution_batch_no`),
  UNIQUE KEY `contract_void_requests_submission_idempotency_key_key` (`submission_idempotency_key`),
  UNIQUE KEY `contract_void_requests_execution_idempotency_key_key` (`execution_idempotency_key`),
  KEY `contract_void_requests_contract_id_status_submitted_at_idx` (`contract_id`, `status`, `submitted_at`),
  CONSTRAINT `contract_void_requests_contract_id_fkey`
    FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `contract_void_reversals` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contract_void_request_id` INT UNSIGNED NOT NULL,
  `category` ENUM('RENT_BILL','PAYMENT','PAYMENT_ALLOCATION','PREPAYMENT','DEPOSIT','REFUND','ADJUSTMENT','PRICING_REBATE','CHECKOUT','COMMISSION','ROOM_STATUS') NOT NULL,
  `original_entity_type` VARCHAR(60) NOT NULL,
  `original_entity_id` INT UNSIGNED NULL,
  `amount` DECIMAL(14, 2) NOT NULL,
  `balance_before` DECIMAL(14, 2) NULL,
  `balance_after` DECIMAL(14, 2) NULL,
  `generated_entity_type` VARCHAR(60) NULL,
  `generated_entity_id` INT UNSIGNED NULL,
  `original_occurred_at` DATETIME(3) NULL,
  `correction_occurred_at` DATETIME(3) NOT NULL,
  `idempotency_key` VARCHAR(160) NOT NULL,
  `metadata` JSON NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `contract_void_reversals_idempotency_key_key` (`idempotency_key`),
  KEY `contract_void_reversals_contract_void_request_id_category_idx` (`contract_void_request_id`, `category`),
  KEY `contract_void_reversals_original_entity_idx` (`original_entity_type`, `original_entity_id`),
  CONSTRAINT `contract_void_reversals_contract_void_request_id_fkey`
    FOREIGN KEY (`contract_void_request_id`) REFERENCES `contract_void_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `contract_void_request_files` (
  `contract_void_request_id` INT UNSIGNED NOT NULL,
  `file_asset_id` INT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`contract_void_request_id`, `file_asset_id`),
  KEY `contract_void_request_files_file_asset_id_idx` (`file_asset_id`),
  CONSTRAINT `contract_void_request_files_contract_void_request_id_fkey`
    FOREIGN KEY (`contract_void_request_id`) REFERENCES `contract_void_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `contract_void_request_files_file_asset_id_fkey`
    FOREIGN KEY (`file_asset_id`) REFERENCES `file_assets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
