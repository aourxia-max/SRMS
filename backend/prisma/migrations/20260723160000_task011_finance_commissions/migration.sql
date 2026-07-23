CREATE TABLE `contract_commissions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contract_id` INT UNSIGNED NOT NULL,
  `recipient_name` VARCHAR(120) NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `created_by` INT UNSIGNED NOT NULL,
  `updated_by` INT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deleted_at` DATETIME(3) NULL,
  `deleted_by` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_commission_contract_recipient` (`contract_id`,`recipient_name`),
  KEY `idx_commission_contract_deleted` (`contract_id`,`deleted_at`),
  CONSTRAINT `fk_commission_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
