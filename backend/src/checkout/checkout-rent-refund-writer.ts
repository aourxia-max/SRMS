import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CHECKOUT_RENT_REFUND_RESERVATION_CHANGED_MESSAGE,
  lockAndPlanCheckoutRentRefund,
} from './checkout-rent-refund-reservations';
import {
  calculatePaymentRefundStatus,
  type PaymentRefundStatusResult,
} from '../payments/payment-refund-status';

const SNAPSHOT_CHANGED_MESSAGE =
  '退租租金退款金额或锁定快照已变化，请退回结算草稿后重新提交。';
const REFERENCE_CHANGED_MESSAGE =
  '退租租金退款引用已变化，请退回结算草稿后重新提交。';
const CAPACITY_CHANGED_MESSAGE =
  '退租租金退款超过当前可回冲金额，请退回结算草稿后重新提交。';
const BILL_CHANGED_MESSAGE = '租金账单金额已变化，不能执行退租租金退款。';

export type CheckoutRentRefundResult = {
  appliedAmount: string;
  affectedBillIds: number[];
  affectedPaymentIds: number[];
};

type ApplyCheckoutRentRefundInput = {
  settlementId: number;
  depositRefundId: number;
  approvedBy: number;
  occurredAt: Date;
};

const asMoney = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toDecimalPlaces(2);

const addAmount = (
  totals: Map<number, Prisma.Decimal>,
  id: number,
  amount: Prisma.Decimal.Value,
) => {
  totals.set(id, (totals.get(id) ?? new Prisma.Decimal(0)).plus(amount));
};

async function lockCheckoutRentRefundRows(
  tx: Prisma.TransactionClient,
  input: ApplyCheckoutRentRefundInput,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM checkout_settlements WHERE id = ${input.settlementId} FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM deposit_refunds WHERE id = ${input.depositRefundId} FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM checkout_settlement_items WHERE checkout_settlement_id = ${input.settlementId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT crra.id FROM checkout_rent_refund_allocations crra INNER JOIN checkout_settlement_items csi ON csi.id = crra.checkout_settlement_item_id WHERE csi.checkout_settlement_id = ${input.settlementId} ORDER BY crra.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT rb.id FROM rent_bills rb INNER JOIN checkout_rent_refund_allocations crra ON crra.rent_bill_id = rb.id INNER JOIN checkout_settlement_items csi ON csi.id = crra.checkout_settlement_item_id WHERE csi.checkout_settlement_id = ${input.settlementId} AND crra.status = 'RESERVED' ORDER BY rb.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT p.id FROM payments p INNER JOIN checkout_rent_refund_allocations crra ON crra.payment_id = p.id INNER JOIN checkout_settlement_items csi ON csi.id = crra.checkout_settlement_item_id WHERE csi.checkout_settlement_id = ${input.settlementId} AND crra.status = 'RESERVED' ORDER BY p.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT pa.id FROM payment_allocations pa INNER JOIN checkout_rent_refund_allocations crra ON crra.payment_allocation_id = pa.id INNER JOIN checkout_settlement_items csi ON csi.id = crra.checkout_settlement_item_id WHERE csi.checkout_settlement_id = ${input.settlementId} AND crra.status = 'RESERVED' ORDER BY pa.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT pr.id FROM payment_refunds pr INNER JOIN checkout_rent_refund_allocations crra ON crra.payment_id = pr.payment_id INNER JOIN checkout_settlement_items csi ON csi.id = crra.checkout_settlement_item_id WHERE csi.checkout_settlement_id = ${input.settlementId} AND crra.status = 'RESERVED' ORDER BY pr.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT pra.id FROM payment_refund_allocations pra INNER JOIN payment_allocations pa ON pa.id = pra.payment_allocation_id INNER JOIN checkout_rent_refund_allocations crra ON crra.payment_id = pa.payment_id INNER JOIN checkout_settlement_items csi ON csi.id = crra.checkout_settlement_item_id WHERE csi.checkout_settlement_id = ${input.settlementId} AND crra.status = 'RESERVED' ORDER BY pra.id FOR UPDATE`,
  );
}

export async function applyCheckoutRentRefund(
  tx: Prisma.TransactionClient,
  input: ApplyCheckoutRentRefundInput,
): Promise<CheckoutRentRefundResult> {
  if (
    !Number.isInteger(input.settlementId) ||
    input.settlementId <= 0 ||
    !Number.isInteger(input.depositRefundId) ||
    input.depositRefundId <= 0 ||
    !Number.isInteger(input.approvedBy) ||
    input.approvedBy <= 0 ||
    Number.isNaN(input.occurredAt.getTime())
  )
    throw new BadRequestException('退租租金退款记账参数无效。');

  await lockCheckoutRentRefundRows(tx, input);

  const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
    where: { id: input.settlementId },
    select: {
      id: true,
      contractId: true,
      status: true,
      depositRefundableAmount: true,
      prepaymentRefundableAmount: true,
      rentRefundableAmount: true,
      actualCheckoutDate: true,
    },
  });
  const refund = await tx.depositRefund.findUniqueOrThrow({
    where: { id: input.depositRefundId },
    select: {
      id: true,
      contractId: true,
      checkoutSettlementId: true,
      refundAmount: true,
      depositRefundAmount: true,
      prepaymentRefundAmount: true,
      rentRefundAmount: true,
      approvalStatus: true,
      approvedBy: true,
    },
  });
  const items = await tx.checkoutSettlementItem.findMany({
    where: {
      checkoutSettlementId: input.settlementId,
      itemType: 'RENT_REFUND',
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      checkoutSettlementId: true,
      itemType: true,
      amount: true,
    },
  });
  const reservations = await tx.checkoutRentRefundAllocation.findMany({
    where: {
      item: { checkoutSettlementId: input.settlementId },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      checkoutSettlementItemId: true,
      paymentAllocationId: true,
      paymentId: true,
      rentBillId: true,
      reservedAmount: true,
      status: true,
      depositRefundId: true,
    },
  });

  if (reservations.some((item) => item.status === 'APPLIED'))
    throw new BadRequestException('退租租金退款已处理，不能重复回冲。');
  const activeReservations = reservations.filter(
    (item) => item.status === 'RESERVED',
  );
  if (!activeReservations.length) {
    if (reservations.some((item) => item.status === 'RELEASED'))
      throw new BadRequestException(
        '退租租金退款预留已释放，请退回结算草稿后重新提交。',
      );
    throw new BadRequestException(SNAPSHOT_CHANGED_MESSAGE);
  }

  const settlementDepositAmount = asMoney(settlement.depositRefundableAmount);
  const settlementPrepaymentAmount = asMoney(
    settlement.prepaymentRefundableAmount,
  );
  const settlementAmount = asMoney(settlement.rentRefundableAmount);
  const depositAmount = asMoney(refund.depositRefundAmount);
  const prepaymentAmount = asMoney(refund.prepaymentRefundAmount);
  const rentAmount = asMoney(refund.rentRefundAmount);
  const refundAmount = asMoney(refund.refundAmount);
  const item = items[0];
  const reservedTotal = activeReservations.reduce(
    (sum, reservation) => sum.plus(reservation.reservedAmount),
    new Prisma.Decimal(0),
  );

  if (
    settlement.status !== 'APPROVED' ||
    refund.approvalStatus !== 'APPROVED' ||
    refund.approvedBy !== input.approvedBy ||
    refund.checkoutSettlementId !== settlement.id ||
    refund.contractId !== settlement.contractId
  )
    throw new BadRequestException(
      '退租租金退款申请状态或归属已变化，不能执行回冲。',
    );
  if (
    items.length !== 1 ||
    !item ||
    !settlement.actualCheckoutDate ||
    item.checkoutSettlementId !== settlement.id ||
    item.itemType !== 'RENT_REFUND' ||
    settlementAmount.lte(0) ||
    !asMoney(item.amount).equals(settlementAmount) ||
    !depositAmount.equals(settlementDepositAmount) ||
    !prepaymentAmount.equals(settlementPrepaymentAmount) ||
    !rentAmount.equals(settlementAmount) ||
    !refundAmount.equals(
      depositAmount.plus(prepaymentAmount).plus(rentAmount),
    ) ||
    !reservedTotal.toDecimalPlaces(2).equals(settlementAmount)
  )
    throw new BadRequestException(SNAPSHOT_CHANGED_MESSAGE);

  let lockedPlan;
  try {
    ({ plan: lockedPlan } = await lockAndPlanCheckoutRentRefund(tx, {
      contractId: settlement.contractId,
      currentSettlementId: settlement.id,
      actualCheckoutDate: settlement.actualCheckoutDate,
      requestedAmount: settlementAmount,
    }));
  } catch (error) {
    if (error instanceof BadRequestException)
      throw new BadRequestException(
        CHECKOUT_RENT_REFUND_RESERVATION_CHANGED_MESSAGE,
      );
    throw error;
  }
  const storedPlan = activeReservations
    .map((reservation) =>
      [
        reservation.paymentAllocationId,
        reservation.paymentId,
        reservation.rentBillId,
        asMoney(reservation.reservedAmount).toFixed(2),
      ].join(':'),
    )
    .sort();
  const expectedPlan = lockedPlan.allocations
    .map((allocation) =>
      [
        allocation.paymentAllocationId,
        allocation.paymentId,
        allocation.rentBillId,
        asMoney(allocation.amount).toFixed(2),
      ].join(':'),
    )
    .sort();
  if (
    storedPlan.length !== expectedPlan.length ||
    storedPlan.some((entry, index) => entry !== expectedPlan[index])
  )
    throw new BadRequestException(
      CHECKOUT_RENT_REFUND_RESERVATION_CHANGED_MESSAGE,
    );

  const billIds = [
    ...new Set(activeReservations.map((reservation) => reservation.rentBillId)),
  ].sort((left, right) => left - right);
  const paymentIds = [
    ...new Set(activeReservations.map((reservation) => reservation.paymentId)),
  ].sort((left, right) => left - right);
  const allocationIds = [
    ...new Set(
      activeReservations.map((reservation) => reservation.paymentAllocationId),
    ),
  ].sort((left, right) => left - right);

  const bills = await tx.rentBill.findMany({
    where: { id: { in: billIds } },
    select: {
      id: true,
      contractId: true,
      billCategory: true,
      adjustmentAmount: true,
      payableAmount: true,
      receivedAmount: true,
      outstandingAmount: true,
      status: true,
    },
  });
  const allocations = await tx.paymentAllocation.findMany({
    where: { id: { in: allocationIds } },
    select: {
      id: true,
      paymentId: true,
      rentBillId: true,
      allocatedAmount: true,
      reversedAmount: true,
    },
  });
  const payments = await tx.payment.findMany({
    where: { id: { in: paymentIds } },
    select: {
      id: true,
      contractId: true,
      paymentCategory: true,
      status: true,
    },
  });

  if (
    bills.length !== billIds.length ||
    allocations.length !== allocationIds.length ||
    payments.length !== paymentIds.length
  )
    throw new BadRequestException(REFERENCE_CHANGED_MESSAGE);

  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const allocationById = new Map(
    allocations.map((paymentAllocation) => [
      paymentAllocation.id,
      paymentAllocation,
    ]),
  );
  const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
  const amountByBill = new Map<number, Prisma.Decimal>();
  const amountByAllocation = new Map<number, Prisma.Decimal>();

  for (const reservation of activeReservations) {
    const paymentAllocation = allocationById.get(
      reservation.paymentAllocationId,
    );
    const rentBill = billById.get(reservation.rentBillId);
    const payment = paymentById.get(reservation.paymentId);
    const reservationAmount = asMoney(reservation.reservedAmount);
    if (
      reservation.checkoutSettlementItemId !== item.id ||
      reservation.depositRefundId !== null ||
      !paymentAllocation ||
      !rentBill ||
      !payment ||
      paymentAllocation.paymentId !== reservation.paymentId ||
      paymentAllocation.rentBillId !== reservation.rentBillId ||
      rentBill.contractId !== settlement.contractId ||
      rentBill.billCategory !== 'RENT' ||
      payment.contractId !== settlement.contractId ||
      payment.paymentCategory !== 'RENT' ||
      (payment.status !== 'CONFIRMED' &&
        payment.status !== 'PARTIALLY_REFUNDED') ||
      reservationAmount.lte(0)
    )
      throw new BadRequestException(REFERENCE_CHANGED_MESSAGE);
    addAmount(amountByBill, reservation.rentBillId, reservationAmount);
    addAmount(
      amountByAllocation,
      reservation.paymentAllocationId,
      reservationAmount,
    );
  }

  for (const [allocationId, amount] of amountByAllocation) {
    const paymentAllocation = allocationById.get(allocationId)!;
    const remaining = asMoney(paymentAllocation.allocatedAmount).minus(
      paymentAllocation.reversedAmount,
    );
    if (amount.gt(remaining))
      throw new BadRequestException(CAPACITY_CHANGED_MESSAGE);
  }

  for (const [billId, amount] of amountByBill) {
    const rentBill = billById.get(billId)!;
    const payableAmount = asMoney(rentBill.payableAmount);
    const receivedAmount = asMoney(rentBill.receivedAmount);
    if (
      rentBill.status !== 'PAID' ||
      !asMoney(rentBill.outstandingAmount).isZero() ||
      !payableAmount.equals(receivedAmount) ||
      amount.gt(payableAmount) ||
      amount.gt(receivedAmount)
    )
      throw new BadRequestException(BILL_CHANGED_MESSAGE);
  }

  const nextPaymentStatus = new Map<
    number,
    PaymentRefundStatusResult['status']
  >();
  for (const paymentId of paymentIds) {
    const paymentRefundStatus = await calculatePaymentRefundStatus(tx, {
      paymentId,
      current: {
        checkoutRentRefundAllocationIds: activeReservations
          .filter((reservation) => reservation.paymentId === paymentId)
          .map((reservation) => reservation.id),
      },
    });
    nextPaymentStatus.set(paymentId, paymentRefundStatus.status);
  }

  for (const billId of billIds) {
    const rentBill = billById.get(billId)!;
    const amount = amountByBill.get(billId)!;
    const beforeAmount = asMoney(rentBill.payableAmount);
    const afterAmount = beforeAmount.minus(amount).toDecimalPlaces(2);
    const receivedAmount = asMoney(rentBill.receivedAmount)
      .minus(amount)
      .toDecimalPlaces(2);
    await tx.rentBill.update({
      where: { id: billId },
      data: {
        adjustmentAmount: asMoney(rentBill.adjustmentAmount)
          .minus(amount)
          .toDecimalPlaces(2),
        payableAmount: afterAmount,
        receivedAmount,
        outstandingAmount: new Prisma.Decimal(0),
        status:
          afterAmount.isZero() && receivedAmount.isZero() ? 'REFUNDED' : 'PAID',
      },
    });
    await tx.billAdjustment.create({
      data: {
        adjustmentNo: `TZTH${input.occurredAt.getTime().toString(36)}${billId}`,
        rentBillId: billId,
        checkoutSettlementItemId: item.id,
        adjustmentType: 'CHECKOUT_RENT_REFUND',
        direction: 'DECREASE',
        amount,
        beforeAmount,
        afterAmount,
        reason: `退租结算 ${input.settlementId} 退还已缴租金`,
        approvalStatus: 'APPROVED',
        submittedBy: input.approvedBy,
        submittedAt: input.occurredAt,
        approvedBy: input.approvedBy,
        approvedAt: input.occurredAt,
      },
    });
  }

  for (const allocationId of allocationIds) {
    const paymentAllocation = allocationById.get(allocationId)!;
    await tx.paymentAllocation.update({
      where: { id: allocationId },
      data: {
        reversedAmount: asMoney(paymentAllocation.reversedAmount)
          .plus(amountByAllocation.get(allocationId)!)
          .toDecimalPlaces(2),
      },
    });
  }

  const claimedReservations = await tx.checkoutRentRefundAllocation.updateMany({
    where: {
      id: { in: activeReservations.map((reservation) => reservation.id) },
      status: 'RESERVED',
      depositRefundId: null,
    },
    data: {
      status: 'APPLIED',
      appliedAt: input.occurredAt,
      depositRefundId: input.depositRefundId,
    },
  });
  if (claimedReservations.count !== activeReservations.length)
    throw new ConflictException('退租租金退款预留状态已变化，请刷新后重试。');

  for (const paymentId of paymentIds) {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: nextPaymentStatus.get(paymentId)! },
    });
  }

  return {
    appliedAmount: settlementAmount.toFixed(2),
    affectedBillIds: billIds,
    affectedPaymentIds: paymentIds,
  };
}
