import {
  assertBalancedContractVoidImpact,
  computeContractVoidImpact,
  hashContractVoidImpact,
  type ContractVoidImpact,
  type ContractVoidImpactInput,
} from './contract-void-impact';

function inputFixture(
  overrides: Partial<ContractVoidImpactInput> = {},
): ContractVoidImpactInput {
  return {
    contract: { id: 7, status: 'ACTIVE', roomId: 3 },
    bills: [
      {
        id: 11,
        status: 'PAID',
        payableAmount: '3000.00',
        receivedAmount: '3000.00',
        outstandingAmount: '0.00',
      },
    ],
    payments: [
      {
        id: 21,
        status: 'CONFIRMED',
        amount: '3000.00',
        allocatedAmount: '3000.00',
        refundedAmount: '500.00',
        prepaymentNet: '0.00',
      },
    ],
    prepaymentBalance: '0.00',
    depositBalance: '1000.00',
    pending: {
      adjustments: [31],
      refunds: [],
      voidRequests: [],
      changes: [],
      rebates: [],
      checkouts: [],
      depositRefunds: [],
    },
    completedCheckoutIds: [],
    laterContractIds: [],
    currentRoomStatus: 'RENTED',
    ...overrides,
  };
}

describe('contract void impact', () => {
  it('calculates the approved partial-refund cash impact without double-counting the refund', () => {
    const impact = computeContractVoidImpact(inputFixture());

    expect(impact.summary).toEqual({
      rentBillPayable: '3000.00',
      effectivePayment: '2500.00',
      depositBalance: '1000.00',
      prepaymentBalance: '0.00',
      refundNet: '500.00',
      currentNetImpact: '3500.00',
      plannedReversal: '-3500.00',
      postReversalNetImpact: '0.00',
    });
    expect(impact.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'PAYMENT',
          originalEntityId: 21,
          amount: '-3000.00',
          balanceBefore: '3000.00',
          balanceAfter: '0.00',
          affectsNetImpact: true,
        }),
        expect.objectContaining({
          category: 'REFUND',
          originalEntityId: 21,
          amount: '500.00',
          balanceBefore: '-500.00',
          balanceAfter: '0.00',
          affectsNetImpact: true,
        }),
        expect.objectContaining({
          category: 'RENT_BILL',
          originalEntityId: 11,
          amount: '-3000.00',
          balanceBefore: '3000.00',
          balanceAfter: '0.00',
          affectsNetImpact: false,
        }),
      ]),
    );
    assertBalancedContractVoidImpact(impact);
  });

  it('handles no payments, consumed prepayment, and a positive deposit', () => {
    const impact = computeContractVoidImpact(
      inputFixture({
        payments: [],
        prepaymentBalance: '80.50',
        depositBalance: '1000.10',
      }),
    );

    expect(impact.summary).toMatchObject({
      effectivePayment: '0.00',
      refundNet: '0.00',
      currentNetImpact: '1080.60',
      plannedReversal: '-1080.60',
    });
    expect(impact.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'PREPAYMENT',
          amount: '-80.50',
          balanceBefore: '80.50',
        }),
        expect.objectContaining({
          category: 'DEPOSIT',
          amount: '-1000.10',
          balanceBefore: '1000.10',
        }),
      ]),
    );
  });

  it('keeps fully refunded payment/refund traces net-zero while excluding voided payments', () => {
    const impact = computeContractVoidImpact(
      inputFixture({
        payments: [
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
            amount: '300.00',
            allocatedAmount: '300.00',
            refundedAmount: '0.00',
            prepaymentNet: '0.00',
          },
          {
            id: 24,
            status: 'CONFIRMED',
            amount: '50.00',
            allocatedAmount: '50.00',
            refundedAmount: '0.00',
            prepaymentNet: '0.00',
          },
        ],
      }),
    );

    expect(impact.summary.effectivePayment).toBe('50.00');
    expect(impact.summary.refundNet).toBe('200.00');
    expect(impact.rows.filter((row) => row.category === 'PAYMENT')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ originalEntityId: 22, amount: '-200.00' }),
        expect.objectContaining({ originalEntityId: 24, amount: '-50.00' }),
      ]),
    );
    expect(impact.rows.filter((row) => row.category === 'REFUND')).toEqual([
      expect.objectContaining({ originalEntityId: 22, amount: '200.00' }),
    ]);
    expect(impact.rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ originalEntityId: 23 }),
      ]),
    );
  });

  it('keeps an explicit approved refund paired with its fully refunded payment', () => {
    const impact = computeContractVoidImpact(
      inputFixture({
        payments: [
          {
            id: 22,
            status: 'FULLY_REFUNDED',
            amount: '200.00',
            allocatedAmount: '200.00',
            refundedAmount: '200.00',
            prepaymentNet: '0.00',
          },
        ],
        refunds: [
          {
            id: 43,
            paymentId: 22,
            approvalStatus: 'APPROVED',
            amount: '200.00',
          },
        ],
      }),
    );

    expect(impact.summary.effectivePayment).toBe('0.00');
    expect(impact.summary.refundNet).toBe('200.00');
    const paired = impact.rows.filter(
      (row) =>
        (row.category === 'PAYMENT' && row.originalEntityId === 22) ||
        (row.category === 'REFUND' && row.originalEntityId === 43),
    );
    expect(paired).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'PAYMENT', amount: '-200.00' }),
        expect.objectContaining({ category: 'REFUND', amount: '200.00' }),
      ]),
    );
    expect(paired.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(0);
  });
  it('uses the payment amount, rather than bill allocation, for a partial payment', () => {
    const impact = computeContractVoidImpact(
      inputFixture({
        payments: [
          {
            id: 25,
            status: 'CONFIRMED',
            amount: '1200.00',
            allocatedAmount: '1200.00',
            refundedAmount: '0.00',
            prepaymentNet: '0.00',
          },
        ],
      }),
    );

    expect(impact.summary).toMatchObject({
      rentBillPayable: '3000.00',
      effectivePayment: '1200.00',
      currentNetImpact: '2200.00',
      plannedReversal: '-2200.00',
    });
  });
  it('uses individual approved refund rows when actual refunds are provided', () => {
    const impact = computeContractVoidImpact(
      inputFixture({
        payments: [
          {
            id: 21,
            status: 'PARTIALLY_REFUNDED',
            amount: '3000.00',
            allocatedAmount: '3000.00',
            refundedAmount: '800.00',
            prepaymentNet: '0.00',
          },
        ],
        refunds: [
          {
            id: 41,
            paymentId: 21,
            approvalStatus: 'APPROVED',
            amount: '500.00',
            occurredAt: '2026-08-01T00:00:00.000Z',
          },
          {
            id: 42,
            paymentId: 21,
            approvalStatus: 'PENDING',
            amount: '300.00',
          },
        ],
      }),
    );

    expect(impact.summary).toMatchObject({
      effectivePayment: '2500.00',
      refundNet: '500.00',
    });
    expect(impact.rows.filter((row) => row.category === 'REFUND')).toEqual([
      expect.objectContaining({
        originalEntityId: 41,
        amount: '500.00',
        originalOccurredAt: '2026-08-01T00:00:00.000Z',
        metadata: { paymentId: 21 },
      }),
    ]);
  });

  it('exposes informational workflow, checkout, later-contract, and room-state effects', () => {
    const impact = computeContractVoidImpact(
      inputFixture({
        pending: {
          adjustments: [32, 31],
          refunds: [41],
          voidRequests: [51],
          changes: [61],
          rebates: [71],
          checkouts: [81],
          depositRefunds: [82],
        },
        completedCheckoutIds: [91],
        laterContractIds: [101],
        currentRoomStatus: 'PENDING_CHECKOUT',
      }),
    );

    expect(impact.flags).toEqual({
      hasPendingWorkflows: true,
      hasCompletedCheckout: true,
      hasLaterContract: true,
    });
    expect(impact.room).toEqual({
      currentStatus: 'PENDING_CHECKOUT',
      hasLaterContract: true,
      action: 'KEEP_CURRENT_STATUS',
    });
    expect(impact.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'ADJUSTMENT',
          originalEntityType: 'BillAdjustment',
          originalEntityId: 31,
          amount: '0.00',
          affectsNetImpact: false,
        }),
        expect.objectContaining({
          category: 'DEPOSIT',
          originalEntityType: 'DepositRefund',
          originalEntityId: 82,
          amount: '0.00',
          affectsNetImpact: false,
        }),
        expect.objectContaining({
          category: 'CHECKOUT',
          originalEntityType: 'CheckoutSettlement',
          originalEntityId: 91,
          amount: '0.00',
          affectsNetImpact: false,
        }),
        expect.objectContaining({
          category: 'ROOM_STATUS',
          originalEntityType: 'Room',
          originalEntityId: 3,
          amount: '0.00',
          affectsNetImpact: false,
        }),
      ]),
    );
  });

  it('hashes an equivalent impact identically regardless of relation order', () => {
    const left = computeContractVoidImpact(
      inputFixture({
        payments: [
          {
            id: 22,
            status: 'CONFIRMED',
            amount: '10.00',
            allocatedAmount: '10.00',
            refundedAmount: '0.00',
            prepaymentNet: '0.00',
          },
          {
            id: 21,
            status: 'CONFIRMED',
            amount: '20.00',
            allocatedAmount: '20.00',
            refundedAmount: '0.00',
            prepaymentNet: '0.00',
          },
        ],
        pending: {
          adjustments: [32, 31],
          refunds: [],
          voidRequests: [],
          changes: [],
          rebates: [],
          checkouts: [],
          depositRefunds: [82, 81],
        },
      }),
    );
    const right = computeContractVoidImpact(
      inputFixture({
        payments: [
          {
            id: 21,
            status: 'CONFIRMED',
            amount: '20.00',
            allocatedAmount: '20.00',
            refundedAmount: '0.00',
            prepaymentNet: '0.00',
          },
          {
            id: 22,
            status: 'CONFIRMED',
            amount: '10.00',
            allocatedAmount: '10.00',
            refundedAmount: '0.00',
            prepaymentNet: '0.00',
          },
        ],
        pending: {
          adjustments: [31, 32],
          refunds: [],
          voidRequests: [],
          changes: [],
          rebates: [],
          checkouts: [],
          depositRefunds: [81, 82],
        },
      }),
    );

    expect(hashContractVoidImpact(left)).toBe(hashContractVoidImpact(right));
  });

  it('changes the impact hash when a pending deposit refund is created', () => {
    const without = computeContractVoidImpact(inputFixture());
    const withPending = computeContractVoidImpact(
      inputFixture({
        pending: {
          ...inputFixture().pending,
          depositRefunds: [901],
        },
      }),
    );

    expect(hashContractVoidImpact(withPending)).not.toBe(
      hashContractVoidImpact(without),
    );
  });
  it('hashes equal when nested metadata relation arrays are reordered', () => {
    const impact = computeContractVoidImpact(
      inputFixture({ laterContractIds: [101, 102] }),
    );
    const left: ContractVoidImpact = {
      ...impact,
      rows: impact.rows.map((row) =>
        row.category === 'ROOM_STATUS'
          ? {
              ...row,
              metadata: {
                ...row.metadata,
                linkedContracts: [
                  { id: 201, state: 'ACTIVE' },
                  { id: 202, state: 'ENDED' },
                ],
              },
            }
          : row,
      ),
    };
    const right: ContractVoidImpact = {
      ...left,
      rows: left.rows.map((row) =>
        row.category === 'ROOM_STATUS'
          ? {
              ...row,
              metadata: {
                ...row.metadata,
                laterContractIds: [102, 101],
                linkedContracts: [
                  { id: 202, state: 'ENDED' },
                  { id: 201, state: 'ACTIVE' },
                ],
              },
            }
          : row,
      ),
    };

    expect(hashContractVoidImpact(left)).toBe(hashContractVoidImpact(right));
  });
  it('throws the category of the first unbalanced monetary row', () => {
    const impact = computeContractVoidImpact(inputFixture());
    const unbalanced: ContractVoidImpact = {
      ...impact,
      rows: impact.rows.map((row) =>
        row.category === 'PAYMENT' ? { ...row, balanceAfter: '1.00' } : row,
      ),
    };

    expect(() => assertBalancedContractVoidImpact(unbalanced)).toThrow(
      '合同纠错金额无法平衡：PAYMENT',
    );
  });
});
