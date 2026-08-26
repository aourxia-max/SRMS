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
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: contractVoidReversalFindMany },
      },
    } as never);

    const report = await service.cashFlows('2026-08-01', '2026-08-31');

    expect(paymentFindMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: ['CONFIRMED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED', 'VOIDED'],
        },
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
              'COMMISSION',
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
});
