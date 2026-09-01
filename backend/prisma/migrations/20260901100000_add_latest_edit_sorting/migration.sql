ALTER TABLE `export_tasks`
  ADD COLUMN `updated_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER `created_at`;
ALTER TABLE `rent_bills`
  ADD COLUMN `updated_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER `checkout_settlement_id`;
ALTER TABLE `payments`
  ADD COLUMN `updated_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER `remark`;
ALTER TABLE `payment_refunds`
  ADD COLUMN `updated_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER `rejected_reason`;
ALTER TABLE `checkout_settlements`
  ADD COLUMN `updated_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER `remark`;
ALTER TABLE `deposit_refunds`
  ADD COLUMN `updated_at` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3) AFTER `cancelled_reason`;

UPDATE `export_tasks`
SET `updated_at` = COALESCE(`completed_at`, `started_at`, `created_at`);

UPDATE `payments`
SET `updated_at` = COALESCE(`voided_at`, CAST(`payment_date` AS DATETIME(3)));

UPDATE `payment_refunds`
SET `updated_at` = COALESCE(`approved_at`, `submitted_at`, CAST(`refund_date` AS DATETIME(3)));

UPDATE `checkout_settlements` AS cs
LEFT JOIN (
  SELECT rsh.`business_id` AS `settlement_id`, MAX(rsh.`changed_at`) AS `latest_at`
  FROM `room_status_histories` AS rsh
  WHERE rsh.`business_type` = 'CHECKOUT'
    AND rsh.`to_status` <> 'PENDING_CHECKOUT'
  GROUP BY rsh.`business_id`
) AS checkout_history ON checkout_history.`settlement_id` = cs.`id`
LEFT JOIN (
  SELECT dr.`checkout_settlement_id` AS `settlement_id`, MAX(rsh.`changed_at`) AS `latest_at`
  FROM `deposit_refunds` AS dr
  INNER JOIN `room_status_histories` AS rsh
    ON rsh.`business_type` = 'DEPOSIT_REFUND'
   AND rsh.`business_id` = dr.`id`
   AND rsh.`to_status` <> 'PENDING_CHECKOUT'
  GROUP BY dr.`checkout_settlement_id`
) AS refund_history ON refund_history.`settlement_id` = cs.`id`
SET cs.`updated_at` = GREATEST(
  COALESCE(
    checkout_history.`latest_at`,
    CAST('1000-01-01 00:00:00.000' AS DATETIME(3))
  ),
  COALESCE(
    refund_history.`latest_at`,
    CAST('1000-01-01 00:00:00.000' AS DATETIME(3))
  ),
  COALESCE(
    cs.`approved_at`,
    cs.`submitted_at`,
    cs.`inspection_at`,
    CAST(cs.`actual_checkout_date` AS DATETIME(3)),
    CAST(cs.`planned_checkout_date` AS DATETIME(3))
  )
);

UPDATE `deposit_refunds`
SET `updated_at` = COALESCE(`approved_at`, `submitted_at`, CAST(`refund_date` AS DATETIME(3)));

UPDATE `rent_bills` AS rb
LEFT JOIN (
  SELECT events.`rent_bill_id`, MAX(events.`activity_at`) AS `latest_at`
  FROM (
    SELECT pa.`rent_bill_id`, pa.`allocated_at` AS `activity_at`
    FROM `payment_allocations` AS pa
    UNION ALL
    SELECT ba.`rent_bill_id`, COALESCE(ba.`approved_at`, ba.`submitted_at`) AS `activity_at`
    FROM `bill_adjustments` AS ba
    UNION ALL
    SELECT pr.`rent_bill_id`, pr.`updated_at` AS `activity_at`
    FROM `pricing_rebates` AS pr
    WHERE pr.`rent_bill_id` IS NOT NULL
    UNION ALL
    SELECT pt.`rent_bill_id`, pt.`occurred_at` AS `activity_at`
    FROM `prepayment_transactions` AS pt
    WHERE pt.`rent_bill_id` IS NOT NULL
    UNION ALL
    SELECT dt.`rent_bill_id`, dt.`occurred_at` AS `activity_at`
    FROM `deposit_transactions` AS dt
    WHERE dt.`rent_bill_id` IS NOT NULL
  ) AS events
  GROUP BY events.`rent_bill_id`
) AS activity ON activity.`rent_bill_id` = rb.`id`
SET rb.`updated_at` = COALESCE(
  activity.`latest_at`,
  TIMESTAMPADD(SECOND, rb.`id`, CAST('2000-01-01 00:00:00.000' AS DATETIME(3)))
);

ALTER TABLE `export_tasks`
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD KEY `idx_export_tasks_updated_at_id` (`updated_at`, `id`);
ALTER TABLE `rent_bills`
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD KEY `idx_rent_bills_updated_at_id` (`updated_at`, `id`);
ALTER TABLE `payments`
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD KEY `idx_payments_updated_at_id` (`updated_at`, `id`);
ALTER TABLE `payment_refunds`
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD KEY `idx_payment_refunds_updated_at_id` (`updated_at`, `id`);
ALTER TABLE `checkout_settlements`
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD KEY `idx_checkout_settlements_updated_at_id` (`updated_at`, `id`);
ALTER TABLE `deposit_refunds`
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD KEY `idx_deposit_refunds_updated_at_id` (`updated_at`, `id`);