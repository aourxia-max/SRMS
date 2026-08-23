import { Prisma } from '@prisma/client';
import { RentBillsService } from './rent-bills.service';

function bill(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
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
          status: 'PARTIAL',
          periodStart: { gte: expect.any(Date), lt: expect.any(Date) },
          OR: expect.any(Array),
        }),
      }),
    );
    expect(result).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 2,
      summary: {
        payable: '6000.00',
        received: '4500.00',
        outstanding: '1500.00',
        count: 2,
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
