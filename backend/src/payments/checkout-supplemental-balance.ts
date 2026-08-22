import { Prisma } from '@prisma/client';

export async function reopenCheckoutSupplementalBalance(
  tx: Prisma.TransactionClient,
  contractId: number,
  paymentCategory: string,
  reversedAmount: Prisma.Decimal.Value,
) {
  if (paymentCategory !== 'CHECKOUT_SUPPLEMENTAL') return;
  const settlement = await tx.checkoutSettlement.findFirst({
    where: { contractId, supplementalRequired: true },
    orderBy: { id: 'desc' },
    select: {
      id: true,
      supplementalArrearsAmount: true,
      supplementalInspectionAmount: true,
      supplementalReceivedAmount: true,
    },
  });
  if (!settlement) return;
  const total = new Prisma.Decimal(settlement.supplementalArrearsAmount)
    .plus(settlement.supplementalInspectionAmount)
    .toDecimalPlaces(2);
  const received = Prisma.Decimal.max(
    0,
    new Prisma.Decimal(settlement.supplementalReceivedAmount).minus(
      reversedAmount,
    ),
  ).toDecimalPlaces(2);
  await tx.checkoutSettlement.update({
    where: { id: settlement.id },
    data: {
      supplementalReceivedAmount: received,
      supplementalOutstandingAmount: total.minus(received).toDecimalPlaces(2),
      supplementalCollectedAt: null,
    },
  });
}
