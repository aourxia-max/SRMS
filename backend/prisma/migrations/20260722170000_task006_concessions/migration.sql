CREATE TABLE `contract_concessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contract_id` INT UNSIGNED NOT NULL,
  `concession_type` ENUM('RENT_FREE','FIXED_AMOUNT','PERCENTAGE') NOT NULL,
  `apply_mode` ENUM('DATE_RANGE','ONE_TIME','BILLING_PERIODS') NOT NULL,
  `start_date` DATE NULL,
  `end_date` DATE NULL,
  `fixed_amount` DECIMAL(14,2) NULL,
  `discount_rate` DECIMAL(7,4) NULL,
  `billing_period_count` INT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `status` ENUM('ACTIVE','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (`id`),
  KEY `contract_concessions_contract_id_status_idx` (`contract_id`,`status`),
  CONSTRAINT `contract_concessions_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
