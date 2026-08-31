import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { AuthUser } from '../src/auth/auth-user.type';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';

const expectedCountKeys = [
  'contractChanges',
  'fixedRentRebates',
  'contractVoidRequests',
  'billAdjustments',
  'paymentRefunds',
  'paymentVoidRequests',
  'checkoutSettlements',
  'depositRefunds',
  'contractsTotal',
  'paymentsTotal',
  'checkoutsTotal',
  'total',
];

function loadLocalTestDatabaseEnvironment() {
  const candidates = [
    resolve(__dirname, '../../deploy/.env.test'),
    resolve(__dirname, '../../../../deploy/.env.test'),
  ];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) throw new Error('未找到本机测试环境配置');
  const mysql: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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
  if (required.some((name) => !mysql[name]))
    throw new Error('本机测试环境数据库配置不完整');
  const databaseUrl = new URL('mysql://127.0.0.1');
  databaseUrl.username = mysql.MYSQL_USER;
  databaseUrl.password = mysql.MYSQL_PASSWORD;
  databaseUrl.port = mysql.MYSQL_PORT;
  databaseUrl.pathname = `/${mysql.MYSQL_DATABASE}`;
  process.env.DATABASE_URL = databaseUrl.toString();
  process.env.NODE_ENV = 'test';
}

describe('approval task counts and contract remark authorization (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let currentUser: AuthUser | undefined;
  let superAdmin: AuthUser;
  let admin: AuthUser;
  let visitor: AuthUser;
  let contractId: number | undefined;
  let roomId: number | undefined;
  let buildingId: number | undefined;
  let createdOperatorId: number | undefined;
  const marker = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`.slice(-14);
  const contractNo = `E2E-BZ-${marker}`;

  beforeAll(async () => {
    loadLocalTestDatabaseEnvironment();
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET =
      'test-refresh-secret-at-least-32-characters';
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          if (!currentUser) throw new UnauthorizedException('请先登录');
          context.switchToHttp().getRequest<{ user?: AuthUser }>().user =
            currentUser;
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

    let operator = await prisma.db.user.findFirst({
      where: {
        role: UserRole.SUPER_ADMIN,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, username: true, displayName: true, role: true },
    });
    if (!operator) {
      operator = await prisma.db.user.create({
        data: {
          username: `e2e-remark-${marker}`,
          passwordHash: 'e2e-not-used-for-login',
          displayName: '合同备注 E2E',
          role: UserRole.SUPER_ADMIN,
          status: 'ACTIVE',
        },
        select: { id: true, username: true, displayName: true, role: true },
      });
      createdOperatorId = operator.id;
    }
    superAdmin = operator;
    admin = { ...operator, role: UserRole.ADMIN };
    visitor = { ...operator, role: UserRole.VISITOR };
    currentUser = superAdmin;

    const building = await prisma.db.building.create({
      data: {
        buildingNo: `BZ${marker}`.slice(0, 20),
        buildingName: `合同备注验收-${marker}`,
        floorCount: 1,
        remark: 'E2E 测试专用，结束后自动清理',
      },
    });
    buildingId = building.id;
    const room = await prisma.db.room.create({
      data: {
        buildingId: building.id,
        houseNo: '101',
        fullHouseNo: `${building.buildingNo}栋101`,
        floorNo: 1,
        roomType: 'RESIDENTIAL',
        area: new Prisma.Decimal('50.00'),
        usageType: 'RESIDENCE',
        roomStatus: 'EMPTY',
        remark: 'E2E 测试专用，结束后自动清理',
      },
    });
    roomId = room.id;
    const contract = await prisma.db.contract.create({
      data: {
        contractNo,
        roomId: room.id,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        monthlyRent: new Prisma.Decimal('1000.00'),
        pricingMode: 'FIXED',
        depositRequired: new Prisma.Decimal('0.00'),
        status: 'ENDED',
      },
    });
    contractId = contract.id;
  });

  afterAll(async () => {
    if (prisma) {
      if (contractId) {
        await prisma.db.operationLog.deleteMany({
          where: {
            module: 'CONTRACT',
            action: 'UPDATE_CONTRACT_REMARK',
            entityId: contractId,
          },
        });
        await prisma.db.contract.deleteMany({ where: { id: contractId } });
      }
      if (roomId) {
        await prisma.db.roomStatusHistory.deleteMany({ where: { roomId } });
        await prisma.db.room.deleteMany({ where: { id: roomId } });
      }
      if (buildingId)
        await prisma.db.building.deleteMany({ where: { id: buildingId } });
      if (createdOperatorId)
        await prisma.db.user.deleteMany({ where: { id: createdOperatorId } });
      const residue = await Promise.all([
        prisma.db.contract.count({ where: { contractNo } }),
        prisma.db.building.count({
          where: { buildingName: { startsWith: '合同备注验收-' } },
        }),
        prisma.db.operationLog.count({
          where: {
            action: 'UPDATE_CONTRACT_REMARK',
            entityNo: contractNo,
          },
        }),
      ]);
      expect(residue).toEqual([0, 0, 0]);
    }
    if (app) await app.close();
  });

  it('requires authentication for approval counts', async () => {
    currentUser = undefined;
    await request(app.getHttpServer())
      .get('/api/approval-tasks/counts')
      .expect(401);
  });

  it('returns only authoritative integer counts to an administrator', async () => {
    currentUser = admin;
    await request(app.getHttpServer())
      .get('/api/approval-tasks/counts')
      .expect(200)
      .expect(({ body }) => {
        expect(Object.keys(body.data).sort()).toEqual(
          [...expectedCountKeys].sort(),
        );
        expect(Object.values(body.data)).toEqual(
          expect.arrayContaining([expect.any(Number)]),
        );
        expect(
          Object.values(body.data).every(
            (value) => Number.isInteger(value) && Number(value) >= 0,
          ),
        ).toBe(true);
        expect(JSON.stringify(body.data)).not.toMatch(
          /tenant|room|amount|contractNo/i,
        );
      });
  });

  it('returns zero counts without database detail to a visitor', async () => {
    currentUser = visitor;
    await request(app.getHttpServer())
      .get('/api/approval-tasks/counts')
      .expect(200)
      .expect(({ body }) => {
        expect(Object.keys(body.data).sort()).toEqual(
          [...expectedCountKeys].sort(),
        );
        expect(Object.values(body.data).every((value) => value === 0)).toBe(
          true,
        );
      });
  });

  it('forbids visitors from modifying contract remarks', async () => {
    currentUser = visitor;
    await request(app.getHttpServer())
      .patch(`/api/contracts/${contractId}/remark`)
      .send({ remark: '无权修改' })
      .expect(403);
  });

  it('trims, clears and audits an ended-contract remark for an administrator', async () => {
    currentUser = admin;
    await request(app.getHttpServer())
      .patch(`/api/contracts/${contractId}/remark`)
      .send({ remark: '  验收备注  ' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: contractId,
          remark: '验收备注',
        });
        expect(Object.keys(body.data).sort()).toEqual(
          ['id', 'remark', 'updatedAt'].sort(),
        );
      });
    await expect(
      prisma.db.operationLog.findFirst({
        where: {
          action: 'UPDATE_CONTRACT_REMARK',
          entityId: contractId,
        },
        orderBy: { id: 'desc' },
      }),
    ).resolves.toMatchObject({
      module: 'CONTRACT',
      entityNo: contractNo,
      beforeData: { remark: null },
      afterData: { remark: '验收备注' },
      operatorId: admin.id,
      operatorRole: admin.role,
    });

    await request(app.getHttpServer())
      .patch(`/api/contracts/${contractId}/remark`)
      .send({ remark: '   ' })
      .expect(200)
      .expect(({ body }) => expect(body.data.remark).toBeNull());
  });

  it('keeps a voided contract sealed', async () => {
    await prisma.db.contract.update({
      where: { id: contractId },
      data: { status: 'VOIDED', remark: '封存备注' },
    });
    currentUser = superAdmin;
    await request(app.getHttpServer())
      .patch(`/api/contracts/${contractId}/remark`)
      .send({ remark: '不能保存' })
      .expect(400)
      .expect(({ body }) =>
        expect(JSON.stringify(body)).toContain('已作废合同不能修改备注'),
      );
    await expect(
      prisma.db.contract.findUnique({
        where: { id: contractId },
        select: { remark: true },
      }),
    ).resolves.toEqual({ remark: '封存备注' });
  });
});
