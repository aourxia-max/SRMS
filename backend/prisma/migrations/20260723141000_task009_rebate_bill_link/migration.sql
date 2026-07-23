ALTER TABLE `pricing_rebates`
  ADD COLUMN `rent_bill_id` INT UNSIGNED NULL AFTER `pricing_tier_id`,
  ADD KEY `idx_rebate_bill` (`rent_bill_id`),
  ADD CONSTRAINT `fk_rebate_bill` FOREIGN KEY (`rent_bill_id`) REFERENCES `rent_bills`(`id`);
