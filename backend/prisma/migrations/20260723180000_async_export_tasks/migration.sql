ALTER TABLE `file_assets` MODIFY `category` ENUM('TENANT_ID','CONTRACT','PAYMENT_PROOF','DEPOSIT_REFUND_PROOF','PRICING_REBATE_PROOF','BACKUP','FINANCE_EXPORT') NOT NULL;

CREATE TABLE `export_tasks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `task_no` VARCHAR(50) NOT NULL,
  `report_type` VARCHAR(50) NOT NULL,
  `export_format` ENUM('XLSX','PDF') NOT NULL,
  `filters` JSON NOT NULL,
  `status` ENUM('PENDING','RUNNING','SUCCESS','FAILED') NOT NULL DEFAULT 'PENDING',
  `file_asset_id` INT UNSIGNED NULL,
  `failure_reason` VARCHAR(500) NULL,
  `created_by` INT UNSIGNED NOT NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_export_tasks_no` (`task_no`),
  KEY `idx_export_tasks_created` (`created_by`,`created_at`),
  KEY `idx_export_tasks_status` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
