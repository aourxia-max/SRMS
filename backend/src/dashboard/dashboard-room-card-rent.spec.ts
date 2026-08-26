import { DashboardService } from './dashboard.service';

describe('DashboardService room map monthly rent visibility', () => {
  function dependencies(rooms: any[]) {
    const roomFindMany = jest
      .fn()
      .mockResolvedValueOnce(rooms)
      .mockResolvedValueOnce([]);
    const prisma = {
      db: {
        systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
        room: { findMany: roomFindMany },
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
    const finance = {
      rentCollection: jest.fn().mockResolvedValue({
        total: {
          netReceivable: '0.00',
          validReceived: '0.00',
          outstanding: '0.00',
        },
        collectionRate: null,
      }),
    } as any;
    return { prisma, finance, roomFindMany };
  }

  it('returns only the matching effective contract monthly rent to a super administrator', async () => {
    const room = {
      id: 11,
      fullHouseNo: '1栋601',
      houseNo: '601',
      floorNo: 6,
      roomStatus: 'RENTED',
      usageType: 'RESIDENCE',
      building: { id: 1, buildingNo: '1栋', buildingName: '一号楼' },
      contracts: [
        {
          status: 'ENDED',
          monthlyRent: '999.00',
          startDate: new Date('2025-01-01'),
        },
        {
          status: 'ACTIVE',
          monthlyRent: '1500.00',
          startDate: new Date('2026-08-01'),
        },
      ],
    };
    const { prisma, finance, roomFindMany } = dependencies([room]);

    const result = await new DashboardService(prisma, finance).summary({
      id: 1,
      role: 'SUPER_ADMIN',
    });
    const roomSummary = result.roomSummary as { rooms: any[] };

    expect(roomFindMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        include: expect.objectContaining({
          contracts: expect.objectContaining({
            where: {
              status: { in: ['PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT'] },
            },
          }),
        }),
      }),
    );
    expect(roomSummary.rooms[0]).toMatchObject({
      id: 11,
      usageType: 'RESIDENCE',
      currentMonthlyRent: '1500.00',
    });
    expect(roomSummary.rooms[0]).not.toHaveProperty('contracts');
  });

  it.each([
    {
      roomStatus: 'PENDING_MOVE_IN',
      contractStatus: 'PENDING_START',
      monthlyRent: '1800.00',
    },
    {
      roomStatus: 'PENDING_CHECKOUT',
      contractStatus: 'PENDING_CHECKOUT',
      monthlyRent: '1700.00',
    },
  ])(
    'uses the $contractStatus contract for a $roomStatus room',
    async ({ roomStatus, contractStatus, monthlyRent }) => {
      const room = {
        id: 12,
        fullHouseNo: '1栋602',
        houseNo: '602',
        floorNo: 6,
        roomStatus,
        usageType: 'RESIDENCE',
        building: { id: 1, buildingNo: '1栋', buildingName: '一号楼' },
        contracts: [
          {
            status: contractStatus,
            monthlyRent,
            startDate: new Date('2026-08-01'),
          },
        ],
      };
      const { prisma, finance } = dependencies([room]);

      const result = await new DashboardService(prisma, finance).summary({
        id: 1,
        role: 'SUPER_ADMIN',
      });
      const roomSummary = result.roomSummary as { rooms: any[] };

      expect(roomSummary.rooms[0].currentMonthlyRent).toBe(monthlyRent);
      expect(roomSummary.rooms[0]).not.toHaveProperty('contracts');
    },
  );

  it('does not use an ended historical contract as the current rent', async () => {
    const room = {
      id: 13,
      fullHouseNo: '1栋603',
      houseNo: '603',
      floorNo: 6,
      roomStatus: 'EMPTY',
      usageType: 'RESIDENCE',
      building: { id: 1, buildingNo: '1栋', buildingName: '一号楼' },
      contracts: [
        {
          status: 'ENDED',
          monthlyRent: '999.00',
          startDate: new Date('2025-01-01'),
        },
      ],
    };
    const { prisma, finance } = dependencies([room]);

    const result = await new DashboardService(prisma, finance).summary({
      id: 1,
      role: 'SUPER_ADMIN',
    });
    const roomSummary = result.roomSummary as { rooms: any[] };

    expect(roomSummary.rooms[0].currentMonthlyRent).toBeNull();
    expect(roomSummary.rooms[0]).not.toHaveProperty('contracts');
  });

  it('does not query or return contract rent to an administrator', async () => {
    const room = {
      id: 11,
      fullHouseNo: '1栋601',
      houseNo: '601',
      floorNo: 6,
      roomStatus: 'RENTED',
      usageType: 'RESIDENCE',
      building: { id: 1, buildingNo: '1栋', buildingName: '一号楼' },
    };
    const { prisma, finance, roomFindMany } = dependencies([room]);

    const result = await new DashboardService(prisma, finance).summary({
      id: 2,
      role: 'ADMIN',
    });
    const roomSummary = result.roomSummary as { rooms: any[] };

    expect(roomFindMany.mock.calls[0][0].include).toEqual({ building: true });
    expect(roomSummary.rooms[0]).not.toHaveProperty('currentMonthlyRent');
    expect(roomSummary.rooms[0]).not.toHaveProperty('contracts');
  });

  it('excludes voided contracts from reminder, arrears and monthly move-in operating queries', async () => {
    const { prisma, finance } = dependencies([]);

    await new DashboardService(prisma, finance).summary({
      id: 1,
      role: 'SUPER_ADMIN',
    });

    const calls = prisma.db.rentBill.findMany.mock.calls as Array<
      [{ where: Record<string, unknown> }]
    >;
    const billQueries = calls.map(([query]) => query.where);
    expect(billQueries).toHaveLength(2);
    expect(billQueries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: { notIn: ['VOIDED', 'REFUNDED'] },
          contract: { status: { not: 'VOIDED' } },
        }),
      ]),
    );
    expect(prisma.db.contract.count).toHaveBeenCalledWith({
      where: {
        status: { notIn: ['DRAFT', 'VOIDED'] },
        startDate: { gte: expect.any(Date), lte: expect.any(Date) },
      },
    });
  });
});
