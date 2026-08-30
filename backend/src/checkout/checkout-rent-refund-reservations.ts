import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  allocateCheckoutRentRefund,
  CheckoutRentRefundExceedsAvailableError,
  type CheckoutRentRefundPlan,
  type RentRefundCandidate,
} from './checkout-rent-refund-allocation';

export const CHECKOUT_RENT_REFUND_RESERVATION_CONFLICT_MESSAGE =
  '相关租金已被退租退款流程占用，不能重复退款或作废。';

export const CHECKOUT_RENT_REFUND_RESERVATION_CHANGED_MESSAGE =
  '退租退款预留明细已变化，请退回草稿后重新提交。';

export type CheckoutRentRefundCandidate = RentRefundCandidate & {
  billNo: string;
};

type CandidateClient = Pick<Prisma.TransactionClient, 'paymentAllocation'>;

type ReserveCheckoutRentRefundInput = {
  settlementId: number;
  settlementItemId: number;
  contractId: number;
  actualCheckoutDate: Date;
  requestedAmount: Prisma.Decimal.Value;
};

const translateAllocationError = (error: unknown): never => {
  if (error instanceof CheckoutRentRefundExceedsAvailableError) {
    if (error.maxRefundableAmount === '0.00')
      throw new BadRequestException('当前合同没有可回冲的已缴租金。');
    throw new BadRequestException(
      `退还租金不能超过当前可回冲金额 ¥${error.maxRefundableAmount}。`,
    );
  }
  throw error;
};

export async function loadCheckoutRentRefundCandidates(
  client: CandidateClient,
  contractId: number,
  currentSettlementId: number,
): Promise<CheckoutRentRefundCandidate[]> {
  const allocations = await client.paymentAllocation.findMany({
    where: {
      payment: {
        contractId,
        paymentCategory: 'RENT',
        status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED'] },
      },
      rentBill: { billCategory: 'RENT' },
    },
    select: {
      id: true,
      paymentId: true,
      rentBillId: true,
      allocatedAmount: true,
      reversedAmount: true,
      payment: {
        select: {
          paymentDate: true,
          voidRequests: {
            where: { approvalStatus: 'PENDING' },
            select: { id: true },
          },
        },
      },
      rentBill: {
        select: { billNo: true, periodStart: true, periodEnd: true },
      },
      refundAllocations: {
        where: { paymentRefund: { approvalStatus: 'PENDING' } },
        select: { reversedAmount: true },
      },
      checkoutRentRefundAllocations: {
        where: { status: 'RESERVED' },
        select: {
          reservedAmount: true,
          item: { select: { checkoutSettlementId: true } },
        },
      },
    },
  });

  return allocations.map((allocation) => {
    const pendingRefundAmount = allocation.refundAllocations.reduce(
      (sum, item) => sum.plus(item.reversedAmount),
      new Prisma.Decimal(0),
    );
    const reservedRentRefundAmount =
      allocation.checkoutRentRefundAllocations.reduce(
        (sum, item) =>
          item.item.checkoutSettlementId === currentSettlementId
            ? sum
            : sum.plus(item.reservedAmount),
        new Prisma.Decimal(0),
      );
    const availableAmount = allocation.payment.voidRequests.length
      ? new Prisma.Decimal(0)
      : Prisma.Decimal.max(
          new Prisma.Decimal(0),
          new Prisma.Decimal(allocation.allocatedAmount)
            .minus(allocation.reversedAmount)
            .minus(pendingRefundAmount)
            .minus(reservedRentRefundAmount),
        ).toDecimalPlaces(2);

    return {
      paymentAllocationId: allocation.id,
      paymentId: allocation.paymentId,
      rentBillId: allocation.rentBillId,
      periodStart: allocation.rentBill.periodStart,
      periodEnd: allocation.rentBill.periodEnd,
      paymentDate: allocation.payment.paymentDate,
      billNo: allocation.rentBill.billNo,
      availableAmount,
    };
  });
}

export async function planCheckoutRentRefund(
  client: CandidateClient,
  input: {
    contractId: number;
    currentSettlementId: number;
    actualCheckoutDate: Date;
    requestedAmount: Prisma.Decimal.Value;
  },
): Promise<{
  plan: CheckoutRentRefundPlan;
  candidates: CheckoutRentRefundCandidate[];
}> {
  const candidates = await loadCheckoutRentRefundCandidates(
    client,
    input.contractId,
    input.currentSettlementId,
  );
  try {
    return {
      plan: allocateCheckoutRentRefund({
        actualCheckoutDate: input.actualCheckoutDate,
        requestedAmount: input.requestedAmount,
        candidates,
      }),
      candidates,
    };
  } catch (error) {
    return translateAllocationError(error);
  }
}

async function lockCheckoutRentRefundAvailability(
  tx: Prisma.TransactionClient,
  contractId: number,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT rb.id FROM rent_bills rb WHERE rb.contract_id = ${contractId} AND rb.bill_category = 'RENT' ORDER BY rb.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT p.id FROM payments p WHERE p.contract_id = ${contractId} AND p.payment_category = 'RENT' ORDER BY p.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT pa.id FROM payment_allocations pa INNER JOIN payments p ON p.id = pa.payment_id WHERE p.contract_id = ${contractId} ORDER BY pa.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT pra.id FROM payment_refund_allocations pra INNER JOIN payment_refunds pr ON pr.id = pra.payment_refund_id WHERE pr.contract_id = ${contractId} AND pr.approval_status = 'PENDING' ORDER BY pra.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT pvr.id FROM payment_void_requests pvr INNER JOIN payments p ON p.id = pvr.payment_id WHERE p.contract_id = ${contractId} AND pvr.approval_status = 'PENDING' ORDER BY pvr.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT crra.id FROM checkout_rent_refund_allocations crra INNER JOIN payments p ON p.id = crra.payment_id WHERE p.contract_id = ${contractId} AND crra.status = 'RESERVED' ORDER BY crra.id FOR UPDATE`,
  );
}

async function lockSettlementReservations(
  tx: Prisma.TransactionClient,
  settlementId: number,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT crra.id FROM checkout_rent_refund_allocations crra INNER JOIN checkout_settlement_items csi ON csi.id = crra.checkout_settlement_item_id WHERE csi.checkout_settlement_id = ${settlementId} AND crra.status = 'RESERVED' ORDER BY crra.id FOR UPDATE`,
  );
}

export async function releaseCheckoutRentRefund(
  tx: Prisma.TransactionClient,
  settlementId: number,
  reason: string,
) {
  void reason;
  await lockSettlementReservations(tx, settlementId);
  return tx.checkoutRentRefundAllocation.updateMany({
    where: {
      status: 'RESERVED',
      item: { checkoutSettlementId: settlementId },
    },
    data: { status: 'RELEASED', releasedAt: new Date() },
  });
}

export async function reserveCheckoutRentRefund(
  tx: Prisma.TransactionClient,
  input: ReserveCheckoutRentRefundInput,
) {
  await lockCheckoutRentRefundAvailability(tx, input.contractId);
  await releaseCheckoutRentRefund(tx, input.settlementId, '重新提交');
  const { plan } = await planCheckoutRentRefund(tx, {
    contractId: input.contractId,
    currentSettlementId: input.settlementId,
    actualCheckoutDate: input.actualCheckoutDate,
    requestedAmount: input.requestedAmount,
  });

  if (plan.allocations.length) {
    await tx.checkoutRentRefundAllocation.createMany({
      data: plan.allocations.map((allocation) => ({
        checkoutSettlementItemId: input.settlementItemId,
        paymentAllocationId: allocation.paymentAllocationId,
        paymentId: allocation.paymentId,
        rentBillId: allocation.rentBillId,
        reservedAmount: new Prisma.Decimal(allocation.amount),
        status: 'RESERVED' as const,
      })),
    });
  }
  return plan;
}

export async function assertNoCheckoutRentRefundReservation(
  tx: Prisma.TransactionClient,
  paymentId: number,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT crra.id FROM checkout_rent_refund_allocations crra WHERE crra.payment_id = ${paymentId} AND crra.status = 'RESERVED' ORDER BY crra.id FOR UPDATE`,
  );
  const reservation = await tx.checkoutRentRefundAllocation.findFirst({
    where: { paymentId, status: 'RESERVED' },
    select: { id: true },
  });
  if (reservation)
    throw new BadRequestException(
      CHECKOUT_RENT_REFUND_RESERVATION_CONFLICT_MESSAGE,
    );
}

export async function assertCheckoutRentRefundReservationMatches(
  tx: Prisma.TransactionClient,
  settlementId: number,
  expectedAmount: Prisma.Decimal.Value,
) {
  await lockSettlementReservations(tx, settlementId);
  const reservations = await tx.checkoutRentRefundAllocation.findMany({
    where: {
      status: 'RESERVED',
      item: { checkoutSettlementId: settlementId },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      paymentAllocationId: true,
      paymentId: true,
      rentBillId: true,
      reservedAmount: true,
      item: {
        select: {
          checkoutSettlementId: true,
          itemType: true,
          amount: true,
        },
      },
      paymentAllocation: { select: { paymentId: true, rentBillId: true } },
    },
  });
  const expected = new Prisma.Decimal(expectedAmount).toDecimalPlaces(2);
  const total = reservations.reduce(
    (sum, reservation) => sum.plus(reservation.reservedAmount),
    new Prisma.Decimal(0),
  );
  const detailsValid = reservations.every(
    (reservation) =>
      reservation.item.checkoutSettlementId === settlementId &&
      reservation.item.itemType === 'RENT_REFUND' &&
      new Prisma.Decimal(reservation.item.amount)
        .toDecimalPlaces(2)
        .equals(expected) &&
      reservation.paymentId === reservation.paymentAllocation.paymentId &&
      reservation.rentBillId === reservation.paymentAllocation.rentBillId &&
      new Prisma.Decimal(reservation.reservedAmount).gt(0),
  );
  if (!total.toDecimalPlaces(2).equals(expected) || !detailsValid)
    throw new BadRequestException(
      CHECKOUT_RENT_REFUND_RESERVATION_CHANGED_MESSAGE,
    );
}
