import { Prisma } from '@prisma/client';
import { FinanceService } from './finance.service';

describe('FinanceService void correction cash-flow audit', () => {
  it('retains an ordinary fully refunded payment as historical inflow', async () => {
    const paymentFindMany = jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(
        (where.status?.in ?? where.OR?.[0]?.status.in ?? []).some(
          (status: string) => ['FULLY_REFUNDED', 'VOIDED'].includes(status),
        )
          ? [
              {
                id: 12,
                paymentDate: new Date('2026-08-05T02:00:00.000Z'),
                paymentCategory: 'RENT',
                amount: new Prisma.Decimal('100.00'),
                receiptNo: 'SK-12',
                status: 'FULLY_REFUNDED',
              },
            ]
          : [],
      ),
    );
    const service = new FinanceService({
      db: {
        payment: { findMany: paymentFindMany },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);
    await expect(service.cashFlows()).resolves.toMatchObject({
      rentAndDepositReceivedTotal: new Prisma.Decimal('100.00'),
      flows: [
        expect.objectContaining({
          flowType: 'PAYMENT',
          amount: new Prisma.Decimal('100.00'),
          direction: 'IN',
          countsAsRentReceipt: false,
        }),
      ],
    });
  });
  it('retains a terminal payment when its contract correction reversal matches it', async () => {
    const paymentFindMany = jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(
        where.OR?.[1]?.id.in.includes(14)
          ? [
              {
                id: 14,
                paymentDate: new Date('2026-08-05T02:00:00.000Z'),
                paymentCategory: 'RENT',
                amount: new Prisma.Decimal('100.00'),
                receiptNo: 'SK-14',
                status: 'FULLY_REFUNDED',
              },
            ]
          : [],
      ),
    );
    const reversalFindMany = jest
      .fn()
      .mockImplementation((args) =>
        Promise.resolve(args.select ? [{ originalEntityId: 14 }] : []),
      );
    const service = new FinanceService({
      db: {
        payment: { findMany: paymentFindMany },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: reversalFindMany },
      },
    } as never);
    await expect(service.cashFlows()).resolves.toMatchObject({
      flows: [
        expect.objectContaining({
          source: { entityType: 'Payment', entityId: 14 },
        }),
      ],
    });
  });
  it('does not map historical nonzero commission reversals into cash flows', async () => {
    const reversalFindMany = jest.fn().mockImplementation((args) =>
      Promise.resolve(
        args.select
          ? []
          : [
              {
                id: 92,
                category: 'COMMISSION',
                amount: new Prisma.Decimal('-40.00'),
                balanceBefore: new Prisma.Decimal('40.00'),
                balanceAfter: new Prisma.Decimal('0.00'),
                originalEntityType: 'ContractCommission',
                originalEntityId: 21,
                generatedEntityType: null,
                generatedEntityId: null,
                originalOccurredAt: new Date('2026-08-05T02:00:00.000Z'),
                correctionOccurredAt: new Date('2026-08-26T10:00:00.000Z'),
                request: {
                  requestNo: 'HTZF202608260001',
                  contract: { contractNo: 'HT20260001' },
                },
              },
            ],
      ),
    );
    const service = new FinanceService({
      db: {
        payment: { findMany: jest.fn().mockResolvedValue([]) },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: reversalFindMany },
      },
    } as never);
    await expect(service.cashFlows()).resolves.toMatchObject({ flows: [] });
  });
  it('keeps a fully refunded payment, its refund and both internal correction rows without double counting', async () => {
    const paymentDate = new Date('2026-08-05T02:00:00.000Z');
    const refundDate = new Date('2026-08-06T03:00:00.000Z');
    const correctionOccurredAt = new Date('2026-08-26T10:00:00.000Z');
    const prisma = {
      db: {
        payment: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 31,
              paymentDate,
              paymentCategory: 'RENT',
              amount: new Prisma.Decimal('100.00'),
              receiptNo: 'SK-31',
              status: 'FULLY_REFUNDED',
            },
          ]),
        },
        paymentRefund: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 41,
              refundDate,
              refundAmount: new Prisma.Decimal('100.00'),
              refundNo: 'TK-41',
            },
          ]),
        },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 91,
              category: 'PAYMENT',
              amount: new Prisma.Decimal('-100.00'),
              balanceBefore: new Prisma.Decimal('100.00'),
              balanceAfter: new Prisma.Decimal('0.00'),
              originalEntityType: 'Payment',
              originalEntityId: 31,
              generatedEntityType: null,
              generatedEntityId: null,
              originalOccurredAt: paymentDate,
              correctionOccurredAt,
              request: {
                requestNo: 'HTZF202608260001',
                contract: { contractNo: 'HT20260001' },
              },
            },
            {
              id: 92,
              category: 'REFUND',
              amount: new Prisma.Decimal('100.00'),
              balanceBefore: new Prisma.Decimal('-100.00'),
              balanceAfter: new Prisma.Decimal('0.00'),
              originalEntityType: 'PaymentRefund',
              originalEntityId: 41,
              generatedEntityType: null,
              generatedEntityId: null,
              originalOccurredAt: refundDate,
              correctionOccurredAt,
              request: {
                requestNo: 'HTZF202608260001',
                contract: { contractNo: 'HT20260001' },
              },
            },
          ]),
        },
      },
    };
    const service = new FinanceService(prisma as never);

    const report = await service.cashFlows();

    expect(prisma.db.payment.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            status: {
              in: ['CONFIRMED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED'],
            },
          },
          { id: { in: expect.any(Array) } },
        ],
      },
    });
    expect(prisma.db.paymentRefund.findMany).toHaveBeenCalledWith({
      where: { approvalStatus: 'APPROVED' },
    });
    const payment = report.flows.find((row) => row.flowType === 'PAYMENT');
    const refund = report.flows.find(
      (row) => row.flowType === 'PAYMENT_REFUND',
    );
    const paymentReversal = report.flows.find(
      (row) =>
        row.flowType === 'CONTRACT_VOID_REVERSAL' && row.category === 'PAYMENT',
    );
    const refundReversal = report.flows.find(
      (row) =>
        row.flowType === 'CONTRACT_VOID_REVERSAL' && row.category === 'REFUND',
    );

    expect(report.total).toBe(4);
    expect(report.flows).toHaveLength(4);
    expect(payment).toMatchObject({
      amount: new Prisma.Decimal('100.00'),
      direction: 'IN',
      external: true,
      countsAsRentReceipt: false,
      reference: 'SK-31',
      source: { entityType: 'Payment', entityId: 31 },
    });
    expect(refund).toMatchObject({
      amount: new Prisma.Decimal('100.00'),
      direction: 'OUT',
      external: true,
      countsAsRentReceipt: false,
      reference: 'TK-41',
      source: { entityType: 'PaymentRefund', entityId: 41 },
    });
    expect(paymentReversal).toMatchObject({
      amount: new Prisma.Decimal('-100.00'),
      direction: 'OUT',
      external: false,
      countsAsRentReceipt: false,
      source: { entityType: 'Payment', entityId: 31 },
    });
    expect(refundReversal).toMatchObject({
      amount: new Prisma.Decimal('100.00'),
      direction: 'IN',
      external: false,
      countsAsRentReceipt: false,
      source: { entityType: 'PaymentRefund', entityId: 41 },
    });
    expect(report.inflow.toString()).toBe('100');
    expect(report.outflow.toString()).toBe('100');
    expect(report.netCashFlow.toString()).toBe('0');
  });

  it('uses an exclusive next-day Shanghai boundary for end-date evening records', async () => {
    const paymentFindMany = jest.fn().mockResolvedValue([
      {
        id: 31,
        paymentDate: new Date('2026-08-31T15:00:00.000Z'),
        paymentCategory: 'RENT',
        amount: new Prisma.Decimal('10.00'),
        receiptNo: 'SK-31',
        status: 'CONFIRMED',
      },
    ]);
    const refundFindMany = jest.fn().mockResolvedValue([
      {
        id: 41,
        refundDate: new Date('2026-08-31T14:00:00.000Z'),
        refundAmount: new Prisma.Decimal('5.00'),
        refundNo: 'TK-41',
      },
    ]);
    const reversalFindMany = jest.fn().mockResolvedValue([
      {
        id: 91,
        category: 'PAYMENT',
        amount: new Prisma.Decimal('-10.00'),
        balanceBefore: new Prisma.Decimal('10.00'),
        balanceAfter: new Prisma.Decimal('0.00'),
        originalEntityType: 'Payment',
        originalEntityId: 31,
        generatedEntityType: null,
        generatedEntityId: null,
        originalOccurredAt: new Date('2026-08-01T01:00:00.000Z'),
        correctionOccurredAt: new Date('2026-08-31T13:00:00.000Z'),
        request: {
          requestNo: 'HTZF202608260001',
          contract: { contractNo: 'HT20260001' },
        },
      },
    ]);
    const prisma = {
      db: {
        payment: { findMany: paymentFindMany },
        paymentRefund: { findMany: refundFindMany },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: reversalFindMany },
      },
    };
    const service = new FinanceService(prisma as never);

    const report = await service.cashFlows('2026-08-31', '2026-08-31');
    const expectedRange = {
      gte: new Date('2026-08-30T16:00:00.000Z'),
      lt: new Date('2026-08-31T16:00:00.000Z'),
    };

    expect(paymentFindMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ paymentDate: expectedRange }),
    });
    expect(refundFindMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ refundDate: expectedRange }),
    });
    expect(reversalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ correctionOccurredAt: expectedRange }),
      }),
    );
    expect(report.flows).toHaveLength(3);
  });
});
