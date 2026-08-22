ALTER TABLE `rent_bills`
  ADD COLUMN `bill_category` ENUM('RENT', 'CHECKOUT_SUPPLEMENTAL') NOT NULL DEFAULT 'RENT' AFTER `status`,
  ADD COLUMN `checkout_settlement_id` INT UNSIGNED NULL AFTER `bill_category`,
  ADD UNIQUE INDEX `rent_bills_checkout_settlement_id_key` (`checkout_settlement_id`),
  ADD CONSTRAINT `rent_bills_checkout_settlement_id_fkey`
    FOREIGN KEY (`checkout_settlement_id`) REFERENCES `checkout_settlements`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `checkout_settlements`
  ADD COLUMN `supplemental_required` BOOLEAN NOT NULL DEFAULT FALSE AFTER `final_receivable`,
  ADD COLUMN `supplemental_arrears_amount` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `supplemental_required`,
  ADD COLUMN `supplemental_inspection_amount` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `supplemental_arrears_amount`,
  ADD COLUMN `supplemental_received_amount` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `supplemental_inspection_amount`,
  ADD COLUMN `supplemental_outstanding_amount` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `supplemental_received_amount`,
  ADD COLUMN `supplemental_collected_at` DATETIME(3) NULL AFTER `supplemental_outstanding_amount`;

ALTER TABLE `payments`
  MODIFY COLUMN `payment_category` ENUM('RENT', 'PREPAYMENT', 'DEPOSIT', 'CHECKOUT_SUPPLEMENTAL') NOT NULL;