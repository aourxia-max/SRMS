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
        contract: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        checkoutSettlement: { count: jest.fn().mockResolvedValue(0) },
        billAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        pricingRebate: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as any;
    const finance = { rentCollection: jest.fn() } as any;
    const service = new DashboardService(prisma, finance);

    const result = await service.summary({ id: 2, role: 'ADMIN' }, undefined);

    expect(result).not.toHaveProperty('rentCollectionOverview');
    expect(result).not.toHaveProperty('arrearsTotal');
    expect(finance.rentCollection).not.toHaveBeenCalled();
  });

  it('returns de-duplicated minimal room summaries for pending approvals', async () => {
    const room101 = { id: 11, fullHouseNo: '1栋101' };
    const room202 = { id: 22, fullHouseNo: '2栋202' };
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
        billAdjustment: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { rentBill: { contract: { room: room101 } } },
              { rentBill: { contract: { room: room101 } } },
            ]),
        },
        paymentRefund: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ contract: { room: room101 } }]),
        },
        pricingRebate: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ contract: { room: room202 } }]),
        },
      },
    } as any;
    const service = new DashboardService(prisma, {
      rentCollection: jest.fn(),
    } as any);

    const result = await service.summary({ id: 2, role: 'ADMIN' });

    expect(result.approvalRooms).toEqual([
      {
        roomId: 11,
        fullHouseNo: '1栋101',
        types: ['账单调整', '退款申请'],
        count: 3,
      },
      { roomId: 22, fullHouseNo: '2栋202', types: ['固定月租退差'], count: 1 },
    ]);
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
        contract: { room: { buildingId: 2 } },
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
      },
    });
  });
});
