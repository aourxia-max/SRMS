import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { Response as SuperAgentResponse } from 'superagent';
import { AppModule } from '../src/app.module';
import type { AuthUser } from '../src/auth/auth-user.type';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { FilesService } from '../src/files/files.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PropertyAffairsService } from '../src/property-affairs/property-affairs.service';
import {
  hashSecurityAuditRecord,
  SecurityAuditChainService,
} from '../src/system/security-audit-chain.service';
import { propertyAffairUploadBufferLimit } from '../src/property-affairs/property-affairs.controller';
import {
  collectPropertyAffairCleanupTargets,
  createIsolatedSecurityAuditChain,
  runBestEffortCleanup,
} from './property-affairs.e2e-support';

type AffairState = { id: number; version: number };

function collectBinaryResponse(
  response: SuperAgentResponse,
  callback: (error: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: unknown) => {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      return;
    }
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
      return;
    }
    chunks.push(Buffer.from(chunk as Uint8Array));
  });
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function shanghaiDateKey(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}

describe('property affairs API workflows and invariants (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let files: FilesService;
  let currentUser: AuthUser | undefined;
  let superAdmin: AuthUser;
  let admin: AuthUser;
  let visitor: AuthUser;
  let buildingId: number;
  let roomId: number;
  let tenantId: number;
  let contractId: number;
  let businessSnapshotBefore: string;
  let financeSnapshotBefore: string;

  const marker = Date.now().toString().slice(-9);
  const titlePrefix = `物业办事E2E-${marker}`;
  const buildingNo = `WYE${marker}`.slice(0, 20);
  const contractNo = `WY-E2E-${marker}`;
  const workflowAffairs = new Map<UserRole, AffairState>();
  const createdAffairIds = new Set<number>();
  const createdFileIds = new Set<number>();

  const selectAuthUser = {
    id: true,
    username: true,
    displayName: true,
    role: true,
  } as const;

  async function businessSnapshot() {
    const [building, room, tenant, contract] = await Promise.all([
      prisma.db.building.findUniqueOrThrow({ where: { id: buildingId } }),
      prisma.db.room.findUniqueOrThrow({ where: { id: roomId } }),
      prisma.db.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
      prisma.db.contract.findUniqueOrThrow({ where: { id: contractId } }),
    ]);
    return JSON.stringify({ building, room, tenant, contract });
  }

  async function financeSnapshot() {
    currentUser = superAdmin;
    const response = await request(app.getHttpServer())
      .get('/api/finance/overview')
      .expect(200);
    return JSON.stringify(response.body.data);
  }

  async function listContains(
    affairId: number,
    query: Record<string, number | string> = {},
  ) {
    const response = await request(app.getHttpServer())
      .get('/api/property-affairs')
      .query(query)
      .expect(200);
    return (response.body.data.items as Array<{ id: number }>).some(
      (item) => item.id === affairId,
    );
  }

  async function waitForTenantRowLock(id: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        await prisma.db.$transaction(async (tx) => {
          await tx.$queryRaw<Array<{ id: number }>>`
            SELECT id FROM tenants WHERE id = ${id} FOR UPDATE NOWAIT
          `;
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2010'
        ) {
          return;
        }
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('更新事务未锁定新增承租人');
  }

  function reverseRelationQueries(): Array<Record<string, number>> {
    return [{ buildingId }, { roomId }, { tenantId }, { contractId }];
  }

  beforeAll(async () => {
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
            headers: Record<string, string | string[] | undefined>;
          }>();
          if (!currentUser) return false;
          testRequest.user = currentUser;
          testRequest.headers['user-agent'] = 'SRMS物业办事E2E';
          return true;
        },
      })
      .overrideProvider(SecurityAuditChainService)
      .useValue(createIsolatedSecurityAuditChain())
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    files = app.get(FilesService);

    const [storedSuper, storedAdmin] = await Promise.all([
      prisma.db.user.findFirst({
        where: {
          role: UserRole.SUPER_ADMIN,
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: selectAuthUser,
      }),
      prisma.db.user.findFirst({
        where: { role: UserRole.ADMIN, status: 'ACTIVE', deletedAt: null },
        select: selectAuthUser,
      }),
    ]);
    if (!storedSuper || !storedAdmin) {
      throw new Error('物业办事 E2E 需要有效的超级管理员和普通管理员基础账号');
    }
    superAdmin = storedSuper;
    admin = storedAdmin;
    visitor = {
      ...storedAdmin,
      username: `visitor-${marker}`,
      displayName: '访客',
      role: UserRole.VISITOR,
    };
    currentUser = superAdmin;

    const building = await prisma.db.building.create({
      data: {
        buildingNo,
        buildingName: '物业办事 E2E 楼栋',
        floorCount: 1,
        remark: titlePrefix,
      },
    });
    buildingId = building.id;
    const room = await prisma.db.room.create({
      data: {
        buildingId,
        houseNo: '101',
        fullHouseNo: `${buildingNo}101`,
        floorNo: 1,
        roomType: 'RESIDENTIAL',
        area: new Prisma.Decimal('60.00'),
        decorationStatus: 'UNKNOWN',
        usageType: 'RESIDENCE',
        roomStatus: 'EMPTY',
        remark: titlePrefix,
      },
    });
    roomId = room.id;
    const tenant = await prisma.db.tenant.create({
      data: { name: `${titlePrefix}-租户`, remark: titlePrefix },
    });
    tenantId = tenant.id;
    const contract = await prisma.db.contract.create({
      data: {
        contractNo,
        externalContractNo: contractNo,
        roomId,
        startDate: new Date('2035-01-01T00:00:00.000Z'),
        endDate: new Date('2035-12-31T00:00:00.000Z'),
        monthlyRent: new Prisma.Decimal('1000.00'),
        pricingMode: 'FIXED',
        paymentCycleMonths: 1,
        depositRequired: new Prisma.Decimal('0.00'),
        status: 'DRAFT',
        remark: titlePrefix,
      },
    });
    contractId = contract.id;

    businessSnapshotBefore = await businessSnapshot();
    financeSnapshotBefore = await financeSnapshot();
  });

  afterAll(async () => {
    let cleanupTargets = collectPropertyAffairCleanupTargets({
      createdAffairIds,
      prefixedAffairIds: [],
      createdFileIds,
      remainingLinkedFileIds: [],
    });
    const cleanupSteps: Parameters<typeof runBestEffortCleanup>[0] = [];

    if (prisma) {
      cleanupSteps.push(
        {
          label: '反查标题前缀事项',
          run: async () => {
            const remaining = await prisma.db.propertyAffair.findMany({
              where: { title: { startsWith: titlePrefix } },
              select: { id: true },
            });
            cleanupTargets = collectPropertyAffairCleanupTargets({
              createdAffairIds,
              prefixedAffairIds: remaining.map((item) => item.id),
              createdFileIds,
              remainingLinkedFileIds: cleanupTargets.fileIds,
            });
          },
        },
        {
          label: '反查事项附件',
          run: async () => {
            const remainingLinks = cleanupTargets.affairIds.length
              ? await prisma.db.propertyAffairFile.findMany({
                  where: {
                    affairId: { in: cleanupTargets.affairIds },
                  },
                  select: { fileAssetId: true },
                })
              : [];
            cleanupTargets = collectPropertyAffairCleanupTargets({
              createdAffairIds,
              prefixedAffairIds: cleanupTargets.affairIds,
              createdFileIds,
              remainingLinkedFileIds: remainingLinks.map(
                (item) => item.fileAssetId,
              ),
            });
          },
        },
        {
          label: '删除物业办事测试记录',
          run: async () => {
            if (!cleanupTargets.affairIds.length) return;
            await prisma.db.$transaction(async (tx) => {
              const affairIdFilter = {
                affairId: { in: cleanupTargets.affairIds },
              };
              await tx.propertyAffairFile.deleteMany({
                where: affairIdFilter,
              });
              await tx.propertyAffairProgress.deleteMany({
                where: affairIdFilter,
              });
              await tx.propertyAffairBuilding.deleteMany({
                where: affairIdFilter,
              });
              await tx.propertyAffairRoom.deleteMany({
                where: affairIdFilter,
              });
              await tx.propertyAffairTenant.deleteMany({
                where: affairIdFilter,
              });
              await tx.propertyAffairContract.deleteMany({
                where: affairIdFilter,
              });
              await tx.propertyAffair.deleteMany({
                where: { id: { in: cleanupTargets.affairIds } },
              });
            });
          },
        },
      );

      if (files) {
        cleanupSteps.push({
          label: '清理物业办事附件',
          run: async () => {
            if (!cleanupTargets.fileIds.length) return;
            await files.cleanupReleasedPropertyAffairFiles(
              cleanupTargets.fileIds,
            );
          },
        });
      }

      cleanupSteps.push(
        {
          label: '清理物业办事操作日志',
          run: async () => {
            if (!cleanupTargets.affairIds.length) return;
            await prisma.db.operationLog.deleteMany({
              where: {
                module: 'PROPERTY_AFFAIRS',
                entityId: { in: cleanupTargets.affairIds },
              },
            });
          },
        },
        {
          label: '清理合同夹具',
          run: async () => {
            if (!contractId) return;
            await prisma.db.contract.deleteMany({ where: { id: contractId } });
          },
        },
        {
          label: '清理租户夹具',
          run: async () => {
            if (!tenantId) return;
            await prisma.db.tenant.deleteMany({ where: { id: tenantId } });
          },
        },
        {
          label: '清理房间夹具',
          run: async () => {
            if (!roomId) return;
            await prisma.db.roomStatusHistory.deleteMany({ where: { roomId } });
            await prisma.db.room.deleteMany({ where: { id: roomId } });
          },
        },
        {
          label: '清理楼栋夹具',
          run: async () => {
            if (!buildingId) return;
            await prisma.db.building.deleteMany({ where: { id: buildingId } });
          },
        },
      );
    }
    if (app) {
      cleanupSteps.push({
        label: '关闭测试应用',
        run: () => app.close(),
      });
    }

    const failedLabels = await runBestEffortCleanup(cleanupSteps);
    if (failedLabels.length) {
      process.stderr.write(
        `物业办事 E2E 清理未完成：${failedLabels.join('、')}\n`,
      );
    }
  });

  it.each([UserRole.SUPER_ADMIN, UserRole.ADMIN])(
    'allows %s to list, create, update, append progress, soft-delete, and restore',
    async (role) => {
      currentUser = role === UserRole.SUPER_ADMIN ? superAdmin : admin;
      const relationIds =
        role === UserRole.SUPER_ADMIN
          ? {
              buildingIds: [buildingId],
              roomIds: [roomId],
              tenantIds: [tenantId],
              contractIds: [contractId],
            }
          : {};
      const created = await request(app.getHttpServer())
        .post('/api/property-affairs')
        .send({
          title: `${titlePrefix}-${role}`,
          category: '公共维修',
          priority: role === UserRole.SUPER_ADMIN ? 'URGENT' : 'IMPORTANT',
          content: '创建物业办事流程',
          responsibleUserId: admin.id,
          ...relationIds,
        })
        .expect(201);
      const affairId = created.body.data.id as number;
      createdAffairIds.add(affairId);
      expect(created.body).toMatchObject({
        code: 200,
        message: 'success',
        data: { id: expect.any(Number), version: 1, status: 'PENDING' },
      });

      const listed = await request(app.getHttpServer())
        .get('/api/property-affairs')
        .query({ keyword: `${titlePrefix}-${role}` })
        .expect(200);
      expect(
        (listed.body.data.items as Array<{ id: number }>).some(
          (item) => item.id === affairId,
        ),
      ).toBe(true);

      const updated = await request(app.getHttpServer())
        .patch(`/api/property-affairs/${affairId}`)
        .send({
          version: 1,
          content: '已确认现场情况',
          ...relationIds,
        })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        id: affairId,
        version: 2,
        content: '已确认现场情况',
      });

      const progressed = await request(app.getHttpServer())
        .post(`/api/property-affairs/${affairId}/progress`)
        .send({
          version: 2,
          content: '已联系处理单位',
          nextStatus: 'IN_PROGRESS',
        })
        .expect(201);
      expect(progressed.body.data).toMatchObject({
        id: affairId,
        version: 3,
        status: 'IN_PROGRESS',
      });
      expect(progressed.body.data.progresses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: '已联系处理单位' }),
        ]),
      );

      const deleted = await request(app.getHttpServer())
        .delete(`/api/property-affairs/${affairId}`)
        .send({ version: 3 })
        .expect(200);
      expect(deleted.body.data).toMatchObject({
        id: affairId,
        version: 4,
        deletedAt: expect.any(String),
      });
      expect(await listContains(affairId)).toBe(false);

      const recycleBin = await request(app.getHttpServer())
        .get('/api/property-affairs/recycle-bin')
        .query({ keyword: `${titlePrefix}-${role}` })
        .expect(200);
      expect(
        (recycleBin.body.data.items as Array<{ id: number }>).some(
          (item) => item.id === affairId,
        ),
      ).toBe(true);

      const restored = await request(app.getHttpServer())
        .post(`/api/property-affairs/${affairId}/restore`)
        .send({ version: 4 })
        .expect(201);
      expect(restored.body.data).toMatchObject({
        id: affairId,
        version: 5,
        deletedAt: null,
      });
      workflowAffairs.set(role, { id: affairId, version: 5 });
    },
  );

  it('supports mixed target links and every reverse filter', async () => {
    currentUser = superAdmin;
    const main = workflowAffairs.get(UserRole.SUPER_ADMIN);
    if (!main) throw new Error('超级管理员物业办事流程未初始化');

    const detail = await request(app.getHttpServer())
      .get(`/api/property-affairs/${main.id}`)
      .expect(200);
    expect(detail.body.data).toMatchObject({
      buildings: [expect.objectContaining({ id: buildingId })],
      rooms: [expect.objectContaining({ id: roomId })],
      tenants: [expect.objectContaining({ id: tenantId })],
      contracts: [expect.objectContaining({ id: contractId })],
    });

    for (const query of reverseRelationQueries()) {
      expect(await listContains(main.id, query)).toBe(true);
    }
  });

  it('preserves relation snapshots on partial edits and accepts a retained deleted target id', async () => {
    currentUser = superAdmin;
    const originalName = `${titlePrefix}-历史承租人`;
    const renamed = `${titlePrefix}-承租人改名`;
    const tenant = await prisma.db.tenant.create({
      data: { name: originalName },
    });
    const created = await request(app.getHttpServer())
      .post('/api/property-affairs')
      .send({
        title: `${titlePrefix}-历史关联`,
        content: '验证历史关联快照',
        tenantIds: [tenant.id],
      })
      .expect(201);
    const affairId = created.body.data.id as number;
    createdAffairIds.add(affairId);

    await prisma.db.tenant.update({
      where: { id: tenant.id },
      data: { name: renamed },
    });
    const partiallyUpdated = await request(app.getHttpServer())
      .patch(`/api/property-affairs/${affairId}`)
      .send({ version: 1, title: `${titlePrefix}-只改标题` })
      .expect(200);
    expect(partiallyUpdated.body.data.tenants[0]).toMatchObject({
      id: tenant.id,
      snapshotLabel: originalName,
      currentLabel: renamed,
    });

    await prisma.db.tenant.delete({ where: { id: tenant.id } });
    const retainedAfterDelete = await request(app.getHttpServer())
      .patch(`/api/property-affairs/${affairId}`)
      .send({
        version: partiallyUpdated.body.data.version,
        content: '关联目标删除后仍可编辑事项',
        tenantIds: [tenant.id],
      })
      .expect(200);
    expect(retainedAfterDelete.body.data.tenants[0]).toMatchObject({
      id: tenant.id,
      snapshotLabel: originalName,
      currentLabel: originalName,
      currentStatus: null,
      available: false,
    });
  });

  it('serializes relation saving before target deletion and keeps the committed snapshot as history', async () => {
    currentUser = superAdmin;
    const tenant = await prisma.db.tenant.create({
      data: { name: `${titlePrefix}-保存先提交` },
    });
    const created = await request(app.getHttpServer())
      .post('/api/property-affairs')
      .send({
        title: `${titlePrefix}-保存删除竞态一`,
        content: '验证保存先提交时关系快照合法',
      })
      .expect(201);
    const affairId = created.body.data.id as number;
    createdAffairIds.add(affairId);
    const blockerReady = deferred();
    const blockerRelease = deferred();
    const blocker = prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM property_affairs WHERE id = ${affairId} FOR UPDATE
      `;
      blockerReady.resolve();
      await blockerRelease.promise;
    });
    await blockerReady.promise;
    let updatePromise: Promise<SuperAgentResponse> | undefined;
    let deletionPromise: Promise<unknown> | undefined;

    try {
      updatePromise = Promise.resolve(
        request(app.getHttpServer())
          .patch(`/api/property-affairs/${affairId}`)
          .send({ version: 1, tenantIds: [tenant.id] })
          .expect(200),
      );
      await waitForTenantRowLock(tenant.id);

      let deletionSettled = false;
      deletionPromise = Promise.resolve(
        prisma.db.tenant.delete({ where: { id: tenant.id } }),
      ).finally(() => {
        deletionSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(deletionSettled).toBe(false);

      blockerRelease.resolve();
      const updated = await updatePromise;
      await blocker;
      await deletionPromise;
      expect(updated.body.data.tenants[0]).toMatchObject({
        id: tenant.id,
        snapshotLabel: `${titlePrefix}-保存先提交`,
      });
      const detail = await request(app.getHttpServer())
        .get(`/api/property-affairs/${affairId}`)
        .expect(200);
      expect(detail.body.data.tenants[0]).toMatchObject({
        id: tenant.id,
        snapshotLabel: `${titlePrefix}-保存先提交`,
        currentStatus: null,
        available: false,
      });
    } finally {
      blockerRelease.resolve();
      await blocker.catch(() => undefined);
      await updatePromise?.catch(() => undefined);
      await deletionPromise?.catch(() => undefined);
      await prisma.db.tenant.deleteMany({ where: { id: tenant.id } });
    }
  }, 30000);

  it('rejects a newly linked target when its deletion transaction commits first', async () => {
    currentUser = superAdmin;
    const tenant = await prisma.db.tenant.create({
      data: { name: `${titlePrefix}-删除先提交` },
    });
    const created = await request(app.getHttpServer())
      .post('/api/property-affairs')
      .send({
        title: `${titlePrefix}-保存删除竞态二`,
        content: '验证删除先提交时不能新增悬空关系',
      })
      .expect(201);
    const affairId = created.body.data.id as number;
    createdAffairIds.add(affairId);
    const deleteReady = deferred();
    const deleteRelease = deferred();
    const deleting = prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM tenants WHERE id = ${tenant.id} FOR UPDATE
      `;
      deleteReady.resolve();
      await deleteRelease.promise;
      await tx.tenant.delete({ where: { id: tenant.id } });
    });
    await deleteReady.promise;

    try {
      const updating = Promise.resolve(
        request(app.getHttpServer())
          .patch(`/api/property-affairs/${affairId}`)
          .send({ version: 1, tenantIds: [tenant.id] }),
      );
      deleteRelease.resolve();
      await deleting;
      const response = await updating;
      expect(response.status).toBe(400);
      expect(response.body.message).toBe(`承租人 ${tenant.id} 不存在`);
      await expect(
        prisma.db.propertyAffairTenant.count({ where: { affairId } }),
      ).resolves.toBe(0);
    } finally {
      deleteRelease.resolve();
      await deleting.catch(() => undefined);
      await prisma.db.tenant.deleteMany({ where: { id: tenant.id } });
    }
  }, 30000);

  it('returns Chinese HTTP 400 for illegal update and progress transitions', async () => {
    currentUser = admin;
    const created = await request(app.getHttpServer())
      .post('/api/property-affairs')
      .send({
        title: `${titlePrefix}-非法流转`,
        content: '验证状态校验',
      })
      .expect(201);
    const affairId = created.body.data.id as number;
    createdAffairIds.add(affairId);
    const completed = await request(app.getHttpServer())
      .patch(`/api/property-affairs/${affairId}`)
      .send({ version: 1, status: 'COMPLETED' })
      .expect(200);

    for (const response of [
      await request(app.getHttpServer())
        .patch(`/api/property-affairs/${affairId}`)
        .send({ version: completed.body.data.version, status: 'PENDING' })
        .expect(400),
      await request(app.getHttpServer())
        .post(`/api/property-affairs/${affairId}/progress`)
        .send({
          version: completed.body.data.version,
          content: '非法退回待办理',
          nextStatus: 'PENDING',
        })
        .expect(400),
    ]) {
      expect(response.body.message).toBe('事项状态不能这样变更');
    }
  });

  it('allocates unique same-day affair numbers under concurrent real-MySQL creates', async () => {
    currentUser = superAdmin;
    const dateKey = shanghaiDateKey();
    const previousSequence =
      await prisma.db.propertyAffairDailySequence.findUnique({
        where: { dateKey },
        select: { currentValue: true },
      });
    const previousMaximumSequence = previousSequence?.currentValue ?? 0;
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        request(app.getHttpServer())
          .post('/api/property-affairs')
          .send({
            title: `${titlePrefix}-并发编号-${index + 1}`,
            content: '同日并发编号验证',
          })
          .expect(201),
      ),
    );
    const numbers = responses.map((response) => {
      const data = response.body.data as { id: number; affairNo: string };
      createdAffairIds.add(data.id);
      return data.affairNo;
    });
    const strictNumberPattern = new RegExp(`^WY${dateKey}\\d{4}$`);
    for (const number of numbers) {
      expect(number).toMatch(strictNumberPattern);
    }
    const actualSequences = numbers
      .map((number) => Number(number.slice(-4)))
      .sort((left, right) => left - right);
    expect(actualSequences).toEqual(
      Array.from(
        { length: 6 },
        (_, index) => previousMaximumSequence + index + 1,
      ),
    );
  });

  it('completes, reopens, cancels, and reopens an affair through appended progress', async () => {
    currentUser = superAdmin;
    const main = workflowAffairs.get(UserRole.SUPER_ADMIN);
    if (!main) throw new Error('超级管理员物业办事流程未初始化');

    const transitions = [
      ['COMPLETED', '办理完成'],
      ['IN_PROGRESS', '重新开启继续办理'],
      ['CANCELLED', '确认取消'],
      ['IN_PROGRESS', '取消后重新开启'],
    ] as const;

    for (const [nextStatus, content] of transitions) {
      const response = await request(app.getHttpServer())
        .post(`/api/property-affairs/${main.id}/progress`)
        .send({ version: main.version, content, nextStatus })
        .expect(201);
      expect(response.body.data).toMatchObject({
        id: main.id,
        status: nextStatus,
        version: main.version + 1,
      });
      main.version = response.body.data.version as number;
    }
  });

  it('returns 409 for stale update, progress, and soft-delete requests', async () => {
    currentUser = admin;
    const state = workflowAffairs.get(UserRole.ADMIN);
    if (!state) throw new Error('普通管理员物业办事流程未初始化');
    const staleVersion = state.version;

    const updated = await request(app.getHttpServer())
      .patch(`/api/property-affairs/${state.id}`)
      .send({ version: staleVersion, title: `${titlePrefix}-并发更新` })
      .expect(200);
    state.version = updated.body.data.version as number;

    await request(app.getHttpServer())
      .patch(`/api/property-affairs/${state.id}`)
      .send({ version: staleVersion, title: '过期编辑' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/property-affairs/${state.id}/progress`)
      .send({ version: staleVersion, content: '过期进度' })
      .expect(409);
    await request(app.getHttpServer())
      .delete(`/api/property-affairs/${state.id}`)
      .send({ version: staleVersion })
      .expect(409);
  });

  it('hides soft-deleted affairs from lists, dashboard, and reverse filters, then restores them', async () => {
    currentUser = admin;
    const main = workflowAffairs.get(UserRole.SUPER_ADMIN);
    if (!main) throw new Error('超级管理员物业办事流程未初始化');

    const deleted = await request(app.getHttpServer())
      .delete(`/api/property-affairs/${main.id}`)
      .send({ version: main.version })
      .expect(200);
    main.version = deleted.body.data.version as number;
    expect(await listContains(main.id)).toBe(false);
    for (const query of reverseRelationQueries()) {
      expect(await listContains(main.id, query)).toBe(false);
    }
    const dashboardWithout = await request(app.getHttpServer())
      .get('/api/dashboard')
      .expect(200);
    expect(
      (
        dashboardWithout.body.data.propertyAffairs as Array<{ id: number }>
      ).some((item) => item.id === main.id),
    ).toBe(false);

    currentUser = superAdmin;
    const restored = await request(app.getHttpServer())
      .post(`/api/property-affairs/${main.id}/restore`)
      .send({ version: main.version })
      .expect(201);
    main.version = restored.body.data.version as number;
    expect(await listContains(main.id)).toBe(true);
    for (const query of reverseRelationQueries()) {
      expect(await listContains(main.id, query)).toBe(true);
    }
    const dashboardWith = await request(app.getHttpServer())
      .get('/api/dashboard')
      .expect(200);
    expect(
      (dashboardWith.body.data.propertyAffairs as Array<{ id: number }>).some(
        (item) => item.id === main.id,
      ),
    ).toBe(true);
  });

  it('allows super permanent deletion and rejects an administrator', async () => {
    currentUser = admin;
    const created = await request(app.getHttpServer())
      .post('/api/property-affairs')
      .send({
        title: `${titlePrefix}-永久删除`,
        content: '永久删除权限验证',
      })
      .expect(201);
    const affairId = created.body.data.id as number;
    createdAffairIds.add(affairId);
    const deleted = await request(app.getHttpServer())
      .delete(`/api/property-affairs/${affairId}`)
      .send({ version: created.body.data.version })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/property-affairs/${affairId}/permanent`)
      .send({ version: deleted.body.data.version })
      .expect(403);

    currentUser = superAdmin;
    await request(app.getHttpServer())
      .delete(`/api/property-affairs/${affairId}/permanent`)
      .send({ version: deleted.body.data.version })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          code: 200,
          message: 'success',
          data: { id: affairId },
        });
      });
    await request(app.getHttpServer())
      .get(`/api/property-affairs/${affairId}`)
      .expect(404);
  });

  it('persists a real permanent-delete audit successor and safely restores the isolated chain tail', async () => {
    const affair = await prisma.db.propertyAffair.create({
      data: {
        affairNo: `WYAUD${marker}`,
        title: `${titlePrefix}-真实审计链`,
        content: '验证永久删除后安全审计仍持久存在',
        createdBy: superAdmin.id,
        updatedBy: superAdmin.id,
        deletedAt: new Date(),
        deletedBy: superAdmin.id,
      },
    });
    createdAffairIds.add(affair.id);
    const headBefore = await prisma.db.securityAuditChainHead.findUniqueOrThrow(
      {
        where: { id: 1 },
      },
    );
    let auditId: number | undefined;
    let auditHash: string | undefined;

    try {
      const service = new PropertyAffairsService(
        prisma,
        new SecurityAuditChainService(),
      );
      await service.permanentDelete(affair.id, affair.version, superAdmin, {
        ipAddress: '127.0.0.1',
        userAgent: 'SRMS物业办事真实审计E2E',
      });

      await expect(
        prisma.db.propertyAffair.findUnique({ where: { id: affair.id } }),
      ).resolves.toBeNull();
      const audit = await prisma.db.securityAuditLog.findFirstOrThrow({
        where: {
          eventType: 'PROPERTY_AFFAIR_PERMANENT_DELETE',
          entityType: 'PROPERTY_AFFAIR',
          entityId: affair.id,
        },
      });
      auditId = audit.id;
      auditHash = audit.recordHash ?? undefined;
      expect(audit.previousHash).toBe(headBefore.latestRecordHash);
      expect(audit.recordHash).toBe(
        hashSecurityAuditRecord({
          eventType: audit.eventType,
          entityType: audit.entityType,
          entityId: audit.entityId,
          operatorId: audit.operatorId,
          eventData: audit.eventData,
          reason: audit.reason,
          occurredAt: audit.occurredAt,
          previousHash: audit.previousHash,
        }),
      );
      await expect(
        prisma.db.securityAuditChainHead.findUniqueOrThrow({
          where: { id: 1 },
        }),
      ).resolves.toMatchObject({ latestRecordHash: audit.recordHash });
      await expect(
        prisma.db.operationLog.count({
          where: {
            module: 'PROPERTY_AFFAIRS',
            action: 'PERMANENT_DELETE',
            entityId: affair.id,
          },
        }),
      ).resolves.toBe(1);
    } finally {
      if (auditId && auditHash) {
        await prisma.db.$transaction(async (tx) => {
          const [lockedHead] = await tx.$queryRaw<
            Array<{ latestRecordHash: string | null }>
          >`
            SELECT latest_record_hash AS latestRecordHash
            FROM security_audit_chain_heads WHERE id = 1 FOR UPDATE
          `;
          if (lockedHead?.latestRecordHash !== auditHash) {
            throw new Error('安全审计链已出现其他后继事件，拒绝清理测试链尾');
          }
          await tx.operationLog.deleteMany({
            where: { module: 'PROPERTY_AFFAIRS', entityId: affair.id },
          });
          await tx.securityAuditLog.delete({ where: { id: auditId } });
          await tx.securityAuditChainHead.update({
            where: { id: 1 },
            data: { latestRecordHash: headBefore.latestRecordHash },
          });
        });
      }
      await prisma.db.operationLog.deleteMany({
        where: { module: 'PROPERTY_AFFAIRS', entityId: affair.id },
      });
      await prisma.db.propertyAffair.deleteMany({ where: { id: affair.id } });
    }
  });

  it('uploads, lists in detail, previews, downloads, isolates, and unlinks an attachment', async () => {
    currentUser = admin;
    const main = workflowAffairs.get(UserRole.SUPER_ADMIN);
    const other = workflowAffairs.get(UserRole.ADMIN);
    if (!main || !other) throw new Error('物业办事附件流程未初始化');
    const png = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68,
    ]);

    const uploaded = await request(app.getHttpServer())
      .post(`/api/property-affairs/${main.id}/files`)
      .attach('file', png, {
        filename: '现场 照片.png',
        contentType: 'image/png',
      })
      .expect(201);
    const fileId = uploaded.body.data.id as number;
    createdFileIds.add(fileId);
    expect(uploaded.body).toMatchObject({
      code: 200,
      message: 'success',
      data: {
        id: expect.any(Number),
        originalName: '现场 照片.png',
        mimeType: 'image/png',
      },
    });

    const detail = await request(app.getHttpServer())
      .get(`/api/property-affairs/${main.id}`)
      .expect(200);
    const summary = (
      detail.body.data.files as Array<Record<string, unknown>>
    ).find((item) => item.id === fileId);
    expect(summary).toEqual(
      expect.objectContaining({
        id: fileId,
        originalName: '现场 照片.png',
        mimeType: 'image/png',
      }),
    );
    expect(summary).not.toHaveProperty('storageKey');
    expect(summary).not.toHaveProperty('storedName');

    const preview = await request(app.getHttpServer())
      .get(`/api/property-affairs/${main.id}/files/${fileId}/preview`)
      .buffer(true)
      .parse(collectBinaryResponse)
      .expect(200);
    expect(preview.headers['content-type']).toContain('image/png');
    expect(preview.headers['content-disposition']).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent('现场 照片.png')}`,
    );
    expect(preview.body).toEqual(png);

    const downloaded = await request(app.getHttpServer())
      .get(`/api/property-affairs/${main.id}/files/${fileId}/download`)
      .buffer(true)
      .parse(collectBinaryResponse)
      .expect(200);
    expect(downloaded.headers['content-type']).toContain('image/png');
    expect(downloaded.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('现场 照片.png')}`,
    );
    expect(downloaded.body).toEqual(png);

    await request(app.getHttpServer())
      .get(`/api/property-affairs/${other.id}/files/${fileId}/preview`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/api/property-affairs/${other.id}/files/${fileId}/download`)
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/property-affairs/${other.id}/files/${fileId}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/property-affairs/${main.id}/files/${fileId}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual({ id: fileId });
      });
    const detailAfter = await request(app.getHttpServer())
      .get(`/api/property-affairs/${main.id}`)
      .expect(200);
    expect(
      (detailAfter.body.data.files as Array<{ id: number }>).some(
        (item) => item.id === fileId,
      ),
    ).toBe(false);
  });

  it('rejects a multipart file over the absolute buffer cap with a Chinese 413 response', async () => {
    currentUser = admin;
    const main = workflowAffairs.get(UserRole.ADMIN);
    if (!main) throw new Error('普通管理员物业办事流程未初始化');
    const response = await request(app.getHttpServer())
      .post(`/api/property-affairs/${main.id}/files`)
      .attach('file', Buffer.alloc(propertyAffairUploadBufferLimit + 1), {
        filename: '超大附件.pdf',
        contentType: 'application/pdf',
      })
      .expect(413);
    expect(response.body).toEqual({
      code: 413,
      message: '附件超过允许大小',
      data: null,
    });
  });

  it('persists normalized request sources for every property-affair write action', async () => {
    const logs = await prisma.db.operationLog.findMany({
      where: {
        module: 'PROPERTY_AFFAIRS',
        entityId: { in: [...createdAffairIds] },
      },
      select: { action: true, ipAddress: true, userAgent: true },
    });
    const actions = new Set(logs.map((item) => item.action));
    for (const action of [
      'CREATE',
      'UPDATE',
      'APPEND_PROGRESS',
      'SOFT_DELETE',
      'RESTORE',
      'PERMANENT_DELETE',
      'UPLOAD_FILE',
      'UNLINK_FILE',
    ]) {
      expect(actions).toContain(action);
    }
    for (const log of logs) {
      expect(log.ipAddress).toMatch(/^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i);
      expect(log.userAgent).toEqual(expect.any(String));
      expect(log.userAgent?.length).toBeGreaterThan(0);
      expect(log.userAgent?.length).toBeLessThanOrEqual(500);
    }
  });

  it('returns 403 to a visitor for every property-affair endpoint and no dashboard affairs', async () => {
    currentUser = visitor;
    const main = workflowAffairs.get(UserRole.SUPER_ADMIN);
    if (!main) throw new Error('游客权限流程未初始化');
    const base = '/api/property-affairs';

    await request(app.getHttpServer()).get(base).expect(403);
    await request(app.getHttpServer()).get(`${base}/categories`).expect(403);
    await request(app.getHttpServer())
      .get(`${base}/responsible-users`)
      .expect(403);
    await request(app.getHttpServer()).get(`${base}/recycle-bin`).expect(403);
    await request(app.getHttpServer()).get(`${base}/${main.id}`).expect(403);
    await request(app.getHttpServer())
      .post(base)
      .send({ title: '无权创建', content: '无权创建' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`${base}/${main.id}`)
      .send({ version: main.version, title: '无权编辑' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/${main.id}/progress`)
      .send({ version: main.version, content: '无权追加' })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${base}/${main.id}`)
      .send({ version: main.version })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/${main.id}/restore`)
      .send({ version: main.version })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${base}/${main.id}/permanent`)
      .send({ version: main.version })
      .expect(403);
    await request(app.getHttpServer())
      .post(`${base}/${main.id}/files`)
      .attach('file', Buffer.from('denied'), 'denied.png')
      .expect(403);
    await request(app.getHttpServer())
      .get(`${base}/${main.id}/files/1/preview`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`${base}/${main.id}/files/1/download`)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`${base}/${main.id}/files/1`)
      .expect(403);

    const dashboard = await request(app.getHttpServer())
      .get('/api/dashboard')
      .expect(200);
    expect(dashboard.body.data.propertyAffairs).toEqual([]);
  });

  it('leaves linked business rows and finance totals byte/value-equivalent', async () => {
    expect(await businessSnapshot()).toBe(businessSnapshotBefore);
    expect(await financeSnapshot()).toBe(financeSnapshotBefore);
  });
});
