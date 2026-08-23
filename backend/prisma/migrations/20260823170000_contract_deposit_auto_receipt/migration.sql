ALTER TABLE `payments`
  MODIFY COLUMN `method` ENUM(
    'WECHAT',
    'ALIPAY',
    'BANK_TRANSFER',
    'CASH',
    'POS',
    'OTHER',
    'SYSTEM_AUTO'
  ) NOT NULL,
  ADD COLUMN `auto_source_key` VARCHAR(100) NULL AFTER `external_reference`,
  ADD UNIQUE INDEX `payments_auto_source_key_key` (`auto_source_key`);
