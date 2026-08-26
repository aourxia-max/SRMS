import { ConfigService } from '@nestjs/config';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../src/auth/auth-user.type';
import { ContractVoidExecutorService } from '../src/contracts/contract-void-executor.service';
import { ContractVoidPreviewService } from '../src/contracts/contract-void-preview.service';
import { ContractVoidReversalWriter } from '../src/contracts/contract-void-reversal-writer';
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

describe('contract void executor real MySQL transaction semantics (e2e)', () => {
  let prisma: PrismaService;
  let operator: AuthUser;
  let rollbackFixture: Fixture | undefined;
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

  afterAll(async () => {
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

  it('rolls back every row when failure occurs after reversal insertion', async () => {
    rollbackFixture = await createFixture('rollback');
    const previews = new ContractVoidPreviewService(prisma);
    const baseWriter = new ContractVoidReversalWriter();
    let observedInsertedReversals = false;
    const observingWriter = {
      async write(...args: Parameters<ContractVoidReversalWriter['write']>) {
        const rows = await baseWriter.write(...args);
        observedInsertedReversals = rows.length > 0;
        return rows;
      },
    };
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
});
