import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';
import type { AuthUser } from '../src/auth/auth-user.type';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { AppModule } from '../src/app.module';

describe('contract deposit auto-receipt (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let currentUser: AuthUser | undefined;
  const marker = Date.now().toString().slice(-10);
  const buildingNo = `E2EYJ${marker}`;
  const externalContractNo = `E2E-DEPOSIT-${marker}`;
  let buildingId: number | undefined;
  let roomId: number | undefined;
  let tenantId: number | undefined;
  let contractId: number | undefined;

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
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const operator = await prisma.db.user.findFirst({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        role: true,
        username: true,
        displayName: true,
      },
    });
    if (!operator) throw new Error('测试库中没有可用的超级管理员');
    currentUser = operator;

    const building = await prisma.db.building.create({
      data: {
        buildingNo,
        buildingName: 'E2E 押金自动入账测试楼栋',
        floorCount: 1,
        remark: '测试专用，E2E 结束后自动清理',
      },
    });
    buildingId = building.id;
    const room = await prisma.db.room.create({
      data: {
        buildingId: building.id,
        houseNo: '101',
        fullHouseNo: `${buildingNo}栋101`,
        floorNo: 1,
        roomType: 'RESIDENTIAL',
        area: new Prisma.Decimal('50.00'),
        usageType: 'RESIDENCE',
        roomStatus: 'EMPTY',
        remark: '测试专用，E2E 结束后自动清理',
      },
    });
    roomId = room.id;
    const tenant = await prisma.db.tenant.create({
      data: {
        name: `E2E押金租户${marker}`,
        remark: '测试专用，E2E 结束后自动清理',
      },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.db.$transaction(async (tx) => {
        const contract = await tx.contract.findFirst({
          where: { externalContractNo },
          select: { id: true },
        });
        if (contract) {
          await tx.depositTransaction.deleteMany({
            where: { contractId: contract.id },
          });
          await tx.paymentAllocation.deleteMany({
            where: { payment: { contractId: contract.id } },
          });
          await tx.payment.deleteMany({ where: { contractId: contract.id } });
          await tx.rentBill.deleteMany({ where: { contractId: contract.id } });
          await tx.contractMember.deleteMany({
            where: { contractId: contract.id },
          });
          await tx.contract.delete({ where: { id: contract.id } });
        }
        if (roomId) {
          await tx.roomStatusHistory.deleteMany({ where: { roomId } });
        }
        if (tenantId) {
          await tx.tenant.deleteMany({ where: { id: tenantId } });
        }
        if (roomId) {
          await tx.room.deleteMany({ where: { id: roomId } });
        }
        if (buildingId) {
          await tx.building.deleteMany({ where: { id: buildingId } });
        }
      });
    }
    if (app) await app.close();
  });

  it('creates exactly one confirmed automatic deposit receipt and ledger row', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/contracts/fixed')
      .send({
        externalContractNo,
        roomId,
        startDate: '2030-01-01',
        endDate: '2030-01-31',
        monthlyRent: '1000.00',
        paymentCycleMonths: 1,
        depositRequired: '10000.00',
        primaryTenantId: tenantId,
        remark: '测试专用，E2E 结束后自动清理',
      })
      .expect(201);

    expect(createResponse.body).toMatchObject({
      code: 200,
      message: 'success',
      data: { id: expect.any(Number) },
    });
    expect(
      new Prisma.Decimal(createResponse.body.data.depositRequired).toFixed(2),
    ).toBe('10000.00');
    contractId = createResponse.body.data.id as number;

    const depositResponse = await request(app.getHttpServer())
      .get('/api/deposits')
      .query({ contractId })
      .expect(200);
    expect(depositResponse.body).toMatchObject({
      code: 200,
      message: 'success',
      data: {
        items: [
          {
            contractId,
            transactionType: 'RECEIPT',
          },
        ],
      },
    });
    expect(depositResponse.body.data.items).toHaveLength(1);
    expect(
      new Prisma.Decimal(depositResponse.body.data.balance).toFixed(2),
    ).toBe('10000.00');
    expect(
      new Prisma.Decimal(depositResponse.body.data.items[0].amount).toFixed(2),
    ).toBe('10000.00');
    expect(
      new Prisma.Decimal(
        depositResponse.body.data.items[0].balanceAfter,
      ).toFixed(2),
    ).toBe('10000.00');

    const payments = await prisma.db.payment.findMany({
      where: {
        contractId,
        autoSourceKey: `CONTRACT_INITIAL_DEPOSIT:${contractId}`,
      },
      include: { allocations: true },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      paymentCategory: 'DEPOSIT',
      method: 'SYSTEM_AUTO',
      status: 'CONFIRMED',
    });
    expect(payments[0].amount.toFixed(2)).toBe('10000.00');
    expect(payments[0].allocations).toHaveLength(0);
  });
});
