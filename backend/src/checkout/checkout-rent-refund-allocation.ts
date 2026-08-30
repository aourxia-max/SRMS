import { Prisma } from '@prisma/client';

export type RentRefundCandidate = {
  paymentAllocationId: number;
  paymentId: number;
  rentBillId: number;
  periodStart: Date;
  periodEnd: Date;
  paymentDate: Date;
  availableAmount: Prisma.Decimal.Value;
};

export type CheckoutRentRefundPlan = {
  maxRefundableAmount: string;
  requestedAmount: string;
  allocations: Array<{
    paymentAllocationId: number;
    paymentId: number;
    rentBillId: number;
    amount: string;
  }>;
};

export class CheckoutRentRefundExceedsAvailableError extends Error {
  constructor(readonly maxRefundableAmount: string) {
    super('Requested checkout rent refund exceeds available amount');
    this.name = 'CheckoutRentRefundExceedsAvailableError';
  }
}

const amount = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2);

const isCurrentOrFuturePeriod = (
  candidate: RentRefundCandidate,
  actualCheckoutDate: Date,
) =>
  candidate.periodStart > actualCheckoutDate ||
  (candidate.periodStart <= actualCheckoutDate &&
    candidate.periodEnd >= actualCheckoutDate);

function compareCandidates(
  left: RentRefundCandidate,
  right: RentRefundCandidate,
) {
  const periodStartComparison =
    right.periodStart.getTime() - left.periodStart.getTime();
  if (periodStartComparison !== 0) return periodStartComparison;

  const paymentDateComparison =
    right.paymentDate.getTime() - left.paymentDate.getTime();
  if (paymentDateComparison !== 0) return paymentDateComparison;

  return right.paymentAllocationId - left.paymentAllocationId;
}

export function allocateCheckoutRentRefund(input: {
  actualCheckoutDate: Date;
  requestedAmount: Prisma.Decimal.Value;
  candidates: RentRefundCandidate[];
}): CheckoutRentRefundPlan {
  const requestedAmount = amount(input.requestedAmount);
  const candidates = input.candidates
    .filter((candidate) =>
      isCurrentOrFuturePeriod(candidate, input.actualCheckoutDate),
    )
    .filter((candidate) => amount(candidate.availableAmount).gt(0))
    .sort(compareCandidates);
  const maxRefundable = candidates.reduce(
    (total, candidate) => total.plus(amount(candidate.availableAmount)),
    new Prisma.Decimal(0),
  );
  const maxRefundableAmount = maxRefundable.toFixed(2);

  if (requestedAmount.gt(maxRefundable)) {
    throw new CheckoutRentRefundExceedsAvailableError(maxRefundableAmount);
  }

  let remaining = requestedAmount;
  const allocations: CheckoutRentRefundPlan['allocations'] = [];
  for (const candidate of candidates) {
    if (remaining.lte(0)) break;
    const allocated = Prisma.Decimal.min(
      remaining,
      amount(candidate.availableAmount),
    );
    allocations.push({
      paymentAllocationId: candidate.paymentAllocationId,
      paymentId: candidate.paymentId,
      rentBillId: candidate.rentBillId,
      amount: allocated.toFixed(2),
    });
    remaining = remaining.minus(allocated);
  }

  return {
    maxRefundableAmount,
    requestedAmount: requestedAmount.toFixed(2),
    allocations,
  };
}
