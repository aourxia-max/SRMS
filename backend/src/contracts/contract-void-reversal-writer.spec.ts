import { Prisma } from '@prisma/client';
import { computeContractVoidImpact } from './contract-void-impact';
import { ContractVoidReversalWriter } from './contract-void-reversal-writer';

const now = new Date('2026-08-26T10:00:00.000Z');
const request = {
  id: 9,
  requestNo: 'HTZF20260826000009',
  contractId: 7,
  operatorId: 1,
};

function executionImpact(overrides: Record<string, unknown> = {}) {
  const impact = computeContractVoidImpact({
    contract: { id: 7, status: 'ACTIVE', roomId: 3 },
    bills: [
      {
        id: 11,
        status: 'PAID',
        payableAmount: '300.00',
        receivedAmount: '300.00',
        outstandingAmount: '0.00',
        occurredAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    payments: [
      {
        id: 21,
        status: 'PARTIALLY_REFUNDED',
        amount: '300.00',
        allocatedAmount: '250.00',
        refundedAmount: '50.00',
        prepaymentNet: '0.00',
        occurredAt: '2026-07-02T00:00:00.000Z',
      },
      {
        id: 22,
        status: 'FULLY_REFUNDED',
        amount: '200.00',
        allocatedAmount: '200.00',
        refundedAmount: '200.00',
        prepaymentNet: '0.00',
      },
      {
        id: 23,
        status: 'VOIDED',
        amount: '100.00',
        allocatedAmount: '100.00',
        refundedAmount: '0.00',
        prepaymentNet: '0.00',
      },
    ],
    refunds: [
      {
        id: 41,
        paymentId: 21,
        approvalStatus: 'APPROVED',
        amount: '50.00',
        occurredAt: '2026-07-03T00:00:00.000Z',
      },
      {
        id: 42,
        paymentId: 22,
        approvalStatus: 'APPROVED',
        amount: '200.00',
      },
    ],
    prepaymentBalance: '80.00',
    depositBalance: '100.00',
    pending: {
      adjustments: [],
      refunds: [],
      voidRequests: [],
      changes: [],
      rebates: [],
      checkouts: [],
      depositRefunds: [],
    },
    completedCheckoutIds: [81],
    laterContractIds: [],
    currentRoomStatus: 'RENTED',
    ...(overrides as never),
  });
  return {
    ...impact,
    sourceSnapshot: {
      prepaymentBalanceSource: {
        id: 51,
        balanceAfter: '80.00',
        occurredAt: '2026-07-04T00:00:00.000Z',
      },
      depositBalanceSource: {
        id: 52,
        balanceAfter: '100.00',
        occurredAt: '2026-07-05T00:00:00.000Z',
      },
      contractMembers: [],
      paymentAllocations: [
        {
          id: 61,
          paymentId: 21,
          rentBillId: 11,
          allocatedAmount: '300.00',
          reversedAmount: '50.00',
          allocationType: 'AUTO_OLDEST_FIRST',
          occurredAt: '2026-07-02T00:00:00.000Z',
        },
      ],
      adjustments: [
        {
          id: 71,
          rentBillId: 11,
          adjustmentType: 'DISCOUNT',
          direction: 'DECREASE',
          amount: '100.00',
          beforeAmount: '300.00',
          afterAmount: '200.00',
          approvalStatus: 'APPROVED',
          occurredAt: '2026-07-06T00:00:00.000Z',
          submittedAt: '2026-07-06T00:00:00.000Z',
          approvedAt: '2026-07-06T01:00:00.000Z',
        },
      ],
      rebates: [
        {
          id: 72,
          sourceType: 'FIXED_RENT_MANUAL',
          rebateType: 'MANUAL',
          rentBillId: 11,
          approvalStatus: 'APPROVED',
          settlementMethod: 'ACTUAL_REFUND',
          grossBilledAmount: '300.00',
          previousRebateAmount: '0.00',
          referenceAmount: null,
          targetNetRentAmount: null,
          actualAmount: '25.00',
          differenceAmount: null,
          periodStart: '2026-07-01T00:00:00.000Z',
          periodEnd: '2026-07-31T00:00:00.000Z',
          refundDate: '2026-07-07T00:00:00.000Z',
          occurredAt: '2026-07-07T00:00:00.000Z',
          submittedAt: '2026-07-07T00:00:00.000Z',
          approvedAt: '2026-07-07T01:00:00.000Z',
        },
      ],
      checkoutSettlements: [
        {
          id: 81,
          checkoutType: 'NORMAL',
          originContractStatus: 'ACTIVE',
          status: 'COMPLETED',
          rentReceivable: '300.00',
          rentReceived: '300.00',
          rentOutstanding: '0.00',
          prepaymentBalance: '80.00',
          depositBalance: '100.00',
          depositOffsetAmount: '0.00',
          otherDeductionAmount: '0.00',
          depositRefundableAmount: '100.00',
          prepaymentRefundableAmount: '80.00',
          finalReceivable: '0.00',
          supplementalArrearsAmount: '0.00',
          supplementalInspectionAmount: '0.00',
          supplementalReceivedAmount: '0.00',
          supplementalOutstandingAmount: '0.00',
          occurredAt: '2026-07-08T00:00:00.000Z',
          approvedAt: '2026-07-08T01:00:00.000Z',
        },
      ],
      commissions: [
        {
          id: 91,
          amount: '40.00',
          occurredAt: '2026-06-01T00:00:00.000Z',
          deletedAt: null,
        },
        {
          id: 92,
          amount: '30.00',
          occurredAt: '2026-06-01T00:00:00.000Z',
          deletedAt: '2026-06-02T00:00:00.000Z',
        },
      ],
    },
  };
}

function txFixture() {
  let inserted: Array<Record<string, unknown>> = [];
  const emptyWorkflow = () => ({
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest
      .fn()
      .mockImplementation(({ where }: { where: { id?: { in?: number[] } } }) =>
        Promise.resolve({
          count: where.id?.in?.length ?? 0,
        }),
      ),
  });
  const tx = {
    contractChange: emptyWorkflow(),
    billAdjustment: emptyWorkflow(),
    paymentRefund: emptyWorkflow(),
    paymentVoidRequest: emptyWorkflow(),
    pricingRebate: emptyWorkflow(),
    checkoutSettlement: emptyWorkflow(),
    depositRefund: emptyWorkflow(),
    payment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    rentBill: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    prepaymentTransaction: {
      create: jest.fn().mockResolvedValue({ id: 101 }),
    },
    depositTransaction: {
      create: jest.fn().mockResolvedValue({ id: 102 }),
    },
    contractVoidReversal: {
      createMany: jest.fn().mockImplementation(({ data }) => {
        inserted = data;
        return { count: data.length };
      }),
      findMany: jest
        .fn()
        .mockImplementation(() =>
          inserted.map((data, index) => ({ id: index + 1, ...data })),
        ),
    },
  };
  return { tx, inserted: () => inserted };
}

describe('ContractVoidReversalWriter', () => {
  it('cancels only pending workflows and records every exact transition', async () => {
    const impact = executionImpact({
      pending: {
        adjustments: [31],
        refunds: [41],
        voidRequests: [51],
        changes: [61],
        rebates: [71],
        checkouts: [81],
        depositRefunds: [82],
      },
      completedCheckoutIds: [],
    });
    impact.sourceSnapshot.checkoutSettlements[0].status = 'DRAFT';
    const { tx, inserted } = txFixture();
    tx.contractChange.findMany.mockResolvedValue([
      { id: 61, approvalStatus: 'DRAFT' },
    ]);
    tx.billAdjustment.findMany.mockResolvedValue([
      { id: 31, approvalStatus: 'PENDING' },
    ]);
    tx.paymentRefund.findMany.mockResolvedValue([
      { id: 41, approvalStatus: 'PENDING' },
    ]);
    tx.paymentVoidRequest.findMany.mockResolvedValue([
      { id: 51, approvalStatus: 'DRAFT' },
    ]);
    tx.pricingRebate.findMany.mockResolvedValue([
      { id: 71, approvalStatus: 'PENDING' },
    ]);
    tx.checkoutSettlement.findMany.mockResolvedValue([
      { id: 81, status: 'DRAFT' },
    ]);
    tx.depositRefund.findMany.mockResolvedValue([
      { id: 82, approvalStatus: 'PENDING' },
    ]);

    await new ContractVoidReversalWriter().write(
      tx as never,
      request,
      impact,
      now,
    );

    for (const model of [
      tx.contractChange,
      tx.billAdjustment,
      tx.paymentRefund,
      tx.paymentVoidRequest,
      tx.pricingRebate,
      tx.depositRefund,
    ]) {
      expect(model.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            approvalStatus: { in: ['DRAFT', 'PENDING'] },
          }),
          data: { approvalStatus: 'CANCELLED' },
        }),
      );
    }
    expect(tx.checkoutSettlement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['DRAFT', 'PENDING'] },
        }),
        data: { status: 'CANCELLED' },
      }),
    );
    expect(tx.depositRefund.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [82] },
        approvalStatus: { in: ['DRAFT', 'PENDING'] },
      },
      select: { id: true, approvalStatus: true },
      orderBy: { id: 'asc' },
    });
    const cancellationRows = inserted().filter(
      (row) =>
        (row.metadata as { nextStatus?: string }).nextStatus === 'CANCELLED',
    );
    expect(cancellationRows).toHaveLength(7);
    expect(cancellationRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          originalEntityType: 'ContractChange',
          originalEntityId: 61,
          amount: expect.objectContaining({}),
          metadata: { previousStatus: 'DRAFT', nextStatus: 'CANCELLED' },
        }),
        expect.objectContaining({
          originalEntityType: 'DepositRefund',
          originalEntityId: 82,
          metadata: { previousStatus: 'PENDING', nextStatus: 'CANCELLED' },
        }),
      ]),
    );
  });
  it('throws and writes no reversal trace when a cancellation count mismatches', async () => {
    const impact = executionImpact({
      pending: {
        adjustments: [],
        refunds: [],
        voidRequests: [],
        changes: [61],
        rebates: [],
        checkouts: [],
        depositRefunds: [],
      },
    });
    const { tx } = txFixture();
    tx.contractChange.findMany.mockResolvedValue([
      { id: 61, approvalStatus: 'PENDING' },
    ]);
    tx.contractChange.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      new ContractVoidReversalWriter().write(tx as never, request, impact, now),
    ).rejects.toThrow('合同关联审批状态已并发变化，请重新预览');
    expect(tx.contractVoidReversal.createMany).not.toHaveBeenCalled();
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it('writes balanced append-only source reversals without double counting refunded payments', async () => {
    const { tx, inserted } = txFixture();
    const impact = executionImpact();

    await new ContractVoidReversalWriter().write(
      tx as never,
      request,
      impact,
      now,
    );

    expect(tx.payment.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [21, 22] },
        status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED'] },
      },
      data: {
        status: 'VOIDED',
        voidReason: '合同纠错单 HTZF20260826000009',
        voidedBy: 1,
        voidedAt: now,
      },
    });
    expect(tx.rentBill.updateMany).toHaveBeenCalledWith({
      where: { contractId: 7, status: { not: 'VOIDED' } },
      data: { status: 'VOIDED' },
    });
    expect(tx.prepaymentTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 7,
        transactionType: 'REVERSAL',
        amount: expect.objectContaining({}),
        balanceAfter: expect.objectContaining({}),
        occurredAt: now,
      }),
    });
    expect(tx.depositTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 7,
        transactionType: 'REVERSAL',
        amount: expect.objectContaining({}),
        balanceAfter: expect.objectContaining({}),
        occurredAt: now,
      }),
    });

    const rows = inserted();
    const values = rows.map((row) => ({
      category: row.category,
      type: row.originalEntityType,
      id: row.originalEntityId,
      amount: new Prisma.Decimal(row.amount as Prisma.Decimal.Value).toFixed(2),
      before:
        row.balanceBefore === null
          ? null
          : new Prisma.Decimal(
              row.balanceBefore as Prisma.Decimal.Value,
            ).toFixed(2),
      after:
        row.balanceAfter === null
          ? null
          : new Prisma.Decimal(
              row.balanceAfter as Prisma.Decimal.Value,
            ).toFixed(2),
    }));
    expect(values).toEqual(
      expect.arrayContaining([
        {
          category: 'PAYMENT',
          type: 'Payment',
          id: 21,
          amount: '-300.00',
          before: '300.00',
          after: '0.00',
        },
        {
          category: 'PAYMENT',
          type: 'Payment',
          id: 22,
          amount: '-200.00',
          before: '200.00',
          after: '0.00',
        },
        {
          category: 'REFUND',
          type: 'PaymentRefund',
          id: 42,
          amount: '200.00',
          before: '-200.00',
          after: '0.00',
        },
        {
          category: 'REFUND',
          type: 'PaymentRefund',
          id: 41,
          amount: '50.00',
          before: '-50.00',
          after: '0.00',
        },
        {
          category: 'PAYMENT_ALLOCATION',
          type: 'PaymentAllocation',
          id: 61,
          amount: '-250.00',
          before: '250.00',
          after: '0.00',
        },
        {
          category: 'ADJUSTMENT',
          type: 'BillAdjustment',
          id: 71,
          amount: '100.00',
          before: '-100.00',
          after: '0.00',
        },
        {
          category: 'PRICING_REBATE',
          type: 'PricingRebate',
          id: 72,
          amount: '25.00',
          before: '-25.00',
          after: '0.00',
        },
        {
          category: 'COMMISSION',
          type: 'ContractCommission',
          id: 91,
          amount: '-40.00',
          before: '40.00',
          after: '0.00',
        },
        {
          category: 'CHECKOUT',
          type: 'CheckoutSettlement',
          id: 81,
          amount: '0.00',
          before: null,
          after: null,
        },
        {
          category: 'PREPAYMENT',
          type: 'ContractPrepaymentBalance',
          id: 7,
          amount: '-80.00',
          before: '80.00',
          after: '0.00',
        },
        {
          category: 'DEPOSIT',
          type: 'ContractDepositBalance',
          id: 7,
          amount: '-100.00',
          before: '100.00',
          after: '0.00',
        },
      ]),
    );
    expect(values).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'PAYMENT', id: 23 }),
        expect.objectContaining({ category: 'COMMISSION', id: 92 }),
      ]),
    );
    for (const row of values.filter((item) => item.before !== null)) {
      expect(new Prisma.Decimal(row.before!).plus(row.amount).toFixed(2)).toBe(
        row.after,
      );
    }
    const keys = rows.map((row) => row.idempotencyKey as string);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('contract-void:9:PAYMENT:21');
    expect(rows.every((row) => row.correctionOccurredAt === now)).toBe(true);
    expect(
      rows.find((row) => row.category === 'PREPAYMENT')?.originalOccurredAt,
    ).toEqual(new Date('2026-07-04T00:00:00.000Z'));
  });

  it('does not append balance transactions when both current balances are zero', async () => {
    const { tx } = txFixture();
    const impact = executionImpact({
      prepaymentBalance: '0.00',
      depositBalance: '0.00',
    });
    impact.sourceSnapshot.prepaymentBalanceSource = null;
    impact.sourceSnapshot.depositBalanceSource = null;

    await new ContractVoidReversalWriter().write(
      tx as never,
      request,
      impact,
      now,
    );

    expect(tx.prepaymentTransaction.create).not.toHaveBeenCalled();
    expect(tx.depositTransaction.create).not.toHaveBeenCalled();
  });

  it('fails closed when the reversal insert count is smaller than the planned rows', async () => {
    const { tx } = txFixture();
    tx.contractVoidReversal.createMany.mockResolvedValue({ count: 0 });

    await expect(
      new ContractVoidReversalWriter().write(
        tx as never,
        request,
        executionImpact(),
        now,
      ),
    ).rejects.toThrow('合同作废冲销写入不完整，请重试');
  });

  it('fails closed when the reloaded reversal idempotency keys differ from the plan', async () => {
    const { tx } = txFixture();
    tx.contractVoidReversal.findMany.mockResolvedValue([
      {
        id: 1,
        contractVoidRequestId: request.id,
        idempotencyKey: 'contract-void:9:PAYMENT:unexpected',
      },
    ]);

    await expect(
      new ContractVoidReversalWriter().write(
        tx as never,
        request,
        executionImpact(),
        now,
      ),
    ).rejects.toThrow('合同作废冲销记录校验失败，请人工核对');
  });

  it('accepts a complete planned reversal set without silently skipping duplicates', async () => {
    const { tx } = txFixture();

    await expect(
      new ContractVoidReversalWriter().write(
        tx as never,
        request,
        executionImpact(),
        now,
      ),
    ).resolves.toHaveLength(13);
    expect(tx.contractVoidReversal.createMany).toHaveBeenCalledWith({
      data: expect.any(Array),
    });
  });
});
