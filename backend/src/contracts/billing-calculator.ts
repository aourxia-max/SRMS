import { Prisma } from '@prisma/client';

export type BillingPeriod = {
  sequence: number;
  start: Date;
  end: Date;
  isPartialTail: boolean;
};

function addMonths(date: Date, months: number) {
  const value = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      date.getUTCDate(),
    ),
  );
  if (value.getUTCDate() !== date.getUTCDate()) value.setUTCDate(0);
  return value;
}
function dayBefore(date: Date) {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() - 1);
  return value;
}
function daysInclusive(start: Date, end: Date) {
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

export function buildBillingPeriods(start: Date, end: Date): BillingPeriod[] {
  const periods: BillingPeriod[] = [];
  let cursor = new Date(start);
  let sequence = 1;
  while (cursor <= end) {
    const next = addMonths(cursor, 1);
    const fullEnd = dayBefore(next);
    const periodEnd = fullEnd > end ? end : fullEnd;
    periods.push({
      sequence,
      start: cursor,
      end: periodEnd,
      isPartialTail: periodEnd.getTime() !== fullEnd.getTime(),
    });
    cursor = new Date(periodEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    sequence += 1;
  }
  return periods;
}

export function billAmount(
  monthlyRent: Prisma.Decimal.Value,
  period: BillingPeriod,
) {
  const rent = new Prisma.Decimal(monthlyRent);
  return period.isPartialTail
    ? rent
        .div(30)
        .mul(daysInclusive(period.start, period.end))
        .toDecimalPlaces(2)
    : rent.toDecimalPlaces(2);
}

export function tierForPeriod<T extends { thresholdMonths: number }>(
  tiers: T[],
  periodSequence: number,
) {
  return [...tiers]
    .filter((tier) => tier.thresholdMonths < periodSequence)
    .sort((a, b) => b.thresholdMonths - a.thresholdMonths)[0];
}

export function payableAmount(
  baseRent: Prisma.Decimal.Value,
  rentFree: Prisma.Decimal.Value = 0,
  discount: Prisma.Decimal.Value = 0,
  adjustment: Prisma.Decimal.Value = 0,
) {
  return Prisma.Decimal.max(
    new Prisma.Decimal(0),
    new Prisma.Decimal(baseRent)
      .minus(rentFree)
      .minus(discount)
      .plus(adjustment),
  ).toDecimalPlaces(2);
}

export function overlapDays(
  start: Date,
  end: Date,
  rangeStart: Date,
  rangeEnd: Date,
) {
  const left = start > rangeStart ? start : rangeStart;
  const right = end < rangeEnd ? end : rangeEnd;
  return left > right ? 0 : daysInclusive(left, right);
}

export function rentFreeAmount(
  monthlyRent: Prisma.Decimal.Value,
  period: BillingPeriod,
  freeStart: Date,
  freeEnd: Date,
) {
  return new Prisma.Decimal(monthlyRent)
    .div(30)
    .mul(overlapDays(period.start, period.end, freeStart, freeEnd))
    .toDecimalPlaces(2);
}

export function percentageDiscountAmount(
  baseRent: Prisma.Decimal.Value,
  discountRate: Prisma.Decimal.Value,
) {
  return new Prisma.Decimal(baseRent).mul(discountRate).toDecimalPlaces(2);
}

export function fixedDiscountForPeriod(
  total: Prisma.Decimal.Value,
  periodSequence: number,
  periodCount: number,
) {
  if (periodSequence > periodCount) return new Prisma.Decimal(0);
  const perPeriod = new Prisma.Decimal(total)
    .div(periodCount)
    .toDecimalPlaces(2);
  return periodSequence === periodCount
    ? new Prisma.Decimal(total).minus(perPeriod.mul(periodCount - 1))
    : perPeriod;
}
