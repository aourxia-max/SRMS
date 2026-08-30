import { Prisma } from '@prisma/client';
import { applyCheckoutRentRefund } from './checkout-rent-refund-writer';

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const money = (value: Prisma.Decimal.Value) =>
  new Prisma.Decimal(value).toFixed(2);

type TestRecord = Record<string, any>;

function paymentRow(
  id: number,
  allocations: Array<{
    id: number;
    allocatedAmount: Prisma.Decimal.Value;
    refundAllocations?: Array<{
      reversedAmount: Prisma.Decimal.Value;
      approvalStatus: 'PENDING' | 'APPROVED';
    }>;
    checkoutAllocations?: Array<{
      reservedAmount: Prisma.Decimal.Value;
      status: 'RESERVED' | 'RELEASED' | 'APPLIED';
    }>;
  }>,
) {
  return {
    id,
    contractId: 4,
    paymentCategory: 'RENT',
    status: 'CONFIRMED',
    allocations: allocations.map((allocation) => ({
      id: allocation.id,
      allocatedAmount: decimal(allocation.allocatedAmount),
      refundAllocations: (allocation.refundAllocations ?? []).map((item) => ({
        reversedAmount: decimal(item.reversedAmount),
        paymentRefund: { approvalStatus: item.approvalStatus },
      })),
      checkoutRentRefundAllocations: (allocation.checkoutAllocations ?? []).map(
        (item) => ({
          reservedAmount: decimal(item.reservedAmount),
          status: item.status,
        }),
      ),
    })),
  };
}

function reservation(overrides: TestRecord = {}) {
  return {
    id: 501,
    checkoutSettlementItemId: 81,
    paymentAllocationId: 101,
    paymentId: 11,
    rentBillId: 20,
    reservedAmount: decimal('1000.00'),
    status: 'RESERVED',
    depositRefundId: null,
    ...overrides,
  };
}

function bill(overrides: TestRecord = {}) {
  return {
    id: 20,
    contractId: 4,
    billCategory: 'RENT',
    adjustmentAmount: decimal('0.00'),
    payableAmount: decimal('3000.00'),
    receivedAmount: decimal('3000.00'),
    outstandingAmount: decimal('0.00'),
    status: 'PAID',
    ...overrides,
  };
}

function allocation(overrides: TestRecord = {}) {
  return {
    id: 101,
    paymentId: 11,
    rentBillId: 20,
    allocatedAmount: decimal('3000.00'),
    reversedAmount: decimal('0.00'),
    ...overrides,
  };
}

function writerHarness(
  options: {
    amount?: Prisma.Decimal.Value;
    settlement?: TestRecord;
    refund?: TestRecord;
    items?: TestRecord[];
    reservations?: TestRecord[];
    bills?: TestRecord[];
    allocations?: TestRecord[];
    payments?: TestRecord[];
  } = {},
) {
  const amount = decimal(options.amount ?? '1000.00');
  const settlement = {
    id: 9,
    contractId: 4,
    status: 'APPROVED',
    depositRefundableAmount: decimal('0.00'),
    prepaymentRefundableAmount: decimal('0.00'),
    rentRefundableAmount: amount,
    ...options.settlement,
  };
  const refund = {
    id: 33,
    contractId: 4,
    checkoutSettlementId: 9,
    refundAmount: amount,
    depositRefundAmount: decimal('0.00'),
    prepaymentRefundAmount: decimal('0.00'),
    rentRefundAmount: amount,
    approvalStatus: 'APPROVED',
    approvedBy: 1,
    ...options.refund,
  };
  const items = options.items ?? [
    {
      id: 81,
      checkoutSettlementId: 9,
      itemType: 'RENT_REFUND',
      amount,
    },
  ];
  const reservations = options.reservations ?? [
    reservation({ reservedAmount: amount }),
  ];
  const bills = options.bills ?? [bill()];
  const allocations = options.allocations ?? [allocation()];
  const payments = options.payments ?? [
    paymentRow(11, [{ id: 101, allocatedAmount: '3000.00' }]),
  ];

  const billStates = new Map(
    bills.map((item) => [item.id, { ...item }] as const),
  );
  const allocationStates = new Map(
    allocations.map((item) => [item.id, { ...item }] as const),
  );
  const reservationStates = new Map(
    reservations.map((item) => [item.id, { ...item }] as const),
  );
  const paymentStates = new Map(
    payments.map((item) => [item.id, { status: 'CONFIRMED' }] as const),
  );
  const adjustments: TestRecord[] = [];

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    checkoutSettlement: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(settlement),
    },
    checkoutSettlementItem: {
      findMany: jest.fn().mockResolvedValue(items),
    },
    depositRefund: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(refund),
    },
    checkoutRentRefundAllocation: {
      findMany: jest
        .fn()
        .mockImplementation(() =>
          [...reservationStates.values()].map((item) => ({ ...item })),
        ),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        const ids = new Set<number>(where.id.in);
        let count = 0;
        for (const item of reservationStates.values()) {
          if (ids.has(item.id) && item.status === where.status) {
            Object.assign(item, data);
            count += 1;
          }
        }
        return { count };
      }),
    },
    rentBill: {
      findMany: jest
        .fn()
        .mockImplementation(() =>
          [...billStates.values()].map((item) => ({ ...item })),
        ),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const current = billStates.get(where.id);
        if (!current) throw new Error('账单不存在');
        Object.assign(current, data);
        return { ...current };
      }),
    },
    paymentAllocation: {
      findMany: jest
        .fn()
        .mockImplementation(() =>
          [...allocationStates.values()].map((item) => ({ ...item })),
        ),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const current = allocationStates.get(where.id);
        if (!current) throw new Error('收款分配不存在');
        Object.assign(current, data);
        return { ...current };
      }),
    },
    payment: {
      findMany: jest.fn().mockResolvedValue(payments),
      update: jest.fn().mockImplementation(({ where, data }) => {
        const current = paymentStates.get(where.id);
        if (!current) throw new Error('收款不存在');
        Object.assign(current, data);
        return { id: where.id, ...current };
      }),
    },
    billAdjustment: {
      create: jest.fn().mockImplementation(({ data }) => {
        const created = { ...data, id: adjustments.length + 700 };
        adjustments.push(created);
        return { id: created.id };
      }),
    },
  };

  return {
    tx,
    billStates,
    allocationStates,
    reservationStates,
    paymentStates,
    adjustments,
  };
}

const input = {
  settlementId: 9,
  depositRefundId: 33,
  approvedBy: 1,
  occurredAt: new Date('2026-08-30T00:00:00.000Z'),
};

describe('applyCheckoutRentRefund', () => {
  it('partially reverses net receivable and received rent without creating arrears', async () => {
    const harness = writerHarness();

    const result = await applyCheckoutRentRefund(harness.tx as never, input);

    expect({
      adjustmentAmount: money(harness.billStates.get(20)!.adjustmentAmount),
      payableAmount: money(harness.billStates.get(20)!.payableAmount),
      receivedAmount: money(harness.billStates.get(20)!.receivedAmount),
      outstandingAmount: money(harness.billStates.get(20)!.outstandingAmount),
      status: harness.billStates.get(20)!.status,
    }).toEqual({
      adjustmentAmount: '-1000.00',
      payableAmount: '2000.00',
      receivedAmount: '2000.00',
      outstandingAmount: '0.00',
      status: 'PAID',
    });
    expect(harness.adjustments).toEqual([
      expect.objectContaining({
        rentBillId: 20,
        checkoutSettlementItemId: 81,
        adjustmentType: 'CHECKOUT_RENT_REFUND',
        direction: 'DECREASE',
        amount: decimal('1000.00'),
        beforeAmount: decimal('3000.00'),
        afterAmount: decimal('2000.00'),
        approvalStatus: 'APPROVED',
        submittedBy: 1,
        approvedBy: 1,
        submittedAt: input.occurredAt,
        approvedAt: input.occurredAt,
      }),
    ]);
    expect(money(harness.allocationStates.get(101)!.reversedAmount)).toBe(
      '1000.00',
    );
    expect(harness.reservationStates.get(501)).toMatchObject({
      status: 'APPLIED',
      appliedAt: input.occurredAt,
      depositRefundId: 33,
    });
    expect(harness.paymentStates.get(11)!.status).toBe('PARTIALLY_REFUNDED');
    expect(result).toEqual({
      appliedAmount: '1000.00',
      affectedBillIds: [20],
      affectedPaymentIds: [11],
    });

    const lockSql = harness.tx.$queryRaw.mock.calls.map(
      ([query]) =>
        (query as { strings?: readonly string[] }).strings?.join('?') ?? '',
    );
    for (const table of [
      'checkout_settlements',
      'deposit_refunds',
      'checkout_settlement_items',
      'checkout_rent_refund_allocations',
      'rent_bills',
      'payments',
      'payment_allocations',
      'payment_refund_allocations',
    ])
      expect(
        lockSql.some(
          (sql) => sql.includes(table) && sql.includes('FOR UPDATE'),
        ),
      ).toBe(true);
  });

  it('marks a bill and payment fully refunded when their allocated rent reaches zero', async () => {
    const harness = writerHarness({
      bills: [
        bill({
          payableAmount: decimal('1000.00'),
          receivedAmount: decimal('1000.00'),
        }),
      ],
      allocations: [allocation({ allocatedAmount: decimal('1000.00') })],
      payments: [paymentRow(11, [{ id: 101, allocatedAmount: '1000.00' }])],
    });

    await applyCheckoutRentRefund(harness.tx as never, input);

    expect({
      payableAmount: money(harness.billStates.get(20)!.payableAmount),
      receivedAmount: money(harness.billStates.get(20)!.receivedAmount),
      outstandingAmount: money(harness.billStates.get(20)!.outstandingAmount),
      status: harness.billStates.get(20)!.status,
      paymentStatus: harness.paymentStates.get(11)!.status,
    }).toEqual({
      payableAmount: '0.00',
      receivedAmount: '0.00',
      outstandingAmount: '0.00',
      status: 'REFUNDED',
      paymentStatus: 'FULLY_REFUNDED',
    });
  });

  it('aggregates multiple allocations per bill and updates multiple payments and bills once each', async () => {
    const harness = writerHarness({
      amount: '1500.00',
      reservations: [
        reservation({
          id: 501,
          paymentAllocationId: 101,
          paymentId: 11,
          rentBillId: 20,
          reservedAmount: decimal('400.00'),
        }),
        reservation({
          id: 502,
          paymentAllocationId: 102,
          paymentId: 12,
          rentBillId: 20,
          reservedAmount: decimal('600.00'),
        }),
        reservation({
          id: 503,
          paymentAllocationId: 103,
          paymentId: 12,
          rentBillId: 21,
          reservedAmount: decimal('500.00'),
        }),
      ],
      bills: [
        bill({
          id: 20,
          payableAmount: decimal('2000.00'),
          receivedAmount: decimal('2000.00'),
        }),
        bill({
          id: 21,
          payableAmount: decimal('1500.00'),
          receivedAmount: decimal('1500.00'),
        }),
      ],
      allocations: [
        allocation({
          id: 101,
          paymentId: 11,
          rentBillId: 20,
          allocatedAmount: decimal('400.00'),
        }),
        allocation({
          id: 102,
          paymentId: 12,
          rentBillId: 20,
          allocatedAmount: decimal('1000.00'),
        }),
        allocation({
          id: 103,
          paymentId: 12,
          rentBillId: 21,
          allocatedAmount: decimal('1000.00'),
        }),
      ],
      payments: [
        paymentRow(11, [{ id: 101, allocatedAmount: '400.00' }]),
        paymentRow(12, [
          { id: 102, allocatedAmount: '1000.00' },
          { id: 103, allocatedAmount: '1000.00' },
        ]),
      ],
    });

    const result = await applyCheckoutRentRefund(harness.tx as never, input);

    expect(harness.tx.rentBill.update).toHaveBeenCalledTimes(2);
    expect(harness.adjustments).toHaveLength(2);
    expect({
      bill20: [
        money(harness.billStates.get(20)!.payableAmount),
        money(harness.billStates.get(20)!.receivedAmount),
        harness.billStates.get(20)!.status,
      ],
      bill21: [
        money(harness.billStates.get(21)!.payableAmount),
        money(harness.billStates.get(21)!.receivedAmount),
        harness.billStates.get(21)!.status,
      ],
      payment11: harness.paymentStates.get(11)!.status,
      payment12: harness.paymentStates.get(12)!.status,
    }).toEqual({
      bill20: ['1000.00', '1000.00', 'PAID'],
      bill21: ['1000.00', '1000.00', 'PAID'],
      payment11: 'FULLY_REFUNDED',
      payment12: 'PARTIALLY_REFUNDED',
    });
    expect(
      harness.adjustments.map((item) => [
        item.rentBillId as number,
        money(item.amount as Prisma.Decimal.Value),
      ]),
    ).toEqual([
      [20, '1000.00'],
      [21, '500.00'],
    ]);
    expect(result).toEqual({
      appliedAmount: '1500.00',
      affectedBillIds: [20, 21],
      affectedPaymentIds: [11, 12],
    });
  });

  it('counts only approved ordinary refunds plus applied and current checkout reversals for payment status', async () => {
    const harness = writerHarness({
      amount: '200.00',
      reservations: [reservation({ reservedAmount: decimal('200.00') })],
      bills: [
        bill({
          payableAmount: decimal('1000.00'),
          receivedAmount: decimal('1000.00'),
        }),
      ],
      allocations: [
        allocation({
          allocatedAmount: decimal('1000.00'),
          reversedAmount: decimal('500.00'),
        }),
      ],
      payments: [
        paymentRow(11, [
          {
            id: 101,
            allocatedAmount: '1000.00',
            refundAllocations: [
              { reversedAmount: '300.00', approvalStatus: 'APPROVED' },
              { reversedAmount: '400.00', approvalStatus: 'PENDING' },
            ],
            checkoutAllocations: [
              { reservedAmount: '200.00', status: 'APPLIED' },
              { reservedAmount: '100.00', status: 'RELEASED' },
            ],
          },
        ]),
      ],
    });

    await applyCheckoutRentRefund(harness.tx as never, input);

    expect(money(harness.allocationStates.get(101)!.reversedAmount)).toBe(
      '700.00',
    );
    expect(harness.paymentStates.get(11)!.status).toBe('PARTIALLY_REFUNDED');
  });

  it.each(['RELEASED', 'APPLIED'] as const)(
    'rejects %s reservations and performs no accounting write',
    async (status) => {
      const harness = writerHarness({
        reservations: [
          reservation({
            status,
            depositRefundId: status === 'APPLIED' ? 33 : null,
          }),
        ],
      });

      await expect(
        applyCheckoutRentRefund(harness.tx as never, input),
      ).rejects.toThrow(
        status === 'APPLIED'
          ? '退租租金退款已处理，不能重复回冲。'
          : '退租租金退款预留已释放，请退回结算草稿后重新提交。',
      );
      expect(harness.tx.rentBill.update).not.toHaveBeenCalled();
      expect(harness.tx.paymentAllocation.update).not.toHaveBeenCalled();
      expect(
        harness.tx.checkoutRentRefundAllocation.updateMany,
      ).not.toHaveBeenCalled();
    },
  );

  it('rejects a tampered reserved total before changing any balance', async () => {
    const harness = writerHarness({
      reservations: [reservation({ reservedAmount: decimal('999.99') })],
    });

    await expect(
      applyCheckoutRentRefund(harness.tx as never, input),
    ).rejects.toThrow(
      '退租租金退款金额或锁定快照已变化，请退回结算草稿后重新提交。',
    );
    expect(harness.tx.rentBill.update).not.toHaveBeenCalled();
  });

  it('rejects a stored deposit/prepayment split that was swapped without changing the total', async () => {
    const harness = writerHarness({
      settlement: {
        depositRefundableAmount: decimal('800.00'),
        prepaymentRefundableAmount: decimal('500.00'),
      },
      refund: {
        refundAmount: decimal('2300.00'),
        depositRefundAmount: decimal('500.00'),
        prepaymentRefundAmount: decimal('800.00'),
      },
    });

    await expect(
      applyCheckoutRentRefund(harness.tx as never, input),
    ).rejects.toThrow(
      '退租租金退款金额或锁定快照已变化，请退回结算草稿后重新提交。',
    );
    expect(harness.tx.rentBill.update).not.toHaveBeenCalled();
  });

  it('rejects cached payment and bill references that no longer match the allocation', async () => {
    const harness = writerHarness({
      reservations: [reservation({ paymentId: 12 })],
    });

    await expect(
      applyCheckoutRentRefund(harness.tx as never, input),
    ).rejects.toThrow('退租租金退款引用已变化，请退回结算草稿后重新提交。');
    expect(harness.tx.rentBill.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      '非租金账单',
      {
        bills: [bill({ billCategory: 'CHECKOUT_SUPPLEMENTAL' })],
      },
    ],
    [
      '非租金收款',
      {
        payments: [
          {
            ...paymentRow(11, [{ id: 101, allocatedAmount: '3000.00' }]),
            paymentCategory: 'DEPOSIT',
          },
        ],
      },
    ],
  ])('rejects a reservation that points to a %s', async (_label, options) => {
    const harness = writerHarness(options);

    await expect(
      applyCheckoutRentRefund(harness.tx as never, input),
    ).rejects.toThrow('退租租金退款引用已变化，请退回结算草稿后重新提交。');
    expect(harness.tx.rentBill.update).not.toHaveBeenCalled();
  });

  it('rejects a reversal that would exceed an allocation or make bill amounts negative', async () => {
    const allocationChanged = writerHarness({
      allocations: [
        allocation({
          allocatedAmount: decimal('1000.00'),
          reversedAmount: decimal('0.01'),
        }),
      ],
    });
    await expect(
      applyCheckoutRentRefund(allocationChanged.tx as never, input),
    ).rejects.toThrow(
      '退租租金退款超过当前可回冲金额，请退回结算草稿后重新提交。',
    );

    const billChanged = writerHarness({
      bills: [
        bill({
          payableAmount: decimal('999.99'),
          receivedAmount: decimal('999.99'),
        }),
      ],
    });
    await expect(
      applyCheckoutRentRefund(billChanged.tx as never, input),
    ).rejects.toThrow('租金账单金额已变化，不能执行退租租金退款。');
  });

  it('stops later accounting steps when a bill update fails inside the caller transaction', async () => {
    const harness = writerHarness();
    harness.tx.rentBill.update.mockRejectedValueOnce(
      new Error('模拟账单写入失败'),
    );

    await expect(
      applyCheckoutRentRefund(harness.tx as never, input),
    ).rejects.toThrow('模拟账单写入失败');
    expect(harness.tx.billAdjustment.create).not.toHaveBeenCalled();
    expect(harness.tx.paymentAllocation.update).not.toHaveBeenCalled();
    expect(
      harness.tx.checkoutRentRefundAllocation.updateMany,
    ).not.toHaveBeenCalled();
    expect(harness.tx.payment.update).not.toHaveBeenCalled();
  });
});
