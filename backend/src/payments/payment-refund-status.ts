import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type RefundStatusClient = Pick<Prisma.TransactionClient, 'payment'>;

type CurrentCompletedRefund =
  { paymentRefundId: number } | { checkoutRentRefundAllocationIds: number[] };

export type PaymentRefundStatusResult = {
  allocatedTotal: string;
  completedRefundTotal: string;
  status: 'PARTIALLY_REFUNDED' | 'FULLY_REFUNDED';
};

const amount = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2);

export async function calculatePaymentRefundStatus(
  client: RefundStatusClient,
  input: {
    paymentId: number;
    current: CurrentCompletedRefund;
  },
): Promise<PaymentRefundStatusResult> {
  const currentPaymentRefundId =
    'paymentRefundId' in input.current ? input.current.paymentRefundId : null;
  const currentCheckoutIds = new Set(
    'checkoutRentRefundAllocationIds' in input.current
      ? input.current.checkoutRentRefundAllocationIds
      : [],
  );
  const ordinaryWhere: Prisma.PaymentRefundAllocationWhereInput =
    currentPaymentRefundId === null
      ? { paymentRefund: { approvalStatus: 'APPROVED' } }
      : {
          OR: [
            { paymentRefund: { approvalStatus: 'APPROVED' } },
            { paymentRefundId: currentPaymentRefundId },
          ],
        };
  const checkoutWhere: Prisma.CheckoutRentRefundAllocationWhereInput =
    currentCheckoutIds.size === 0
      ? { status: 'APPLIED' }
      : {
          OR: [{ status: 'APPLIED' }, { id: { in: [...currentCheckoutIds] } }],
        };
  const payment = await client.payment.findUniqueOrThrow({
    where: { id: input.paymentId },
    select: {
      allocations: {
        select: {
          allocatedAmount: true,
          refundAllocations: {
            where: ordinaryWhere,
            select: {
              id: true,
              paymentRefundId: true,
              reversedAmount: true,
              paymentRefund: { select: { approvalStatus: true } },
            },
          },
          checkoutRentRefundAllocations: {
            where: checkoutWhere,
            select: {
              id: true,
              reservedAmount: true,
              status: true,
            },
          },
        },
      },
    },
  });

  const allocatedTotal = payment.allocations.reduce(
    (sum, allocation) => sum.plus(allocation.allocatedAmount),
    new Prisma.Decimal(0),
  );
  const seenCurrentCheckoutIds = new Set<number>();
  let sawCurrentOrdinaryRefund = false;
  const completedRefundTotal = payment.allocations.reduce(
    (paymentTotal, allocation) => {
      const ordinaryRefund = allocation.refundAllocations.reduce(
        (sum, refundAllocation) => {
          const isCurrent =
            currentPaymentRefundId !== null &&
            refundAllocation.paymentRefundId === currentPaymentRefundId;
          if (isCurrent) sawCurrentOrdinaryRefund = true;
          return refundAllocation.paymentRefund.approvalStatus === 'APPROVED' ||
            isCurrent
            ? sum.plus(refundAllocation.reversedAmount)
            : sum;
        },
        new Prisma.Decimal(0),
      );
      const checkoutRefund = allocation.checkoutRentRefundAllocations.reduce(
        (sum, checkoutAllocation) => {
          const isCurrent = currentCheckoutIds.has(checkoutAllocation.id);
          if (isCurrent) seenCurrentCheckoutIds.add(checkoutAllocation.id);
          return checkoutAllocation.status === 'APPLIED' || isCurrent
            ? sum.plus(checkoutAllocation.reservedAmount)
            : sum;
        },
        new Prisma.Decimal(0),
      );
      return paymentTotal.plus(ordinaryRefund).plus(checkoutRefund);
    },
    new Prisma.Decimal(0),
  );
  const allocated = amount(allocatedTotal);
  const refunded = amount(completedRefundTotal);
  if (
    allocated.lte(0) ||
    refunded.lt(0) ||
    refunded.gt(allocated) ||
    (currentPaymentRefundId !== null && !sawCurrentOrdinaryRefund) ||
    seenCurrentCheckoutIds.size !== currentCheckoutIds.size
  )
    throw new BadRequestException(
      '收款退款累计金额异常，不能更新收款退款状态。',
    );

  return {
    allocatedTotal: allocated.toFixed(2),
    completedRefundTotal: refunded.toFixed(2),
    status: refunded.equals(allocated)
      ? 'FULLY_REFUNDED'
      : 'PARTIALLY_REFUNDED',
  };
}
