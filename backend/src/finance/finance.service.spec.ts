import { FinanceService } from './finance.service';

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
});
