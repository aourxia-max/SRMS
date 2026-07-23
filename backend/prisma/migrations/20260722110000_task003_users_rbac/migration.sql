CREATE TABLE `security_audit_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_type` VARCHAR(80) NOT NULL,
  `entity_type` VARCHAR(50) NOT NULL,
  `entity_id` INT UNSIGNED NULL,
  `operator_id` INT UNSIGNED NOT NULL,
  `event_data` JSON NOT NULL,
  `reason` VARCHAR(500) NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `security_audit_logs_operator_id_occurred_at_idx` (`operator_id`, `occurred_at`),
  INDEX `security_audit_logs_event_type_occurred_at_idx` (`event_type`, `occurred_at`),
  CONSTRAINT `security_audit_logs_operator_id_fkey` FOREIGN KEY (`operator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci ENGINE=InnoDB;
