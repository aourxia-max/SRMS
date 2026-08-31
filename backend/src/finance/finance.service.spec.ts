import { FinanceService } from './finance.service';
import { Prisma } from '@prisma/client';

describe('FinanceService rent collection category isolation', () => {
  it('queries only rental bills when calculating rent collection', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new FinanceService({
      db: { rentBill: { findMany } },
    } as never);

    await service.rentCollection('2026-08-01', '2026-08-31');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billCategory: 'RENT',
          status: { not: 'VOIDED' },
          contract: { status: { not: 'VOIDED' } },
        }),
      }),
    );
  });

  it('includes only active approved discount and waiver adjustments in rent concessions', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        billNo: 'BILL-001',
        periodStart: new Date('2026-08-01'),
        baseRentAmount: new Prisma.Decimal('1000.00'),
        rentFreeAmount: new Prisma.Decimal('100.00'),
        discountAmount: new Prisma.Decimal('50.00'),
        payableAmount: new Prisma.Decimal('800.00'),
        status: 'PENDING',
        contract: {
          contractNo: 'HT-001',
          room: { fullHouseNo: '1-101' },
          members: [{ tenant: { name: '测试租户' } }],
        },
        allocations: [],
        adjustments: [
          { amount: new Prisma.Decimal('30.00') },
          { amount: new Prisma.Decimal('20.00') },
        ],
      },
    ]);
    const service = new FinanceService({
      db: { rentBill: { findMany } },
    } as never);

    const report = await service.rentCollection();

    expect(findMany.mock.calls[0][0].include.adjustments).toEqual({
      where: {
        adjustmentType: { in: ['DISCOUNT', 'WAIVER'] },
        direction: 'DECREASE',
        approvalStatus: 'APPROVED',
        reversedByAdjustmentId: null,
      },
      select: { amount: true },
    });
    expect(report.rows[0].concessionAmount).toEqual(
      new Prisma.Decimal('200.00'),
    );
    expect(report.rows[0].netReceivable).toEqual(new Prisma.Decimal('800.00'));
    expect(report.total.concessionAmount).toEqual(new Prisma.Decimal('200.00'));
  });

  it('labels checkout supplemental receipts without counting them as rental receipts', async () => {
    const service = new FinanceService({
      db: {
        payment: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentDate: new Date('2026-08-22'),
              paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
              amount: '100.00',
              receiptNo: 'SK-1',
            },
          ]),
        },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    await expect(service.cashFlows()).resolves.toMatchObject({
      flows: [
        expect.objectContaining({
          type: '退租补收',
          countsAsRentReceipt: false,
        }),
      ],
    });
  });

  it('sums only the latest deposit balance of each contract', async () => {
    const depositFindMany = jest.fn().mockResolvedValue([
      { contractId: 1, balanceAfter: new Prisma.Decimal('7000.00') },
      { contractId: 2, balanceAfter: new Prisma.Decimal('3000.00') },
      { contractId: 3, balanceAfter: new Prisma.Decimal('0.00') },
    ]);
    const prepaymentFindMany = jest.fn().mockResolvedValue([
      { contractId: 1, balanceAfter: new Prisma.Decimal('500.00') },
      { contractId: 2, balanceAfter: new Prisma.Decimal('200.00') },
    ]);
    const service = new FinanceService({
      db: {
        depositTransaction: { findMany: depositFindMany },
        prepaymentTransaction: { findMany: prepaymentFindMany },
      },
    } as never);

    await expect(service.overview()).resolves.toEqual({
      depositBalanceTotal: new Prisma.Decimal('10000.00'),
      prepaymentBalanceTotal: new Prisma.Decimal('700.00'),
    });
    expect(depositFindMany).toHaveBeenCalledWith({
      where: { contract: { status: { not: 'VOIDED' } } },
      distinct: ['contractId'],
      orderBy: [{ contractId: 'asc' }, { id: 'desc' }],
      select: { contractId: true, balanceAfter: true },
    });
    expect(prepaymentFindMany).toHaveBeenCalledWith({
      where: { contract: { status: { not: 'VOIDED' } } },
      distinct: ['contractId'],
      orderBy: [{ contractId: 'asc' }, { id: 'desc' }],
      select: { contractId: true, balanceAfter: true },
    });
  });

  it('returns a zero deposit balance when no ledger exists', async () => {
    const service = new FinanceService({
      db: {
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        prepaymentTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    await expect(service.overview()).resolves.toEqual({
      depositBalanceTotal: new Prisma.Decimal('0.00'),
      prepaymentBalanceTotal: new Prisma.Decimal('0.00'),
    });
  });

  it('keeps original voided receipts and globally merges monetary corrections by correction date', async () => {
    const correctionOccurredAt = new Date('2026-08-26T10:00:00.000Z');
    const originalOccurredAt = new Date('2026-08-02T09:00:00.000Z');
    const contractVoidReversalFindMany = jest.fn().mockResolvedValue([
      {
        id: 91,
        category: 'PAYMENT',
        amount: new Prisma.Decimal('-120.00'),
        balanceBefore: new Prisma.Decimal('120.00'),
        balanceAfter: new Prisma.Decimal('0.00'),
        originalEntityType: 'Payment',
        originalEntityId: 31,
        generatedEntityType: null,
        generatedEntityId: null,
        originalOccurredAt,
        correctionOccurredAt,
        request: {
          requestNo: 'HTZF202608260001',
          contract: { contractNo: 'HT20260001' },
        },
      },
    ]);
    const paymentFindMany = jest.fn().mockResolvedValue([
      {
        id: 31,
        paymentDate: originalOccurredAt,
        paymentCategory: 'RENT',
        amount: new Prisma.Decimal('120.00'),
        receiptNo: 'SK-31',
        status: 'VOIDED',
      },
    ]);
    const service = new FinanceService({
      db: {
        payment: { findMany: paymentFindMany },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: contractVoidReversalFindMany },
      },
    } as never);

    const report = await service.cashFlows('2026-08-01', '2026-08-31');

    expect(paymentFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED'] } },
          { id: { in: expect.any(Array) } },
        ],
        paymentDate: {
          gte: new Date('2026-07-31T16:00:00.000Z'),
          lt: new Date('2026-08-31T16:00:00.000Z'),
        },
      },
    });
    expect(contractVoidReversalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: {
            in: [
              'RENT_BILL',
              'PAYMENT',
              'PAYMENT_ALLOCATION',
              'PREPAYMENT',
              'DEPOSIT',
              'REFUND',
              'ADJUSTMENT',
              'PRICING_REBATE',
            ],
          },
          correctionOccurredAt: {
            gte: new Date('2026-07-31T16:00:00.000Z'),
            lt: new Date('2026-08-31T16:00:00.000Z'),
          },
          balanceBefore: { not: null },
          balanceAfter: { not: null },
        }),
      }),
    );
    expect(report.total).toBe(2);
    expect(report.flows).toHaveLength(2);
    expect(report.flows[0]).toMatchObject({
      flowType: 'CONTRACT_VOID_REVERSAL',
      type: '\u5408\u540c\u7ea0\u9519\u51b2\u9500',
      amount: new Prisma.Decimal('-120.00'),
      direction: 'OUT',
      external: false,
      countsAsRentReceipt: false,
      reference: 'HTZF202608260001',
      requestNo: 'HTZF202608260001',
      contractNo: 'HT20260001',
      correctionOccurredAt,
      originalOccurredAt,
      source: { entityType: 'Payment', entityId: 31 },
      generatedSource: null,
    });
    expect(report.flows[1]).toMatchObject({
      type: '\u79df\u91d1\u6536\u6b3e',
      reference: 'SK-31',
      countsAsRentReceipt: false,
    });
  });

  it('reports one combined checkout refund outflow with all three splits', async () => {
    const refundDate = new Date('2026-08-30T00:00:00.000Z');
    const depositRefundFindMany = jest.fn().mockResolvedValue([
      {
        id: 33,
        refundNo: 'YJTK202608300033',
        refundDate,
        refundAmount: new Prisma.Decimal('10500.00'),
        depositRefundAmount: new Prisma.Decimal('7500.00'),
        prepaymentRefundAmount: new Prisma.Decimal('1000.00'),
        rentRefundAmount: new Prisma.Decimal('2000.00'),
      },
    ]);
    const service = new FinanceService({
      db: {
        payment: { findMany: jest.fn().mockResolvedValue([]) },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositRefund: { findMany: depositRefundFindMany },
        depositTransaction: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 401,
              transactionType: 'REFUND',
              occurredAt: refundDate,
              amount: new Prisma.Decimal('7500.00'),
              transactionNo: 'YJTK202608300033-DEPOSIT',
            },
          ]),
        },
        contractVoidReversal: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    const report = await service.cashFlows();
    const combined = report.flows.filter(
      (item) => item.flowType === 'CHECKOUT_COMBINED_REFUND',
    );

    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({
      type: '退租合并退款（押金 ¥7500.00、预收款 ¥1000.00、租金 ¥2000.00）',
      amount: new Prisma.Decimal('10500.00'),
      direction: 'OUT',
      external: true,
      reference: 'YJTK202608300033',
      source: { entityType: 'DepositRefund', entityId: 33 },
    });
    expect(report.outflow.toFixed(2)).toBe('10500.00');
    expect(report.flows).toHaveLength(1);
    expect(depositRefundFindMany).toHaveBeenCalledWith({
      where: { approvalStatus: 'APPROVED' },
    });
  });
});
