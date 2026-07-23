CREATE TABLE `payment_refund_allocations` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payment_refund_id` INT UNSIGNED NOT NULL,
  `payment_allocation_id` INT UNSIGNED NOT NULL,
  `reversed_amount` DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refund_alloc` (`payment_refund_id`, `payment_allocation_id`),
  KEY `idx_refund_alloc_payment_allocation` (`payment_allocation_id`),
  CONSTRAINT `payment_refund_allocations_payment_refund_id_fkey` FOREIGN KEY (`payment_refund_id`) REFERENCES `payment_refunds`(`id`),
  CONSTRAINT `payment_refund_allocations_payment_allocation_id_fkey` FOREIGN KEY (`payment_allocation_id`) REFERENCES `payment_allocations`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
