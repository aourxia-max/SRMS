import { ConflictException } from '@nestjs/common';
import { Prisma, type RentBill } from '@prisma/client';
import { isRentBillPerformed } from './checkout-accounting-cutoff';
import type { CheckoutRentRefundPlan } from './checkout-rent-refund-allocation';

export const CHECKOUT_ACCOUNTING_CHANGED_MESSAGE =
  '实际退房日期或账单已变化，请重新预估结算金额';

type LinkedItem = {
  itemType: string;
  rentBillId?: number | null;
  amount: Prisma.Decimal.Value;
};

export function assertCheckoutBillItemsCurrent(
  items: readonly LinkedItem[],
  eligibleBills: ReadonlyArray<Pick<RentBill, 'id' | 'outstandingAmount'>>,
  checkOutstanding = true,
) {
  const arrearsIds = new Set<number>();
  for (const item of items) {
    if (item.itemType !== 'RENT_ARREARS' && item.rentBillId == null) continue;
    const bill = eligibleBills.find((bill) => bill.id === item.rentBillId);
    if (!bill) throw new ConflictException(CHECKOUT_ACCOUNTING_CHANGED_MESSAGE);
    if (item.itemType !== 'RENT_ARREARS') continue;
    if (
      arrearsIds.has(bill.id) ||
      (checkOutstanding &&
        new Prisma.Decimal(item.amount).gt(bill.outstandingAmount))
    )
      throw new ConflictException(CHECKOUT_ACCOUNTING_CHANGED_MESSAGE);
    arrearsIds.add(bill.id);
  }
}

export function assertCheckoutFinalAccountingCurrent(
  items: readonly LinkedItem[],
  bills: ReadonlyArray<
    Pick<
      RentBill,
      'id' | 'periodStart' | 'billCategory' | 'status' | 'outstandingAmount'
    >
  >,
  actualCheckoutDate: Date,
) {
  const effectiveBills = bills.filter(
    (bill) => !['VOIDED', 'REFUNDED'].includes(bill.status),
  );
  const performedBills = effectiveBills.filter(
    (bill) =>
      bill.billCategory === 'RENT' &&
      isRentBillPerformed(bill.periodStart, actualCheckoutDate),
  );
  assertCheckoutBillItemsCurrent(items, performedBills, false);
  if (
    effectiveBills.some(
      (bill) =>
        (bill.billCategory === 'CHECKOUT_SUPPLEMENTAL' ||
          isRentBillPerformed(bill.periodStart, actualCheckoutDate)) &&
        new Prisma.Decimal(bill.outstandingAmount).gt(0),
    )
  )
    throw new ConflictException(CHECKOUT_ACCOUNTING_CHANGED_MESSAGE);
}

export function assertCheckoutRentRefundPlanCurrent(
  reservations: ReadonlyArray<{
    paymentAllocationId: number;
    paymentId: number;
    rentBillId: number;
    reservedAmount: Prisma.Decimal.Value;
  }>,
  allocations: CheckoutRentRefundPlan['allocations'],
) {
  const stored = reservations
    .map(
      (row) =>
        `${row.paymentAllocationId}:${row.paymentId}:${row.rentBillId}:${new Prisma.Decimal(row.reservedAmount).toFixed(2)}`,
    )
    .sort();
  const current = allocations
    .map(
      (row) =>
        `${row.paymentAllocationId}:${row.paymentId}:${row.rentBillId}:${new Prisma.Decimal(row.amount).toFixed(2)}`,
    )
    .sort();
  if (
    stored.length !== current.length ||
    stored.some((value, index) => value !== current[index])
  )
    throw new ConflictException(CHECKOUT_ACCOUNTING_CHANGED_MESSAGE);
}
