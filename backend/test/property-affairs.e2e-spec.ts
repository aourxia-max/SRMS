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
    if (prisma) {
      const remaining = await prisma.db.propertyAffair.findMany({
        where: { title: { startsWith: titlePrefix } },
        select: {
          id: true,
          files: { select: { fileAssetId: true } },
        },
      });
      const affairIds = remaining.map((item) => item.id);
      const releasedFileIds = remaining.flatMap((item) =>
        item.files.map((link) => link.fileAssetId),
      );
      affairIds.forEach((id) => createdAffairIds.add(id));
      if (affairIds.length) {
        await prisma.db.$transaction(async (tx) => {
          await tx.propertyAffairFile.deleteMany({
            where: { affairId: { in: affairIds } },
          });
          await tx.propertyAffairProgress.deleteMany({
            where: { affairId: { in: affairIds } },
          });
          await tx.propertyAffairBuilding.deleteMany({
            where: { affairId: { in: affairIds } },
          });
          await tx.propertyAffairRoom.deleteMany({
            where: { affairId: { in: affairIds } },
          });
          await tx.propertyAffairTenant.deleteMany({
            where: { affairId: { in: affairIds } },
          });
          await tx.propertyAffairContract.deleteMany({
            where: { affairId: { in: affairIds } },
          });
          await tx.propertyAffair.deleteMany({
            where: { id: { in: affairIds } },
          });
        });
      }
      if (releasedFileIds.length) {
        await files.cleanupReleasedPropertyAffairFiles(releasedFileIds);
      }
      const allCreatedIds = [...createdAffairIds];
      if (allCreatedIds.length) {
        await prisma.db.operationLog.deleteMany({
          where: {
            module: 'PROPERTY_AFFAIRS',
            entityId: { in: allCreatedIds },
          },
        });
      }
      if (contractId) {
        await prisma.db.contract.deleteMany({ where: { id: contractId } });
      }
      if (tenantId) {
        await prisma.db.tenant.deleteMany({ where: { id: tenantId } });
      }
      if (roomId) {
        await prisma.db.roomStatusHistory.deleteMany({ where: { roomId } });
        await prisma.db.room.deleteMany({ where: { id: roomId } });
      }
      if (buildingId) {
        await prisma.db.building.deleteMany({ where: { id: buildingId } });
      }
    }
    if (app) await app.close();
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
      expect(created.body).toMatchObject({
        code: 200,
        message: 'success',
        data: { id: expect.any(Number), version: 1, status: 'PENDING' },
      });
      const affairId = created.body.data.id as number;
      createdAffairIds.add(affairId);

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
      buildingIds: [buildingId],
      roomIds: [roomId],
      tenantIds: [tenantId],
      contractIds: [contractId],
    });

    for (const query of reverseRelationQueries()) {
      expect(await listContains(main.id, query)).toBe(true);
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
    expect(uploaded.body).toMatchObject({
      code: 200,
      message: 'success',
      data: {
        id: expect.any(Number),
        originalName: '现场 照片.png',
        mimeType: 'image/png',
      },
    });
    const fileId = uploaded.body.data.id as number;

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
