import { Prisma } from '@prisma/client';

type CheckoutAmountsInput = {
  depositBalance: Prisma.Decimal.Value;
  prepaymentBalance: Prisma.Decimal.Value;
  rentOutstanding: Prisma.Decimal.Value;
  otherCharges: Prisma.Decimal.Value;
  rentRefundAmount?: Prisma.Decimal.Value;
};

const amount = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2);
const money = (value: Prisma.Decimal.Value) => amount(value).toFixed(2);

export function calculateCheckoutAmounts(input: CheckoutAmountsInput) {
  const deposit = amount(input.depositBalance);
  const prepayment = amount(input.prepaymentBalance);
  const arrears = amount(input.rentOutstanding);
  const charges = amount(input.otherCharges);
  const rentRefund = amount(input.rentRefundAmount ?? 0);
  const depositOffset = Prisma.Decimal.min(deposit, arrears);
  const afterArrears = deposit.minus(depositOffset);
  const otherDeduction = Prisma.Decimal.min(afterArrears, charges);
  const depositRefundable = afterArrears.minus(otherDeduction);
  const supplementalArrears = Prisma.Decimal.max(
    new Prisma.Decimal(0),
    arrears.minus(depositOffset),
  );
  const supplementalInspection = Prisma.Decimal.max(
    new Prisma.Decimal(0),
    charges.minus(otherDeduction),
  );
  const finalReceivable = supplementalArrears.plus(supplementalInspection);

  return {
    depositOffsetAmount: money(depositOffset),
    otherDeductionAmount: money(otherDeduction),
    depositRefundableAmount: money(depositRefundable),
    prepaymentRefundableAmount: money(prepayment),
    rentRefundableAmount: money(rentRefund),
    totalRefundAmount: money(
      depositRefundable.plus(prepayment).plus(rentRefund),
    ),
    supplementalArrearsAmount: money(supplementalArrears),
    supplementalInspectionAmount: money(supplementalInspection),
    finalReceivable: money(finalReceivable),
  };
}
