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
    const billAdjustmentFindMany = jest.fn().mockResolvedValue([]);
    const paymentRefundFindMany = jest.fn().mockResolvedValue([]);
    const pricingRebateFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      db: {
        systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
        room: { findMany: jest.fn().mockResolvedValue([]) },
        rentBill: { findMany: jest.fn().mockResolvedValue([]) },
        contract: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        checkoutSettlement: { count: jest.fn().mockResolvedValue(0) },
        billAdjustment: { findMany: billAdjustmentFindMany },
        paymentRefund: { findMany: paymentRefundFindMany },
        pricingRebate: { findMany: pricingRebateFindMany },
      },
    } as any;
    const finance = { rentCollection: jest.fn() } as any;
    const service = new DashboardService(prisma, finance);

    const result = await service.summary({ id: 2, role: 'ADMIN' }, undefined);

    expect(result).not.toHaveProperty('rentCollectionOverview');
    expect(result).not.toHaveProperty('arrearsTotal');
    expect(finance.rentCollection).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('approvals');
    expect(result).not.toHaveProperty('approvalRooms');
    expect(billAdjustmentFindMany).not.toHaveBeenCalled();
    expect(paymentRefundFindMany).not.toHaveBeenCalled();
    expect(pricingRebateFindMany).not.toHaveBeenCalled();
  });
});

describe('DashboardService monthly rental movement metrics', () => {
  function dependencies(moveInCount = 3, checkoutCount = 2) {
    const prisma = {
      db: {
        systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
        room: { findMany: jest.fn().mockResolvedValue([]) },
        rentBill: { findMany: jest.fn().mockResolvedValue([]) },
        contract: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(moveInCount),
        },
        checkoutSettlement: {
          count: jest.fn().mockResolvedValue(checkoutCount),
        },
        billAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        pricingRebate: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as any;
    const finance = { rentCollection: jest.fn() } as any;
    return { prisma, finance };
  }

  it('returns current-month confirmed rentals and completed checkouts for a building', async () => {
    const { prisma, finance } = dependencies();
    const service = new DashboardService(prisma, finance);

    const result = await service.summary({ id: 2, role: 'ADMIN' }, 2);

    expect(prisma.db.contract.count).toHaveBeenCalledWith({
      where: {
        status: { notIn: ['DRAFT', 'VOIDED'] },
        startDate: { gte: expect.any(Date), lte: expect.any(Date) },
        room: { buildingId: 2 },
      },
    });
    expect(prisma.db.checkoutSettlement.count).toHaveBeenCalledWith({
      where: {
        status: 'COMPLETED',
        actualCheckoutDate: {
          gte: expect.any(Date),
          lte: expect.any(Date),
        },
        contract: {
          status: { not: 'VOIDED' },
          room: { buildingId: 2 },
        },
      },
    });
    expect(result).toMatchObject({
      monthlyMoveInCount: 3,
      monthlyCheckoutCount: 2,
    });
  });

  it('counts all buildings when no building filter is selected', async () => {
    const { prisma, finance } = dependencies(4, 1);
    const service = new DashboardService(prisma, finance);

    await service.summary({ id: 2, role: 'ADMIN' });

    expect(prisma.db.contract.count).toHaveBeenCalledWith({
      where: {
        status: { notIn: ['DRAFT', 'VOIDED'] },
        startDate: { gte: expect.any(Date), lte: expect.any(Date) },
      },
    });
    expect(prisma.db.checkoutSettlement.count).toHaveBeenCalledWith({
      where: {
        status: 'COMPLETED',
        actualCheckoutDate: {
          gte: expect.any(Date),
          lte: expect.any(Date),
        },
        contract: { status: { not: 'VOIDED' } },
      },
    });
  });
});
