import type { CheckoutSettlementStatus, RentBillStatus } from '@prisma/client';

export const ACTIVE_CHECKOUT_CUTOFF_STATUSES: CheckoutSettlementStatus[] = [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
];

type CutoffSettlement = {
  status: CheckoutSettlementStatus;
  actualCheckoutDate: Date | null;
};

export function resolveCheckoutCutoff(rows: CutoffSettlement[]): Date | null {
  return (
    rows.find(
      (row) =>
        ACTIVE_CHECKOUT_CUTOFF_STATUSES.includes(row.status) &&
        row.actualCheckoutDate,
    )?.actualCheckoutDate ?? null
  );
}

export function isRentBillPerformed(periodStart: Date, cutoff: Date | null) {
  return cutoff === null || periodStart.getTime() < cutoff.getTime();
}

export function effectiveRentBillStatus(
  status: RentBillStatus,
  periodStart: Date,
  cutoff: Date | null,
): RentBillStatus | 'PENDING_CHECKOUT_REVIEW' {
  if (['VOIDED', 'REFUNDED'].includes(status)) return status;
  return isRentBillPerformed(periodStart, cutoff)
    ? status
    : 'PENDING_CHECKOUT_REVIEW';
}
