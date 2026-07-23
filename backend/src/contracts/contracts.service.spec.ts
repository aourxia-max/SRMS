import { ContractsService } from './contracts.service';

describe('ContractsService', () => {
  const input = {
    contractNo: 'HT-TEST-001',
    roomId: 1,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-02-05'),
    monthlyRent: '3000',
    paymentCycleMonths: 1,
    depositRequired: '0',
    primaryTenantId: 1,
  };

  it('rejects an overlapping effective contract before creating any data', async () => {
    const tx = {
      room: {
        findFirstOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 1, roomStatus: 'EMPTY' }),
      },
      contract: { findFirst: jest.fn().mockResolvedValue({ id: 9 }) },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    await expect(
      new ContractsService(prisma as never).createFixedContract(input),
    ).rejects.toThrow('已有有效合同');
    expect(tx.contract.findFirst).toHaveBeenCalled();
  });

  it('generates billing snapshots and changes the room to pending move-in', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      room: {
        findFirstOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 1, roomStatus: 'EMPTY' }),
        update,
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 10 }),
      },
      rentBill: { createMany },
      roomStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    await new ContractsService(prisma as never).createFixedContract(input);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ baseRentAmount: expect.anything() }),
        ]),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roomStatus: 'PENDING_MOVE_IN' }),
      }),
    );
  });

  it('previews tiered bills from contract-local tier prices', () => {
    const service = new ContractsService({} as never);
    const result = service.previewTieredBills(
      '3000',
      new Date('2026-01-01'),
      new Date('2026-03-05'),
      [
        {
          tierName: '基础',
          thresholdMonths: 0,
          monthlyRent: '3000',
          requiresFullyPaid: true,
        },
        {
          tierName: '二月档',
          thresholdMonths: 2,
          monthlyRent: '2000',
          requiresFullyPaid: true,
        },
      ],
    );
    expect(result[2].tier?.tierName).toBe('二月档');
    expect(result[2].amount.toFixed(2)).toBe('333.33');
  });

  it('writes tier snapshots and associates generated bills with snapshots', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 3 });
    const tierCreate = jest
      .fn()
      .mockResolvedValueOnce({
        id: 21,
        thresholdMonths: 0,
        monthlyRent: '3000',
      })
      .mockResolvedValueOnce({
        id: 22,
        thresholdMonths: 2,
        monthlyRent: '2000',
      });
    const tx = {
      room: {
        findFirstOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 1, roomStatus: 'EMPTY' }),
        update: jest.fn().mockResolvedValue({}),
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 10 }),
      },
      contractPricingTier: { create: tierCreate },
      rentBill: { createMany },
      roomStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    await new ContractsService(prisma as never).createTieredContract({
      ...input,
      endDate: new Date('2026-03-05'),
      tiers: [
        {
          tierName: '基础',
          thresholdMonths: 0,
          monthlyRent: '3000',
          requiresFullyPaid: true,
        },
        {
          tierName: '二月档',
          thresholdMonths: 2,
          monthlyRent: '2000',
          requiresFullyPaid: true,
        },
      ],
    });
    expect(tierCreate).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ contractPricingTierId: 21 }),
          expect.objectContaining({ contractPricingTierId: 22 }),
        ]),
      }),
    );
  });

  it('rejects an invalid rent change before it creates an approval record', async () => {
    const create = jest.fn();
    const service = new ContractsService({
      db: {
        contract: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-03-31'),
            pricingMode: 'FIXED',
            members: [],
            concessions: [],
          }),
        },
        contractChange: { create },
      },
    } as never);
    await expect(
      service.submitChange(
        1,
        {
          changeType: 'RENT',
          effectiveDate: '2026-02-01',
          afterSnapshot: { monthlyRent: '-1' },
          reason: 'test',
        },
        { id: 1, role: 'ADMIN', username: 'admin', displayName: 'Admin' },
      ),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not approve a change when a later bill already has a receipt', async () => {
    const update = jest.fn();
    const tx = {
      contractChange: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 9,
          contractId: 1,
          changeType: 'RENT',
          effectiveDate: new Date('2026-02-01'),
          afterSnapshot: { monthlyRent: '3500' },
          reason: 'test',
          approvalStatus: 'PENDING',
          contract: {
            id: 1,
            contractNo: 'HT-1',
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-03-31'),
            pricingMode: 'FIXED',
            monthlyRent: '3000',
            members: [],
            concessions: [],
            pricingTiers: [],
            bills: [
              {
                id: 12,
                periodSeq: 2,
                periodStart: new Date('2026-02-01'),
                receivedAmount: '1',
              },
            ],
          },
        }),
        update,
      },
    };
    const service = new ContractsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);
    await expect(
      service.approveChange(9, {
        id: 1,
        role: 'SUPER_ADMIN',
        username: 'root',
        displayName: 'Root',
      }),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });
});
