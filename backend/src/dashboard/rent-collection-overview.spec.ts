import { currentMonthPeriod } from './rent-collection-overview';
import { DashboardService } from './dashboard.service';

describe('currentMonthPeriod', () => {
  it('returns the current natural month as an inclusive billing-period range', () => {
    const result = currentMonthPeriod(new Date('2026-07-28T10:00:00.000Z'));

    expect(result.from).toBe('2026-07-01');
    expect(result.to).toBe('2026-07-31');
  });

  it('uses the correct final day for February in a leap year', () => {
    const result = currentMonthPeriod(new Date('2028-02-09T10:00:00.000Z'));

    expect(result.from).toBe('2028-02-01');
    expect(result.to).toBe('2028-02-29');
  });
});

describe('DashboardService rent collection permissions', () => {
  it('does not return financial collection amounts to an administrator', async () => {
    const prisma = {
      db: {
        systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
        room: { findMany: jest.fn().mockResolvedValue([]) },
        rentBill: { findMany: jest.fn().mockResolvedValue([]) },
        contract: { findMany: jest.fn().mockResolvedValue([]) },
        billAdjustment: { count: jest.fn().mockResolvedValue(0) },
        paymentRefund: { count: jest.fn().mockResolvedValue(0) },
        pricingRebate: { count: jest.fn().mockResolvedValue(0) },
      },
    } as any;
    const finance = { rentCollection: jest.fn() } as any;
    const service = new DashboardService(prisma, finance);

    const result = await service.summary({ id: 2, role: 'ADMIN' }, undefined);

    expect(result).not.toHaveProperty('rentCollectionOverview');
    expect(finance.rentCollection).not.toHaveBeenCalled();
  });
});
