import { ConfigService } from '@nestjs/config';
import { Prisma, RoomStatus, UserRole } from '@prisma/client';
import type { AuthUser } from '../src/auth/auth-user.type';
import { CheckoutService } from '../src/checkout/checkout.service';
import { ContractVoidExecutorService } from '../src/contracts/contract-void-executor.service';
import { ContractVoidPreviewService } from '../src/contracts/contract-void-preview.service';
import { ContractVoidRequestsService } from '../src/contracts/contract-void-requests.service';
import { ContractVoidReversalWriter } from '../src/contracts/contract-void-reversal-writer';
import { CommissionsService } from '../src/finance/commissions.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SecurityAuditChainService } from '../src/system/security-audit-chain.service';

type Fixture = {
  buildingId: number;
  roomId: number;
  tenantId: number;
  contractId: number;
  paymentId: number;
  requestId: number;
  previewHash: string;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('contract void executor real MySQL transaction semantics (e2e)', () => {
  let prisma: PrismaService;
  let operator: AuthUser;
  let rollbackFixture: Fixture | undefined;
  let refreshPair: [Fixture, Fixture] | undefined;
  let approveRefreshPair: [Fixture, Fixture] | undefined;
  const marker = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        '缺少隔离测试库 DATABASE_URL，无法运行合同作废 MySQL E2E',
      );
    }
    prisma = new PrismaService(
      new ConfigService({
        DATABASE_URL: process.env.DATABASE_URL,
        NODE_ENV: 'test',
      }),
    );
    await prisma.db.$connect();
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
  });

  async function deletePendingFixture(fixture: Fixture) {
    await prisma.db.$transaction(async (tx) => {
      await tx.contractVoidRequest.deleteMany({
        where: { id: fixture.requestId, status: 'PENDING' },
      });
      await tx.payment.deleteMany({ where: { id: fixture.paymentId } });
      await tx.contractMember.deleteMany({
        where: { contractId: fixture.contractId },
      });
      await tx.contract.deleteMany({ where: { id: fixture.contractId } });
      await tx.tenant.deleteMany({ where: { id: fixture.tenantId } });
    });
  }
  afterAll(async () => {
    if (refreshPair) {
      await deletePendingFixture(refreshPair[0]);
      await deletePendingFixture(refreshPair[1]);
      await prisma.db.room.deleteMany({ where: { id: refreshPair[0].roomId } });
      await prisma.db.building.deleteMany({
        where: { id: refreshPair[0].buildingId },
      });
    }
    if (approveRefreshPair) {
      // The approved side is retained because its append-only audit entry must keep provenance.
      await deletePendingFixture(approveRefreshPair[1]);
    }
    if (rollbackFixture) {
      await prisma.db.$transaction(async (tx) => {
        await tx.contractVoidReversal.deleteMany({
          where: { contractVoidRequestId: rollbackFixture!.requestId },
        });
        await tx.contractVoidRequest.deleteMany({
          where: { id: rollbackFixture!.requestId },
        });
        await tx.payment.deleteMany({
          where: { id: rollbackFixture!.paymentId },
        });
        await tx.contractMember.deleteMany({
          where: { contractId: rollbackFixture!.contractId },
        });
        await tx.contract.deleteMany({
          where: { id: rollbackFixture!.contractId },
        });
        await tx.tenant.deleteMany({
          where: { id: rollbackFixture!.tenantId },
        });
        await tx.room.deleteMany({
          where: { id: rollbackFixture!.roomId },
        });
        await tx.building.deleteMany({
          where: { id: rollbackFixture!.buildingId },
        });
      });
    }
    await prisma?.onModuleDestroy();
  });

  async function createFixture(label: string): Promise<Fixture> {
    const suffix = `${marker}${label}`.slice(-16);
    const building = await prisma.db.building.create({
      data: {
        buildingNo: `ZFE2E${suffix}`.slice(0, 20),
        buildingName: '合同作废事务 E2E',
        floorCount: 1,
        remark: '隔离测试数据',
      },
    });
    const room = await prisma.db.room.create({
      data: {
        buildingId: building.id,
        houseNo: '101',
        fullHouseNo: `ZFE2E${suffix}栋101`.slice(0, 60),
        floorNo: 1,
        roomType: 'RESIDENTIAL',
        area: new Prisma.Decimal('50.00'),
        usageType: 'RESIDENCE',
        roomStatus: 'RENTED',
        remark: '合同作废事务 E2E',
      },
    });
    const tenant = await prisma.db.tenant.create({
      data: {
        name: `合同作废E2E租户${suffix}`,
        remark: '隔离测试数据',
      },
    });
    const contract = await prisma.db.contract.create({
      data: {
        contractNo: `ZFE2E-HT-${suffix}`,
        roomId: room.id,
        startDate: new Date('2035-01-01T00:00:00.000Z'),
        endDate: new Date('2035-12-31T00:00:00.000Z'),
        monthlyRent: new Prisma.Decimal('100.00'),
        pricingMode: 'FIXED',
        paymentCycleMonths: 1,
        depositRequired: new Prisma.Decimal('0.00'),
        status: 'ACTIVE',
        activatedAt: new Date(),
        members: {
          create: { tenantId: tenant.id, memberRole: 'PRIMARY' },
        },
      },
    });
    const payment = await prisma.db.payment.create({
      data: {
        receiptNo: `ZFE2E-SK-${suffix}`,
        contractId: contract.id,
        paymentCategory: 'RENT',
        paymentDate: new Date('2035-01-02T00:00:00.000Z'),
        amount: new Prisma.Decimal('100.00'),
        method: 'CASH',
        operatorId: operator.id,
        status: 'CONFIRMED',
      },
    });
    const previews = new ContractVoidPreviewService(prisma);
    const preview = await previews.preview(contract.id, operator);
    const request = await prisma.db.contractVoidRequest.create({
      data: {
        requestNo: `ZFE2E-ZF-${suffix}`,
        contractId: contract.id,
        reason: '验证合同作废真实事务语义',
        impactSnapshot: JSON.parse(
          JSON.stringify(preview),
        ) as Prisma.InputJsonValue,
        impactHash: preview.impactHash,
        activeContractKey: `contract:${contract.id}`,
        submissionIdempotencyKey: `submit-contract-void-${suffix}`,
        submittedBy: operator.id,
      },
    });
    return {
      buildingId: building.id,
      roomId: room.id,
      tenantId: tenant.id,
      contractId: contract.id,
      paymentId: payment.id,
      requestId: request.id,
      previewHash: preview.impactHash,
    };
  }

  function startGatedExecution(fixture: Fixture, executionKey: string) {
    const writeReached = deferred();
    const writeRelease = deferred();
    const writer = new ContractVoidReversalWriter();
    const baseWrite = writer.write.bind(writer);
    jest.spyOn(writer, 'write').mockImplementation(async (...args) => {
      writeReached.resolve();
      await writeRelease.promise;
      return baseWrite(...args);
    });
    const executor = new ContractVoidExecutorService(
      prisma,
      new ContractVoidPreviewService(prisma),
      writer,
      new SecurityAuditChainService(),
    );
    const execution = executor.execute(
      fixture.requestId,
      fixture.previewHash,
      '确认作废合同',
      executionKey,
      operator,
    );
    return {
      execution,
      writeReached: writeReached.promise,
      releaseWrite: writeRelease.resolve,
    };
  }

  async function createSharedRoomFixture(label: string) {
    const suffix = `${marker.slice(-8)}${label.slice(-5)}`;
    const building = await prisma.db.building.create({
      data: {
        buildingNo: `ZFSH${suffix}`.slice(0, 20),
        buildingName: '合同作废同房并发 E2E',
        floorCount: 1,
        remark: '隔离测试数据',
      },
    });
    const room = await prisma.db.room.create({
      data: {
        buildingId: building.id,
        houseNo: '201',
        fullHouseNo: `ZFSH${suffix}栋201`.slice(0, 60),
        floorNo: 2,
        roomType: 'RESIDENTIAL',
        area: new Prisma.Decimal('60.00'),
        usageType: 'RESIDENCE',
        roomStatus: 'RENTED',
        remark: '合同作废同房并发 E2E',
      },
    });
    const fixtures: Fixture[] = [];
    for (const index of [1, 2]) {
      const tenant = await prisma.db.tenant.create({
        data: {
          name: `同房并发租户${suffix}${index}`,
          remark: '隔离测试数据',
        },
      });
      const contract = await prisma.db.contract.create({
        data: {
          contractNo: `ZFSH-HT-${suffix}-${index}`,
          roomId: room.id,
          startDate: new Date(`2035-0${index}-01T00:00:00.000Z`),
          endDate: new Date(`2035-1${index}-30T00:00:00.000Z`),
          monthlyRent: new Prisma.Decimal('100.00'),
          pricingMode: 'FIXED',
          paymentCycleMonths: 1,
          depositRequired: new Prisma.Decimal('0.00'),
          status: 'ACTIVE',
          activatedAt: new Date(),
          members: {
            create: { tenantId: tenant.id, memberRole: 'PRIMARY' },
          },
        },
      });
      const payment = await prisma.db.payment.create({
        data: {
          receiptNo: `ZFSH-SK-${suffix}-${index}`,
          contractId: contract.id,
          paymentCategory: 'RENT',
          paymentDate: new Date('2035-01-02T00:00:00.000Z'),
          amount: new Prisma.Decimal('100.00'),
          method: 'CASH',
          operatorId: operator.id,
          status: 'CONFIRMED',
        },
      });
      const previews = new ContractVoidPreviewService(prisma);
      const preview = await previews.preview(contract.id, operator);
      const request = await prisma.db.contractVoidRequest.create({
        data: {
          requestNo: `ZFSH-ZF-${suffix}-${index}`,
          contractId: contract.id,
          reason: '验证同房合同统一锁序',
          impactSnapshot: JSON.parse(
            JSON.stringify(preview),
          ) as Prisma.InputJsonValue,
          impactHash: preview.impactHash,
          activeContractKey: `contract:${contract.id}`,
          submissionIdempotencyKey: `submit-shared-${suffix}-${index}`,
          submittedBy: operator.id,
        },
      });
      fixtures.push({
        buildingId: building.id,
        roomId: room.id,
        tenantId: tenant.id,
        contractId: contract.id,
        paymentId: payment.id,
        requestId: request.id,
        previewHash: preview.impactHash,
      });
    }
    return fixtures as [Fixture, Fixture];
  }

  function installIdentityBarrier() {
    const gate = deferred();
    let arrivals = 0;
    const originalTransaction = prisma.db.$transaction.bind(prisma.db);
    const transactionSpy = jest
      .spyOn(prisma.db, '$transaction')
      .mockImplementation((callback: unknown, options?: unknown) => {
        if (typeof callback !== 'function')
          throw new Error('并发 barrier 仅支持交互式事务');
        return originalTransaction(async (tx) => {
          const contract = new Proxy(tx.contract, {
            get(target, property, receiver) {
              if (property !== 'findUnique')
                return Reflect.get(target, property, receiver) as unknown;
              return async (args: { select?: Record<string, boolean> }) => {
                const result = await target.findUnique(args as never);
                if (
                  args.select?.id === true &&
                  args.select?.roomId === true &&
                  Object.keys(args.select).length === 2
                ) {
                  arrivals += 1;
                  if (arrivals === 2) gate.resolve();
                  await gate.promise;
                }
                return result;
              };
            },
          });
          const wrapped = new Proxy(tx, {
            get(target, property, receiver) {
              return property === 'contract'
                ? contract
                : (Reflect.get(target, property, receiver) as unknown);
            },
          });
          const run = callback as (client: typeof tx) => Promise<unknown>;
          return await run(wrapped);
        }, options as never);
      });
    return { transactionSpy, arrivals: () => arrivals };
  }
  async function withinTimeout<T>(promise: Promise<T>, milliseconds = 10000) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('同房合同并发操作超时')),
            milliseconds,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  it('同一房源两个合同并发 refresh 均在超时内完成且快照保持一致', async () => {
    refreshPair = await createSharedRoomFixture('refresh-pair');
    const [left, right] = refreshPair;
    const requests = new ContractVoidRequestsService(
      prisma,
      new ContractVoidPreviewService(prisma),
    );

    const baseline = await Promise.all([
      requests.refreshSnapshot(left.requestId, operator),
      requests.refreshSnapshot(right.requestId, operator),
    ]);
    const barrier = installIdentityBarrier();
    const results = await withinTimeout(
      Promise.all([
        requests.refreshSnapshot(left.requestId, operator),
        requests.refreshSnapshot(right.requestId, operator),
      ]),
    );

    barrier.transactionSpy.mockRestore();
    expect(barrier.arrivals()).toBe(2);
    expect(baseline[0].status).toBe('PENDING');
    expect(baseline[1].status).toBe('PENDING');
    expect(results[0].status).toBe('PENDING');
    expect(results[1].status).toBe('PENDING');
    expect(results[0].impactHash).toBe(baseline[0].impactHash);
    expect(results[1].impactHash).toBe(baseline[1].impactHash);
    const [storedLeft, storedRight] = await Promise.all([
      prisma.db.contractVoidRequest.findUniqueOrThrow({
        where: { id: left.requestId },
        select: { status: true, impactHash: true },
      }),
      prisma.db.contractVoidRequest.findUniqueOrThrow({
        where: { id: right.requestId },
        select: { status: true, impactHash: true },
      }),
    ]);
    expect(storedLeft.status).toBe('PENDING');
    expect(storedRight.status).toBe('PENDING');
    expect(storedLeft.impactHash).toBe(results[0].impactHash);
    expect(storedRight.impactHash).toBe(results[1].impactHash);
  });

  it('同一房源 approve 与另一合同 refresh 并发完成且终态和持久化快照一致', async () => {
    approveRefreshPair = await createSharedRoomFixture('approve-refresh');
    const [approval, refresh] = approveRefreshPair;
    const previews = new ContractVoidPreviewService(prisma);
    const executor = new ContractVoidExecutorService(
      prisma,
      previews,
      new ContractVoidReversalWriter(),
      new SecurityAuditChainService(),
    );
    const requests = new ContractVoidRequestsService(prisma, previews);
    const synchronizedApproval = await requests.refreshSnapshot(
      approval.requestId,
      operator,
    );

    const barrier = installIdentityBarrier();
    const [completed, refreshed] = await withinTimeout(
      Promise.all([
        executor.execute(
          approval.requestId,
          synchronizedApproval.impactHash,
          '确认作废合同',
          `execute-shared-${marker}`,
          operator,
        ),
        requests.refreshSnapshot(refresh.requestId, operator),
      ]),
    );

    barrier.transactionSpy.mockRestore();
    expect(barrier.arrivals()).toBe(2);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.contractStatus).toBe('VOIDED');
    expect(refreshed.status).toBe('PENDING');
    const [storedApproval, storedRefresh] = await Promise.all([
      prisma.db.contractVoidRequest.findUniqueOrThrow({
        where: { id: approval.requestId },
        select: { status: true, impactHash: true },
      }),
      prisma.db.contractVoidRequest.findUniqueOrThrow({
        where: { id: refresh.requestId },
        select: { status: true, impactHash: true },
      }),
    ]);
    expect(storedApproval.status).toBe('COMPLETED');
    expect(storedApproval.impactHash).toBe(completed.impactHash);
    expect(storedRefresh.status).toBe('PENDING');
    expect(storedRefresh.impactHash).toBe(refreshed.impactHash);
  });
  it('rolls back every row when failure occurs after reversal insertion', async () => {
    rollbackFixture = await createFixture('rollback');
    const previews = new ContractVoidPreviewService(prisma);
    const observingWriter = new ContractVoidReversalWriter();
    const baseWrite = observingWriter.write.bind(observingWriter);
    let observedInsertedReversals = false;
    jest.spyOn(observingWriter, 'write').mockImplementation(async (...args) => {
      const rows = await baseWrite(...args);
      observedInsertedReversals = rows.length > 0;
      return rows;
    });
    const executor = new ContractVoidExecutorService(
      prisma,
      previews,
      observingWriter,
      {
        append: () => Promise.reject(new Error('强制审计失败')),
      },
    );
    const headBefore = await prisma.db.securityAuditChainHead.findUniqueOrThrow(
      {
        where: { id: 1 },
      },
    );

    await expect(
      executor.execute(
        rollbackFixture.requestId,
        rollbackFixture.previewHash,
        '确认作废合同',
        `execute-rollback-${marker}`,
        operator,
      ),
    ).rejects.toThrow('强制审计失败');

    expect(observedInsertedReversals).toBe(true);
    await expect(
      prisma.db.contractVoidRequest.findUniqueOrThrow({
        where: { id: rollbackFixture.requestId },
        select: { status: true, executionIdempotencyKey: true },
      }),
    ).resolves.toEqual({
      status: 'PENDING',
      executionIdempotencyKey: null,
    });
    await expect(
      prisma.db.contract.findUniqueOrThrow({
        where: { id: rollbackFixture.contractId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'ACTIVE' });
    await expect(
      prisma.db.payment.findUniqueOrThrow({
        where: { id: rollbackFixture.paymentId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'CONFIRMED' });
    await expect(
      prisma.db.contractVoidReversal.count({
        where: { contractVoidRequestId: rollbackFixture.requestId },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.db.operationLog.count({
        where: {
          entityType: 'CONTRACT_VOID_REQUEST',
          entityId: rollbackFixture.requestId,
        },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.db.securityAuditChainHead.findUniqueOrThrow({
        where: { id: 1 },
      }),
    ).resolves.toEqual(headBefore);
  });

  it('serializes two concurrent approvals into one result and one audit successor', async () => {
    const fixture = await createFixture('concurrent');
    const previews = new ContractVoidPreviewService(prisma);
    const executor = new ContractVoidExecutorService(
      prisma,
      previews,
      new ContractVoidReversalWriter(),
      new SecurityAuditChainService(),
    );
    const headBefore = await prisma.db.securityAuditChainHead.findUniqueOrThrow(
      {
        where: { id: 1 },
      },
    );
    const executionKey = `execute-concurrent-${marker}`;

    const [left, right] = await Promise.all([
      executor.execute(
        fixture.requestId,
        fixture.previewHash,
        '确认作废合同',
        executionKey,
        operator,
      ),
      executor.execute(
        fixture.requestId,
        fixture.previewHash,
        '确认作废合同',
        executionKey,
        operator,
      ),
    ]);

    expect(right).toEqual(left);
    expect(left).toMatchObject({
      requestId: fixture.requestId,
      status: 'COMPLETED',
      contractStatus: 'VOIDED',
    });
    const audits = await prisma.db.securityAuditLog.findMany({
      where: {
        eventType: 'CONTRACT_VOID_COMPLETED',
        entityType: 'CONTRACT_VOID_REQUEST',
        entityId: fixture.requestId,
      },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].previousHash).toBe(headBefore.latestRecordHash);
    await expect(
      prisma.db.securityAuditChainHead.findUniqueOrThrow({
        where: { id: 1 },
      }),
    ).resolves.toMatchObject({
      latestRecordHash: audits[0].recordHash,
    });
    await expect(
      prisma.db.operationLog.count({
        where: {
          entityType: 'CONTRACT_VOID_REQUEST',
          entityId: fixture.requestId,
        },
      }),
    ).resolves.toBe(1);
    const reversals = await prisma.db.contractVoidReversal.findMany({
      where: { contractVoidRequestId: fixture.requestId },
      select: { idempotencyKey: true },
    });
    expect(reversals.length).toBeGreaterThan(0);
    expect(new Set(reversals.map((row) => row.idempotencyKey)).size).toBe(
      reversals.length,
    );
  });

  it('does not let checkout initiation overwrite a concurrently committed VOIDED status', async () => {
    const fixture = await createFixture('checkout-race');
    await expect(
      prisma.db.room.findUniqueOrThrow({
        where: { id: fixture.roomId },
        select: { roomStatus: true },
      }),
    ).resolves.toEqual({ roomStatus: RoomStatus.RENTED });
    const gated = startGatedExecution(
      fixture,
      `execute-checkout-race-${marker}`,
    );
    await gated.writeReached;

    const checkout = new CheckoutService(prisma);
    const checkoutAttempt = checkout.initiate(
      fixture.contractId,
      {
        checkoutType: '并发退租',
        plannedCheckoutDate: '2035-08-20',
        handoverDate: '2035-08-20',
        inspectionAt: '2035-08-20T09:00:00.000Z',
        checkoutReason: '验证合同锁后重载',
        targetRoomStatus: RoomStatus.EMPTY,
      },
      operator,
    );
    void checkoutAttempt.catch(() => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    gated.releaseWrite();

    await expect(gated.execution).resolves.toMatchObject({
      contractStatus: 'VOIDED',
    });
    await expect(checkoutAttempt).rejects.toThrow('已作废合同不能发起退租');
    const checkoutError = await checkoutAttempt.catch(
      (error: unknown) => error,
    );
    expect(checkoutError).toBeInstanceOf(Error);
    expect((checkoutError as Error).message).not.toMatch(/1213|P2034/);
    await expect(
      prisma.db.contract.findUniqueOrThrow({
        where: { id: fixture.contractId },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: 'VOIDED' });
    await expect(
      prisma.db.room.findUniqueOrThrow({
        where: { id: fixture.roomId },
        select: { roomStatus: true },
      }),
    ).resolves.toEqual({ roomStatus: RoomStatus.EMPTY });
    await expect(
      prisma.db.checkoutSettlement.count({
        where: { contractId: fixture.contractId },
      }),
    ).resolves.toBe(0);
  });

  it('does not insert a commission after concurrent contract void commits', async () => {
    const fixture = await createFixture('child-race');
    const gated = startGatedExecution(fixture, `execute-child-race-${marker}`);
    await gated.writeReached;

    const commissions = new CommissionsService(prisma);
    const commissionAttempt = commissions.create(
      {
        contractId: fixture.contractId,
        recipientName: `并发提成-${marker}`,
        amount: '10.00',
      },
      operator,
    );
    void commissionAttempt.catch(() => undefined);
    await new Promise<void>((resolve) => setImmediate(resolve));
    gated.releaseWrite();

    await expect(gated.execution).resolves.toMatchObject({
      contractStatus: 'VOIDED',
    });
    await expect(commissionAttempt).rejects.toThrow(
      '已作废合同不能新增租房提成',
    );
    await expect(
      prisma.db.contractCommission.count({
        where: { contractId: fixture.contractId },
      }),
    ).resolves.toBe(0);
  });
});
