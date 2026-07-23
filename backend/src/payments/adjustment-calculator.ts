import { AdjustmentDirection, Prisma, RentBillStatus } from '@prisma/client';

export function calculateAdjustedBill(input: {
  baseRentAmount: Prisma.Decimal.Value;
  rentFreeAmount: Prisma.Decimal.Value;
  discountAmount: Prisma.Decimal.Value;
  currentAdjustmentAmount: Prisma.Decimal.Value;
  receivedAmount: Prisma.Decimal.Value;
  direction: AdjustmentDirection;
  amount: Prisma.Decimal.Value;
}) {
  const adjustmentAmount = new Prisma.Decimal(input.currentAdjustmentAmount)
    .plus(
      input.direction === 'DECREASE'
        ? new Prisma.Decimal(input.amount).negated()
        : input.amount,
    )
    .toDecimalPlaces(2);
  const payableAmount = Prisma.Decimal.max(
    0,
    new Prisma.Decimal(input.baseRentAmount)
      .minus(input.rentFreeAmount)
      .minus(input.discountAmount)
      .plus(adjustmentAmount),
  ).toDecimalPlaces(2);
  const outstandingAmount = Prisma.Decimal.max(
    0,
    payableAmount.minus(input.receivedAmount),
  ).toDecimalPlaces(2);
  const status: RentBillStatus = outstandingAmount.isZero()
    ? 'PAID'
    : new Prisma.Decimal(input.receivedAmount).gt(0)
      ? 'PARTIAL'
      : 'PENDING';
  return { adjustmentAmount, payableAmount, outstandingAmount, status };
}
