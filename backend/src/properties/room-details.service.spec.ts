import { RoomDetailsService } from './room-details.service';
import { Prisma } from '@prisma/client';

function pendingDelegates(counts: Partial<Record<string, number>> = {}) {
  const delegate = (name: string) => ({
    count: jest.fn().mockResolvedValue(counts[name] ?? 0),
  });
  return {
    contractChange: delegate('contractChange'),
    billAdjustment: delegate('billAdjustment'),
    paymentRefund: delegate('paymentRefund'),
    paymentVoidRequest: delegate('paymentVoidRequest'),
    pricingRebate: delegate('pricingRebate'),
    depositRefund: delegate('depositRefund'),
    checkoutSettlement: delegate('checkoutSettlement'),
  };
}

describe('RoomDetailsService', () => {
  afterEach(() => jest.useRealTimers());

  it('does not mark a performed bill due on the current business day as room arrears after cancellation', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T04:00:00Z'));
    const { service, rows, settlement } = checkoutFixture();
    rows.splice(0, 1);
    rows[0].dueDate = new Date('2026-09-03');
    rows[0].status = 'PENDING';
    settlement.status = 'CANCELLED';
    const result = await service.detail(11, { id: 2, role: 'ADMIN' });
    expect(result.riskLabels).not.toContain('有逾期账单');
    expect(result.room).toMatchObject({
      contracts: [expect.objectContaining({ hasOverdueBill: false })],
    });
  });

  function checkoutFixture() {
    const settlement = {
      status: 'DRAFT',
      actualCheckoutDate: new Date('2026-09-01'),
    };
    const rows = [
      {
        id: 1,
        periodStart: new Date('2026-09-01'),
        dueDate: new Date('2026-09-01'),
        status: 'OVERDUE',
        billCategory: 'RENT',
        payableAmount: new Prisma.Decimal(1600),
        receivedAmount: new Prisma.Decimal(0),
        outstandingAmount: new Prisma.Decimal(1600),
      },
      {
        id: 2,
        periodStart: new Date('2026-08-01'),
        dueDate: new Date('2026-08-01'),
        status: 'OVERDUE',
        billCategory: 'RENT',
        payableAmount: new Prisma.Decimal(1000),
        receivedAmount: new Prisma.Decimal(200),
        outstandingAmount: new Prisma.Decimal(800),
      },
      {
        id: 3,
        periodStart: new Date('2026-10-01'),
        dueDate: new Date('2026-10-01'),
        status: 'PAID',
        billCategory: 'RENT',
        payableAmount: new Prisma.Decimal(1600),
        receivedAmount: new Prisma.Decimal(1600),
        outstandingAmount: new Prisma.Decimal(0),
      },
    ];
    const contract = {
      id: 21,
      status: 'PENDING_CHECKOUT',
      endDate: new Date('2027-12-31'),
      members: [],
      bills: rows,
      checkoutSettlements: [settlement],
    };
    const findFirstOrThrow = jest.fn().mockResolvedValue({
      id: 11,
      roomStatus: 'PENDING_CHECKOUT',
      building: {},
      histories: [],
      contracts: [contract],
    });
    const prisma = {
      db: {
        ...pendingDelegates(),
        room: { findFirstOrThrow },
        rentBill: { findMany: jest.fn().mockResolvedValue(rows) },
        payment: { findMany: jest.fn().mockResolvedValue([]) },
        prepaymentTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        paymentRefund: {
          count: jest.fn().mockResolvedValue(0),
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };
    return {
      service: new RoomDetailsService(prisma as never),
      settlement,
      rows,
      findFirstOrThrow,
    };
  }

  it('excludes equal-boundary room debt but retains earlier arrears and actual cash', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T04:00:00Z'));
    const { service, settlement, findFirstOrThrow } = checkoutFixture();
    const active = await service.detail(11, { id: 1, role: 'SUPER_ADMIN' });
    expect(active.financial).toMatchObject({
      summary: {
        payable: new Prisma.Decimal(1000),
        received: new Prisma.Decimal(1800),
        outstanding: new Prisma.Decimal(800),
      },
      bills: [
        expect.objectContaining({
          status: 'PENDING_CHECKOUT_REVIEW',
          outstandingAmount: new Prisma.Decimal(0),
        }),
        expect.objectContaining({ status: 'OVERDUE' }),
        expect.objectContaining({ status: 'PENDING_CHECKOUT_REVIEW' }),
      ],
    });
    expect(active.riskLabels).toContain('有逾期账单');
    expect(findFirstOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          contracts: expect.objectContaining({
            include: expect.objectContaining({
              checkoutSettlements: {
                where: {
                  status: { in: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] },
                },
                select: { status: true, actualCheckoutDate: true },
                orderBy: { id: 'desc' },
              },
              bills: { select: expect.objectContaining({ periodStart: true }) },
            }),
          }),
        }),
      }),
    );
    settlement.status = 'CANCELLED';
    const cancelled = await service.detail(11, { id: 1, role: 'SUPER_ADMIN' });
    expect(cancelled.financial).toMatchObject({
      summary: {
        payable: new Prisma.Decimal(4200),
        received: new Prisma.Decimal(1800),
        outstanding: new Prisma.Decimal(2400),
      },
    });
  });

  it('removes checkout-only overdue risk and restores it when the same checkout is cancelled', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T04:00:00Z'));
    const { service, rows, settlement } = checkoutFixture();
    rows.splice(1, 1);
    const active = await service.detail(11, { id: 2, role: 'ADMIN' });
    expect(active.riskLabels).not.toContain('有逾期账单');
    expect(active.room).toMatchObject({
      contracts: [expect.objectContaining({ hasOverdueBill: false })],
    });
    settlement.status = 'CANCELLED';
    const cancelled = await service.detail(11, { id: 2, role: 'ADMIN' });
    expect(cancelled.riskLabels).toContain('有逾期账单');
    expect(cancelled.room).toMatchObject({
      contracts: [expect.objectContaining({ hasOverdueBill: true })],
    });
  });

  it('does not return financial details to an administrator', async () => {
    const prisma = {
      db: {
        room: {
          findFirstOrThrow: jest.fn().mockResolvedValue({
            id: 11,
            roomStatus: 'EMPTY',
            building: { buildingNo: 'TEST-B1', buildingName: '测试楼' },
            histories: [],
            contracts: [],
          }),
        },
        ...pendingDelegates(),
      },
    } as any;
    const service = new RoomDetailsService(prisma);

    const result = await service.detail(11, { id: 2, role: 'ADMIN' });

    expect(result).not.toHaveProperty('financial');
    expect(result.riskLabels).toEqual(['当前无待办']);
  });

  it('shows room approval and checkout todos instead of current no todo', async () => {
    const prisma = {
      db: {
        room: {
          findFirstOrThrow: jest.fn().mockResolvedValue({
            id: 11,
            roomStatus: 'EMPTY',
            building: { buildingNo: 'TEST-B1', buildingName: '测试楼' },
            histories: [],
            contracts: [
              {
                id: 21,
                status: 'ACTIVE',
                endDate: new Date('2030-12-31'),
                bills: [],
                members: [],
              },
            ],
          }),
        },
        ...pendingDelegates({
          contractChange: 2,
          billAdjustment: 1,
          paymentRefund: 1,
          paymentVoidRequest: 1,
          pricingRebate: 1,
          depositRefund: 1,
          checkoutSettlement: 1,
        }),
      },
    } as any;
    const service = new RoomDetailsService(prisma);

    const result = await service.detail(11, { id: 2, role: 'ADMIN' });

    expect(result.riskLabels).toEqual([
      '合同变更待审批（2）',
      '账单调整待审批',
      '收款退款待审批',
      '收款作废待审批',
      '固定月租退差待审批',
      '押金退款待审批',
      '退租结算待处理',
    ]);
    expect(result.riskLabels).not.toContain('当前无待办');
  });
});
