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
import { ContractsService } from '../src/contracts/contracts.service';
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
  const gateExternalContractNos = [
    `E2E-ROOM-GATE-A-${marker}`,
    `E2E-ROOM-GATE-B-${marker}`,
  ];
  let gateRoomId: number | undefined;
  const gateTenantIds: number[] = [];
  let createdOperatorId: number | undefined;

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

    let operator = await prisma.db.user.findFirst({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE', deletedAt: null },
      select: {
        id: true,
        role: true,
        username: true,
        displayName: true,
      },
    });
    if (!operator) {
      operator = await prisma.db.user.create({
        data: {
          username: `e2e-fixed-gate-${marker}`,
          passwordHash: 'e2e-not-used-for-login',
          displayName: '固定合同门闩 E2E',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        },
        select: {
          id: true,
          role: true,
          username: true,
          displayName: true,
        },
      });
      createdOperatorId = operator.id;
    }
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
        const gateContracts = await tx.contract.findMany({
          where: { externalContractNo: { in: gateExternalContractNos } },
          select: { id: true },
        });
        const gateContractIds = gateContracts.map(({ id }) => id);
        if (gateContractIds.length) {
          await tx.depositTransaction.deleteMany({
            where: { contractId: { in: gateContractIds } },
          });
          await tx.paymentAllocation.deleteMany({
            where: { payment: { contractId: { in: gateContractIds } } },
          });
          await tx.payment.deleteMany({
            where: { contractId: { in: gateContractIds } },
          });
          await tx.rentBill.deleteMany({
            where: { contractId: { in: gateContractIds } },
          });
          await tx.contractMember.deleteMany({
            where: { contractId: { in: gateContractIds } },
          });
          await tx.contract.deleteMany({
            where: { id: { in: gateContractIds } },
          });
        }
        if (gateRoomId) {
          await tx.roomStatusHistory.deleteMany({
            where: { roomId: gateRoomId },
          });
        }
        if (gateTenantIds.length) {
          await tx.tenant.deleteMany({
            where: { id: { in: gateTenantIds } },
          });
        }
        if (gateRoomId) {
          await tx.room.deleteMany({ where: { id: gateRoomId } });
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
        if (createdOperatorId) {
          await tx.user.deleteMany({ where: { id: createdOperatorId } });
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

  it('allows only one of two concurrent fixed confirmations for the same room', async () => {
    if (!buildingId || !currentUser)
      throw new Error('并发合同门闩 E2E 基础数据未初始化');

    const room = await prisma.db.room.create({
      data: {
        buildingId,
        houseNo: '102',
        fullHouseNo: `${buildingNo}栋102`,
        floorNo: 1,
        roomType: 'RESIDENTIAL',
        area: new Prisma.Decimal('50.00'),
        usageType: 'RESIDENCE',
        roomStatus: 'EMPTY',
        remark: '合同确认同房并发门闩 E2E，结束后自动清理',
      },
    });
    gateRoomId = room.id;
    for (const label of ['甲', '乙']) {
      const tenant = await prisma.db.tenant.create({
        data: {
          name: `合同确认门闩E2E租户${marker}${label}`,
          remark: '合同确认同房并发门闩 E2E，结束后自动清理',
        },
      });
      gateTenantIds.push(tenant.id);
    }

    let releaseConflictGate!: () => void;
    const conflictGate = new Promise<void>((resolve) => {
      releaseConflictGate = resolve;
    });
    let conflictArrivals = 0;
    const originalTransaction = prisma.db.$transaction.bind(prisma.db);
    const transactionSpy = jest
      .spyOn(prisma.db, '$transaction')
      .mockImplementation((callback: unknown, options?: unknown) => {
        if (typeof callback !== 'function')
          throw new Error('并发合同门闩 E2E 仅支持交互式事务');
        return originalTransaction(async (tx) => {
          let roomLockObserved = false;
          const originalQueryRaw = tx.$queryRaw.bind(tx) as (
            ...args: unknown[]
          ) => Promise<unknown>;
          const wrappedQueryRaw = async (...args: unknown[]) => {
            const sql = args[0] as { strings?: readonly string[] } | undefined;
            const statement = sql?.strings?.join('?') ?? '';
            if (
              statement.includes('FROM rooms') &&
              statement.includes('FOR UPDATE')
            ) {
              roomLockObserved = true;
            }
            return originalQueryRaw(...args);
          };
          const contract = new Proxy(tx.contract, {
            get(target, property, receiver) {
              if (property !== 'findFirst')
                return Reflect.get(target, property, receiver) as unknown;
              return async (args: { where?: { roomId?: number } }) => {
                const result = await target.findFirst(args);
                if (!roomLockObserved && args.where?.roomId === gateRoomId) {
                  conflictArrivals += 1;
                  if (conflictArrivals === 2) releaseConflictGate();
                  await conflictGate;
                }
                return result;
              };
            },
          });
          const wrapped = new Proxy(tx, {
            get(target, property, receiver) {
              if (property === '$queryRaw') return wrappedQueryRaw;
              if (property === 'contract') return contract;
              return Reflect.get(target, property, receiver) as unknown;
            },
          });
          const run = callback as (client: typeof tx) => Promise<unknown>;
          return await run(wrapped);
        }, options as never);
      });

    const contracts = app.get(ContractsService);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let outcomes: PromiseSettledResult<unknown>[];
    try {
      outcomes = await Promise.race([
        Promise.allSettled(
          gateTenantIds.map((primaryTenantId, index) =>
            contracts.createFixedContract(
              {
                externalContractNo: gateExternalContractNos[index],
                roomId: room.id,
                startDate: new Date('2031-01-01T00:00:00.000Z'),
                endDate: new Date('2031-01-31T00:00:00.000Z'),
                monthlyRent: '1000.00',
                paymentCycleMonths: 1,
                depositRequired: '0.00',
                primaryTenantId,
                remark: '合同确认同房并发门闩 E2E，结束后自动清理',
              },
              currentUser,
            ),
          ),
        ),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error('同房合同并发确认超时')),
            10000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      transactionSpy.mockRestore();
    }

    const fulfilledCount = outcomes.filter(
      ({ status }) => status === 'fulfilled',
    ).length;
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    const conflictMessage =
      rejected?.status === 'rejected'
        ? (rejected.reason as { message?: unknown })?.message
        : undefined;
    const storedCount = await prisma.db.contract.count({
      where: { externalContractNo: { in: gateExternalContractNos } },
    });
    expect({ fulfilledCount, conflictMessage, storedCount }).toEqual({
      fulfilledCount: 1,
      conflictMessage: '该房源在合同租期内已有有效合同',
      storedCount: 1,
    });
  }, 20000);
});
