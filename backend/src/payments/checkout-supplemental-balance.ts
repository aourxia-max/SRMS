import { BadRequestException } from '@nestjs/common';
import { CheckoutSettlementStatus, Prisma } from '@prisma/client';
const protectedCheckoutArrears = {
  itemType: 'RENT_ARREARS' as const,
  settlement: {
    status: {
      in: [
        CheckoutSettlementStatus.APPROVED,
        CheckoutSettlementStatus.COMPLETED,
      ],
    },
    supplementalRequired: true,
  },
};

export function assertPaymentIsNotContractAutomaticDeposit(payment: {
  paymentCategory: string;
  autoSourceKey?: string | null;
}) {
  if (
    payment.paymentCategory === 'DEPOSIT' &&
    payment.autoSourceKey?.startsWith('CONTRACT_INITIAL_DEPOSIT:')
  ) {
    throw new BadRequestException(
      '合同自动入账押金不能通过通用收款修改、退款或作废，请使用押金专用流程',
    );
  }
}

export async function assertRentBillNotProtectedByCheckout(
  tx: Prisma.TransactionClient,
  rentBillId: number,
) {
  const protectedItem = await tx.checkoutSettlementItem.findFirst({
    where: { rentBillId, ...protectedCheckoutArrears },
    select: { id: true },
  });
  if (protectedItem)
    throw new BadRequestException('该欠租账单已锁定到退租补收，不能修改');
}

export async function assertPaymentDoesNotTouchProtectedCheckoutArrears(
  tx: Prisma.TransactionClient,
  paymentId: number,
) {
  const protectedAllocation = await tx.paymentAllocation.findFirst({
    where: {
      paymentId,
      rentBill: {
        checkoutSettlementItems: { some: protectedCheckoutArrears },
      },
    },
    select: { id: true },
  });
  if (protectedAllocation)
    throw new BadRequestException(
      '该收款已用于退租补收锁定的欠租，不能修改、退款或作废',
    );
}

export async function assertPaymentReversalRequestAllowed(
  tx: Prisma.TransactionClient,
  payment: {
    id: number;
    contractId: number;
    paymentCategory: string;
    autoSourceKey?: string | null;
  },
) {
  assertPaymentIsNotContractAutomaticDeposit(payment);
  if (payment.paymentCategory !== 'CHECKOUT_SUPPLEMENTAL') {
    await assertPaymentDoesNotTouchProtectedCheckoutArrears(tx, payment.id);
    return;
  }
  const settlement = await tx.checkoutSettlement.findFirst({
    where: { contractId: payment.contractId, supplementalRequired: true },
    orderBy: { id: 'desc' },
    select: { status: true },
  });
  if (settlement?.status === CheckoutSettlementStatus.COMPLETED)
    throw new BadRequestException('退租已完成，不能再退款或作废退租补收款');
}
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
      status: true,
      supplementalArrearsAmount: true,
      supplementalInspectionAmount: true,
      supplementalReceivedAmount: true,
    },
  });
  if (!settlement) return;
  if (settlement.status === 'COMPLETED')
    throw new BadRequestException('退租已完成，不能再退款或作废退租补收款');
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

export async function assertNoPendingCheckoutSupplementalReversal(
  tx: Prisma.TransactionClient,
  contractId: number,
) {
  const pending = await tx.payment.findFirst({
    where: {
      contractId,
      AND: [
        {
          OR: [
            { paymentCategory: 'CHECKOUT_SUPPLEMENTAL' },
            {
              allocations: {
                some: {
                  rentBill: {
                    checkoutSettlementItems: {
                      some: protectedCheckoutArrears,
                    },
                  },
                },
              },
            },
          ],
        },
        {
          OR: [
            { refunds: { some: { approvalStatus: 'PENDING' } } },
            { voidRequests: { some: { approvalStatus: 'PENDING' } } },
          ],
        },
      ],
    },
    select: { id: true },
  });
  if (pending)
    throw new BadRequestException('退租补收款存在待审批退款或作废申请');
}
