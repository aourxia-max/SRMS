-- Repair settlements approved before supplemental receivables became first-class fields.
-- Only open, approved checkout records with an untouched legacy default are eligible.
UPDATE `checkout_settlements` AS `settlement`
JOIN `contracts` AS `contract`
  ON `contract`.`id` = `settlement`.`contract_id`
LEFT JOIN (
  SELECT
    `linked_bill`.`checkout_settlement_id`,
    SUM(
      CASE
        WHEN `bill`.`status` NOT IN ('VOIDED', 'REFUNDED')
          THEN `bill`.`outstanding_amount`
        ELSE 0
      END
    ) AS `current_arrears_amount`
  FROM (
    SELECT DISTINCT
      `item`.`checkout_settlement_id`,
      `item`.`rent_bill_id`
    FROM `checkout_settlement_items` AS `item`
    WHERE `item`.`item_type` = 'RENT_ARREARS'
      AND `item`.`rent_bill_id` IS NOT NULL
  ) AS `linked_bill`
  JOIN `rent_bills` AS `bill`
    ON `bill`.`id` = `linked_bill`.`rent_bill_id`
  GROUP BY `linked_bill`.`checkout_settlement_id`
) AS `arrears`
  ON `arrears`.`checkout_settlement_id` = `settlement`.`id`
SET
  `settlement`.`supplemental_required` = TRUE,
  `settlement`.`supplemental_arrears_amount` = GREATEST(
    LEAST(
      GREATEST(
        `settlement`.`rent_outstanding` - `settlement`.`deposit_offset_amount`,
        0
      ),
      `settlement`.`final_receivable`
    ),
    COALESCE(`arrears`.`current_arrears_amount`, 0)
  ),
  `settlement`.`supplemental_inspection_amount` = GREATEST(
    `settlement`.`final_receivable` - LEAST(
      GREATEST(
        `settlement`.`rent_outstanding` - `settlement`.`deposit_offset_amount`,
        0
      ),
      `settlement`.`final_receivable`
    ),
    0
  ),
  `settlement`.`supplemental_received_amount` = GREATEST(
    GREATEST(
      LEAST(
        GREATEST(
          `settlement`.`rent_outstanding` - `settlement`.`deposit_offset_amount`,
          0
        ),
        `settlement`.`final_receivable`
      ),
      COALESCE(`arrears`.`current_arrears_amount`, 0)
    ) - COALESCE(`arrears`.`current_arrears_amount`, 0),
    0
  ),
  `settlement`.`supplemental_outstanding_amount` =
    COALESCE(`arrears`.`current_arrears_amount`, 0) + GREATEST(
      `settlement`.`final_receivable` - LEAST(
        GREATEST(
          `settlement`.`rent_outstanding` - `settlement`.`deposit_offset_amount`,
          0
        ),
        `settlement`.`final_receivable`
      ),
      0
    ),
  `settlement`.`supplemental_collected_at` = NULL
WHERE `settlement`.`status` = 'APPROVED'
  AND `contract`.`status` = 'PENDING_CHECKOUT'
  AND `settlement`.`final_receivable` > 0
  AND `settlement`.`supplemental_required` = FALSE
  AND `settlement`.`supplemental_arrears_amount` = 0
  AND `settlement`.`supplemental_inspection_amount` = 0
  AND `settlement`.`supplemental_received_amount` = 0
  AND `settlement`.`supplemental_outstanding_amount` = 0;

-- Keep the locked total internally consistent when a legacy arrears bill was paid
-- or reopened after checkout approval but before this migration.
UPDATE `checkout_settlements` AS `settlement`
JOIN `contracts` AS `contract`
  ON `contract`.`id` = `settlement`.`contract_id`
SET `settlement`.`final_receivable` =
  `settlement`.`supplemental_received_amount` +
  `settlement`.`supplemental_outstanding_amount`
WHERE `settlement`.`status` = 'APPROVED'
  AND `contract`.`status` = 'PENDING_CHECKOUT'
  AND `settlement`.`supplemental_required` = TRUE
  AND `settlement`.`final_receivable` <>
    `settlement`.`supplemental_received_amount` +
    `settlement`.`supplemental_outstanding_amount`;

-- Old inspection deductions had no supplemental bill. Create exactly one collectible
-- bill so the existing supplemental-payment transaction can allocate the receipt.
INSERT INTO `rent_bills` (
  `bill_no`, `contract_id`, `period_seq`, `period_start`, `period_end`,
  `due_date`, `unit_monthly_rent`, `base_rent_amount`, `payable_amount`,
  `received_amount`, `outstanding_amount`, `status`, `bill_category`,
  `checkout_settlement_id`
)
SELECT
  CONCAT('TZBS', `settlement`.`settlement_no`),
  `settlement`.`contract_id`,
  (
    SELECT COALESCE(MAX(`existing_bill`.`period_seq`), 0) + 1
    FROM `rent_bills` AS `existing_bill`
    WHERE `existing_bill`.`contract_id` = `settlement`.`contract_id`
  ),
  `settlement`.`actual_checkout_date`,
  `settlement`.`actual_checkout_date`,
  `settlement`.`actual_checkout_date`,
  0,
  0,
  `settlement`.`supplemental_inspection_amount`,
  0,
  `settlement`.`supplemental_inspection_amount`,
  'PENDING',
  'CHECKOUT_SUPPLEMENTAL',
  `settlement`.`id`
FROM `checkout_settlements` AS `settlement`
JOIN `contracts` AS `contract`
  ON `contract`.`id` = `settlement`.`contract_id`
LEFT JOIN `rent_bills` AS `supplemental_bill`
  ON `supplemental_bill`.`checkout_settlement_id` = `settlement`.`id`
WHERE `settlement`.`status` = 'APPROVED'
  AND `contract`.`status` = 'PENDING_CHECKOUT'
  AND `settlement`.`supplemental_required` = TRUE
  AND `settlement`.`supplemental_inspection_amount` > 0
  AND `supplemental_bill`.`id` IS NULL;
