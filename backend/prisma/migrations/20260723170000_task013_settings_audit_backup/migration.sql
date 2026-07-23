ALTER TABLE `security_audit_logs`
  ADD COLUMN `previous_hash` CHAR(64) NULL,
  ADD COLUMN `record_hash` CHAR(64) NULL;

CREATE TABLE `system_settings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `setting_key` VARCHAR(80) NOT NULL,
  `setting_value` JSON NOT NULL,
  `value_type` ENUM('STRING','INTEGER','BOOLEAN','JSON') NOT NULL,
  `description` VARCHAR(255) NOT NULL,
  `updated_by` INT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_system_settings_key` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `operation_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `module` VARCHAR(50) NOT NULL,
  `action` VARCHAR(80) NOT NULL,
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` INT UNSIGNED NULL,
  `entity_no` VARCHAR(100) NULL,
  `summary` VARCHAR(500) NOT NULL,
  `before_data` JSON NULL,
  `after_data` JSON NULL,
  `reason` VARCHAR(500) NULL,
  `operator_id` INT UNSIGNED NOT NULL,
  `operator_role` ENUM('SUPER_ADMIN','ADMIN','VISITOR') NOT NULL,
  `ip_address` VARCHAR(45) NULL,
  `user_agent` VARCHAR(500) NULL,
  `is_hidden` BOOLEAN NOT NULL DEFAULT FALSE,
  `hidden_by` INT UNSIGNED NULL,
  `hidden_at` DATETIME(3) NULL,
  `hidden_reason` VARCHAR(500) NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_operation_logs_operator_occurred` (`operator_id`, `occurred_at`),
  KEY `idx_operation_logs_module_occurred` (`module`, `occurred_at`),
  KEY `idx_operation_logs_hidden_occurred` (`is_hidden`, `occurred_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `backup_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `backup_no` VARCHAR(50) NOT NULL,
  `backup_type` ENUM('MANUAL','DAILY','PRE_RESTORE') NOT NULL,
  `status` ENUM('PENDING','RUNNING','SUCCESS','FAILED') NOT NULL DEFAULT 'PENDING',
  `database_path` VARCHAR(500) NULL,
  `manifest_path` VARCHAR(500) NULL,
  `size_bytes` BIGINT UNSIGNED NULL,
  `checksum` CHAR(64) NULL,
  `failure_reason` VARCHAR(500) NULL,
  `retention_until` DATETIME(3) NOT NULL,
  `created_by` INT UNSIGNED NULL,
  `started_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `restore_status` ENUM('NOT_REQUESTED','RUNNING','SUCCESS','FAILED') NOT NULL DEFAULT 'NOT_REQUESTED',
  `restored_by` INT UNSIGNED NULL,
  `restored_at` DATETIME(3) NULL,
  `restore_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_backup_records_no` (`backup_no`),
  KEY `idx_backup_records_status_created` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
