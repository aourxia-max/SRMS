import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListRentBillsDto } from './dto/list-rent-bills.dto';
import { RentBillsService } from './rent-bills.service';

function bill(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    billCategory: 'RENT',
    billNo: 'ZD202608-0101',
    periodStart: new Date('2026-08-01'),
    periodEnd: new Date('2026-08-31'),
    dueDate: new Date('2026-08-01'),
    baseRentAmount: new Prisma.Decimal('3000'),
    rentFreeAmount: new Prisma.Decimal('0'),
    discountAmount: new Prisma.Decimal('0'),
    payableAmount: new Prisma.Decimal('3000'),
    receivedAmount: new Prisma.Decimal('1500'),
    outstandingAmount: new Prisma.Decimal('1500'),
    status: 'PARTIAL',
    contract: {
      id: 1,
      contractNo: 'HT2026080101',
      status: 'ACTIVE',
      checkoutSettlements: [],
      room: {
        id: 11,
        fullHouseNo: '1栋101',
        buildingId: 1,
        building: { buildingNo: '1栋', buildingName: null },
      },
      members: [{ tenant: { id: 8, name: '李四' } }],
    },
    ...overrides,
  };
}

describe('RentBillsService', () => {
  function checkoutFixture() {
    const settlement = {
      status: 'DRAFT',
      actualCheckoutDate: new Date('2026-09-01'),
    };
    const contract = { ...bill().contract, checkoutSettlements: [settlement] };
    const rows = [
      bill({
        id: 1,
        contract,
        periodStart: new Date('2026-09-01'),
        status: 'OVERDUE',
        payableAmount: new Prisma.Decimal(1600),
        receivedAmount: new Prisma.Decimal(0),
        outstandingAmount: new Prisma.Decimal(1600),
      }),
      bill({
        id: 2,
        contract,
        periodStart: new Date('2026-08-01'),
        status: 'OVERDUE',
        payableAmount: new Prisma.Decimal(1000),
        receivedAmount: new Prisma.Decimal(200),
        outstandingAmount: new Prisma.Decimal(800),
      }),
      bill({
        id: 3,
        contract,
        periodStart: new Date('2026-10-01'),
        status: 'PAID',
        payableAmount: new Prisma.Decimal(1600),
        receivedAmount: new Prisma.Decimal(1600),
        outstandingAmount: new Prisma.Decimal(0),
      }),
      bill({
        id: 4,
        contract,
        periodStart: new Date('2026-09-01'),
        status: 'PARTIAL',
        payableAmount: new Prisma.Decimal(1600),
        receivedAmount: new Prisma.Decimal(600),
        outstandingAmount: new Prisma.Decimal(1000),
      }),
    ];
    const findMany = jest
      .fn()
      .mockImplementation((query: { select?: unknown }) =>
        Promise.resolve(query.select ? [] : rows),
      );
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = new RentBillsService({
      db: {
        rentBill: {
          findMany,
          updateMany,
          count: jest.fn().mockResolvedValue(rows.length),
        },
      },
    } as never);
    return { settlement, rows, service, findMany, updateMany };
  }

  it('projects equal and later checkout bills while retaining actual received cash and earlier arrears', async () => {
    const { service, updateMany, rows } = checkoutFixture();
    const result = await service.list({ page: 1, pageSize: 20 });
    expect(result.summary).toEqual({
      payable: '1000.00',
      received: '2400.00',
      outstanding: '800.00',
      count: 1,
      overdueCount: 1,
    });
    expect(result.items.map((item) => item.status)).toEqual([
      'PENDING_CHECKOUT_REVIEW',
      'OVERDUE',
      'PENDING_CHECKOUT_REVIEW',
      'PENDING_CHECKOUT_REVIEW',
    ]);
    expect(result.items[0]).toMatchObject({
      payableAmount: '0.00',
      outstandingAmount: '0.00',
    });
    expect(result.total).toBe(4);
    expect(rows[0].status).toBe('OVERDUE');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'PENDING', received: 0, outstanding: 500 },
    { status: 'PARTIAL', received: 200, outstanding: 300 },
    { status: 'OVERDUE', received: 200, outstanding: 300 },
  ])(
    'preserves $status checkout supplemental detail on the actual checkout day',
    async ({ status, received, outstanding }) => {
      const { rows } = checkoutFixture();
      const row = {
        ...rows[0],
        billCategory: 'CHECKOUT_SUPPLEMENTAL',
        status,
        payableAmount: new Prisma.Decimal(500),
        receivedAmount: new Prisma.Decimal(received),
        outstandingAmount: new Prisma.Decimal(outstanding),
        adjustments: [],
        allocations: [],
        prepaymentTransactions: [],
      };
      const service = new RentBillsService({
        db: { rentBill: { findUnique: jest.fn().mockResolvedValue(row) } },
      } as never);
      expect(await service.detail(row.id)).toMatchObject({
        payableAmount: '500.00',
        receivedAmount: received === 0 ? '0.00' : '200.00',
        outstandingAmount: outstanding === 500 ? '500.00' : '300.00',
        status,
      });
    },
  );

  it('reconciles due checkout supplemental debt while excluding unperformed rental candidates and rental summaries', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T04:00:00Z'));
    const { rows, service, findMany, updateMany } = checkoutFixture();
    const candidates = [
      { ...rows[0], status: 'PENDING' },
      { ...rows[1], status: 'PARTIAL' },
      {
        ...rows[0],
        id: 5,
        billCategory: 'CHECKOUT_SUPPLEMENTAL',
        status: 'PENDING',
      },
    ];
    findMany.mockImplementation((query: { select?: unknown }) =>
      Promise.resolve(query.select ? candidates : rows),
    );
    const result = await service.list({ page: 1, pageSize: 20 });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [2, 5] },
        dueDate: { lt: new Date('2026-09-03') },
        outstandingAmount: { gt: 0 },
        status: { in: ['PENDING', 'PARTIAL'] },
      },
      data: { status: 'OVERDUE' },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ billCategory: true }),
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ billCategory: 'RENT' }),
        include: expect.any(Object),
      }),
    );
    expect(result.summary).toEqual({
      payable: '1000.00',
      received: '2400.00',
      outstanding: '800.00',
      count: 1,
      overdueCount: 1,
    });
    expect(result.total).toBe(4);
    expect(
      (
        await service.list({ page: 1, pageSize: 20, status: 'OVERDUE' })
      ).items.map((item) => item.id),
    ).toEqual([2]);
    updateMany.mockClear();
    findMany.mockImplementation((query: { select?: unknown }) =>
      Promise.resolve(query.select ? [candidates[0]] : rows),
    );
    await service.list({ page: 1, pageSize: 20 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('filters status before pagination and counts projected rows only', async () => {
    const { service, findMany } = checkoutFixture();
    const overdue = await service.list({
      status: 'OVERDUE',
      page: 1,
      pageSize: 20,
    });
    expect(overdue.items.map((item) => item.id)).toEqual([2]);
    expect(overdue.total).toBe(1);
    expect(overdue.summary.overdueCount).toBe(1);
    const pending = await service.list(
      plainToInstance(ListRentBillsDto, {
        status: 'PENDING_CHECKOUT_REVIEW',
        page: 2,
        pageSize: 1,
      }),
    );
    expect(pending.items.map((item) => item.id)).toEqual([3]);
    expect(pending.total).toBe(3);
    expect(pending.summary).toMatchObject({
      payable: '0.00',
      outstanding: '0.00',
      received: '2200.00',
      overdueCount: 0,
    });
    const paid = await service.list({ status: 'PAID', page: 1, pageSize: 20 });
    expect(paid.items).toEqual([]);
    expect(paid.total).toBe(0);
    const unfiltered = await service.list({ page: 2, pageSize: 2 });
    expect(unfiltered.items.map((item) => item.id)).toEqual([3, 4]);
    expect(unfiltered.total).toBe(4);
    const listQueries = findMany.mock.calls.filter(([query]) => !query.select);
    for (const [query] of listQueries)
      expect(query.where).not.toHaveProperty('status');
  });

  it('restores the same bills to accounting and overdue filters after cancellation', async () => {
    const { service, settlement } = checkoutFixture();
    expect(
      (await service.list({ status: 'OVERDUE', page: 1, pageSize: 20 })).total,
    ).toBe(1);
    settlement.status = 'CANCELLED';
    const result = await service.list({ page: 1, pageSize: 20 });
    expect(result.summary).toEqual({
      payable: '5800.00',
      received: '2400.00',
      outstanding: '3400.00',
      count: 4,
      overdueCount: 2,
    });
    expect(
      (
        await service.list({ status: 'OVERDUE', page: 1, pageSize: 20 })
      ).items.map((item) => item.id),
    ).toEqual([1, 2]);
  });

  it('updates only performed overdue candidates and resumes a cancelled checkout candidate', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T04:00:00Z'));
    const { service, settlement, rows, findMany, updateMany } =
      checkoutFixture();
    const candidates = [{ ...rows[1], status: 'PARTIAL' }, rows[3]];
    findMany.mockImplementation((query: { select?: unknown }) =>
      Promise.resolve(query.select ? candidates : rows),
    );
    await service.list({ page: 1, pageSize: 20 });
    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        id: { in: [2] },
        dueDate: { lt: new Date('2026-09-03') },
        outstandingAmount: { gt: 0 },
        status: { in: ['PENDING', 'PARTIAL'] },
      },
      data: { status: 'OVERDUE' },
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          periodStart: true,
          contract: {
            select: {
              checkoutSettlements: {
                where: {
                  status: { in: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] },
                },
                select: { status: true, actualCheckoutDate: true },
                orderBy: { id: 'desc' },
              },
            },
          },
        }),
      }),
    );
    settlement.status = 'CANCELLED';
    await service.list({ page: 1, pageSize: 20 });
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [2, 4] } }),
      }),
    );
  });

  it('accepts the API-only checkout status and rejects unknown filter values', async () => {
    for (const status of [
      'PENDING_CHECKOUT_REVIEW',
      'PENDING',
      'PARTIAL',
      'PAID',
      'OVERDUE',
      'VOIDED',
      'REFUNDED',
    ]) {
      expect(
        await validate(plainToInstance(ListRentBillsDto, { status })),
      ).toEqual([]);
    }
    expect(
      await validate(plainToInstance(ListRentBillsDto, { status: 'UNKNOWN' })),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'status' })]),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks past-due outstanding bills overdue before listing without marking bills due today', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-29T04:00:00.000Z'));
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const rows = [
      bill({ status: 'OVERDUE', dueDate: new Date('2026-08-01') }),
      bill({ id: 2, dueDate: new Date('2026-08-29') }),
    ];
    const prisma = {
      db: {
        rentBill: {
          updateMany,
          findMany: jest
            .fn()
            .mockResolvedValueOnce([bill()])
            .mockResolvedValue(rows),
          count: jest.fn().mockResolvedValue(2),
        },
      },
    } as any;

    const result = await new RentBillsService(prisma).list({
      month: '2026-08',
      page: 1,
      pageSize: 20,
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [1] },
        dueDate: { lt: new Date('2026-08-29T00:00:00.000Z') },
        outstandingAmount: { gt: 0 },
        status: { in: ['PENDING', 'PARTIAL'] },
      },
      data: { status: 'OVERDUE' },
    });
    expect(result.summary.overdueCount).toBe(1);
  });

  it('filters by month, status, building and keyword and returns paged summaries', async () => {
    const rows = [
      bill(),
      bill({
        id: 2,
        billNo: 'ZD202608-0102',
        status: 'PAID',
        receivedAmount: new Prisma.Decimal('3000'),
        outstandingAmount: new Prisma.Decimal('0'),
      }),
    ];
    const prisma = {
      db: {
        rentBill: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue(rows),
          count: jest.fn().mockResolvedValue(2),
        },
      },
    } as any;
    const service = new RentBillsService(prisma);

    const result = await service.list({
      keyword: '李四',
      buildingId: 1,
      status: 'PARTIAL',
      month: '2026-08',
      page: 1,
      pageSize: 10,
    });

    expect(prisma.db.rentBill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billCategory: 'RENT',
          periodStart: { gte: expect.any(Date), lt: expect.any(Date) },
          OR: expect.any(Array),
        }),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    );
    expect(result).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
      summary: {
        payable: '3000.00',
        received: '1500.00',
        outstanding: '1500.00',
        count: 1,
        overdueCount: 0,
      },
    });
    expect(result.items[0]).toMatchObject({
      billNo: 'ZD202608-0101',
      tenant: { name: '李四' },
      room: { fullHouseNo: '1栋101' },
    });
  });

  it('excludes voided and refunded bills from the business summary but keeps them in the list', async () => {
    const rows = [
      bill(),
      bill({
        id: 2,
        status: 'VOIDED',
        payableAmount: new Prisma.Decimal('5000'),
        receivedAmount: new Prisma.Decimal('5000'),
        outstandingAmount: new Prisma.Decimal('0'),
      }),
    ];
    const prisma = {
      db: {
        rentBill: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue(rows),
          count: jest.fn().mockResolvedValue(2),
        },
      },
    } as any;
    const result = await new RentBillsService(prisma).list({
      page: 1,
      pageSize: 20,
    });

    expect(result.items).toHaveLength(2);
    expect(result.summary).toMatchObject({
      payable: '3000.00',
      received: '1500.00',
      outstanding: '1500.00',
      count: 1,
    });
  });

  it('keeps bills of a voided contract visible but excludes them from the business summary', async () => {
    const rows = [
      bill(),
      bill({
        id: 2,
        payableAmount: new Prisma.Decimal('5000'),
        receivedAmount: new Prisma.Decimal('5000'),
        outstandingAmount: new Prisma.Decimal('0'),
        contract: {
          ...bill().contract,
          id: 2,
          contractNo: 'HT2026080102',
          status: 'VOIDED',
        },
      }),
    ];
    const prisma = {
      db: {
        rentBill: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findMany: jest.fn().mockResolvedValue(rows),
          count: jest.fn().mockResolvedValue(2),
        },
      },
    } as any;

    const result = await new RentBillsService(prisma).list({
      page: 1,
      pageSize: 20,
    });

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.summary).toMatchObject({
      payable: '3000.00',
      received: '1500.00',
      outstanding: '1500.00',
      count: 1,
    });
  });
  it('returns detail relations without sensitive tenant or payment account fields', async () => {
    const row = {
      ...bill(),
      adjustments: [
        {
          id: 4,
          adjustmentNo: 'ADJ-1',
          adjustmentType: 'WAIVER',
          direction: 'DECREASE',
          amount: new Prisma.Decimal('200'),
          approvalStatus: 'APPROVED',
          reason: '测试',
          createdAt: new Date('2026-08-01'),
        },
      ],
      allocations: [
        {
          id: 5,
          allocatedAmount: new Prisma.Decimal('1500'),
          reversedAmount: new Prisma.Decimal('0'),
          payment: {
            receiptNo: 'SK-1',
            paymentDate: new Date('2026-08-01'),
            status: 'CONFIRMED',
          },
        },
      ],
      prepaymentTransactions: [
        {
          id: 6,
          transactionNo: 'YS-1',
          transactionType: 'CREDIT',
          amount: new Prisma.Decimal('100'),
          occurredAt: new Date('2026-08-01'),
        },
      ],
    };
    const prisma = {
      db: { rentBill: { findUnique: jest.fn().mockResolvedValue(row) } },
    } as any;
    const result = await new RentBillsService(prisma).detail(1);

    expect(result).toMatchObject({
      billNo: 'ZD202608-0101',
      adjustments: [{ amount: '200.00' }],
      allocations: [{ allocatedAmount: '1500.00' }],
    });
    expect(JSON.stringify(result)).not.toContain('phone');
    expect(JSON.stringify(result)).not.toContain('account');
  });
});
