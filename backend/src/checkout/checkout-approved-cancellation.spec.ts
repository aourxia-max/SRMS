import { Prisma } from '@prisma/client';
import { rollbackApprovedCheckout } from './checkout-approved-cancellation';

const input = {
  settlementId: 107,
  contractId: 75,
  actualCheckoutDate: new Date('2026-08-13T00:00:00.000Z'),
  operatorId: 1,
  occurredAt: new Date('2026-08-31T12:00:00.000Z'),
};

function harness() {
  const pendingRefund = {
    id: 49,
    approvalStatus: 'PENDING',
    checkoutSettlementId: 107,
  };
  const arrearsBill = {
    id: 259,
    billNo: 'ZD259',
    dueDate: new Date('2026-07-20T00:00:00.000Z'),
    adjustmentAmount: new Prisma.Decimal('0.00'),
    payableAmount: new Prisma.Decimal('800.00'),
    receivedAmount: new Prisma.Decimal('800.00'),
    outstandingAmount: new Prisma.Decimal('0.00'),
    status: 'PAID',
  };
  const legacyFutureBill = {
    id: 261,
    billNo: 'ZD261',
    dueDate: new Date('2026-08-20T00:00:00.000Z'),
    adjustmentAmount: new Prisma.Decimal('0.00'),
    payableAmount: new Prisma.Decimal('800.00'),
    receivedAmount: new Prisma.Decimal('0.00'),
    outstandingAmount: new Prisma.Decimal('0.00'),
    status: 'VOIDED',
  };
  const refundWrite = jest.fn().mockResolvedValue({ count: 1 });
  const reservationWrite = jest.fn().mockResolvedValue({ count: 1 });
  const depositWrite = jest.fn();
  const billWrite = jest.fn();
  const auditWrite = jest.fn();
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    depositRefund: {
      findMany: jest.fn().mockResolvedValue([pendingRefund]),
      updateMany: refundWrite,
    },
    payment: { findFirst: jest.fn().mockResolvedValue(null) },
    checkoutRentRefundAllocation: { updateMany: reservationWrite },
    depositTransaction: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 501,
          transactionType: 'OFFSET_ARREARS',
          amount: new Prisma.Decimal('100.00'),
          rentBillId: 259,
          rentBill: arrearsBill,
        },
      ]),
      findFirst: jest.fn().mockResolvedValue({
        id: 501,
        balanceAfter: new Prisma.Decimal('900.00'),
      }),
      create: depositWrite,
    },
    rentBill: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([legacyFutureBill]),
      update: billWrite,
    },
    billAdjustment: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    securityAuditLog: { create: auditWrite },
  };
  return {
    tx,
    refundWrite,
    reservationWrite,
    depositWrite,
    billWrite,
    auditWrite,
  };
}

describe('approved checkout cancellation rollback', () => {
  it('cancels pending refund, releases reservation and restores linked ledgers', async () => {
    const state = harness();

    const result = await rollbackApprovedCheckout(state.tx as never, input);

    expect(result).toEqual({
      cancelledRefundCount: 1,
      releasedReservationCount: 1,
      restoredDepositAmount: '100.00',
      restoredLegacyFutureBillIds: [261],
    });
    expect(state.refundWrite).toHaveBeenCalledWith({
      where: {
        id: { in: [49] },
        approvalStatus: 'PENDING',
      },
      data: {
        approvalStatus: 'CANCELLED',
        cancelledReason: '取消整个退租',
      },
    });
    expect(state.reservationWrite).toHaveBeenCalledWith({
      where: {
        status: 'RESERVED',
        item: { checkoutSettlementId: 107 },
      },
      data: { status: 'RELEASED', releasedAt: input.occurredAt },
    });
    expect(state.depositWrite).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 75,
        transactionType: 'REVERSAL',
        amount: new Prisma.Decimal('100.00'),
        balanceAfter: new Prisma.Decimal('1000.00'),
        checkoutSettlementId: 107,
        rentBillId: 259,
        reason: '取消退租结算 107 恢复押金抵扣',
      }),
    });
    expect(state.billWrite).toHaveBeenCalledWith({
      where: { id: 259 },
      data: {
        receivedAmount: new Prisma.Decimal('700.00'),
        outstandingAmount: new Prisma.Decimal('100.00'),
        status: 'PARTIAL',
      },
    });
    expect(state.billWrite).toHaveBeenCalledWith({
      where: { id: 261 },
      data: {
        outstandingAmount: new Prisma.Decimal('800.00'),
        status: 'OVERDUE',
      },
    });
    expect(state.auditWrite).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'APPROVED_CHECKOUT_ROLLED_BACK',
        entityType: 'CHECKOUT_SETTLEMENT',
        entityId: 107,
        operatorId: 1,
      }),
    });
  });

  it('rejects cancellation while a confirmed checkout supplemental payment exists', async () => {
    const state = harness();
    state.tx.payment.findFirst.mockResolvedValue({ id: 88, receiptNo: 'SK88' });

    await expect(
      rollbackApprovedCheckout(state.tx as never, input),
    ).rejects.toThrow('请先退款或作废退租补收款');

    expect(state.refundWrite).not.toHaveBeenCalled();
    expect(state.reservationWrite).not.toHaveBeenCalled();
    expect(state.depositWrite).not.toHaveBeenCalled();
  });

  it('rejects cancellation after the combined refund was approved', async () => {
    const state = harness();
    state.tx.depositRefund.findMany.mockResolvedValue([
      { id: 49, approvalStatus: 'APPROVED', checkoutSettlementId: 107 },
    ]);

    await expect(
      rollbackApprovedCheckout(state.tx as never, input),
    ).rejects.toThrow('实际退款已经确认');

    expect(state.reservationWrite).not.toHaveBeenCalled();
  });
});
