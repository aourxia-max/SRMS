import { currentMonthPeriod } from './rent-collection-overview';
import { DashboardService } from './dashboard.service';
import { FinanceService } from '../finance/finance.service';
import { Prisma } from '@prisma/client';

describe('DashboardService checkout accounting', () => {
  afterEach(() => jest.useRealTimers());

  it('queries overdue and reminders from the Shanghai business day rather than the operation time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T20:00:00Z'));
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      db: {
        systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
        room: { findMany: jest.fn().mockResolvedValue([]) },
        contract: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        checkoutSettlement: { count: jest.fn().mockResolvedValue(0) },
        rentBill: { findMany },
      },
    };
    await new DashboardService(prisma as never, {} as never).summary({
      id: 2,
      role: 'ADMIN',
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dueDate: { lt: new Date('2026-09-03') },
        }),
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dueDate: { gte: new Date('2026-09-03'), lte: new Date('2026-09-10') },
        }),
      }),
    );
  });

  it('shares the finance cutoff for arrears and receipts and restores it after cancellation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T04:00:00Z'));
    const settlement = {
      status: 'DRAFT',
      actualCheckoutDate: new Date('2026-09-01'),
    };
    const contract = {
      checkoutSettlements: [settlement],
      contractNo: 'HT-CUTOFF',
      room: { fullHouseNo: '1-101' },
      members: [],
    };
    const rows = [
      {
        id: 1,
        billNo: 'EQUAL',
        periodStart: new Date('2026-09-01'),
        payableAmount: new Prisma.Decimal(1600),
        receivedAmount: new Prisma.Decimal(0),
        outstandingAmount: new Prisma.Decimal(1600),
        baseRentAmount: new Prisma.Decimal(1600),
        rentFreeAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        status: 'OVERDUE',
        allocations: [],
        depositTransactions: [],
        adjustments: [],
        contract,
      },
      {
        id: 2,
        billNo: 'EARLIER',
        periodStart: new Date('2026-08-01'),
        payableAmount: new Prisma.Decimal(1000),
        receivedAmount: new Prisma.Decimal(200),
        outstandingAmount: new Prisma.Decimal(800),
        baseRentAmount: new Prisma.Decimal(1000),
        rentFreeAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        status: 'OVERDUE',
        allocations: [
          {
            allocatedAmount: new Prisma.Decimal(200),
            reversedAmount: new Prisma.Decimal(0),
            payment: { status: 'CONFIRMED' },
          },
        ],
        depositTransactions: [],
        adjustments: [],
        contract,
      },
      {
        id: 3,
        billNo: 'PAID',
        periodStart: new Date('2026-09-01'),
        payableAmount: new Prisma.Decimal(1600),
        receivedAmount: new Prisma.Decimal(1600),
        outstandingAmount: new Prisma.Decimal(0),
        baseRentAmount: new Prisma.Decimal(1600),
        rentFreeAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        status: 'PAID',
        allocations: [
          {
            allocatedAmount: new Prisma.Decimal(1600),
            reversedAmount: new Prisma.Decimal(0),
            payment: { status: 'CONFIRMED' },
          },
        ],
        depositTransactions: [],
        adjustments: [],
        contract,
      },
    ];
    const rentFindMany = jest
      .fn()
      .mockImplementation(
        (query: {
          where: { dueDate?: { lt?: Date }; periodStart?: unknown };
        }) =>
          Promise.resolve(
            query.where.dueDate
              ? query.where.dueDate.lt
                ? rows.slice(0, 2)
                : []
              : [rows[0], rows[2]],
          ),
      );
    const prisma = {
      db: {
        systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
        room: { findMany: jest.fn().mockResolvedValue([]) },
        contract: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
        checkoutSettlement: { count: jest.fn().mockResolvedValue(0) },
        rentBill: { findMany: rentFindMany },
      },
    };
    const service = new DashboardService(
      prisma as never,
      new FinanceService(prisma as never),
    );
    const active = await service.summary({ id: 1, role: 'SUPER_ADMIN' });
    expect(active.arrears).toEqual([rows[1]]);
    expect(active.arrearsTotal).toEqual(new Prisma.Decimal(800));
    expect(active.rentCollectionOverview).toMatchObject({
      netReceivable: new Prisma.Decimal(0),
      validReceived: new Prisma.Decimal(1600),
      outstanding: new Prisma.Decimal(0),
    });
    settlement.status = 'CANCELLED';
    const cancelled = await service.summary({ id: 1, role: 'SUPER_ADMIN' });
    expect(cancelled.arrears).toEqual(rows.slice(0, 2));
    expect(cancelled.arrearsTotal).toEqual(new Prisma.Decimal(2400));
    expect(cancelled.rentCollectionOverview).toMatchObject({
      netReceivable: new Prisma.Decimal(3200),
      validReceived: new Prisma.Decimal(1600),
      outstanding: new Prisma.Decimal(1600),
    });
  });
});

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
