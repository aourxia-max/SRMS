ALTER TABLE `checkout_settlements`
  ADD COLUMN `origin_contract_status` ENUM('DRAFT', 'PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT', 'ENDED', 'VOIDED') NOT NULL DEFAULT 'ACTIVE' AFTER `checkout_type`;
