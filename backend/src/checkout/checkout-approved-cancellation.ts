import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, type RentBillStatus } from '@prisma/client';
import { reverseFutureCheckoutBillNormalization } from './checkout-future-bill-normalization';

type ApprovedCheckoutCancellationInput = {
  settlementId: number;
  contractId: number;
  actualCheckoutDate: Date;
  operatorId: number;
  occurredAt: Date;
};

const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2);

function restoredBillStatus(input: {
  receivedAmount: Prisma.Decimal;
  outstandingAmount: Prisma.Decimal;
  dueDate: Date;
  occurredAt: Date;
}): RentBillStatus {
  if (input.outstandingAmount.isZero()) return 'PAID';
  if (input.receivedAmount.gt(0)) return 'PARTIAL';
  return input.dueDate.getTime() < input.occurredAt.getTime()
    ? 'OVERDUE'
    : 'PENDING';
}

export async function rollbackApprovedCheckout(
  tx: Prisma.TransactionClient,
  input: ApprovedCheckoutCancellationInput,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM deposit_refunds WHERE checkout_settlement_id = ${input.settlementId} AND approval_status IN ('PENDING', 'APPROVED') ORDER BY id FOR UPDATE`,
  );
  const refunds = await tx.depositRefund.findMany({
    where: {
      checkoutSettlementId: input.settlementId,
      approvalStatus: { in: ['PENDING', 'APPROVED'] },
    },
    orderBy: { id: 'asc' },
  });
  if (refunds.some((refund) => refund.approvalStatus === 'APPROVED'))
    throw new BadRequestException('实际退款已经确认，不能取消整个退租');

  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM payments WHERE contract_id = ${input.contractId} AND payment_category = 'CHECKOUT_SUPPLEMENTAL' AND status IN ('CONFIRMED', 'PARTIALLY_REFUNDED') ORDER BY id FOR UPDATE`,
  );
  const activeSupplementalPayment = await tx.payment.findFirst({
    where: {
      contractId: input.contractId,
      paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
      status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED'] },
    },
    select: { id: true, receiptNo: true },
  });
  if (activeSupplementalPayment)
    throw new BadRequestException(
      '退租补收款已经确认到账，请先退款或作废退租补收款',
    );

  const pendingRefundIds = refunds
    .filter((refund) => refund.approvalStatus === 'PENDING')
    .map((refund) => refund.id);
  let cancelledRefundCount = 0;
  if (pendingRefundIds.length) {
    const cancelled = await tx.depositRefund.updateMany({
      where: {
        id: { in: pendingRefundIds },
        approvalStatus: 'PENDING',
      },
      data: {
        approvalStatus: 'CANCELLED',
        cancelledReason: '取消整个退租',
      },
    });
    if (cancelled.count !== pendingRefundIds.length)
      throw new ConflictException('退款申请状态已变化，请刷新后重试');
    cancelledRefundCount = cancelled.count;
  }

  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM checkout_rent_refund_allocations WHERE checkout_settlement_item_id IN (SELECT id FROM checkout_settlement_items WHERE checkout_settlement_id = ${input.settlementId}) AND status = 'RESERVED' ORDER BY id FOR UPDATE`,
  );
  const released = await tx.checkoutRentRefundAllocation.updateMany({
    where: {
      status: 'RESERVED',
      item: { checkoutSettlementId: input.settlementId },
    },
    data: { status: 'RELEASED', releasedAt: input.occurredAt },
  });

  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM deposit_transactions WHERE checkout_settlement_id = ${input.settlementId} AND transaction_type IN ('OFFSET_ARREARS', 'OFFSET_SETTLEMENT') ORDER BY id FOR UPDATE`,
  );
  const offsets = await tx.depositTransaction.findMany({
    where: {
      checkoutSettlementId: input.settlementId,
      transactionType: { in: ['OFFSET_ARREARS', 'OFFSET_SETTLEMENT'] },
    },
    include: { rentBill: true },
    orderBy: { id: 'desc' },
  });
  const latestDeposit = await tx.depositTransaction.findFirst({
    where: { contractId: input.contractId },
    orderBy: { id: 'desc' },
  });
  let depositBalance = money(latestDeposit?.balanceAfter ?? 0);
  let restoredDepositAmount = new Prisma.Decimal(0);
  for (const offset of offsets) {
    const amount = money(offset.amount);
    depositBalance = depositBalance.plus(amount).toDecimalPlaces(2);
    restoredDepositAmount = restoredDepositAmount.plus(amount);

    if (offset.transactionType === 'OFFSET_ARREARS' && offset.rentBill) {
      const receivedAmount = money(offset.rentBill.receivedAmount)
        .minus(amount)
        .toDecimalPlaces(2);
      if (receivedAmount.lt(0))
        throw new ConflictException(
          `欠租账单 ${offset.rentBill.billNo} 的实收金额不足，无法安全取消退租`,
        );
      const payableAmount = money(offset.rentBill.payableAmount);
      const outstandingAmount = payableAmount
        .minus(receivedAmount)
        .toDecimalPlaces(2);
      await tx.rentBill.update({
        where: { id: offset.rentBill.id },
        data: {
          receivedAmount,
          outstandingAmount,
          status: restoredBillStatus({
            receivedAmount,
            outstandingAmount,
            dueDate: offset.rentBill.dueDate,
            occurredAt: input.occurredAt,
          }),
        },
      });
    }

    await tx.depositTransaction.create({
      data: {
        contractId: input.contractId,
        transactionNo: `TZQXREV${input.occurredAt.getTime()}${offset.id}`,
        transactionType: 'REVERSAL',
        amount,
        balanceAfter: depositBalance,
        checkoutSettlementId: input.settlementId,
        rentBillId: offset.rentBillId,
        reason: `取消退租结算 ${input.settlementId} 恢复押金抵扣`,
        occurredAt: input.occurredAt,
      },
    });
  }

  await reverseFutureCheckoutBillNormalization(tx, input);

  // 兼容修复前已经审批的结算：旧逻辑曾直接把未来全额未收账单标成作废，
  // 但没有留下调整记录。这里只恢复特征完全匹配的旧数据。
  const legacyFutureBills = await tx.rentBill.findMany({
    where: {
      contractId: input.contractId,
      billCategory: 'RENT',
      periodStart: { gt: input.actualCheckoutDate },
      status: 'VOIDED',
      receivedAmount: 0,
      outstandingAmount: 0,
      payableAmount: { gt: 0 },
    },
    orderBy: { id: 'asc' },
  });
  const restoredLegacyFutureBillIds: number[] = [];
  for (const bill of legacyFutureBills) {
    const payableAmount = money(bill.payableAmount);
    await tx.rentBill.update({
      where: { id: bill.id },
      data: {
        outstandingAmount: payableAmount,
        status: restoredBillStatus({
          receivedAmount: new Prisma.Decimal(0),
          outstandingAmount: payableAmount,
          dueDate: bill.dueDate,
          occurredAt: input.occurredAt,
        }),
      },
    });
    restoredLegacyFutureBillIds.push(bill.id);
  }

  const supplementalBill = await tx.rentBill.findUnique({
    where: { checkoutSettlementId: input.settlementId },
  });
  if (supplementalBill) {
    if (money(supplementalBill.receivedAmount).gt(0))
      throw new ConflictException(
        '退租补收账单已有实收金额，请先退款或作废退租补收款',
      );
    await tx.rentBill.update({
      where: { id: supplementalBill.id },
      data: {
        outstandingAmount: new Prisma.Decimal('0.00'),
        status: 'VOIDED',
      },
    });
  }

  await tx.securityAuditLog.create({
    data: {
      eventType: 'APPROVED_CHECKOUT_ROLLED_BACK',
      entityType: 'CHECKOUT_SETTLEMENT',
      entityId: input.settlementId,
      operatorId: input.operatorId,
      reason: '取消已确认的退租结算',
      eventData: {
        contractId: input.contractId,
        cancelledRefundCount,
        releasedReservationCount: released.count,
        restoredDepositAmount: restoredDepositAmount.toFixed(2),
        restoredLegacyFutureBillIds,
      },
    },
  });

  return {
    cancelledRefundCount,
    releasedReservationCount: released.count,
    restoredDepositAmount: restoredDepositAmount.toFixed(2),
    restoredLegacyFutureBillIds,
  };
}
