import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { calculatePaymentRefundStatus } from '../payments/payment-refund-status';
import {
  reverseFutureCheckoutBillNormalization,
  restoreLegacyFutureCheckoutBills,
} from './checkout-future-bill-normalization';

export type CompletedCheckoutReversalInput = {
  settlementId: number;
  contractId: number;
  actualCheckoutDate: Date;
  operatorId: number;
  occurredAt: Date;
};

const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2);

const restoredBillStatus = (
  receivedAmount: Prisma.Decimal,
  outstandingAmount: Prisma.Decimal,
  dueDate: Date,
  occurredAt: Date,
) => {
  if (outstandingAmount.isZero()) return 'PAID' as const;
  if (receivedAmount.gt(0)) return 'PARTIAL' as const;
  return dueDate.getTime() < occurredAt.getTime()
    ? ('OVERDUE' as const)
    : ('PENDING' as const);
};

/**
 * Reverses the money entries produced by an already-completed checkout.
 * This function never deletes historical records: it appends reversal rows and
 * marks the original combined refund as cancelled inside the caller's transaction.
 */
export async function reverseCompletedCheckoutAccounting(
  tx: Prisma.TransactionClient,
  input: CompletedCheckoutReversalInput,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM deposit_refunds WHERE checkout_settlement_id = ${input.settlementId} AND approval_status = 'APPROVED' ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM deposit_transactions WHERE contract_id = ${input.contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM prepayment_transactions WHERE contract_id = ${input.contractId} ORDER BY id FOR UPDATE`,
  );
  const refunds = await tx.depositRefund.findMany({
    where: {
      checkoutSettlementId: input.settlementId,
      approvalStatus: 'APPROVED',
    },
    orderBy: { id: 'asc' },
  });
  const latestDeposit = await tx.depositTransaction.findFirst({
    where: { contractId: input.contractId },
    orderBy: { id: 'desc' },
  });
  const latestPrepayment = await tx.prepaymentTransaction.findFirst({
    where: { contractId: input.contractId },
    orderBy: { id: 'desc' },
  });

  let depositBalance = money(latestDeposit?.balanceAfter ?? 0);
  let prepaymentBalance = money(latestPrepayment?.balanceAfter ?? 0);
  let restoredDepositAmount = new Prisma.Decimal(0);
  let restoredPrepaymentAmount = new Prisma.Decimal(0);

  for (const refund of refunds) {
    const depositAmount = money(refund.depositRefundAmount);
    const prepaymentAmount = money(refund.prepaymentRefundAmount);
    if (depositAmount.gt(0)) {
      depositBalance = depositBalance.plus(depositAmount).toDecimalPlaces(2);
      await tx.depositTransaction.create({
        data: {
          contractId: input.contractId,
          transactionNo: `TZCXJ${input.occurredAt.getTime()}${refund.id}`,
          transactionType: 'REVERSAL',
          amount: depositAmount,
          balanceAfter: depositBalance,
          checkoutSettlementId: input.settlementId,
          depositRefundId: refund.id,
          reason: `撤销退租结算 ${input.settlementId} 恢复押金退款`,
          occurredAt: input.occurredAt,
        },
      });
      restoredDepositAmount = restoredDepositAmount.plus(depositAmount);
    }
    if (prepaymentAmount.gt(0)) {
      prepaymentBalance = prepaymentBalance
        .plus(prepaymentAmount)
        .toDecimalPlaces(2);
      await tx.prepaymentTransaction.create({
        data: {
          contractId: input.contractId,
          transactionNo: `TZCXYS${input.occurredAt.getTime()}${refund.id}`,
          transactionType: 'REVERSAL',
          amount: prepaymentAmount,
          balanceAfter: prepaymentBalance,
          reason: `撤销退租结算 ${input.settlementId} 恢复预收款退款`,
          occurredAt: input.occurredAt,
        },
      });
      restoredPrepaymentAmount =
        restoredPrepaymentAmount.plus(prepaymentAmount);
    }
    const cancelled = await tx.depositRefund.updateMany({
      where: { id: refund.id, approvalStatus: 'APPROVED' },
      data: {
        approvalStatus: 'CANCELLED',
        cancelledReason: '撤销已完成退租',
      },
    });
    if (cancelled.count !== 1)
      throw new ConflictException('退款申请状态已变化，请刷新后重试');
  }

  const futureBills = await reverseFutureCheckoutBillNormalization(tx, input);
  const legacyFutureBills = await restoreLegacyFutureCheckoutBills(tx, input);

  const depositOffsets = await tx.depositTransaction.findMany({
    where: {
      checkoutSettlementId: input.settlementId,
      transactionType: { in: ['OFFSET_ARREARS', 'OFFSET_SETTLEMENT'] },
    },
    include: { rentBill: true },
    orderBy: { id: 'desc' },
  });
  let restoredDepositOffsetAmount = new Prisma.Decimal(0);
  for (const offset of depositOffsets) {
    const amount = money(offset.amount);
    depositBalance = depositBalance.plus(amount).toDecimalPlaces(2);
    if (offset.transactionType === 'OFFSET_ARREARS' && offset.rentBill) {
      const bill = offset.rentBill;
      const receivedAmount = money(bill.receivedAmount).minus(amount);
      if (receivedAmount.lt(0))
        throw new ConflictException('欠租账单实收金额不足，不能撤销退租');
      const outstandingAmount = money(bill.payableAmount)
        .minus(receivedAmount)
        .toDecimalPlaces(2);
      await tx.rentBill.update({
        where: { id: bill.id },
        data: {
          receivedAmount,
          outstandingAmount,
          status: restoredBillStatus(
            receivedAmount,
            outstandingAmount,
            bill.dueDate,
            input.occurredAt,
          ),
        },
      });
    }
    await tx.depositTransaction.create({
      data: {
        contractId: input.contractId,
        transactionNo: `TZCXYJ${input.occurredAt.getTime()}${offset.id}`,
        transactionType: 'REVERSAL',
        amount,
        balanceAfter: depositBalance,
        checkoutSettlementId: input.settlementId,
        rentBillId: offset.rentBillId,
        reason: `撤销退租结算 ${input.settlementId} 恢复押金抵扣`,
        occurredAt: input.occurredAt,
      },
    });
    restoredDepositOffsetAmount = restoredDepositOffsetAmount.plus(amount);
  }

  const supplementalBill = await tx.rentBill.findUnique({
    where: { checkoutSettlementId: input.settlementId },
  });
  let voidedSupplementalBillId: number | null = null;
  if (supplementalBill) {
    if (money(supplementalBill.receivedAmount).gt(0))
      throw new ConflictException('退租补收账单已有实收金额，不能撤销退租');
    await tx.rentBill.update({
      where: { id: supplementalBill.id },
      data: { outstandingAmount: new Prisma.Decimal('0.00'), status: 'VOIDED' },
    });
    voidedSupplementalBillId = supplementalBill.id;
  }

  const appliedRentRefunds = await tx.checkoutRentRefundAllocation.findMany({
    where: {
      status: 'APPLIED',
      item: { checkoutSettlementId: input.settlementId },
    },
    orderBy: { id: 'asc' },
  });
  const appliedItemIds = [
    ...new Set(
      appliedRentRefunds.map(
        (allocation) => allocation.checkoutSettlementItemId,
      ),
    ),
  ];
  const rentRefundAdjustments = appliedItemIds.length
    ? await tx.billAdjustment.findMany({
        where: {
          checkoutSettlementItemId: { in: appliedItemIds },
          adjustmentType: 'CHECKOUT_RENT_REFUND',
          approvalStatus: 'APPROVED',
          reversedByAdjustmentId: null,
        },
        include: { rentBill: true },
        orderBy: { id: 'asc' },
      })
    : [];
  const amountByBill = new Map<number, Prisma.Decimal>();
  for (const adjustment of rentRefundAdjustments) {
    const amount = money(adjustment.amount);
    amountByBill.set(
      adjustment.rentBillId,
      (amountByBill.get(adjustment.rentBillId) ?? new Prisma.Decimal(0)).plus(
        amount,
      ),
    );
    const bill = adjustment.rentBill;
    const beforeAmount = money(bill.payableAmount);
    const afterAmount = beforeAmount.plus(amount).toDecimalPlaces(2);
    const receivedAmount = money(bill.receivedAmount)
      .plus(amount)
      .toDecimalPlaces(2);
    const outstandingAmount = afterAmount
      .minus(receivedAmount)
      .toDecimalPlaces(2);
    const reversal = await tx.billAdjustment.create({
      data: {
        adjustmentNo: `TZCXTH${input.occurredAt.getTime().toString(36)}${adjustment.id}`,
        rentBillId: bill.id,
        checkoutSettlementItemId: adjustment.checkoutSettlementItemId,
        adjustmentType: 'CHECKOUT_RENT_REFUND',
        direction: 'INCREASE',
        amount,
        beforeAmount,
        afterAmount,
        reason: `撤销退租结算 ${input.settlementId} 恢复退还租金`,
        approvalStatus: 'APPROVED',
        submittedBy: input.operatorId,
        submittedAt: input.occurredAt,
        approvedBy: input.operatorId,
        approvedAt: input.occurredAt,
      },
    });
    await tx.rentBill.update({
      where: { id: bill.id },
      data: {
        adjustmentAmount: money(bill.adjustmentAmount)
          .plus(amount)
          .toDecimalPlaces(2),
        payableAmount: afterAmount,
        receivedAmount,
        outstandingAmount,
        status: restoredBillStatus(
          receivedAmount,
          outstandingAmount,
          bill.dueDate,
          input.occurredAt,
        ),
      },
    });
    const claimed = await tx.billAdjustment.updateMany({
      where: { id: adjustment.id, reversedByAdjustmentId: null },
      data: { reversedByAdjustmentId: reversal.id },
    });
    if (claimed.count !== 1)
      throw new ConflictException('退还租金账单调整状态已变化，请刷新后重试');
  }
  const amountByAllocation = new Map<number, Prisma.Decimal>();
  for (const allocation of appliedRentRefunds) {
    amountByAllocation.set(
      allocation.paymentAllocationId,
      (
        amountByAllocation.get(allocation.paymentAllocationId) ??
        new Prisma.Decimal(0)
      ).plus(allocation.reservedAmount),
    );
  }
  const allocationIds = [...amountByAllocation.keys()];
  if (allocationIds.length) {
    const paymentAllocations = await tx.paymentAllocation.findMany({
      where: { id: { in: allocationIds } },
      orderBy: { id: 'asc' },
    });
    if (paymentAllocations.length !== allocationIds.length)
      throw new ConflictException('退还租金收款分配已变化，请刷新后重试');
    for (const allocation of paymentAllocations) {
      const amount = amountByAllocation.get(allocation.id)!;
      const reversedAmount = money(allocation.reversedAmount).minus(amount);
      if (reversedAmount.lt(0))
        throw new ConflictException('退还租金收款分配金额异常，不能撤销退租');
      await tx.paymentAllocation.update({
        where: { id: allocation.id },
        data: { reversedAmount },
      });
    }
  }
  for (const allocation of appliedRentRefunds) {
    const released = await tx.checkoutRentRefundAllocation.updateMany({
      where: { id: allocation.id, status: 'APPLIED' },
      data: { status: 'RELEASED', releasedAt: input.occurredAt },
    });
    if (released.count !== 1)
      throw new ConflictException('退还租金预留状态已变化，请刷新后重试');
  }
  for (const paymentId of [
    ...new Set(appliedRentRefunds.map((allocation) => allocation.paymentId)),
  ]) {
    const status = await calculatePaymentRefundStatus(tx, {
      paymentId,
      current: { checkoutRentRefundAllocationIds: [] },
    });
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status:
          status.completedRefundTotal === '0.00' ? 'CONFIRMED' : status.status,
      },
    });
  }
  const restoredRentRefundAmount = [...amountByBill.values()]
    .reduce((sum, amount) => sum.plus(amount), new Prisma.Decimal(0))
    .toFixed(2);

  return {
    cancelledRefundIds: refunds.map((refund) => refund.id),
    restoredDepositAmount: restoredDepositAmount.toFixed(2),
    restoredPrepaymentAmount: restoredPrepaymentAmount.toFixed(2),
    restoredRentRefundAmount,
    restoredFutureBillAmount: money(futureBills.restoredOutstandingAmount)
      .plus(legacyFutureBills.restoredOutstandingAmount)
      .toFixed(2),
    restoredDepositOffsetAmount: restoredDepositOffsetAmount.toFixed(2),
    voidedSupplementalBillId,
  };
}
