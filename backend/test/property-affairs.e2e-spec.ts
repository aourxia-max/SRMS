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
import { SecurityAuditChainService } from '../src/system/security-audit-chain.service';
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
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.every((number) => /^WY\d{12}$/.test(number))).toBe(true);
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
