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
        where: expect.objectContaining({ billCategory: 'RENT' }),
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
    const findMany = jest.fn().mockResolvedValue([
      { contractId: 1, balanceAfter: new Prisma.Decimal('7000.00') },
      { contractId: 2, balanceAfter: new Prisma.Decimal('3000.00') },
      { contractId: 3, balanceAfter: new Prisma.Decimal('0.00') },
    ]);
    const service = new FinanceService({
      db: { depositTransaction: { findMany } },
    } as never);

    await expect(service.overview()).resolves.toEqual({
      depositBalanceTotal: new Prisma.Decimal('10000.00'),
    });
    expect(findMany).toHaveBeenCalledWith({
      distinct: ['contractId'],
      orderBy: [{ contractId: 'asc' }, { id: 'desc' }],
      select: { contractId: true, balanceAfter: true },
    });
  });

  it('returns a zero deposit balance when no ledger exists', async () => {
    const service = new FinanceService({
      db: {
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    await expect(service.overview()).resolves.toEqual({
      depositBalanceTotal: new Prisma.Decimal('0.00'),
    });
  });
});
