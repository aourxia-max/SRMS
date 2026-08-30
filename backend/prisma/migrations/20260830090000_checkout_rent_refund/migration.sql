ALTER TABLE `payment_allocations`
  MODIFY COLUMN `allocation_type` ENUM('AUTO_OLDEST_FIRST', 'MANUAL_SUPER_ADMIN', 'PREPAYMENT_AUTO', 'RENT_REFUND') NOT NULL DEFAULT 'AUTO_OLDEST_FIRST';

ALTER TABLE `bill_adjustments`
  MODIFY COLUMN `adjustment_type` ENUM('DISCOUNT', 'WAIVER', 'INCREASE', 'CORRECTION', 'CHECKOUT_RENT_REFUND') NOT NULL;

ALTER TABLE `checkout_settlements`
  ADD COLUMN `rent_refundable_amount` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `prepayment_refundable_amount`;

ALTER TABLE `deposit_refunds`
  ADD COLUMN `deposit_refund_amount` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `refund_amount`,
  ADD COLUMN `prepayment_refund_amount` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `deposit_refund_amount`,
  ADD COLUMN `rent_refund_amount` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `prepayment_refund_amount`;

UPDATE `deposit_refunds` AS dr
INNER JOIN `checkout_settlements` AS cs ON cs.`id` = dr.`checkout_settlement_id`
SET dr.`deposit_refund_amount` = cs.`deposit_refundable_amount`,
    dr.`prepayment_refund_amount` = cs.`prepayment_refundable_amount`,
    dr.`rent_refund_amount` = 0.00;

CREATE TABLE `checkout_rent_refund_allocations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `checkout_settlement_item_id` INT UNSIGNED NOT NULL,
  `payment_allocation_id` INT UNSIGNED NOT NULL,
  `payment_id` INT UNSIGNED NOT NULL,
  `rent_bill_id` INT UNSIGNED NOT NULL,
  `reserved_amount` DECIMAL(14,2) NOT NULL,
  `status` ENUM('RESERVED', 'RELEASED', 'APPLIED') NOT NULL DEFAULT 'RESERVED',
  `reserved_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `released_at` DATETIME(3) NULL,
  `applied_at` DATETIME(3) NULL,
  `deposit_refund_id` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_checkout_rent_refund_item_status` (`checkout_settlement_item_id`, `status`),
  KEY `idx_checkout_rent_refund_allocation_status` (`payment_allocation_id`, `status`),
  KEY `idx_checkout_rent_refund_refund` (`deposit_refund_id`),
  CONSTRAINT `fk_checkout_rent_refund_item` FOREIGN KEY (`checkout_settlement_item_id`) REFERENCES `checkout_settlement_items` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_checkout_rent_refund_allocation` FOREIGN KEY (`payment_allocation_id`) REFERENCES `payment_allocations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_checkout_rent_refund_payment` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_checkout_rent_refund_bill` FOREIGN KEY (`rent_bill_id`) REFERENCES `rent_bills` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_checkout_rent_refund_refund` FOREIGN KEY (`deposit_refund_id`) REFERENCES `deposit_refunds` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
