import { ConflictException } from '@nestjs/common';
import { Prisma, type RentBillStatus } from '@prisma/client';

type NormalizationInput = {
  settlementId: number;
  contractId: number;
  actualCheckoutDate: Date;
  operatorId: number;
  occurredAt: Date;
};

const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2);

const normalizationReason = (settlementId: number) =>
  `退租结算 ${settlementId} 核销未来未收租金`;

const restoredStatus = (input: {
  receivedAmount: Prisma.Decimal;
  outstandingAmount: Prisma.Decimal;
  dueDate: Date;
  occurredAt: Date;
}): RentBillStatus => {
  if (input.outstandingAmount.isZero()) return 'PAID';
  if (input.receivedAmount.gt(0)) return 'PARTIAL';
  return input.dueDate.getTime() < input.occurredAt.getTime()
    ? 'OVERDUE'
    : 'PENDING';
};

export async function normalizeFutureCheckoutBills(
  tx: Prisma.TransactionClient,
  input: NormalizationInput,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM rent_bills WHERE contract_id = ${input.contractId} AND bill_category = 'RENT' AND period_start > ${input.actualCheckoutDate} ORDER BY id FOR UPDATE`,
  );
  const bills = await tx.rentBill.findMany({
    where: {
      contractId: input.contractId,
      billCategory: 'RENT',
      periodStart: { gt: input.actualCheckoutDate },
      status: { not: 'REFUNDED' },
    },
    orderBy: { id: 'asc' },
  });
  const normalizedBillIds: number[] = [];
  let cancelledOutstandingAmount = new Prisma.Decimal(0);

  for (const bill of bills) {
    const outstandingAmount = money(bill.outstandingAmount);
    if (outstandingAmount.lte(0)) continue;

    const beforeAmount = money(bill.payableAmount);
    const receivedAmount = money(bill.receivedAmount);
    const afterAmount = beforeAmount
      .minus(outstandingAmount)
      .toDecimalPlaces(2);
    if (afterAmount.lt(0) || !afterAmount.equals(receivedAmount))
      throw new ConflictException(
        `未来账单 ${bill.billNo} 的应收、实收和未收金额不一致，请刷新后重试`,
      );

    await tx.rentBill.update({
      where: { id: bill.id },
      data: {
        adjustmentAmount: money(bill.adjustmentAmount)
          .minus(outstandingAmount)
          .toDecimalPlaces(2),
        payableAmount: afterAmount,
        outstandingAmount: new Prisma.Decimal('0.00'),
        status: receivedAmount.isZero() ? 'VOIDED' : 'PAID',
      },
    });
    await tx.billAdjustment.create({
      data: {
        adjustmentNo: `TZWQ${input.occurredAt.getTime().toString(36)}${bill.id}`,
        rentBillId: bill.id,
        adjustmentType: 'CORRECTION',
        direction: 'DECREASE',
        amount: outstandingAmount,
        beforeAmount,
        afterAmount,
        reason: normalizationReason(input.settlementId),
        approvalStatus: 'APPROVED',
        submittedBy: input.operatorId,
        submittedAt: input.occurredAt,
        approvedBy: input.operatorId,
        approvedAt: input.occurredAt,
      },
    });
    normalizedBillIds.push(bill.id);
    cancelledOutstandingAmount =
      cancelledOutstandingAmount.plus(outstandingAmount);
  }

  return {
    normalizedBillIds,
    cancelledOutstandingAmount: cancelledOutstandingAmount
      .toDecimalPlaces(2)
      .toFixed(2),
  };
}

export async function reverseFutureCheckoutBillNormalization(
  tx: Prisma.TransactionClient,
  input: NormalizationInput,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT ba.id FROM bill_adjustments ba INNER JOIN rent_bills rb ON rb.id = ba.rent_bill_id WHERE rb.contract_id = ${input.contractId} AND ba.adjustment_type = 'CORRECTION' AND ba.direction = 'DECREASE' AND ba.reason = ${normalizationReason(input.settlementId)} AND ba.approval_status = 'APPROVED' AND ba.reversed_by_adjustment_id IS NULL ORDER BY ba.id FOR UPDATE`,
  );
  const adjustments = await tx.billAdjustment.findMany({
    where: {
      adjustmentType: 'CORRECTION',
      direction: 'DECREASE',
      reason: normalizationReason(input.settlementId),
      approvalStatus: 'APPROVED',
      reversedByAdjustmentId: null,
      rentBill: { contractId: input.contractId },
    },
    include: { rentBill: true },
    orderBy: { id: 'asc' },
  });
  const restoredBillIds: number[] = [];
  let restoredOutstandingAmount = new Prisma.Decimal(0);

  for (const adjustment of adjustments) {
    const bill = adjustment.rentBill;
    const amount = money(adjustment.amount);
    const beforeAmount = money(bill.payableAmount);
    const afterAmount = beforeAmount.plus(amount).toDecimalPlaces(2);
    const receivedAmount = money(bill.receivedAmount);
    const outstandingAmount = afterAmount
      .minus(receivedAmount)
      .toDecimalPlaces(2);
    const reversal = await tx.billAdjustment.create({
      data: {
        adjustmentNo: `TZWQREV${input.occurredAt.getTime().toString(36)}${adjustment.id}`,
        rentBillId: bill.id,
        adjustmentType: 'CORRECTION',
        direction: 'INCREASE',
        amount,
        beforeAmount,
        afterAmount,
        reason: `取消退租结算 ${input.settlementId} 恢复未来账单`,
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
        outstandingAmount,
        status: restoredStatus({
          receivedAmount,
          outstandingAmount,
          dueDate: bill.dueDate,
          occurredAt: input.occurredAt,
        }),
      },
    });
    const claimed = await tx.billAdjustment.updateMany({
      where: { id: adjustment.id, reversedByAdjustmentId: null },
      data: { reversedByAdjustmentId: reversal.id },
    });
    if (claimed.count !== 1)
      throw new ConflictException('未来账单核销状态已变化，请刷新后重试');
    restoredBillIds.push(bill.id);
    restoredOutstandingAmount = restoredOutstandingAmount.plus(amount);
  }

  return {
    restoredBillIds,
    restoredOutstandingAmount: restoredOutstandingAmount
      .toDecimalPlaces(2)
      .toFixed(2),
  };
}
