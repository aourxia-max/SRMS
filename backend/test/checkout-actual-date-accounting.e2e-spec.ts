import { randomBytes } from 'node:crypto';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import type { AuthUser } from '../src/auth/auth-user.type';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import type { SubmitCheckoutSettlementDto } from '../src/checkout/dto/submit-checkout-settlement.dto';
import { runAfterDisposableE2eDatabaseGuard } from './support/isolated-e2e-database';

type FixtureOptions = {
  contractStatus?: 'ACTIVE' | 'PENDING_START';
  contractStart?: string;
  periodStart?: string;
  periodEnd?: string;
  received?: string;
};
type Fixture = {
  buildingId: number;
  roomId: number;
  tenantId: number;
  contractId: number;
  billId: number;
  billNo: string;
};
type BillRow = {
  id: number;
  billNo: string;
  status: string;
  payableAmount: string;
  outstandingAmount: string;
};
type BillList = {
  items: BillRow[];
  total: number;
  summary: {
    payable: string;
    received: string;
    outstanding: string;
    overdueCount: number;
  };
};
type FinanceReport = {
  rows: {
    billNo: string;
    status: string;
    originalReceivable: string;
    netReceivable: string;
    validReceived: string;
    outstanding: string;
  }[];
  total: { originalReceivable: string; outstanding: string };
};
type Dashboard = {
  arrears: { id: number }[];
  arrearsTotal: string;
  rentCollectionOverview: { netReceivable: string; outstanding: string };
};
type RoomDetail = {
  riskLabels: string[];
  financial: {
    summary: { payable: string; received: string; outstanding: string };
    bills: BillRow[];
  };
};
type Snapshot = {
  rentOutstanding: string;
  futureBillCount: number;
  arrearsBills: { id: number; outstandingAmount: string }[];
};
type Preview = {
  finalReceivable: string;
  rentRefundableAmount: string;
  maxRentRefundAmount: string;
  rentRefundAllocations: { rentBillId: number; amount: string }[];
};

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const money = (value: string) => new Prisma.Decimal(value).toFixed(2);
const conflictMessage = '实际退房日期或账单已变化，请重新预估结算金额';

describe('actual checkout date accounting across real HTTP and MySQL (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let operator: AuthUser;
  const suitePrefix = `T6AD${randomBytes(6).toString('hex')}`;
  const fixtures: Fixture[] = [];
  let sequence = 0;

  beforeAll(async () => {
    const moduleFixture = await runAfterDisposableE2eDatabaseGuard(async () => {
      // Freeze only the business clock; MySQL, HTTP and Nest timers stay real.
      jest.useFakeTimers({
        now: new Date('2026-09-03T04:00:00.000Z'),
        doNotFake: [
          'hrtime',
          'nextTick',
          'performance',
          'queueMicrotask',
          'setImmediate',
          'clearImmediate',
          'setInterval',
          'clearInterval',
          'setTimeout',
          'clearTimeout',
        ],
      });
      const { AppModule } = await import('../src/app.module');
      process.env.JWT_ACCESS_SECRET =
        'test-access-secret-at-least-32-characters';
      process.env.JWT_REFRESH_SECRET =
        'test-refresh-secret-at-least-32-characters';
      return Test.createTestingModule({ imports: [AppModule] })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate(context: ExecutionContext) {
            if (!operator) return false;
            context.switchToHttp().getRequest<{ user?: AuthUser }>().user =
              operator;
            return true;
          },
        })
        .compile();
    });
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    const user = await prisma.db.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN, status: 'ACTIVE', deletedAt: null },
      select: { id: true, username: true, displayName: true, role: true },
    });
    if (!user) throw new Error('隔离测试库中没有可用的超级管理员');
    operator = user;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const contractIds = fixtures.map((fixture) => fixture.contractId);
        const roomIds = fixtures.map((fixture) => fixture.roomId);
        await prisma.db.$transaction(async (tx) => {
          // Remove children before their parents, including reserved refund items.
          await tx.checkoutRentRefundAllocation.deleteMany({
            where: {
              item: { settlement: { contractId: { in: contractIds } } },
            },
          });
          await tx.checkoutSettlementItem.deleteMany({
            where: { settlement: { contractId: { in: contractIds } } },
          });
          await tx.paymentAllocation.deleteMany({
            where: { payment: { contractId: { in: contractIds } } },
          });
          await tx.payment.deleteMany({
            where: { contractId: { in: contractIds } },
          });
          await tx.rentBill.deleteMany({
            where: { contractId: { in: contractIds } },
          });
          await tx.checkoutSettlement.deleteMany({
            where: { contractId: { in: contractIds } },
          });
          await tx.roomStatusHistory.deleteMany({
            where: { roomId: { in: roomIds } },
          });
          await tx.contractMember.deleteMany({
            where: { contractId: { in: contractIds } },
          });
          await tx.contract.deleteMany({ where: { id: { in: contractIds } } });
          await tx.tenant.deleteMany({
            where: { id: { in: fixtures.map((fixture) => fixture.tenantId) } },
          });
          await tx.room.deleteMany({ where: { id: { in: roomIds } } });
          await tx.building.deleteMany({
            where: {
              id: { in: fixtures.map((fixture) => fixture.buildingId) },
            },
          });
        });
        expect(
          await prisma.db.building.count({
            where: { buildingNo: { startsWith: suitePrefix } },
          }),
        ).toBe(0);
        expect(
          await prisma.db.contract.count({
            where: { contractNo: { startsWith: suitePrefix } },
          }),
        ).toBe(0);
        expect(
          await prisma.db.rentBill.count({
            where: { billNo: { startsWith: suitePrefix } },
          }),
        ).toBe(0);
        expect(
          await prisma.db.checkoutSettlement.count({
            where: { contractId: { in: contractIds } },
          }),
        ).toBe(0);
        expect(
          await prisma.db.payment.count({
            where: { contractId: { in: contractIds } },
          }),
        ).toBe(0);
        expect(
          await prisma.db.roomStatusHistory.count({
            where: { roomId: { in: roomIds } },
          }),
        ).toBe(0);
      }
    } finally {
      if (app) await app.close();
      jest.useRealTimers();
    }
  });

  async function createFixture(
    label: string,
    options: FixtureOptions = {},
  ): Promise<Fixture> {
    const fixture = await prisma.db.$transaction(async (tx) => {
      const tag = `${suitePrefix}${++sequence}`;
      const contractStatus = options.contractStatus ?? 'ACTIVE';
      const startDate = date(options.contractStart ?? '2026-08-01');
      const received = new Prisma.Decimal(options.received ?? '0.00');
      const building = await tx.building.create({
        data: {
          buildingNo: tag,
          buildingName: `退租日期核算-${label}`,
          floorCount: 1,
        },
      });
      const room = await tx.room.create({
        data: {
          buildingId: building.id,
          houseNo: '101',
          fullHouseNo: `${tag}栋101`,
          floorNo: 1,
          roomType: 'RESIDENTIAL',
          area: new Prisma.Decimal(50),
          usageType: 'RESIDENCE',
          roomStatus:
            contractStatus === 'ACTIVE' ? 'RENTED' : 'PENDING_MOVE_IN',
        },
      });
      const tenant = await tx.tenant.create({
        data: { name: `退租日期-${label}` },
      });
      const contract = await tx.contract.create({
        data: {
          contractNo: `${tag}-C`,
          externalContractNo: `${tag}-EXT`,
          roomId: room.id,
          startDate,
          endDate: date('2027-12-31'),
          monthlyRent: new Prisma.Decimal(1600),
          pricingMode: 'FIXED',
          paymentCycleMonths: 1,
          depositRequired: new Prisma.Decimal(0),
          status: contractStatus,
          activatedAt: contractStatus === 'ACTIVE' ? startDate : null,
          members: {
            create: {
              tenantId: tenant.id,
              memberRole: 'PRIMARY',
              isCurrent: true,
            },
          },
        },
      });
      const bill = await tx.rentBill.create({
        data: {
          billNo: `${tag}-B`,
          contractId: contract.id,
          periodSeq: 1,
          periodStart: date(options.periodStart ?? '2026-09-01'),
          periodEnd: date(options.periodEnd ?? '2026-09-30'),
          dueDate: date('2026-09-01'),
          billCategory: 'RENT',
          unitMonthlyRent: new Prisma.Decimal(1600),
          baseRentAmount: new Prisma.Decimal(1600),
          payableAmount: new Prisma.Decimal(1600),
          receivedAmount: received,
          outstandingAmount: new Prisma.Decimal(1600).minus(received),
          status: received.eq(1600) ? 'PAID' : 'OVERDUE',
        },
      });
      if (received.gt(0)) {
        await tx.payment.create({
          data: {
            receiptNo: `${tag}-P`,
            contractId: contract.id,
            paymentCategory: 'RENT',
            paymentDate: date('2026-08-31'),
            amount: received,
            method: 'BANK_TRANSFER',
            operatorId: operator.id,
            status: 'CONFIRMED',
            allocations: {
              create: { rentBillId: bill.id, allocatedAmount: received },
            },
          },
        });
      }
      return {
        buildingId: building.id,
        roomId: room.id,
        tenantId: tenant.id,
        contractId: contract.id,
        billId: bill.id,
        billNo: bill.billNo,
      };
    });
    fixtures.push(fixture);
    return fixture;
  }

  async function get<T>(path: string): Promise<T> {
    const response = await request(app.getHttpServer())
      .get(`/api${path}`)
      .expect(200);
    return (response.body as { data: T }).data;
  }
  async function post<T>(path: string, payload: unknown): Promise<T> {
    const response = await request(app.getHttpServer())
      .post(`/api${path}`)
      .send(payload as object)
      .expect(201);
    return (response.body as { data: T }).data;
  }
  function payload(
    actualCheckoutDate: string,
    items: SubmitCheckoutSettlementDto['items'] = [],
  ): SubmitCheckoutSettlementDto {
    return {
      actualCheckoutDate,
      handoverDate: actualCheckoutDate,
      inspectionAt: actualCheckoutDate,
      targetRoomStatus: 'EMPTY',
      items,
    };
  }
  function arrears(fixture: Fixture, amount = '1600.00') {
    return {
      itemType: 'RENT_ARREARS' as const,
      amount,
      rentBillId: fixture.billId,
      description: '已履行账期欠租',
      evidenceRequired: false,
      confirmedByTenant: false,
    };
  }
  function initiate(fixture: Fixture, actualCheckoutDate?: string) {
    return post<{ id: number; actualCheckoutDate: string | null }>(
      `/checkout-settlements/contract/${fixture.contractId}/initiate`,
      {
        checkoutType: '提前退租',
        plannedCheckoutDate: '2026-09-01',
        actualCheckoutDate,
        handoverDate: '2026-09-01',
        inspectionAt: '2026-09-01',
        checkoutReason: '实际退房后补录',
        targetRoomStatus: 'EMPTY',
      },
    );
  }
  function snapshot(fixture: Fixture, actual?: string) {
    return get<Snapshot>(
      `/checkout-settlements/contract/${fixture.contractId}/finance-snapshot${actual ? `?actualCheckoutDate=${actual}` : ''}`,
    );
  }
  async function surfaces(fixture: Fixture) {
    const bills = await get<BillList>(
      `/rent-bills?buildingId=${fixture.buildingId}`,
    );
    const overdue = await get<BillList>(
      `/rent-bills?buildingId=${fixture.buildingId}&status=OVERDUE`,
    );
    const finance = await get<FinanceReport>(
      '/finance/rent-collection?from=2026-09-01&to=2026-09-30',
    );
    const dashboard = await get<Dashboard>('/dashboard');
    const room = await get<RoomDetail>(
      `/properties/rooms/${fixture.roomId}/detail`,
    );
    return { bills, overdue, finance, dashboard, room };
  }

  it('excludes the September 1 bill everywhere when a September 1 move-out is entered on September 3', async () => {
    const fixture = await createFixture('equal-boundary');
    expect(await snapshot(fixture)).toMatchObject({
      rentOutstanding: '1600.00',
      futureBillCount: 0,
    });
    expect(await snapshot(fixture, '2026-09-01')).toMatchObject({
      rentOutstanding: '0.00',
      futureBillCount: 1,
      arrearsBills: [],
    });
    const before = await surfaces(fixture);
    const settlement = await initiate(fixture, '2026-09-01');
    expect(settlement.actualCheckoutDate).toBe('2026-09-01T00:00:00.000Z');
    const after = await surfaces(fixture);
    expect(after.bills.items).toEqual([
      expect.objectContaining({
        id: fixture.billId,
        status: 'PENDING_CHECKOUT_REVIEW',
      }),
    ]);
    expect(after.bills.summary).toMatchObject({
      payable: '0.00',
      outstanding: '0.00',
      overdueCount: 0,
    });
    expect(after.overdue).toMatchObject({
      items: [],
      total: 0,
      summary: { overdueCount: 0, outstanding: '0.00' },
    });
    expect(
      (
        await get<BillList>(
          `/rent-bills?buildingId=${fixture.buildingId}&status=PENDING_CHECKOUT_REVIEW`,
        )
      ).total,
    ).toBe(1);
    const financeRow = after.finance.rows.find(
      (row) => row.billNo === fixture.billNo,
    )!;
    expect(financeRow.status).toBe('PENDING_CHECKOUT_REVIEW');
    expect(money(financeRow.originalReceivable)).toBe('0.00');
    expect(money(financeRow.outstanding)).toBe('0.00');
    expect(
      new Prisma.Decimal(before.finance.total.originalReceivable)
        .minus(after.finance.total.originalReceivable)
        .toFixed(2),
    ).toBe('1600.00');
    expect(after.dashboard.arrears.map((bill) => bill.id)).not.toContain(
      fixture.billId,
    );
    expect(
      new Prisma.Decimal(before.dashboard.arrearsTotal)
        .minus(after.dashboard.arrearsTotal)
        .toFixed(2),
    ).toBe('1600.00');
    expect(
      new Prisma.Decimal(before.dashboard.rentCollectionOverview.outstanding)
        .minus(after.dashboard.rentCollectionOverview.outstanding)
        .toFixed(2),
    ).toBe('1600.00');
    expect(after.room.riskLabels).not.toContain('有逾期账单');
    expect(money(after.room.financial.summary.outstanding)).toBe('0.00');
    const stored = await prisma.db.rentBill.findUniqueOrThrow({
      where: { id: fixture.billId },
    });
    expect(stored.status).toBe('OVERDUE');
    expect(stored.outstandingAmount.toFixed(2)).toBe('1600.00');
    expect(
      await prisma.db.billAdjustment.count({
        where: { rentBillId: fixture.billId },
      }),
    ).toBe(0);
  });

  it('keeps a spanning period payable and allows manually requested refund from its actual receipt', async () => {
    const fixture = await createFixture('spanning', { received: '500.00' });
    const settlement = await initiate(fixture, '2026-09-02');
    expect(await snapshot(fixture, '2026-09-02')).toMatchObject({
      rentOutstanding: '1100.00',
      futureBillCount: 0,
    });
    const result = await post<Preview>(
      `/checkout-settlements/${settlement.id}/preview`,
      payload('2026-09-02', [
        arrears(fixture, '1100.00'),
        {
          itemType: 'RENT_REFUND',
          amount: '400.00',
          description: '人工退还当期多收租金',
          evidenceRequired: false,
          confirmedByTenant: false,
        },
      ]),
    );
    expect(result).toMatchObject({
      finalReceivable: '1100.00',
      rentRefundableAmount: '400.00',
      maxRentRefundAmount: '500.00',
    });
    expect(result.rentRefundAllocations).toEqual([
      expect.objectContaining({ rentBillId: fixture.billId, amount: '400.00' }),
    ]);
    expect(
      (await get<BillList>(`/rent-bills?buildingId=${fixture.buildingId}`))
        .summary,
    ).toMatchObject({
      payable: '1600.00',
      received: '500.00',
      outstanding: '1100.00',
    });
  });

  it('rejects stale arrears after moving the actual date earlier and accepts a fresh empty preview', async () => {
    const fixture = await createFixture('edit-earlier');
    const settlement = await initiate(fixture, '2026-09-02');
    const oldPayload = payload('2026-09-02', [arrears(fixture)]);
    expect(
      await post<Preview>(
        `/checkout-settlements/${settlement.id}/preview`,
        oldPayload,
      ),
    ).toMatchObject({ finalReceivable: '1600.00' });
    const stale = await request(app.getHttpServer())
      .post(`/api/checkout-settlements/${settlement.id}/submit`)
      .send({ ...oldPayload, actualCheckoutDate: '2026-09-01' })
      .expect(409);
    expect((stale.body as { message: string }).message).toBe(conflictMessage);
    expect(
      await prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id: settlement.id },
      }),
    ).toMatchObject({
      status: 'DRAFT',
      actualCheckoutDate: date('2026-09-02'),
    });
    expect(
      await prisma.db.checkoutSettlementItem.count({
        where: { checkoutSettlementId: settlement.id },
      }),
    ).toBe(0);
    expect(
      await post<Preview>(
        `/checkout-settlements/${settlement.id}/preview`,
        payload('2026-09-01'),
      ),
    ).toMatchObject({ finalReceivable: '0.00' });
    expect(
      await post(
        `/checkout-settlements/${settlement.id}/submit`,
        payload('2026-09-01'),
      ),
    ).toMatchObject({
      status: 'PENDING',
      actualCheckoutDate: '2026-09-01T00:00:00.000Z',
      items: [],
    });
  });

  it('requires newly performed arrears when moving the actual date later', async () => {
    const fixture = await createFixture('edit-later');
    const settlement = await initiate(fixture, '2026-09-01');
    expect(
      await post<Preview>(
        `/checkout-settlements/${settlement.id}/preview`,
        payload('2026-09-01'),
      ),
    ).toMatchObject({ finalReceivable: '0.00' });
    const stale = await request(app.getHttpServer())
      .post(`/api/checkout-settlements/${settlement.id}/submit`)
      .send(payload('2026-09-02'))
      .expect(409);
    expect((stale.body as { message: string }).message).toBe(conflictMessage);
    expect(await snapshot(fixture, '2026-09-02')).toMatchObject({
      rentOutstanding: '1600.00',
      arrearsBills: [expect.objectContaining({ id: fixture.billId })],
    });
    const freshPayload = payload('2026-09-02', [arrears(fixture)]);
    expect(
      await post<Preview>(
        `/checkout-settlements/${settlement.id}/preview`,
        freshPayload,
      ),
    ).toMatchObject({ finalReceivable: '1600.00' });
    expect(
      await post(`/checkout-settlements/${settlement.id}/submit`, freshPayload),
    ).toMatchObject({
      status: 'PENDING',
      actualCheckoutDate: '2026-09-02T00:00:00.000Z',
    });
  });

  it('restores the same bill receivable, overdue and room risk after cancellation', async () => {
    const fixture = await createFixture('cancel');
    const settlement = await initiate(fixture, '2026-09-01');
    const before = await surfaces(fixture);
    expect(before.overdue.total).toBe(0);
    await post(`/checkout-settlements/${settlement.id}/cancel`, {});
    const after = await surfaces(fixture);
    expect(after.overdue.items).toEqual([
      expect.objectContaining({ id: fixture.billId, status: 'OVERDUE' }),
    ]);
    expect(after.overdue.summary).toMatchObject({
      payable: '1600.00',
      outstanding: '1600.00',
      overdueCount: 1,
    });
    expect(
      new Prisma.Decimal(after.finance.total.originalReceivable)
        .minus(before.finance.total.originalReceivable)
        .toFixed(2),
    ).toBe('1600.00');
    expect(after.dashboard.arrears.map((bill) => bill.id)).toContain(
      fixture.billId,
    );
    expect(
      new Prisma.Decimal(after.dashboard.arrearsTotal)
        .minus(before.dashboard.arrearsTotal)
        .toFixed(2),
    ).toBe('1600.00');
    expect(after.room.riskLabels).toContain('有逾期账单');
    expect(money(after.room.financial.summary.outstanding)).toBe('1600.00');
    expect(
      await prisma.db.contract.findUniqueOrThrow({
        where: { id: fixture.contractId },
      }),
    ).toMatchObject({ status: 'ACTIVE' });
    expect(
      await prisma.db.room.findUniqueOrThrow({ where: { id: fixture.roomId } }),
    ).toMatchObject({ roomStatus: 'RENTED' });
  });

  it('allows pre-start move-out and excludes every rent bill before occupancy', async () => {
    const fixture = await createFixture('pending-start', {
      contractStatus: 'PENDING_START',
      contractStart: '2026-10-01',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    await prisma.db.rentBill.create({
      data: {
        billNo: `${fixture.billNo}-NEXT`,
        contractId: fixture.contractId,
        periodSeq: 2,
        periodStart: date('2026-11-01'),
        periodEnd: date('2026-11-30'),
        dueDate: date('2026-11-01'),
        unitMonthlyRent: new Prisma.Decimal(1600),
        baseRentAmount: new Prisma.Decimal(1600),
        payableAmount: new Prisma.Decimal(1600),
        outstandingAmount: new Prisma.Decimal(1600),
        status: 'PENDING',
      },
    });
    const settlement = await initiate(fixture, '2026-09-01');
    expect(await snapshot(fixture, '2026-09-01')).toMatchObject({
      rentOutstanding: '0.00',
      futureBillCount: 2,
      arrearsBills: [],
    });
    const bills = await get<BillList>(
      `/rent-bills?buildingId=${fixture.buildingId}`,
    );
    expect(bills.items).toHaveLength(2);
    expect(bills.items.map((bill) => bill.status)).toEqual([
      'PENDING_CHECKOUT_REVIEW',
      'PENDING_CHECKOUT_REVIEW',
    ]);
    expect(bills.summary).toMatchObject({
      payable: '0.00',
      outstanding: '0.00',
      overdueCount: 0,
    });
    expect(
      await post<Preview>(
        `/checkout-settlements/${settlement.id}/preview`,
        payload('2026-09-01'),
      ),
    ).toMatchObject({ finalReceivable: '0.00' });
  });

  it('leaves supplemental charges payable while only rent is pending checkout review', async () => {
    const fixture = await createFixture('supplemental');
    const settlement = await initiate(fixture, '2026-09-01');
    const supplemental = await prisma.db.rentBill.create({
      data: {
        billNo: `${fixture.billNo}-SUP`,
        contractId: fixture.contractId,
        periodSeq: 2,
        billCategory: 'CHECKOUT_SUPPLEMENTAL',
        checkoutSettlementId: settlement.id,
        periodStart: date('2026-09-01'),
        periodEnd: date('2026-09-01'),
        dueDate: date('2026-09-01'),
        unitMonthlyRent: new Prisma.Decimal(0),
        baseRentAmount: new Prisma.Decimal(300),
        payableAmount: new Prisma.Decimal(300),
        outstandingAmount: new Prisma.Decimal(300),
        status: 'PENDING',
      },
    });
    const bills = await get<BillList>(
      `/rent-bills?buildingId=${fixture.buildingId}`,
    );
    // The rent list deliberately excludes supplemental charges, but its overdue
    // reconciliation must still update them. Their detail API retains the debt.
    expect(bills.items).toEqual([
      expect.objectContaining({
        id: fixture.billId,
        status: 'PENDING_CHECKOUT_REVIEW',
      }),
    ]);
    expect(await get<BillRow>(`/rent-bills/${supplemental.id}`)).toMatchObject({
      status: 'OVERDUE',
      payableAmount: '300.00',
      outstandingAmount: '300.00',
    });
    expect(bills.summary).toMatchObject({
      payable: '0.00',
      outstanding: '0.00',
      overdueCount: 0,
    });
    const stored = await prisma.db.rentBill.findUniqueOrThrow({
      where: { id: supplemental.id },
    });
    expect(stored.status).toBe('OVERDUE');
    expect(stored.payableAmount.toFixed(2)).toBe('300.00');
    expect(stored.outstandingAmount.toFixed(2)).toBe('300.00');
  });

  it('preserves real receipts until refund and does not cut off a checkout with no actual date', async () => {
    const fixture = await createFixture('cash', { received: '1600.00' });
    const settlement = await initiate(fixture, '2026-09-01');
    const report = await get<FinanceReport>('/finance/rent-collection');
    const row = report.rows.find((bill) => bill.billNo === fixture.billNo)!;
    expect(money(row.originalReceivable)).toBe('0.00');
    expect(money(row.validReceived)).toBe('1600.00');
    expect(
      (await get<BillList>(`/rent-bills?buildingId=${fixture.buildingId}`))
        .summary.received,
    ).toBe('1600.00');
    expect(
      await post<Preview>(
        `/checkout-settlements/${settlement.id}/preview`,
        payload('2026-09-01'),
      ),
    ).toMatchObject({
      maxRentRefundAmount: '1600.00',
      rentRefundableAmount: '0.00',
    });
    const noDateFixture = await createFixture('no-date');
    expect((await initiate(noDateFixture)).actualCheckoutDate).toBeNull();
    expect(
      (
        await get<BillList>(
          `/rent-bills?buildingId=${noDateFixture.buildingId}`,
        )
      ).summary,
    ).toMatchObject({
      payable: '1600.00',
      outstanding: '1600.00',
      overdueCount: 1,
    });
  });
});
