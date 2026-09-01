import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types';
import type { AuthUser } from '../src/auth/auth-user.type';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { AppModule } from '../src/app.module';
import { DepositRefundsService } from '../src/checkout/deposit-refunds.service';
import { ContractVoidPreviewService } from '../src/contracts/contract-void-preview.service';
import { ContractVoidReversalWriter } from '../src/contracts/contract-void-reversal-writer';
import { PrismaService } from '../src/prisma/prisma.service';

type Fixture = {
  buildingId: number;
  roomId: number;
  tenantId: number;
  contractId: number;
  billId: number;
  paymentId: number;
  paymentAllocationId: number;
  settlementId: number;
  proofFileId: number;
};

type CleanupScope = {
  buildingIds: number[];
  roomIds: number[];
  tenantIds: number[];
  contractIds: number[];
  settlementIds: number[];
  itemIds: number[];
  refundIds: number[];
  paymentRefundIds: number[];
  paymentRefundAuditIds: number[];
  voidRequestIds: number[];
  billIds: number[];
  paymentIds: number[];
  fileIds: number[];
};

const actualCheckoutDate = '2035-01-15';
const refundDate = '2035-01-20';

function loadLocalTestDatabaseEnvironment() {
  const content = readFileSync(
    resolve(__dirname, '../../deploy/.env.test'),
    'utf8',
  );
  const mysql: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*(MYSQL_[A-Za-z0-9_]+)\s*=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    mysql[match[1]] = value;
  }
  const required = [
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_DATABASE',
    'MYSQL_PORT',
  ];
  if (required.some((name) => !mysql[name])) {
    throw new Error('本机测试环境数据库配置不完整');
  }
  const databaseUrl = new URL('mysql://127.0.0.1');
  databaseUrl.username = mysql.MYSQL_USER;
  databaseUrl.password = mysql.MYSQL_PASSWORD;
  databaseUrl.port = mysql.MYSQL_PORT;
  databaseUrl.pathname = `/${mysql.MYSQL_DATABASE}`;
  process.env.DATABASE_URL = databaseUrl.toString();
  process.env.NODE_ENV = 'test';
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('checkout rent refund real MySQL workflow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let currentUser: AuthUser | undefined;
  let operator: AuthUser;
  let fixtureSequence = 0;
  const marker = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 7)}`.slice(0, 14);
  const suitePrefix = `T9RR${marker}`;

  beforeAll(async () => {
    loadLocalTestDatabaseEnvironment();
    if (!process.env.DATABASE_URL) {
      throw new Error(
        '缺少隔离测试库 DATABASE_URL，无法运行退租租金退款 MySQL E2E',
      );
    }
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET =
      'test-refresh-secret-at-least-32-characters';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const testRequest = context.switchToHttp().getRequest<{
            user?: AuthUser;
          }>();
          if (!currentUser) return false;
          testRequest.user = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    const migrationTables = await prisma.db.$queryRaw<
      Array<{ tableCount: bigint }>
    >(
      Prisma.sql`SELECT COUNT(*) AS tableCount FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'checkout_rent_refund_allocations'`,
    );
    if (Number(migrationTables[0]?.tableCount ?? 0) !== 1) {
      throw new Error(
        '隔离测试库尚未应用 checkout rent refund 迁移，未创建任何测试数据',
      );
    }

    const user = await prisma.db.user.findFirst({
      where: {
        role: UserRole.SUPER_ADMIN,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
      },
    });
    if (!user) throw new Error('隔离测试库中没有可用的超级管理员');
    operator = user;
    currentUser = operator;
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const cleanupScope = await cleanupSuiteData();
        await assertSuiteDataRemoved(cleanupScope);
      }
    } finally {
      if (app) await app.close();
    }
  });

  function asRole(role: UserRole): AuthUser {
    return { ...operator, role };
  }

  function settlementPayload(rentRefundAmount: string) {
    return {
      actualCheckoutDate,
      handoverDate: actualCheckoutDate,
      inspectionAt: `${actualCheckoutDate}T09:00:00.000Z`,
      targetRoomStatus: 'EMPTY',
      remark: 'Task 9 真实 MySQL E2E，结束后自动清理',
      items: [
        {
          itemType: 'RENT_REFUND',
          amount: rentRefundAmount,
          description: '提前退房退还未履行租金',
        },
      ],
    };
  }

  function combinedRefundPayload(
    fixture: Fixture,
    amount: string,
    proofFileId = fixture.proofFileId,
  ) {
    return {
      checkoutSettlementId: fixture.settlementId,
      refundAmount: amount,
      refundDate,
      refundMethod: 'BANK_TRANSFER',
      remark: 'Task 9 合并退款 E2E',
      proofFileIds: [proofFileId],
    };
  }

  async function createFixture(
    label: string,
    options: {
      billAmount?: string;
      depositBalance?: string;
      prepaymentBalance?: string;
    } = {},
  ): Promise<Fixture> {
    const sequence = ++fixtureSequence;
    const tag = `${label}-${sequence}`;
    const compact = `${suitePrefix}${sequence}`.slice(0, 20);
    const billAmount = options.billAmount ?? '3000.00';
    const depositBalance = options.depositBalance ?? '800.00';
    const prepaymentBalance = options.prepaymentBalance ?? '200.00';

    return prisma.db.$transaction(async (tx) => {
      const building = await tx.building.create({
        data: {
          buildingNo: compact,
          buildingName: `Task9 退租退款 E2E ${tag}`,
          floorCount: 1,
          remark: '隔离测试数据，套件结束后自动清理',
        },
      });
      const room = await tx.room.create({
        data: {
          buildingId: building.id,
          houseNo: '101',
          fullHouseNo: `${compact}栋101`,
          floorNo: 1,
          roomType: 'RESIDENTIAL',
          area: new Prisma.Decimal('50.00'),
          usageType: 'RESIDENCE',
          roomStatus: 'PENDING_CHECKOUT',
          remark: 'Task 9 退租退款 E2E',
        },
      });
      const tenant = await tx.tenant.create({
        data: {
          name: `Task9退租退款租户${tag}`,
          remark: '隔离测试数据，套件结束后自动清理',
        },
      });
      const contract = await tx.contract.create({
        data: {
          contractNo: `${suitePrefix}-${tag}`,
          externalContractNo: `${suitePrefix}-EXT-${tag}`,
          roomId: room.id,
          startDate: new Date('2035-01-01T00:00:00.000Z'),
          endDate: new Date('2035-12-31T00:00:00.000Z'),
          monthlyRent: new Prisma.Decimal(billAmount),
          pricingMode: 'FIXED',
          paymentCycleMonths: 1,
          depositRequired: new Prisma.Decimal(depositBalance),
          status: 'PENDING_CHECKOUT',
          activatedAt: new Date('2035-01-01T00:00:00.000Z'),
          remark: 'Task 9 退租退款 E2E',
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
          billNo: `${suitePrefix}-B-${tag}`,
          contractId: contract.id,
          periodSeq: 1,
          periodStart: new Date('2035-02-01T00:00:00.000Z'),
          periodEnd: new Date('2035-02-28T00:00:00.000Z'),
          dueDate: new Date('2035-01-25T00:00:00.000Z'),
          unitMonthlyRent: new Prisma.Decimal(billAmount),
          baseRentAmount: new Prisma.Decimal(billAmount),
          payableAmount: new Prisma.Decimal(billAmount),
          receivedAmount: new Prisma.Decimal(billAmount),
          outstandingAmount: new Prisma.Decimal(0),
          status: 'PAID',
        },
      });
      const payment = await tx.payment.create({
        data: {
          receiptNo: `${suitePrefix}-P-${tag}`.slice(0, 40),
          contractId: contract.id,
          paymentCategory: 'RENT',
          paymentDate: new Date('2035-01-05T00:00:00.000Z'),
          amount: new Prisma.Decimal(billAmount),
          method: 'BANK_TRANSFER',
          operatorId: operator.id,
          status: 'CONFIRMED',
          remark: 'Task 9 退租退款 E2E',
        },
      });
      const allocation = await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          rentBillId: bill.id,
          allocatedAmount: new Prisma.Decimal(billAmount),
        },
      });
      if (new Prisma.Decimal(depositBalance).gt(0)) {
        await tx.depositTransaction.create({
          data: {
            contractId: contract.id,
            transactionNo: `${suitePrefix}-D-${tag}`.slice(0, 40),
            transactionType: 'RECEIPT',
            amount: new Prisma.Decimal(depositBalance),
            balanceAfter: new Prisma.Decimal(depositBalance),
            reason: 'Task 9 初始押金',
          },
        });
      }
      if (new Prisma.Decimal(prepaymentBalance).gt(0)) {
        await tx.prepaymentTransaction.create({
          data: {
            contractId: contract.id,
            transactionNo: `${suitePrefix}-C-${tag}`.slice(0, 40),
            transactionType: 'CREDIT_RECEIPT',
            amount: new Prisma.Decimal(prepaymentBalance),
            balanceAfter: new Prisma.Decimal(prepaymentBalance),
            reason: 'Task 9 初始预收款',
          },
        });
      }
      const settlement = await tx.checkoutSettlement.create({
        data: {
          settlementNo: `${suitePrefix}-S-${tag}`.slice(0, 40),
          contractId: contract.id,
          checkoutType: '提前退房',
          originContractStatus: 'ACTIVE',
          plannedCheckoutDate: new Date(`${actualCheckoutDate}T00:00:00.000Z`),
          handoverDate: new Date(`${actualCheckoutDate}T00:00:00.000Z`),
          inspectionAt: new Date(`${actualCheckoutDate}T09:00:00.000Z`),
          checkoutReason: 'Task 9 真实 MySQL E2E',
          targetRoomStatus: 'EMPTY',
          status: 'DRAFT',
          submittedBy: operator.id,
          remark: '隔离测试数据，套件结束后自动清理',
        },
      });
      await tx.roomStatusHistory.create({
        data: {
          roomId: room.id,
          fromStatus: 'RENTED',
          toStatus: 'PENDING_CHECKOUT',
          changeReason: 'Task 9 发起退租夹具',
          businessType: 'CHECKOUT',
          businessId: settlement.id,
          changedBy: operator.id,
        },
      });
      const proof = await tx.fileAsset.create({
        data: {
          storageKey: `task9-checkout-rent-refund/${suitePrefix}/${tag}.pdf`,
          originalName: `${tag}.pdf`,
          storedName: `${tag}.pdf`,
          mimeType: 'application/pdf',
          extension: '.pdf',
          sizeBytes: 8n,
          sha256: createHash('sha256').update(tag).digest('hex'),
          category: 'DEPOSIT_REFUND_PROOF',
          uploadedBy: operator.id,
        },
      });
      return {
        buildingId: building.id,
        roomId: room.id,
        tenantId: tenant.id,
        contractId: contract.id,
        billId: bill.id,
        paymentId: payment.id,
        paymentAllocationId: allocation.id,
        settlementId: settlement.id,
        proofFileId: proof.id,
      };
    });
  }

  function submitSettlement(fixture: Fixture, amount: string) {
    currentUser = asRole(UserRole.ADMIN);
    return request(app.getHttpServer())
      .post(`/api/checkout-settlements/${fixture.settlementId}/submit`)
      .send(settlementPayload(amount));
  }

  function approveSettlement(fixture: Fixture) {
    currentUser = operator;
    return request(app.getHttpServer()).post(
      `/api/checkout-settlements/${fixture.settlementId}/approve`,
    );
  }

  async function prepareApprovedSettlement(fixture: Fixture, amount: string) {
    await submitSettlement(fixture, amount).expect(201);
    await approveSettlement(fixture).expect(201);
  }

  async function createPendingCombinedRefund(
    fixture: Fixture,
    amount: string,
    proofFileId = fixture.proofFileId,
  ) {
    currentUser = asRole(UserRole.ADMIN);
    const response = await request(app.getHttpServer())
      .post('/api/deposit-refunds')
      .send(combinedRefundPayload(fixture, amount, proofFileId))
      .expect(201);
    return response.body.data.id as number;
  }

  function installTransactionStartBarrier(expectedArrivals = 2) {
    const gate = deferred();
    let arrivals = 0;
    const originalTransaction = prisma.db.$transaction.bind(prisma.db);
    const transactionSpy = jest
      .spyOn(prisma.db, '$transaction')
      .mockImplementation((callback: unknown, options?: unknown) => {
        if (typeof callback !== 'function')
          throw new Error('Task 9 并发门闩仅支持交互式事务');
        return originalTransaction(async (tx) => {
          arrivals += 1;
          if (arrivals === expectedArrivals) gate.resolve();
          await gate.promise;
          const run = callback as (client: typeof tx) => Promise<unknown>;
          return run(tx);
        }, options as never);
      });
    return { transactionSpy, arrivals: () => arrivals };
  }

  async function withinTimeout<T>(promise: Promise<T>, milliseconds = 15000) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Task 9 MySQL 并发操作超时')),
            milliseconds,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function expectOneSuccessOneClientError(responses: Response[]) {
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 400,
    ]);
  }

  async function financeSnapshot() {
    currentUser = operator;
    const overview = await request(app.getHttpServer())
      .get('/api/finance/overview')
      .expect(200);
    const rentCollection = await request(app.getHttpServer())
      .get('/api/finance/rent-collection')
      .expect(200);
    return {
      depositBalance: overview.body.data.depositBalanceTotal as string,
      prepaymentBalance: overview.body.data.prepaymentBalanceTotal as string,
      originalReceivable: rentCollection.body.data.total
        .originalReceivable as string,
      netReceivable: rentCollection.body.data.total.netReceivable as string,
      validReceived: rentCollection.body.data.total.validReceived as string,
      outstanding: rentCollection.body.data.total.outstanding as string,
    };
  }

  function expectFinanceDelta(
    before: Awaited<ReturnType<typeof financeSnapshot>>,
    after: Awaited<ReturnType<typeof financeSnapshot>>,
    expected: Record<keyof Awaited<ReturnType<typeof financeSnapshot>>, string>,
  ) {
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      expect(new Prisma.Decimal(after[key]).minus(before[key]).toFixed(2)).toBe(
        expected[key],
      );
    }
  }

  it('原子完成押金、预收款和租金合并退款，只展示最终回冲且只产生一笔外部退款', async () => {
    const fixture = await createFixture('atomic');
    const payload = settlementPayload('1000.00');

    currentUser = asRole(UserRole.VISITOR);
    await request(app.getHttpServer())
      .post(`/api/checkout-settlements/${fixture.settlementId}/preview`)
      .send(payload)
      .expect(403);

    currentUser = asRole(UserRole.ADMIN);
    const preview = await request(app.getHttpServer())
      .post(`/api/checkout-settlements/${fixture.settlementId}/preview`)
      .send(payload)
      .expect(201);
    expect(preview.body.data).toMatchObject({
      maxRentRefundAmount: '3000.00',
      rentRefundableAmount: '1000.00',
      totalRefundAmount: '2000.00',
    });

    await submitSettlement(fixture, '1000.00').expect(201);
    currentUser = operator;
    await request(app.getHttpServer())
      .post(`/api/checkout-settlements/${fixture.settlementId}/reject`)
      .send({ reason: '验证释放后重新提交' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/checkout-settlements/${fixture.settlementId}/return-to-draft`)
      .expect(201);
    await submitSettlement(fixture, '1000.00').expect(201);

    const reservationHistory =
      await prisma.db.checkoutRentRefundAllocation.findMany({
        where: { item: { checkoutSettlementId: fixture.settlementId } },
        orderBy: { id: 'asc' },
      });
    expect(reservationHistory.map(({ status }) => status)).toEqual([
      'RELEASED',
      'RESERVED',
    ]);

    currentUser = asRole(UserRole.ADMIN);
    await request(app.getHttpServer())
      .post(`/api/checkout-settlements/${fixture.settlementId}/approve`)
      .expect(403);
    await approveSettlement(fixture).expect(201);

    const refundId = await createPendingCombinedRefund(fixture, '2000.00');
    await prisma.db.depositRefund.create({
      data: {
        refundNo: `${suitePrefix}-REJECTED-${fixture.settlementId}`.slice(
          0,
          40,
        ),
        contractId: fixture.contractId,
        checkoutSettlementId: fixture.settlementId,
        refundAmount: new Prisma.Decimal('2000.00'),
        depositRefundAmount: new Prisma.Decimal('800.00'),
        prepaymentRefundAmount: new Prisma.Decimal('200.00'),
        rentRefundAmount: new Prisma.Decimal('1000.00'),
        refundDate: new Date(`${refundDate}T00:00:00.000Z`),
        refundMethod: 'BANK_TRANSFER',
        approvalStatus: 'REJECTED',
        submittedBy: operator.id,
        submittedAt: new Date('2035-01-22T00:00:00.000Z'),
        cancelledReason: 'Task 9 相反状态历史记录',
      },
    });

    currentUser = operator;
    const pendingDetail = await request(app.getHttpServer())
      .get(`/api/checkout-settlements/${fixture.settlementId}`)
      .expect(200);
    expect(pendingDetail.body.data.depositRefunds).toEqual([
      expect.objectContaining({ id: refundId, approvalStatus: 'PENDING' }),
    ]);
    expect(pendingDetail.body.data.rentRefundAllocations).toEqual([
      expect.objectContaining({ status: 'RESERVED', amount: '1000.00' }),
    ]);

    const financeBeforeRefund = await financeSnapshot();
    await request(app.getHttpServer())
      .post(`/api/deposit-refunds/${refundId}/approve`)
      .expect(201);
    const financeAfterRefund = await financeSnapshot();
    expectFinanceDelta(financeBeforeRefund, financeAfterRefund, {
      depositBalance: '-800.00',
      prepaymentBalance: '-200.00',
      originalReceivable: '0.00',
      netReceivable: '-1000.00',
      validReceived: '-1000.00',
      outstanding: '0.00',
    });

    const [bill, allocation, payment, refund, reservations, adjustment] =
      await Promise.all([
        prisma.db.rentBill.findUniqueOrThrow({
          where: { id: fixture.billId },
        }),
        prisma.db.paymentAllocation.findUniqueOrThrow({
          where: { id: fixture.paymentAllocationId },
        }),
        prisma.db.payment.findUniqueOrThrow({
          where: { id: fixture.paymentId },
        }),
        prisma.db.depositRefund.findUniqueOrThrow({ where: { id: refundId } }),
        prisma.db.checkoutRentRefundAllocation.findMany({
          where: { item: { checkoutSettlementId: fixture.settlementId } },
          orderBy: { id: 'asc' },
        }),
        prisma.db.billAdjustment.findFirstOrThrow({
          where: {
            checkoutSettlementItem: {
              checkoutSettlementId: fixture.settlementId,
            },
            adjustmentType: 'CHECKOUT_RENT_REFUND',
          },
        }),
      ]);
    expect({
      payableAmount: bill.payableAmount.toFixed(2),
      receivedAmount: bill.receivedAmount.toFixed(2),
      outstandingAmount: bill.outstandingAmount.toFixed(2),
      status: bill.status,
    }).toEqual({
      payableAmount: '2000.00',
      receivedAmount: '2000.00',
      outstandingAmount: '0.00',
      status: 'PAID',
    });
    expect(allocation.reversedAmount.toFixed(2)).toBe('1000.00');
    expect(payment.status).toBe('PARTIALLY_REFUNDED');
    expect({
      total: refund.refundAmount.toFixed(2),
      deposit: refund.depositRefundAmount.toFixed(2),
      prepayment: refund.prepaymentRefundAmount.toFixed(2),
      rent: refund.rentRefundAmount.toFixed(2),
      status: refund.approvalStatus,
    }).toEqual({
      total: '2000.00',
      deposit: '800.00',
      prepayment: '200.00',
      rent: '1000.00',
      status: 'APPROVED',
    });
    expect(reservations.map(({ status }) => status)).toEqual([
      'RELEASED',
      'APPLIED',
    ]);
    expect(adjustment).toMatchObject({
      approvalStatus: 'APPROVED',
      direction: 'DECREASE',
    });
    expect(adjustment.amount.toFixed(2)).toBe('1000.00');

    const [
      settlement,
      contract,
      room,
      proof,
      depositRefundLedgers,
      prepaymentRefundLedgers,
      roomHistories,
      auditLogs,
    ] = await Promise.all([
      prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id: fixture.settlementId },
      }),
      prisma.db.contract.findUniqueOrThrow({
        where: { id: fixture.contractId },
      }),
      prisma.db.room.findUniqueOrThrow({ where: { id: fixture.roomId } }),
      prisma.db.fileAsset.findUniqueOrThrow({
        where: { id: fixture.proofFileId },
      }),
      prisma.db.depositTransaction.findMany({
        where: {
          contractId: fixture.contractId,
          checkoutSettlementId: fixture.settlementId,
          depositRefundId: refundId,
          transactionType: 'REFUND',
        },
        orderBy: { id: 'asc' },
      }),
      prisma.db.prepaymentTransaction.findMany({
        where: {
          contractId: fixture.contractId,
          transactionType: 'REFUND',
          reason: '退租结算预收款退款',
        },
        orderBy: { id: 'asc' },
      }),
      prisma.db.roomStatusHistory.findMany({
        where: {
          roomId: fixture.roomId,
          businessType: 'DEPOSIT_REFUND',
          businessId: refundId,
        },
        orderBy: { id: 'asc' },
      }),
      prisma.db.securityAuditLog.findMany({
        where: {
          eventType: 'CHECKOUT_REFUND_APPROVED',
          entityType: 'DEPOSIT_REFUND',
          entityId: refundId,
        },
        orderBy: { id: 'asc' },
      }),
    ]);
    expect(settlement.status).toBe('COMPLETED');
    expect(contract.status).toBe('ENDED');
    expect(room.roomStatus).toBe('EMPTY');
    expect(proof.lockedAt).toEqual(expect.any(Date));
    expect(depositRefundLedgers).toHaveLength(1);
    expect(depositRefundLedgers[0]).toMatchObject({
      contractId: fixture.contractId,
      checkoutSettlementId: fixture.settlementId,
      depositRefundId: refundId,
      transactionType: 'REFUND',
      reason: '退租结算押金退款',
    });
    expect(depositRefundLedgers[0].amount.toFixed(2)).toBe('800.00');
    expect(depositRefundLedgers[0].balanceAfter.toFixed(2)).toBe('0.00');
    expect(prepaymentRefundLedgers).toHaveLength(1);
    expect(prepaymentRefundLedgers[0]).toMatchObject({
      contractId: fixture.contractId,
      transactionType: 'REFUND',
      reason: '退租结算预收款退款',
    });
    expect(prepaymentRefundLedgers[0].amount.toFixed(2)).toBe('200.00');
    expect(prepaymentRefundLedgers[0].balanceAfter.toFixed(2)).toBe('0.00');
    expect(roomHistories).toEqual([
      expect.objectContaining({
        fromStatus: 'PENDING_CHECKOUT',
        toStatus: 'EMPTY',
        changeReason: '确认退租合并退款并结束合同',
        changedBy: operator.id,
      }),
    ]);
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({ operatorId: operator.id });
    expect(auditLogs[0].eventData).toEqual({
      checkoutSettlementId: fixture.settlementId,
      refundAmount: '2000.00',
      depositRefundAmount: '800.00',
      prepaymentRefundAmount: '200.00',
      rentRefundAmount: '1000.00',
    });

    const completedDetail = await request(app.getHttpServer())
      .get(`/api/checkout-settlements/${fixture.settlementId}`)
      .expect(200);
    expect(completedDetail.body.data.depositRefunds).toEqual([
      expect.objectContaining({ id: refundId, approvalStatus: 'APPROVED' }),
    ]);
    expect(completedDetail.body.data.rentRefundAllocations).toEqual([
      expect.objectContaining({ status: 'APPLIED', amount: '1000.00' }),
    ]);

    const flows = await request(app.getHttpServer())
      .get('/api/finance/cash-flows')
      .expect(200);
    const combinedFlows = flows.body.data.flows.filter(
      (flow: { flowType: string; reference: string }) =>
        flow.flowType === 'CHECKOUT_COMBINED_REFUND' &&
        flow.reference === refund.refundNo,
    );
    expect(combinedFlows).toHaveLength(1);
    expect(combinedFlows[0]).toEqual(
      expect.objectContaining({
        direction: 'OUT',
        external: true,
      }),
    );
    expect(new Prisma.Decimal(combinedFlows[0].amount).toFixed(2)).toBe(
      '2000.00',
    );
  }, 30000);

  it('完成退款时把未来部分已收账单归一为实收金额并保留已收部分', async () => {
    const fixture = await createFixture('partial-future');
    const futureBill = await prisma.db.rentBill.create({
      data: {
        billNo: `${suitePrefix}-PF-B-${fixture.contractId}`.slice(0, 140),
        contractId: fixture.contractId,
        periodSeq: 2,
        periodStart: new Date('2035-03-01T00:00:00.000Z'),
        periodEnd: new Date('2035-03-31T00:00:00.000Z'),
        dueDate: new Date('2035-02-25T00:00:00.000Z'),
        unitMonthlyRent: new Prisma.Decimal('800.00'),
        baseRentAmount: new Prisma.Decimal('800.00'),
        payableAmount: new Prisma.Decimal('800.00'),
        receivedAmount: new Prisma.Decimal('300.00'),
        outstandingAmount: new Prisma.Decimal('500.00'),
        status: 'PARTIAL',
      },
    });
    const futurePayment = await prisma.db.payment.create({
      data: {
        receiptNo: `${suitePrefix}-PF-P-${fixture.contractId}`.slice(0, 40),
        contractId: fixture.contractId,
        paymentCategory: 'RENT',
        paymentDate: new Date('2035-01-06T00:00:00.000Z'),
        amount: new Prisma.Decimal('300.00'),
        method: 'BANK_TRANSFER',
        operatorId: operator.id,
        status: 'CONFIRMED',
        remark: 'Task 9 未来部分已收账单',
      },
    });
    await prisma.db.paymentAllocation.create({
      data: {
        paymentId: futurePayment.id,
        rentBillId: futureBill.id,
        allocatedAmount: new Prisma.Decimal('300.00'),
      },
    });

    await prepareApprovedSettlement(fixture, '100.00');
    const refundId = await createPendingCombinedRefund(fixture, '1100.00');
    currentUser = operator;
    await request(app.getHttpServer())
      .post(`/api/deposit-refunds/${refundId}/approve`)
      .expect(201);

    const [normalizedBill, adjustment] = await Promise.all([
      prisma.db.rentBill.findUniqueOrThrow({ where: { id: futureBill.id } }),
      prisma.db.billAdjustment.findFirstOrThrow({
        where: {
          rentBillId: futureBill.id,
          adjustmentType: 'CORRECTION',
          direction: 'DECREASE',
          approvalStatus: 'APPROVED',
          reason: `退租结算 ${fixture.settlementId} 核销未来未收租金`,
        },
      }),
    ]);
    expect({
      payable: normalizedBill.payableAmount.toFixed(2),
      received: normalizedBill.receivedAmount.toFixed(2),
      outstanding: normalizedBill.outstandingAmount.toFixed(2),
      status: normalizedBill.status,
      adjustment: adjustment.amount.toFixed(2),
    }).toEqual({
      payable: '200.00',
      received: '200.00',
      outstanding: '0.00',
      status: 'PAID',
      adjustment: '500.00',
    });
  }, 30000);

  it('可以分别取消待确认退款和整个已确认退租并恢复合同房态与预留', async () => {
    const fixture = await createFixture('approved-cancel');
    await prepareApprovedSettlement(fixture, '1000.00');
    const refundId = await createPendingCombinedRefund(fixture, '2000.00');

    currentUser = asRole(UserRole.ADMIN);
    await request(app.getHttpServer())
      .post(`/api/deposit-refunds/${refundId}/cancel`)
      .expect(201);
    const afterRefundCancel = await Promise.all([
      prisma.db.depositRefund.findUniqueOrThrow({ where: { id: refundId } }),
      prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id: fixture.settlementId },
      }),
      prisma.db.checkoutRentRefundAllocation.findFirstOrThrow({
        where: { item: { checkoutSettlementId: fixture.settlementId } },
      }),
    ]);
    expect(afterRefundCancel[0].approvalStatus).toBe('CANCELLED');
    expect(afterRefundCancel[1].status).toBe('APPROVED');
    expect(afterRefundCancel[2].status).toBe('RESERVED');

    await request(app.getHttpServer())
      .post(`/api/checkout-settlements/${fixture.settlementId}/cancel`)
      .expect(201);
    const [settlement, contract, room, reservation] = await Promise.all([
      prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id: fixture.settlementId },
      }),
      prisma.db.contract.findUniqueOrThrow({
        where: { id: fixture.contractId },
      }),
      prisma.db.room.findUniqueOrThrow({ where: { id: fixture.roomId } }),
      prisma.db.checkoutRentRefundAllocation.findFirstOrThrow({
        where: { item: { checkoutSettlementId: fixture.settlementId } },
      }),
    ]);
    expect(settlement.status).toBe('CANCELLED');
    expect(contract.status).toBe('ACTIVE');
    expect(room.roomStatus).toBe('RENTED');
    expect(reservation.status).toBe('RELEASED');
  }, 30000);

  it('在末端审计写入失败时回滚凭证、账单、收款、预留、合同和房态', async () => {
    const fixture = await createFixture('rollback');
    await prepareApprovedSettlement(fixture, '1000.00');
    const refundId = await createPendingCombinedRefund(fixture, '2000.00');
    const service = app.get(DepositRefundsService);
    const originalTransaction = prisma.db.$transaction.bind(prisma.db);
    let injected = 0;
    const transactionSpy = jest
      .spyOn(prisma.db, '$transaction')
      .mockImplementation((callback: unknown, options?: unknown) => {
        if (typeof callback !== 'function')
          throw new Error('Task 9 回滚注入仅支持交互式事务');
        return originalTransaction(async (tx) => {
          const audit = new Proxy(tx.securityAuditLog, {
            get(target, property, receiver) {
              if (property !== 'create')
                return Reflect.get(target, property, receiver) as unknown;
              return async (args: { data?: { eventType?: string } }) => {
                if (args.data?.eventType === 'CHECKOUT_REFUND_APPROVED') {
                  injected += 1;
                  throw new Error('Task 9 强制末端审计失败');
                }
                return target.create(args as never);
              };
            },
          });
          const wrapped = new Proxy(tx, {
            get(target, property, receiver) {
              return property === 'securityAuditLog'
                ? audit
                : (Reflect.get(target, property, receiver) as unknown);
            },
          });
          const run = callback as (client: typeof tx) => Promise<unknown>;
          return run(wrapped);
        }, options as never);
      });

    try {
      await expect(service.approve(refundId, operator)).rejects.toThrow(
        'Task 9 强制末端审计失败',
      );
    } finally {
      transactionSpy.mockRestore();
    }
    expect(injected).toBe(1);

    const [
      refund,
      settlement,
      contract,
      room,
      proof,
      bill,
      allocation,
      payment,
    ] = await Promise.all([
      prisma.db.depositRefund.findUniqueOrThrow({ where: { id: refundId } }),
      prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id: fixture.settlementId },
      }),
      prisma.db.contract.findUniqueOrThrow({
        where: { id: fixture.contractId },
      }),
      prisma.db.room.findUniqueOrThrow({ where: { id: fixture.roomId } }),
      prisma.db.fileAsset.findUniqueOrThrow({
        where: { id: fixture.proofFileId },
      }),
      prisma.db.rentBill.findUniqueOrThrow({ where: { id: fixture.billId } }),
      prisma.db.paymentAllocation.findUniqueOrThrow({
        where: { id: fixture.paymentAllocationId },
      }),
      prisma.db.payment.findUniqueOrThrow({
        where: { id: fixture.paymentId },
      }),
    ]);
    expect(refund.approvalStatus).toBe('PENDING');
    expect(settlement.status).toBe('APPROVED');
    expect(contract.status).toBe('PENDING_CHECKOUT');
    expect(room.roomStatus).toBe('PENDING_CHECKOUT');
    expect(proof.lockedAt).toBeNull();
    expect(bill.payableAmount.toFixed(2)).toBe('3000.00');
    expect(bill.receivedAmount.toFixed(2)).toBe('3000.00');
    expect(allocation.reversedAmount.toFixed(2)).toBe('0.00');
    expect(payment.status).toBe('CONFIRMED');
    await expect(
      prisma.db.checkoutRentRefundAllocation.findFirstOrThrow({
        where: { item: { checkoutSettlementId: fixture.settlementId } },
        select: {
          status: true,
          appliedAt: true,
          depositRefundId: true,
        },
      }),
    ).resolves.toEqual({
      status: 'RESERVED',
      appliedAt: null,
      depositRefundId: null,
    });
    await expect(
      prisma.db.billAdjustment.count({
        where: {
          checkoutSettlementItem: {
            checkoutSettlementId: fixture.settlementId,
          },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.db.depositTransaction.count({
        where: { contractId: fixture.contractId, transactionType: 'REFUND' },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.db.prepaymentTransaction.count({
        where: { contractId: fixture.contractId, transactionType: 'REFUND' },
      }),
    ).resolves.toBe(0);
  }, 30000);

  it('同一结算的两个并发提交只有一个成功且只创建一份有效预留', async () => {
    const fixture = await createFixture('double-submit');
    currentUser = asRole(UserRole.ADMIN);
    const barrier = installTransactionStartBarrier();
    let responses: Response[];
    try {
      responses = await withinTimeout(
        Promise.all([
          request(app.getHttpServer())
            .post(`/api/checkout-settlements/${fixture.settlementId}/submit`)
            .send(settlementPayload('1000.00')),
          request(app.getHttpServer())
            .post(`/api/checkout-settlements/${fixture.settlementId}/submit`)
            .send(settlementPayload('1000.00')),
        ]),
      );
    } finally {
      barrier.transactionSpy.mockRestore();
    }
    expect(barrier.arrivals()).toBe(2);
    expectOneSuccessOneClientError(responses!);
    await expect(
      prisma.db.checkoutSettlementItem.count({
        where: {
          checkoutSettlementId: fixture.settlementId,
          itemType: 'RENT_REFUND',
        },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.db.checkoutRentRefundAllocation.count({
        where: {
          status: 'RESERVED',
          item: { checkoutSettlementId: fixture.settlementId },
        },
      }),
    ).resolves.toBe(1);
  }, 30000);

  it('同一退款凭证跨两个结算并发提交时只有一个待确认退款能占用', async () => {
    const left = await createFixture('proof-left', {
      depositBalance: '0.00',
      prepaymentBalance: '0.00',
    });
    const right = await createFixture('proof-right', {
      depositBalance: '0.00',
      prepaymentBalance: '0.00',
    });
    await prepareApprovedSettlement(left, '1000.00');
    await prepareApprovedSettlement(right, '1000.00');
    currentUser = asRole(UserRole.ADMIN);
    const barrier = installTransactionStartBarrier();
    let responses: Response[];
    try {
      responses = await withinTimeout(
        Promise.all([
          request(app.getHttpServer())
            .post('/api/deposit-refunds')
            .send(combinedRefundPayload(left, '1000.00', left.proofFileId)),
          request(app.getHttpServer())
            .post('/api/deposit-refunds')
            .send(combinedRefundPayload(right, '1000.00', left.proofFileId)),
        ]),
      );
    } finally {
      barrier.transactionSpy.mockRestore();
    }
    expect(barrier.arrivals()).toBe(2);
    expectOneSuccessOneClientError(responses!);
    await expect(
      prisma.db.depositRefundFile.count({
        where: { fileAssetId: left.proofFileId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.db.depositRefund.count({
        where: {
          checkoutSettlementId: { in: [left.settlementId, right.settlementId] },
          approvalStatus: 'PENDING',
        },
      }),
    ).resolves.toBe(1);
  }, 30000);

  it('普通退款与退租提交竞争同一分配时只允许一个流程占满余额', async () => {
    const fixture = await createFixture('ordinary-race');
    currentUser = asRole(UserRole.ADMIN);
    const barrier = installTransactionStartBarrier();
    let responses: Response[];
    try {
      responses = await withinTimeout(
        Promise.all([
          request(app.getHttpServer())
            .post(`/api/checkout-settlements/${fixture.settlementId}/submit`)
            .send(settlementPayload('3000.00')),
          request(app.getHttpServer())
            .post('/api/payment-refunds')
            .send({
              paymentId: fixture.paymentId,
              refundAmount: '3000.00',
              refundDate,
              refundMethod: 'BANK_TRANSFER',
              reason: 'Task 9 普通退款与退租预留竞争',
              allocations: [
                {
                  paymentAllocationId: fixture.paymentAllocationId,
                  amount: '3000.00',
                },
              ],
            }),
        ]),
      );
    } finally {
      barrier.transactionSpy.mockRestore();
    }
    expect(barrier.arrivals()).toBe(2);
    expectOneSuccessOneClientError(responses!);
    const [reservation, ordinaryRefund] = await Promise.all([
      prisma.db.checkoutRentRefundAllocation.aggregate({
        where: {
          status: 'RESERVED',
          paymentAllocationId: fixture.paymentAllocationId,
        },
        _sum: { reservedAmount: true },
      }),
      prisma.db.paymentRefundAllocation.aggregate({
        where: {
          paymentAllocationId: fixture.paymentAllocationId,
          paymentRefund: { approvalStatus: 'PENDING' },
        },
        _sum: { reversedAmount: true },
      }),
    ]);
    const claimed = new Prisma.Decimal(
      reservation._sum.reservedAmount ?? 0,
    ).plus(ordinaryRefund._sum.reversedAmount ?? 0);
    expect(claimed.toFixed(2)).toBe('3000.00');
  }, 30000);

  it('预留金额变化后拒绝确认且结算保持待确认', async () => {
    const fixture = await createFixture('reservation-change');
    await submitSettlement(fixture, '1000.00').expect(201);
    const reservation =
      await prisma.db.checkoutRentRefundAllocation.findFirstOrThrow({
        where: {
          status: 'RESERVED',
          item: { checkoutSettlementId: fixture.settlementId },
        },
      });
    await prisma.db.checkoutRentRefundAllocation.update({
      where: { id: reservation.id },
      data: { reservedAmount: new Prisma.Decimal('999.00') },
    });
    const response = await approveSettlement(fixture).expect(400);
    expect(response.body.message).toContain('预留明细已变化');
    await expect(
      prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id: fixture.settlementId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PENDING' });
  });

  it('取消结算会释放有效预留并原子恢复合同和房态', async () => {
    const fixture = await createFixture('cancel-release');
    await submitSettlement(fixture, '1000.00').expect(201);
    currentUser = asRole(UserRole.ADMIN);
    await request(app.getHttpServer())
      .post(`/api/checkout-settlements/${fixture.settlementId}/cancel`)
      .expect(201);
    const [settlement, contract, room, allocation] = await Promise.all([
      prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id: fixture.settlementId },
      }),
      prisma.db.contract.findUniqueOrThrow({
        where: { id: fixture.contractId },
      }),
      prisma.db.room.findUniqueOrThrow({ where: { id: fixture.roomId } }),
      prisma.db.checkoutRentRefundAllocation.findFirstOrThrow({
        where: { item: { checkoutSettlementId: fixture.settlementId } },
      }),
    ]);
    expect(settlement.status).toBe('CANCELLED');
    expect(contract.status).toBe('ACTIVE');
    expect(room.roomStatus).toBe('RENTED');
    expect(allocation.status).toBe('RELEASED');
    expect(allocation.releasedAt).toBeInstanceOf(Date);
  });

  it('合同纠错写入器会在真实事务中取消待处理结算并释放预留', async () => {
    const fixture = await createFixture('void-release');
    await submitSettlement(fixture, '1000.00').expect(201);
    const preview = await new ContractVoidPreviewService(prisma).preview(
      fixture.contractId,
      operator,
    );
    const voidRequest = await prisma.db.contractVoidRequest.create({
      data: {
        requestNo: `${suitePrefix}-V-${fixture.contractId}`.slice(0, 40),
        contractId: fixture.contractId,
        reason: 'Task 9 验证合同纠错释放退租预留',
        impactSnapshot: JSON.parse(
          JSON.stringify(preview),
        ) as Prisma.InputJsonValue,
        impactHash: preview.impactHash,
        activeContractKey: `${suitePrefix}:contract:${fixture.contractId}`,
        submissionIdempotencyKey: `${suitePrefix}:void:${fixture.contractId}`,
        submittedBy: operator.id,
      },
    });
    const writer = new ContractVoidReversalWriter();
    const rows = await prisma.db.$transaction((tx) =>
      writer.write(
        tx,
        {
          id: voidRequest.id,
          requestNo: voidRequest.requestNo,
          contractId: fixture.contractId,
          operatorId: operator.id,
        },
        preview,
        new Date(),
      ),
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'CHECKOUT',
          originalEntityType: 'CheckoutRentRefundAllocation',
        }),
        expect.objectContaining({
          category: 'CHECKOUT',
          originalEntityType: 'CheckoutSettlement',
        }),
      ]),
    );
    await expect(
      prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id: fixture.settlementId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'CANCELLED' });
    await expect(
      prisma.db.checkoutRentRefundAllocation.findFirstOrThrow({
        where: { item: { checkoutSettlementId: fixture.settlementId } },
        select: { status: true, releasedAt: true },
      }),
    ).resolves.toEqual({
      status: 'RELEASED',
      releasedAt: expect.any(Date),
    });
  }, 30000);

  it('普通退款后再完成退租回冲时收款状态按部分退款推进到全额退款', async () => {
    const fixture = await createFixture('payment-order', {
      billAmount: '2000.00',
      depositBalance: '1000.00',
      prepaymentBalance: '0.00',
    });
    const { ordinaryAllocationId, historicalBillId } =
      await prisma.db.$transaction(async (tx) => {
        const historicalBill = await tx.rentBill.create({
          data: {
            billNo: `${suitePrefix}-H-${fixture.billId}`.slice(0, 40),
            contractId: fixture.contractId,
            periodSeq: 2,
            periodStart: new Date('2035-01-01T00:00:00.000Z'),
            periodEnd: new Date('2035-01-14T00:00:00.000Z'),
            dueDate: new Date('2035-01-01T00:00:00.000Z'),
            unitMonthlyRent: new Prisma.Decimal('2000.00'),
            baseRentAmount: new Prisma.Decimal('1000.00'),
            payableAmount: new Prisma.Decimal('1000.00'),
            receivedAmount: new Prisma.Decimal('1000.00'),
            outstandingAmount: new Prisma.Decimal(0),
            status: 'PAID',
          },
        });
        await tx.payment.update({
          where: { id: fixture.paymentId },
          data: { amount: new Prisma.Decimal('3000.00') },
        });
        const historicalAllocation = await tx.paymentAllocation.create({
          data: {
            paymentId: fixture.paymentId,
            rentBillId: historicalBill.id,
            allocatedAmount: new Prisma.Decimal('1000.00'),
            allocationOrder: 2,
          },
        });
        return {
          ordinaryAllocationId: historicalAllocation.id,
          historicalBillId: historicalBill.id,
        };
      });
    const financeBeforeOrdinaryRefund = await financeSnapshot();
    currentUser = asRole(UserRole.ADMIN);
    const ordinary = await request(app.getHttpServer())
      .post('/api/payment-refunds')
      .send({
        paymentId: fixture.paymentId,
        refundAmount: '1000.00',
        refundDate,
        refundMethod: 'BANK_TRANSFER',
        reason: 'Task 9 先执行普通退款',
        allocations: [
          {
            paymentAllocationId: ordinaryAllocationId,
            amount: '1000.00',
          },
        ],
      })
      .expect(201);
    currentUser = operator;
    await request(app.getHttpServer())
      .post(`/api/payment-refunds/${ordinary.body.data.id}/approve`)
      .send({ adjustmentDecisions: [] })
      .expect(201);
    const financeAfterOrdinaryRefund = await financeSnapshot();
    expectFinanceDelta(
      financeBeforeOrdinaryRefund,
      financeAfterOrdinaryRefund,
      {
        depositBalance: '0.00',
        prepaymentBalance: '0.00',
        originalReceivable: '0.00',
        netReceivable: '0.00',
        validReceived: '-1000.00',
        outstanding: '1000.00',
      },
    );
    await expect(
      prisma.db.payment.findUniqueOrThrow({
        where: { id: fixture.paymentId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'PARTIALLY_REFUNDED' });

    const checkoutPayload = settlementPayload('2000.00');
    currentUser = asRole(UserRole.ADMIN);
    await request(app.getHttpServer())
      .post(`/api/checkout-settlements/${fixture.settlementId}/submit`)
      .send({
        ...checkoutPayload,
        items: [
          ...checkoutPayload.items,
          {
            itemType: 'RENT_ARREARS',
            amount: '1000.00',
            rentBillId: historicalBillId,
            description: 'Task 9 普通退款形成的已履行账单欠租',
          },
        ],
      })
      .expect(201);
    currentUser = operator;
    await approveSettlement(fixture).expect(201);
    const refundId = await createPendingCombinedRefund(fixture, '2000.00');
    currentUser = operator;
    await request(app.getHttpServer())
      .post(`/api/deposit-refunds/${refundId}/approve`)
      .expect(201);
    const [payment, bill, allocation, ordinaryAllocation] = await Promise.all([
      prisma.db.payment.findUniqueOrThrow({
        where: { id: fixture.paymentId },
      }),
      prisma.db.rentBill.findUniqueOrThrow({ where: { id: fixture.billId } }),
      prisma.db.paymentAllocation.findUniqueOrThrow({
        where: { id: fixture.paymentAllocationId },
      }),
      prisma.db.paymentAllocation.findUniqueOrThrow({
        where: { id: ordinaryAllocationId },
      }),
    ]);
    expect(payment.status).toBe('FULLY_REFUNDED');
    expect(allocation.reversedAmount.toFixed(2)).toBe('2000.00');
    expect(ordinaryAllocation.reversedAmount.toFixed(2)).toBe('1000.00');
    expect({
      payable: bill.payableAmount.toFixed(2),
      received: bill.receivedAmount.toFixed(2),
      outstanding: bill.outstandingAmount.toFixed(2),
      status: bill.status,
    }).toEqual({
      payable: '0.00',
      received: '0.00',
      outstanding: '0.00',
      status: 'REFUNDED',
    });
  }, 30000);

  async function cleanupSuiteData() {
    const contracts = await prisma.db.contract.findMany({
      where: { contractNo: { startsWith: suitePrefix } },
      select: { id: true, roomId: true },
    });
    const contractIds = contracts.map(({ id }) => id);
    const roomIds = contracts.map(({ roomId }) => roomId);
    const rooms = roomIds.length
      ? await prisma.db.room.findMany({
          where: { id: { in: roomIds } },
          select: { buildingId: true },
        })
      : [];
    const buildingIds = [...new Set(rooms.map(({ buildingId }) => buildingId))];
    const settlements = contractIds.length
      ? await prisma.db.checkoutSettlement.findMany({
          where: { contractId: { in: contractIds } },
          select: { id: true },
        })
      : [];
    const settlementIds = settlements.map(({ id }) => id);
    const refunds = contractIds.length
      ? await prisma.db.depositRefund.findMany({
          where: { contractId: { in: contractIds } },
          select: { id: true },
        })
      : [];
    const refundIds = refunds.map(({ id }) => id);
    const paymentRefunds = contractIds.length
      ? await prisma.db.paymentRefund.findMany({
          where: { contractId: { in: contractIds } },
          select: { id: true },
        })
      : [];
    const paymentRefundIds = paymentRefunds.map(({ id }) => id);
    const paymentRefundAudits = paymentRefundIds.length
      ? await prisma.db.securityAuditLog.findMany({
          where: {
            entityType: 'PAYMENT_REFUND',
            entityId: { in: paymentRefundIds },
          },
          select: { id: true },
        })
      : [];
    const paymentRefundAuditIds = paymentRefundAudits.map(({ id }) => id);

    const voidRequests = contractIds.length
      ? await prisma.db.contractVoidRequest.findMany({
          where: { contractId: { in: contractIds } },
          select: { id: true },
        })
      : [];
    const voidRequestIds = voidRequests.map(({ id }) => id);
    const items = settlementIds.length
      ? await prisma.db.checkoutSettlementItem.findMany({
          where: { checkoutSettlementId: { in: settlementIds } },
          select: { id: true },
        })
      : [];
    const itemIds = items.map(({ id }) => id);
    const bills = contractIds.length
      ? await prisma.db.rentBill.findMany({
          where: { contractId: { in: contractIds } },
          select: { id: true },
        })
      : [];
    const billIds = bills.map(({ id }) => id);
    const payments = contractIds.length
      ? await prisma.db.payment.findMany({
          where: { contractId: { in: contractIds } },
          select: { id: true },
        })
      : [];
    const paymentIds = payments.map(({ id }) => id);
    const tenants = contractIds.length
      ? await prisma.db.contractMember.findMany({
          where: { contractId: { in: contractIds } },
          select: { tenantId: true },
        })
      : [];
    const tenantIds = [...new Set(tenants.map(({ tenantId }) => tenantId))];
    const files = await prisma.db.fileAsset.findMany({
      where: {
        storageKey: {
          startsWith: `task9-checkout-rent-refund/${suitePrefix}/`,
        },
      },
      select: { id: true },
    });
    const fileIds = files.map(({ id }) => id);

    const cleanupScope: CleanupScope = {
      buildingIds,
      roomIds,
      tenantIds,
      contractIds,
      settlementIds,
      itemIds,
      refundIds,
      paymentRefundIds,
      paymentRefundAuditIds,
      voidRequestIds,
      billIds,
      paymentIds,
      fileIds,
    };

    await prisma.db.$transaction(async (tx) => {
      if (refundIds.length) {
        await tx.securityAuditLog.deleteMany({
          where: {
            entityType: 'DEPOSIT_REFUND',
            entityId: { in: refundIds },
          },
        });
      }
      if (voidRequestIds.length) {
        await tx.contractVoidReversal.deleteMany({
          where: { contractVoidRequestId: { in: voidRequestIds } },
        });
        await tx.contractVoidRequestFile.deleteMany({
          where: { contractVoidRequestId: { in: voidRequestIds } },
        });
        await tx.contractVoidRequest.deleteMany({
          where: { id: { in: voidRequestIds } },
        });
      }
      if (settlementIds.length) {
        await tx.securityAuditLog.deleteMany({
          where: {
            entityType: 'CHECKOUT_SETTLEMENT',
            entityId: { in: settlementIds },
          },
        });
        await tx.checkoutRentRefundAllocation.deleteMany({
          where: { item: { checkoutSettlementId: { in: settlementIds } } },
        });
      }
      if (refundIds.length) {
        await tx.depositRefundFile.deleteMany({
          where: { depositRefundId: { in: refundIds } },
        });
      }
      if (contractIds.length) {
        await tx.depositTransaction.deleteMany({
          where: { contractId: { in: contractIds } },
        });
        await tx.prepaymentTransaction.deleteMany({
          where: { contractId: { in: contractIds } },
        });
      }
      if (refundIds.length) {
        await tx.depositRefund.deleteMany({ where: { id: { in: refundIds } } });
      }
      if (paymentRefundIds.length) {
        await tx.securityAuditLog.deleteMany({
          where: {
            entityType: 'PAYMENT_REFUND',
            entityId: { in: paymentRefundIds },
          },
        });
        await tx.paymentRefundAdjustmentDecision.deleteMany({
          where: { paymentRefundId: { in: paymentRefundIds } },
        });
        await tx.paymentRefundAllocation.deleteMany({
          where: { paymentRefundId: { in: paymentRefundIds } },
        });
        await tx.paymentRefund.deleteMany({
          where: { id: { in: paymentRefundIds } },
        });
      }
      if (paymentIds.length) {
        await tx.paymentVoidRequest.deleteMany({
          where: { paymentId: { in: paymentIds } },
        });
      }
      if (billIds.length) {
        await tx.billAdjustment.deleteMany({
          where: { rentBillId: { in: billIds } },
        });
      }
      if (itemIds.length) {
        await tx.checkoutSettlementItemFile.deleteMany({
          where: { checkoutSettlementItemId: { in: itemIds } },
        });
        await tx.checkoutSettlementItem.deleteMany({
          where: { id: { in: itemIds } },
        });
      }
      if (paymentIds.length) {
        await tx.paymentFile.deleteMany({
          where: { paymentId: { in: paymentIds } },
        });
        await tx.paymentAllocation.deleteMany({
          where: { paymentId: { in: paymentIds } },
        });
        await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
      }
      if (billIds.length) {
        await tx.rentBill.deleteMany({ where: { id: { in: billIds } } });
      }
      if (roomIds.length) {
        await tx.roomStatusHistory.deleteMany({
          where: { roomId: { in: roomIds } },
        });
      }
      if (settlementIds.length) {
        await tx.checkoutSettlement.deleteMany({
          where: { id: { in: settlementIds } },
        });
      }
      if (contractIds.length) {
        await tx.contractMember.deleteMany({
          where: { contractId: { in: contractIds } },
        });
        await tx.contract.deleteMany({ where: { id: { in: contractIds } } });
      }
      if (tenantIds.length) {
        await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      }
      if (roomIds.length) {
        await tx.room.deleteMany({ where: { id: { in: roomIds } } });
      }
      if (buildingIds.length) {
        await tx.building.deleteMany({
          where: { id: { in: buildingIds } },
        });
      }
      if (fileIds.length) {
        await tx.fileAsset.deleteMany({ where: { id: { in: fileIds } } });
      }
    });

    return cleanupScope;
  }

  async function assertSuiteDataRemoved(scope: CleanupScope) {
    const counts = await Promise.all([
      prisma.db.building.count({
        where: {
          OR: [
            { id: { in: scope.buildingIds } },
            { buildingNo: { startsWith: suitePrefix } },
          ],
        },
      }),
      prisma.db.room.count({
        where: {
          OR: [
            { id: { in: scope.roomIds } },
            { fullHouseNo: { startsWith: suitePrefix } },
          ],
        },
      }),
      prisma.db.tenant.count({
        where: {
          OR: [
            { id: { in: scope.tenantIds } },
            { name: { startsWith: `Task9退租退款租户${suitePrefix}` } },
          ],
        },
      }),
      prisma.db.contract.count({
        where: {
          OR: [
            { id: { in: scope.contractIds } },
            { contractNo: { startsWith: suitePrefix } },
            { externalContractNo: { startsWith: suitePrefix } },
          ],
        },
      }),
      prisma.db.contractMember.count({
        where: { contractId: { in: scope.contractIds } },
      }),
      prisma.db.contractVoidRequest.count({
        where: {
          OR: [
            { id: { in: scope.voidRequestIds } },
            { contractId: { in: scope.contractIds } },
          ],
        },
      }),
      prisma.db.contractVoidReversal.count({
        where: { contractVoidRequestId: { in: scope.voidRequestIds } },
      }),
      prisma.db.contractVoidRequestFile.count({
        where: {
          OR: [
            { contractVoidRequestId: { in: scope.voidRequestIds } },
            { fileAssetId: { in: scope.fileIds } },
          ],
        },
      }),
      prisma.db.checkoutSettlement.count({
        where: {
          OR: [
            { id: { in: scope.settlementIds } },
            { contractId: { in: scope.contractIds } },
            { settlementNo: { startsWith: suitePrefix } },
          ],
        },
      }),
      prisma.db.checkoutSettlementItem.count({
        where: {
          OR: [
            { id: { in: scope.itemIds } },
            { checkoutSettlementId: { in: scope.settlementIds } },
          ],
        },
      }),
      prisma.db.checkoutSettlementItemFile.count({
        where: {
          OR: [
            { checkoutSettlementItemId: { in: scope.itemIds } },
            { fileAssetId: { in: scope.fileIds } },
          ],
        },
      }),
      prisma.db.checkoutRentRefundAllocation.count({
        where: {
          OR: [
            { checkoutSettlementItemId: { in: scope.itemIds } },
            { paymentId: { in: scope.paymentIds } },
            { rentBillId: { in: scope.billIds } },
            { depositRefundId: { in: scope.refundIds } },
          ],
        },
      }),
      prisma.db.depositRefund.count({
        where: {
          OR: [
            { id: { in: scope.refundIds } },
            { contractId: { in: scope.contractIds } },
            { checkoutSettlementId: { in: scope.settlementIds } },
            { refundNo: { startsWith: suitePrefix } },
          ],
        },
      }),
      prisma.db.depositRefundFile.count({
        where: {
          OR: [
            { depositRefundId: { in: scope.refundIds } },
            { fileAssetId: { in: scope.fileIds } },
          ],
        },
      }),
      prisma.db.securityAuditLog.count({
        where: {
          OR: [
            { id: { in: scope.paymentRefundAuditIds } },
            {
              entityType: 'DEPOSIT_REFUND',
              entityId: { in: scope.refundIds },
            },
            {
              entityType: 'PAYMENT_REFUND',
              entityId: { in: scope.paymentRefundIds },
            },
            {
              entityType: 'CHECKOUT_SETTLEMENT',
              entityId: { in: scope.settlementIds },
            },
          ],
        },
      }),
      prisma.db.depositTransaction.count({
        where: {
          OR: [
            { contractId: { in: scope.contractIds } },
            { checkoutSettlementId: { in: scope.settlementIds } },
            { depositRefundId: { in: scope.refundIds } },
            { transactionNo: { startsWith: suitePrefix } },
          ],
        },
      }),
      prisma.db.prepaymentTransaction.count({
        where: {
          OR: [
            { contractId: { in: scope.contractIds } },
            { paymentId: { in: scope.paymentIds } },
            { rentBillId: { in: scope.billIds } },
            { transactionNo: { startsWith: suitePrefix } },
          ],
        },
      }),
      prisma.db.paymentRefund.count({
        where: {
          OR: [
            { id: { in: scope.paymentRefundIds } },
            { contractId: { in: scope.contractIds } },
            { paymentId: { in: scope.paymentIds } },
          ],
        },
      }),
      prisma.db.paymentRefundAdjustmentDecision.count({
        where: { paymentRefundId: { in: scope.paymentRefundIds } },
      }),
      prisma.db.paymentRefundAllocation.count({
        where: { paymentRefundId: { in: scope.paymentRefundIds } },
      }),
      prisma.db.paymentVoidRequest.count({
        where: { paymentId: { in: scope.paymentIds } },
      }),
      prisma.db.billAdjustment.count({
        where: { rentBillId: { in: scope.billIds } },
      }),
      prisma.db.paymentFile.count({
        where: {
          OR: [
            { paymentId: { in: scope.paymentIds } },
            { fileAssetId: { in: scope.fileIds } },
          ],
        },
      }),
      prisma.db.paymentAllocation.count({
        where: {
          OR: [
            { paymentId: { in: scope.paymentIds } },
            { rentBillId: { in: scope.billIds } },
          ],
        },
      }),
      prisma.db.payment.count({
        where: {
          OR: [
            { id: { in: scope.paymentIds } },
            { contractId: { in: scope.contractIds } },
            { receiptNo: { startsWith: suitePrefix } },
          ],
        },
      }),
      prisma.db.rentBill.count({
        where: {
          OR: [
            { id: { in: scope.billIds } },
            { contractId: { in: scope.contractIds } },
            { billNo: { startsWith: suitePrefix } },
          ],
        },
      }),
      prisma.db.roomStatusHistory.count({
        where: { roomId: { in: scope.roomIds } },
      }),
      prisma.db.fileAsset.count({
        where: {
          OR: [
            { id: { in: scope.fileIds } },
            {
              storageKey: {
                startsWith: `task9-checkout-rent-refund/${suitePrefix}/`,
              },
            },
          ],
        },
      }),
    ]);
    const labels = [
      'building',
      'room',
      'tenant',
      'contract',
      'contractMember',
      'contractVoidRequest',
      'contractVoidReversal',
      'contractVoidRequestFile',
      'checkoutSettlement',
      'checkoutSettlementItem',
      'checkoutSettlementItemFile',
      'checkoutRentRefundAllocation',
      'depositRefund',
      'depositRefundFile',
      'securityAuditLog',
      'depositTransaction',
      'prepaymentTransaction',
      'paymentRefund',
      'paymentRefundAdjustmentDecision',
      'paymentRefundAllocation',
      'paymentVoidRequest',
      'billAdjustment',
      'paymentFile',
      'paymentAllocation',
      'payment',
      'rentBill',
      'roomStatusHistory',
      'fileAsset',
    ];
    const residuals = Object.fromEntries(
      labels
        .map((label, index) => [label, counts[index]])
        .filter(([, count]) => count !== 0),
    );
    expect(residuals).toEqual({});
  }
});
