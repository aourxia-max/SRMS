ALTER TABLE `payment_allocations`
  ADD COLUMN `allocation_order` INT NOT NULL DEFAULT 1 AFTER `allocated_amount`,
  ADD COLUMN `allocation_type` ENUM('AUTO_OLDEST_FIRST','MANUAL_SUPER_ADMIN','PREPAYMENT_AUTO') NOT NULL DEFAULT 'AUTO_OLDEST_FIRST' AFTER `allocation_order`;

CREATE TEMPORARY TABLE `payment_allocation_order_backfill` AS
SELECT
  `id`,
  ROW_NUMBER() OVER (
    PARTITION BY `payment_id`
    ORDER BY `allocated_at`, `id`
  ) AS `allocation_order`
FROM `payment_allocations`;

UPDATE `payment_allocations` AS `pa`
INNER JOIN `payment_allocation_order_backfill` AS `backfill`
  ON `backfill`.`id` = `pa`.`id`
SET `pa`.`allocation_order` = `backfill`.`allocation_order`;

DROP TEMPORARY TABLE `payment_allocation_order_backfill`;

CREATE TABLE `payment_files` (
  `payment_id` INT UNSIGNED NOT NULL,
  `file_asset_id` INT UNSIGNED NOT NULL,
  `purpose` VARCHAR(50) NOT NULL DEFAULT 'PAYMENT_PROOF',
  `uploaded_by` INT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `locked_at` DATETIME(3) NULL,
  PRIMARY KEY (`payment_id`, `file_asset_id`),
  KEY `payment_files_file_asset_id_idx` (`file_asset_id`),
  KEY `payment_files_uploaded_by_created_at_idx` (`uploaded_by`, `created_at`),
  CONSTRAINT `payment_files_payment_id_fkey`
    FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`),
  CONSTRAINT `payment_files_file_asset_id_fkey`
    FOREIGN KEY (`file_asset_id`) REFERENCES `file_assets`(`id`),
  CONSTRAINT `payment_files_uploaded_by_fkey`
    FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `payment_refund_adjustment_decisions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `payment_refund_id` INT UNSIGNED NOT NULL,
  `bill_adjustment_id` INT UNSIGNED NOT NULL,
  `decision` ENUM('REVERSE','KEEP') NOT NULL,
  `keep_reason` VARCHAR(500) NULL,
  `reversal_adjustment_id` INT UNSIGNED NULL,
  `decided_by` INT UNSIGNED NOT NULL,
  `decided_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `payment_refund_adjustment_decisions_payment_refund_id_bill_adjustment_id_key`
    (`payment_refund_id`, `bill_adjustment_id`),
  KEY `payment_refund_adjustment_decisions_bill_adjustment_id_idx` (`bill_adjustment_id`),
  KEY `payment_refund_adjustment_decisions_reversal_adjustment_id_idx` (`reversal_adjustment_id`),
  KEY `payment_refund_adjustment_decisions_decided_by_decided_at_idx` (`decided_by`, `decided_at`),
  CONSTRAINT `payment_refund_adjustment_decisions_payment_refund_id_fkey`
    FOREIGN KEY (`payment_refund_id`) REFERENCES `payment_refunds`(`id`),
  CONSTRAINT `payment_refund_adjustment_decisions_bill_adjustment_id_fkey`
    FOREIGN KEY (`bill_adjustment_id`) REFERENCES `bill_adjustments`(`id`),
  CONSTRAINT `payment_refund_adjustment_decisions_reversal_adjustment_id_fkey`
    FOREIGN KEY (`reversal_adjustment_id`) REFERENCES `bill_adjustments`(`id`),
  CONSTRAINT `payment_refund_adjustment_decisions_decided_by_fkey`
    FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
