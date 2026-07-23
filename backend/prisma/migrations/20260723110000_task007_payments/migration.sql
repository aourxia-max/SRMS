ALTER TABLE `contracts`
  ADD COLUMN `paid_through_date` DATE NULL,
  ADD COLUMN `next_due_date` DATE NULL,
  ADD KEY `contracts_status_next_due_date_idx` (`status`, `next_due_date`);

CREATE TABLE `payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `receipt_no` VARCHAR(40) NOT NULL,
  `contract_id` INT UNSIGNED NOT NULL,
  `payment_category` ENUM('RENT','PREPAYMENT','DEPOSIT') NOT NULL,
  `payment_date` DATE NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `method` ENUM('WECHAT','ALIPAY','BANK_TRANSFER','CASH','POS','OTHER') NOT NULL,
  `external_reference` VARCHAR(100) NULL,
  `operator_id` INT UNSIGNED NOT NULL,
  `status` ENUM('CONFIRMED','VOIDED','PARTIALLY_REFUNDED','FULLY_REFUNDED') NOT NULL DEFAULT 'CONFIRMED',
  `void_reason` VARCHAR(500) NULL,
  `voided_by` INT UNSIGNED NULL,
  `voided_at` DATETIME(3) NULL,
  `edit_reason` VARCHAR(500) NULL,
  `remark` VARCHAR(500) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `payments_receipt_no_key` (`receipt_no`),
  KEY `payments_contract_id_payment_date_status_idx` (`contract_id`, `payment_date`, `status`),
  CONSTRAINT `payments_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `payment_allocations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payment_id` INT UNSIGNED NOT NULL,
  `rent_bill_id` INT UNSIGNED NOT NULL,
  `allocated_amount` DECIMAL(14,2) NOT NULL,
  `reversed_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `allocated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `payment_allocations_payment_id_idx` (`payment_id`),
  KEY `payment_allocations_rent_bill_id_idx` (`rent_bill_id`),
  CONSTRAINT `payment_allocations_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`),
  CONSTRAINT `payment_allocations_rent_bill_id_fkey` FOREIGN KEY (`rent_bill_id`) REFERENCES `rent_bills`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `prepayment_transactions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `contract_id` INT UNSIGNED NOT NULL,
  `transaction_no` VARCHAR(40) NOT NULL,
  `transaction_type` ENUM('CREDIT_RECEIPT','DEBIT_TO_BILL','REFUND','TRANSFER_OUT','TRANSFER_IN','REVERSAL','ADJUSTMENT') NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `balance_after` DECIMAL(14,2) NOT NULL,
  `payment_id` INT UNSIGNED NULL,
  `rent_bill_id` INT UNSIGNED NULL,
  `reason` VARCHAR(500) NULL,
  `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `prepayment_transactions_transaction_no_key` (`transaction_no`),
  KEY `prepayment_transactions_contract_id_occurred_at_idx` (`contract_id`, `occurred_at`),
  CONSTRAINT `prepayment_transactions_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`),
  CONSTRAINT `prepayment_transactions_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`),
  CONSTRAINT `prepayment_transactions_rent_bill_id_fkey` FOREIGN KEY (`rent_bill_id`) REFERENCES `rent_bills`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
