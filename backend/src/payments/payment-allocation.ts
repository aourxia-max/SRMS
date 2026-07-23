import { Prisma } from '@prisma/client';

export type AllocatableBill = {
  id: number;
  outstandingAmount: Prisma.Decimal.Value;
};

export function allocatePayment(
  amount: Prisma.Decimal.Value,
  bills: AllocatableBill[],
) {
  let remaining = new Prisma.Decimal(amount);
  const allocations: Array<{ rentBillId: number; amount: Prisma.Decimal }> = [];
  for (const bill of bills) {
    if (remaining.lte(0)) break;
    const outstanding = new Prisma.Decimal(bill.outstandingAmount);
    if (outstanding.lte(0)) continue;
    const allocated = Prisma.Decimal.min(
      remaining,
      outstanding,
    ).toDecimalPlaces(2);
    allocations.push({ rentBillId: bill.id, amount: allocated });
    remaining = remaining.minus(allocated);
  }
  return { allocations, prepaymentAmount: remaining.toDecimalPlaces(2) };
}
