import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, UserRole } from '@prisma/client';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { AuthUser } from '../src/auth/auth-user.type';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { assertContractVoidMutationDatabaseSafety } from './support/contract-void-mutation-database-guard';

type SourceIds = {
  bills: number[];
  payments: number[];
  allocations: number[];
  deposits: number[];
  prepayments: number[];
  checkouts: number[];
};

type AllocationSource = {
  id: number;
  paymentId: number;
  rentBillId: number;
  allocatedAmount: string;
  reversedAmount: string;
  allocationType: string;
};

type ExpectedReversal = {
  category: string;
  originalEntityType: string;
  originalEntityId: number;
  amount: string;
  balanceBefore: string | null;
  balanceAfter: string | null;
  generatedEntityType: string | null;
};

type CleanupEntry = {
  label: string;
  buildingIds: number[];
  roomIds: number[];
  tenantIds: number[];
  contractIds: number[];
};

type ScenarioFixture = {
  sequence: number;
  label: string;
  buildingId: number;
  roomId: number;
  tenantIds: number[];
  contractIds: number[];
  contractId: number;
  contractNo: string;
  tenantName: string;
  roomKeyword: string;
  roomStatusBefore: string;
  successorContractId?: number;
  sources: SourceIds;
  allocationSources: AllocationSource[];
  expectedReversals: ExpectedReversal[];
  expectedCurrentNetImpact: string;
  cleanup: CleanupEntry;
};

type CompletedScenario = {
  fixture: ScenarioFixture;
  requestId: number;
  requestNo: string;
};

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
    process.env[match[1]] = value;
  }
  const required = [
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_DATABASE',
    'MYSQL_PORT',
  ];
  const missing = required.filter((name) => !mysql[name]);
  if (missing.length) {
    throw new Error(`隔离测试库配置缺少变量：${missing.join('、')}`);
  }
  const databaseUrl = new URL('mysql://127.0.0.1');
  databaseUrl.username = mysql.MYSQL_USER;
  databaseUrl.password = mysql.MYSQL_PASSWORD;
  databaseUrl.port = mysql.MYSQL_PORT;
  databaseUrl.pathname = `/${mysql.MYSQL_DATABASE}`;
  assertContractVoidMutationDatabaseSafety(
    databaseUrl.toString(),
    process.env.CONTRACT_VOID_MUTATION_PROOF === '1',
  );
  process.env.DATABASE_URL = databaseUrl.toString();
  process.env.NODE_ENV = 'test';
}

function collectBinaryResponse(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body: unknown) => void,
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

describe('contract void correction API and financial invariants (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let currentUser: AuthUser | undefined;
  let visitor: AuthUser;
  let admin: AuthUser;
  let superAdmin: AuthUser;
  let sequence = 0;
  const cleanupRegistry: CleanupEntry[] = [];
  const completed: CompletedScenario[] = [];
  const marker = `${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`.slice(-14);
  const prefix = `合同纠错测试-Task10-${marker}`;

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
    const operator = await prisma.db.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN, status: 'ACTIVE', deletedAt: null },
      select: { id: true, username: true, displayName: true, role: true },
    });
    if (!operator) throw new Error('隔离测试库中没有可用的超级管理员');
    superAdmin = operator;
    admin = { ...operator, role: UserRole.ADMIN };
    visitor = { ...operator, role: UserRole.VISITOR };
    currentUser = superAdmin;
  });

  afterAll(async () => {
    if (prisma) {
      for (const entry of cleanupRegistry) await cleanupEntry(entry);
    }
    if (app) await app.close();
  });

  function registerCleanup(label: string): CleanupEntry {
    const entry = {
      label,
      buildingIds: [],
      roomIds: [],
      tenantIds: [],
      contractIds: [],
    };
    cleanupRegistry.push(entry);
    return entry;
  }

  function nextCode() {
    sequence += 1;
    return `${marker}${sequence.toString().padStart(2, '0')}`;
  }

  async function createLocation(label: string, roomStatus: 'EMPTY' | 'RENTED') {
    const cleanup = registerCleanup(label);
    const code = nextCode();
    const building = await prisma.db.building.create({
      data: {
        buildingNo: `CV10${code}`.slice(0, 20),
        buildingName: `${prefix}-${label}`,
        floorCount: 1,
        remark: `${prefix}-可清理fixture`,
      },
    });
    cleanup.buildingIds.push(building.id);
    const roomKeyword = `CV10${code}室`;
    const room = await prisma.db.room.create({
      data: {
        buildingId: building.id,
        houseNo: '101',
        fullHouseNo: roomKeyword,
        floorNo: 1,
        roomType: 'RESIDENTIAL',
        area: new Prisma.Decimal('50.00'),
        usageType: 'RESIDENCE',
        roomStatus,
        remark: `${prefix}-${label}`,
      },
    });
    cleanup.roomIds.push(room.id);
    const tenantName = `${prefix}-${label}-租户`;
    const tenant = await prisma.db.tenant.create({
      data: { name: tenantName, remark: `${prefix}-可清理fixture` },
    });
    cleanup.tenantIds.push(tenant.id);
    return { code, building, room, tenant, tenantName, roomKeyword, cleanup };
  }

  async function sourceIds(contractId: number): Promise<SourceIds> {
    const [bills, payments, allocations, deposits, prepayments, checkouts] =
      await Promise.all([
        prisma.db.rentBill.findMany({
          where: { contractId },
          select: { id: true },
          orderBy: { id: 'asc' },
        }),
        prisma.db.payment.findMany({
          where: { contractId },
          select: { id: true },
          orderBy: { id: 'asc' },
        }),
        prisma.db.paymentAllocation.findMany({
          where: { payment: { contractId } },
          select: { id: true },
          orderBy: { id: 'asc' },
        }),
        prisma.db.depositTransaction.findMany({
          where: { contractId },
          select: { id: true },
          orderBy: { id: 'asc' },
        }),
        prisma.db.prepaymentTransaction.findMany({
          where: { contractId },
          select: { id: true },
          orderBy: { id: 'asc' },
        }),
        prisma.db.checkoutSettlement.findMany({
          where: { contractId },
          select: { id: true },
          orderBy: { id: 'asc' },
        }),
      ]);
    return {
      bills: bills.map(({ id }) => id),
      payments: payments.map(({ id }) => id),
      allocations: allocations.map(({ id }) => id),
      deposits: deposits.map(({ id }) => id),
      prepayments: prepayments.map(({ id }) => id),
      checkouts: checkouts.map(({ id }) => id),
    };
  }

  async function loadAllocationSources(
    allocationIds: number[],
  ): Promise<AllocationSource[]> {
    if (!allocationIds.length) return [];
    const allocations = await prisma.db.paymentAllocation.findMany({
      where: { id: { in: allocationIds } },
      select: {
        id: true,
        paymentId: true,
        rentBillId: true,
        allocatedAmount: true,
        reversedAmount: true,
        allocationType: true,
      },
      orderBy: { id: 'asc' },
    });
    return allocations.map((allocation) => ({
      id: allocation.id,
      paymentId: allocation.paymentId,
      rentBillId: allocation.rentBillId,
      allocatedAmount: allocation.allocatedAmount.toFixed(2),
      reversedAmount: allocation.reversedAmount.toFixed(2),
      allocationType: allocation.allocationType,
    }));
  }

  async function createDirectContract(input: {
    label: string;
    roomStatus: 'EMPTY' | 'RENTED';
    contractStatus: 'ACTIVE' | 'ENDED';
    billStatus: 'PENDING' | 'PAID';
    billAmount: string;
    expectedCurrentNetImpact: string;
    withPayment?: boolean;
    withCompletedCheckout?: boolean;
    withSuccessor?: boolean;
  }): Promise<ScenarioFixture> {
    const location = await createLocation(input.label, input.roomStatus);
    const contractNo = `CV10-HT-${location.code}`;
    const contract = await prisma.db.contract.create({
      data: {
        contractNo,
        externalContractNo: `CV10-EXT-${location.code}`,
        roomId: location.room.id,
        startDate: new Date('2025-01-01T00:00:00.000Z'),
        endDate: new Date('2025-12-31T00:00:00.000Z'),
        monthlyRent: new Prisma.Decimal(input.billAmount),
        pricingMode: 'FIXED',
        paymentCycleMonths: 1,
        depositRequired: new Prisma.Decimal('0.00'),
        status: input.contractStatus,
        activatedAt: new Date('2025-01-01T00:00:00.000Z'),
        billingGeneratedAt: new Date('2025-01-01T00:00:00.000Z'),
        remark: `${prefix}-${input.label}`,
        members: {
          create: {
            tenantId: location.tenant.id,
            memberRole: 'PRIMARY',
          },
        },
      },
    });
    location.cleanup.contractIds.push(contract.id);
    const bill = await prisma.db.rentBill.create({
      data: {
        billNo: `CV10-ZD-${location.code}`,
        contractId: contract.id,
        periodSeq: 1,
        periodStart: new Date('2025-01-01T00:00:00.000Z'),
        periodEnd: new Date('2025-01-31T00:00:00.000Z'),
        dueDate: new Date('2025-01-01T00:00:00.000Z'),
        unitMonthlyRent: new Prisma.Decimal(input.billAmount),
        baseRentAmount: new Prisma.Decimal(input.billAmount),
        payableAmount: new Prisma.Decimal(input.billAmount),
        receivedAmount: new Prisma.Decimal(
          input.billStatus === 'PAID' ? input.billAmount : '0.00',
        ),
        outstandingAmount: new Prisma.Decimal(
          input.billStatus === 'PAID' ? '0.00' : input.billAmount,
        ),
        status: input.billStatus,
      },
    });
    let paymentId: number | undefined;
    let allocationId: number | undefined;
    let checkoutId: number | undefined;
    if (input.withPayment) {
      const payment = await prisma.db.payment.create({
        data: {
          receiptNo: `CV10-SK-${location.code}`.slice(0, 40),
          contractId: contract.id,
          paymentCategory: 'RENT',
          paymentDate: new Date('2025-01-02T00:00:00.000Z'),
          amount: new Prisma.Decimal(input.billAmount),
          method: 'CASH',
          operatorId: superAdmin.id,
          status: 'CONFIRMED',
          remark: `${prefix}-${input.label}`,
        },
      });
      paymentId = payment.id;
      const allocation = await prisma.db.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          rentBillId: bill.id,
          allocatedAmount: new Prisma.Decimal(input.billAmount),
        },
      });
      allocationId = allocation.id;
    }
    if (input.withCompletedCheckout) {
      const checkout = await prisma.db.checkoutSettlement.create({
        data: {
          settlementNo: `CV10-TZ-${location.code}`.slice(0, 40),
          contractId: contract.id,
          checkoutType: '正常退租',
          originContractStatus: 'ACTIVE',
          plannedCheckoutDate: new Date('2025-12-31T00:00:00.000Z'),
          actualCheckoutDate: new Date('2025-12-31T00:00:00.000Z'),
          handoverDate: new Date('2025-12-31T00:00:00.000Z'),
          checkoutReason: `${prefix}-已完成退租`,
          rentReceivable: new Prisma.Decimal(input.billAmount),
          rentReceived: new Prisma.Decimal(input.billAmount),
          targetRoomStatus: 'EMPTY',
          status: 'COMPLETED',
          submittedBy: superAdmin.id,
          submittedAt: new Date('2025-12-31T00:00:00.000Z'),
          approvedBy: superAdmin.id,
          approvedAt: new Date('2025-12-31T00:00:00.000Z'),
          remark: `${prefix}-必须保留的历史来源`,
        },
      });
      checkoutId = checkout.id;
    }
    const tenantIds = [...location.cleanup.tenantIds];
    const contractIds = [...location.cleanup.contractIds];
    let successorContractId: number | undefined;
    if (input.withSuccessor) {
      const successorTenant = await prisma.db.tenant.create({
        data: {
          name: `${prefix}-${input.label}-后续租户`,
          remark: `${prefix}-后续合同`,
        },
      });
      location.cleanup.tenantIds.push(successorTenant.id);
      tenantIds.push(successorTenant.id);
      const successor = await prisma.db.contract.create({
        data: {
          contractNo: `CV10-HX-${location.code}`,
          roomId: location.room.id,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2027-12-31T00:00:00.000Z'),
          monthlyRent: new Prisma.Decimal('500.00'),
          pricingMode: 'FIXED',
          paymentCycleMonths: 1,
          depositRequired: new Prisma.Decimal('0.00'),
          status: 'ACTIVE',
          activatedAt: new Date('2026-01-01T00:00:00.000Z'),
          remark: `${prefix}-后续ACTIVE合同`,
          members: {
            create: {
              tenantId: successorTenant.id,
              memberRole: 'PRIMARY',
            },
          },
        },
      });
      location.cleanup.contractIds.push(successor.id);
      successorContractId = successor.id;
      contractIds.push(successor.id);
    }
    const sources = await sourceIds(contract.id);
    const allocationSources = await loadAllocationSources(sources.allocations);
    const expectedReversals: ExpectedReversal[] = [
      {
        category: 'RENT_BILL',
        originalEntityType: 'RentBill',
        originalEntityId: bill.id,
        amount: `-${input.billAmount}`,
        balanceBefore: input.billAmount,
        balanceAfter: '0.00',
        generatedEntityType: null,
      },
    ];
    if (paymentId) {
      expectedReversals.push({
        category: 'PAYMENT',
        originalEntityType: 'Payment',
        originalEntityId: paymentId,
        amount: `-${input.billAmount}`,
        balanceBefore: input.billAmount,
        balanceAfter: '0.00',
        generatedEntityType: null,
      });
    }
    if (allocationId) {
      expectedReversals.push({
        category: 'PAYMENT_ALLOCATION',
        originalEntityType: 'PaymentAllocation',
        originalEntityId: allocationId,
        amount: `-${input.billAmount}`,
        balanceBefore: input.billAmount,
        balanceAfter: '0.00',
        generatedEntityType: null,
      });
    }
    if (checkoutId) {
      expectedReversals.push({
        category: 'CHECKOUT',
        originalEntityType: 'CheckoutSettlement',
        originalEntityId: checkoutId,
        amount: '0.00',
        balanceBefore: null,
        balanceAfter: null,
        generatedEntityType: null,
      });
    }
    expectedReversals.push({
      category: 'ROOM_STATUS',
      originalEntityType: 'Room',
      originalEntityId: location.room.id,
      amount: '0.00',
      balanceBefore: null,
      balanceAfter: null,
      generatedEntityType: null,
    });
    const fixture: ScenarioFixture = {
      sequence,
      label: input.label,
      buildingId: location.building.id,
      roomId: location.room.id,
      tenantIds,
      contractIds,
      contractId: contract.id,
      contractNo,
      tenantName: location.tenantName,
      roomKeyword: location.roomKeyword,
      roomStatusBefore: input.roomStatus,
      successorContractId,
      sources,
      allocationSources,
      expectedReversals,
      expectedCurrentNetImpact: input.expectedCurrentNetImpact,
      cleanup: location.cleanup,
    };
    return fixture;
  }

  async function createPaidAutoDepositFixture(): Promise<ScenarioFixture> {
    const label = '已收加自动押金';
    const location = await createLocation(label, 'EMPTY');
    currentUser = superAdmin;
    const response = await request(app.getHttpServer())
      .post('/api/contracts/fixed')
      .send({
        externalContractNo: `CV10-AUTO-${location.code}`,
        roomId: location.room.id,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        monthlyRent: '100.00',
        paymentCycleMonths: 1,
        depositRequired: '50.00',
        primaryTenantId: location.tenant.id,
        remark: `${prefix}-${label}`,
      })
      .expect(201);
    const contractId = response.body.data.id as number;
    location.cleanup.contractIds.push(contractId);
    const contract = await prisma.db.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: { contractNo: true },
    });
    const autoDepositPayment = await prisma.db.payment.findUniqueOrThrow({
      where: { autoSourceKey: `CONTRACT_INITIAL_DEPOSIT:${contractId}` },
      select: {
        id: true,
        contractId: true,
        paymentCategory: true,
        amount: true,
        method: true,
        autoSourceKey: true,
        status: true,
      },
    });
    expect({
      contractId: autoDepositPayment.contractId,
      purpose: autoDepositPayment.paymentCategory,
      amount: autoDepositPayment.amount.toFixed(2),
      origin: autoDepositPayment.method,
      source: autoDepositPayment.autoSourceKey,
      status: autoDepositPayment.status,
    }).toEqual({
      contractId,
      purpose: 'DEPOSIT',
      amount: '50.00',
      origin: 'SYSTEM_AUTO',
      source: `CONTRACT_INITIAL_DEPOSIT:${contractId}`,
      status: 'CONFIRMED',
    });
    const autoDepositTransaction =
      await prisma.db.depositTransaction.findFirstOrThrow({
        where: { contractId, paymentId: autoDepositPayment.id },
        select: {
          id: true,
          paymentId: true,
          transactionType: true,
          amount: true,
          balanceAfter: true,
        },
      });
    expect({
      paymentId: autoDepositTransaction.paymentId,
      transactionType: autoDepositTransaction.transactionType,
      amount: autoDepositTransaction.amount.toFixed(2),
      balanceAfter: autoDepositTransaction.balanceAfter.toFixed(2),
    }).toEqual({
      paymentId: autoDepositPayment.id,
      transactionType: 'RECEIPT',
      amount: '50.00',
      balanceAfter: '50.00',
    });
    const bill = await prisma.db.rentBill.findFirstOrThrow({
      where: { contractId },
      orderBy: { id: 'asc' },
    });
    const rentPayment = await prisma.db.payment.create({
      data: {
        receiptNo: `CV10-RS-${location.code}`.slice(0, 40),
        contractId,
        paymentCategory: 'RENT',
        paymentDate: new Date('2026-08-02T00:00:00.000Z'),
        amount: new Prisma.Decimal('100.00'),
        method: 'CASH',
        operatorId: superAdmin.id,
        status: 'CONFIRMED',
        remark: `${prefix}-已收租金`,
      },
    });
    const rentAllocation = await prisma.db.paymentAllocation.create({
      data: {
        paymentId: rentPayment.id,
        rentBillId: bill.id,
        allocatedAmount: new Prisma.Decimal('100.00'),
      },
    });
    await prisma.db.rentBill.update({
      where: { id: bill.id },
      data: {
        receivedAmount: new Prisma.Decimal('100.00'),
        outstandingAmount: new Prisma.Decimal('0.00'),
        status: 'PAID',
      },
    });
    const prepayment = await prisma.db.payment.create({
      data: {
        receiptNo: `CV10-YS-${location.code}`.slice(0, 40),
        contractId,
        paymentCategory: 'PREPAYMENT',
        paymentDate: new Date('2026-08-03T00:00:00.000Z'),
        amount: new Prisma.Decimal('25.00'),
        method: 'CASH',
        operatorId: superAdmin.id,
        status: 'CONFIRMED',
        remark: `${prefix}-预收款余额`,
      },
    });
    const prepaymentTransaction = await prisma.db.prepaymentTransaction.create({
      data: {
        contractId,
        transactionNo: `CV10-YSLS-${location.code}`.slice(0, 40),
        transactionType: 'CREDIT_RECEIPT',
        amount: new Prisma.Decimal('25.00'),
        balanceAfter: new Prisma.Decimal('25.00'),
        paymentId: prepayment.id,
        reason: `${prefix}-预收款余额`,
        occurredAt: new Date('2026-08-03T00:00:00.000Z'),
      },
    });
    const sources = await sourceIds(contractId);
    expect(sources.allocations).toEqual([rentAllocation.id]);
    expect(sources.deposits).toEqual([autoDepositTransaction.id]);
    expect(sources.prepayments).toEqual([prepaymentTransaction.id]);
    const allocationSources = await loadAllocationSources(sources.allocations);
    const expectedReversals: ExpectedReversal[] = [
      {
        category: 'RENT_BILL',
        originalEntityType: 'RentBill',
        originalEntityId: bill.id,
        amount: '-100.00',
        balanceBefore: '100.00',
        balanceAfter: '0.00',
        generatedEntityType: null,
      },
      {
        category: 'PAYMENT',
        originalEntityType: 'Payment',
        originalEntityId: autoDepositPayment.id,
        amount: '-50.00',
        balanceBefore: '50.00',
        balanceAfter: '0.00',
        generatedEntityType: null,
      },
      {
        category: 'PAYMENT',
        originalEntityType: 'Payment',
        originalEntityId: rentPayment.id,
        amount: '-100.00',
        balanceBefore: '100.00',
        balanceAfter: '0.00',
        generatedEntityType: null,
      },
      {
        category: 'PAYMENT',
        originalEntityType: 'Payment',
        originalEntityId: prepayment.id,
        amount: '-25.00',
        balanceBefore: '25.00',
        balanceAfter: '0.00',
        generatedEntityType: null,
      },
      {
        category: 'PAYMENT_ALLOCATION',
        originalEntityType: 'PaymentAllocation',
        originalEntityId: rentAllocation.id,
        amount: '-100.00',
        balanceBefore: '100.00',
        balanceAfter: '0.00',
        generatedEntityType: null,
      },
      {
        category: 'DEPOSIT',
        originalEntityType: 'ContractDepositBalance',
        originalEntityId: contractId,
        amount: '-50.00',
        balanceBefore: '50.00',
        balanceAfter: '0.00',
        generatedEntityType: 'DepositTransaction',
      },
      {
        category: 'PREPAYMENT',
        originalEntityType: 'ContractPrepaymentBalance',
        originalEntityId: contractId,
        amount: '-25.00',
        balanceBefore: '25.00',
        balanceAfter: '0.00',
        generatedEntityType: 'PrepaymentTransaction',
      },
      {
        category: 'ROOM_STATUS',
        originalEntityType: 'Room',
        originalEntityId: location.room.id,
        amount: '0.00',
        balanceBefore: null,
        balanceAfter: null,
        generatedEntityType: null,
      },
    ];
    const fixture: ScenarioFixture = {
      sequence,
      label,
      buildingId: location.building.id,
      roomId: location.room.id,
      tenantIds: [...location.cleanup.tenantIds],
      contractIds: [...location.cleanup.contractIds],
      contractId,
      contractNo: contract.contractNo,
      tenantName: location.tenantName,
      roomKeyword: location.roomKeyword,
      roomStatusBefore: 'RENTED',
      sources,
      allocationSources,
      expectedReversals,
      expectedCurrentNetImpact: '250.00',
      cleanup: location.cleanup,
    };
    return fixture;
  }

  function mergeIds(target: number[], discovered: Array<{ id: number }>) {
    const ids = new Set(target);
    for (const { id } of discovered) ids.add(id);
    target.splice(0, target.length, ...ids);
  }

  async function hydrateCleanupEntry(entry: CleanupEntry) {
    const buildings = await prisma.db.building.findMany({
      where: { buildingName: `${prefix}-${entry.label}` },
      select: { id: true },
    });
    mergeIds(entry.buildingIds, buildings);
    const rooms = await prisma.db.room.findMany({
      where: {
        OR: [
          { buildingId: { in: entry.buildingIds } },
          { remark: `${prefix}-${entry.label}` },
        ],
      },
      select: { id: true },
    });
    mergeIds(entry.roomIds, rooms);
    const tenants = await prisma.db.tenant.findMany({
      where: { name: { startsWith: `${prefix}-${entry.label}-` } },
      select: { id: true },
    });
    mergeIds(entry.tenantIds, tenants);
    const contracts = await prisma.db.contract.findMany({
      where: { roomId: { in: entry.roomIds } },
      select: { id: true },
    });
    mergeIds(entry.contractIds, contracts);
  }

  async function cleanupEntry(entry: CleanupEntry) {
    await hydrateCleanupEntry(entry);
    const contractIds = entry.contractIds;
    await prisma.db.$transaction(async (tx) => {
      const requests = await tx.contractVoidRequest.findMany({
        where: { contractId: { in: contractIds } },
        select: { id: true, status: true },
      });
      if (requests.some((item) => item.status === 'COMPLETED')) return;
      const requestIds = requests.map(({ id }) => id);
      const payments = await tx.payment.findMany({
        where: { contractId: { in: contractIds } },
        select: { id: true },
      });
      const paymentIds = payments.map(({ id }) => id);
      const bills = await tx.rentBill.findMany({
        where: { contractId: { in: contractIds } },
        select: { id: true },
      });
      const billIds = bills.map(({ id }) => id);
      if (requestIds.length) {
        await tx.operationLog.deleteMany({
          where: {
            entityType: 'CONTRACT_VOID_REQUEST',
            entityId: { in: requestIds },
          },
        });
        await tx.contractVoidReversal.deleteMany({
          where: { contractVoidRequestId: { in: requestIds } },
        });
        await tx.contractVoidRequestFile.deleteMany({
          where: { contractVoidRequestId: { in: requestIds } },
        });
        await tx.contractVoidRequest.deleteMany({
          where: { id: { in: requestIds } },
        });
      }
      await tx.depositTransaction.deleteMany({
        where: { contractId: { in: contractIds } },
      });
      await tx.prepaymentTransaction.deleteMany({
        where: { contractId: { in: contractIds } },
      });
      if (paymentIds.length || billIds.length) {
        await tx.paymentAllocation.deleteMany({
          where: {
            OR: [
              ...(paymentIds.length ? [{ paymentId: { in: paymentIds } }] : []),
              ...(billIds.length ? [{ rentBillId: { in: billIds } }] : []),
            ],
          },
        });
      }
      await tx.payment.deleteMany({
        where: { contractId: { in: contractIds } },
      });
      await tx.rentBill.deleteMany({
        where: { contractId: { in: contractIds } },
      });
      await tx.checkoutSettlement.deleteMany({
        where: { contractId: { in: contractIds } },
      });
      await tx.contractCommission.deleteMany({
        where: { contractId: { in: contractIds } },
      });
      await tx.contractMember.deleteMany({
        where: { contractId: { in: contractIds } },
      });
      await tx.contract.deleteMany({ where: { id: { in: contractIds } } });
      await tx.roomStatusHistory.deleteMany({
        where: { roomId: { in: entry.roomIds } },
      });
      await tx.tenant.deleteMany({
        where: { id: { in: entry.tenantIds } },
      });
      await tx.room.deleteMany({ where: { id: { in: entry.roomIds } } });
      await tx.building.deleteMany({
        where: { id: { in: entry.buildingIds } },
      });
    });
  }

  async function executeScenario(
    fixture: ScenarioFixture,
    roleChecks = false,
  ): Promise<CompletedScenario> {
    if (roleChecks) {
      currentUser = visitor;
      await request(app.getHttpServer())
        .get(`/api/contracts/${fixture.contractId}/void-preview`)
        .expect(403);
    }
    currentUser = admin;
    const previewResponse = await request(app.getHttpServer())
      .get(`/api/contracts/${fixture.contractId}/void-preview`)
      .expect(200);
    expect(previewResponse.body.data.summary.postReversalNetImpact).toBe(
      '0.00',
    );
    if (fixture.successorContractId) {
      expect(previewResponse.body.data.room).toMatchObject({
        hasLaterContract: true,
        action: 'KEEP_CURRENT_STATUS',
      });
    }
    const submitResponse = await request(app.getHttpServer())
      .post('/api/contracts/void-requests')
      .send({
        contractId: fixture.contractId,
        reason: `${prefix}-${fixture.label}-确认整份合同误录`,
        impactHash: previewResponse.body.data.impactHash,
        idempotencyKey: `submit-task10-${marker}-${fixture.sequence}`,
      })
      .expect(201);
    expect(submitResponse.body).toMatchObject({
      code: 200,
      message: 'success',
      data: { status: 'PENDING', contractId: fixture.contractId },
    });
    const requestId = submitResponse.body.data.id as number;
    const requestNo = submitResponse.body.data.requestNo as string;

    const filtered = await request(app.getHttpServer())
      .get('/api/contracts/void-requests')
      .query({
        contractNo: fixture.contractNo,
        roomKeyword: fixture.roomKeyword,
        tenantKeyword: fixture.tenantName,
      })
      .expect(200);
    expect(filtered.body.data.map((item: { id: number }) => item.id)).toEqual([
      requestId,
    ]);

    const executionKey = `execute-task10-${marker}-${fixture.sequence}`;
    if (roleChecks) {
      currentUser = admin;
      await request(app.getHttpServer())
        .post(`/api/contracts/void-requests/${requestId}/approve`)
        .send({
          previewHash: previewResponse.body.data.impactHash,
          confirmation: '确认作废合同',
          idempotencyKey: executionKey,
        })
        .expect(403);

      currentUser = superAdmin;
      const wrongConfirmation = await request(app.getHttpServer())
        .post(`/api/contracts/void-requests/${requestId}/approve`)
        .send({
          previewHash: previewResponse.body.data.impactHash,
          confirmation: '确认作废',
          idempotencyKey: executionKey,
        })
        .expect(400);
      expect(wrongConfirmation.body.message).toContain('确认作废合同');
    }

    currentUser = superAdmin;
    const approvalPayload = {
      previewHash: previewResponse.body.data.impactHash,
      confirmation: '确认作废合同',
      idempotencyKey: executionKey,
    };
    const completedResponse = await request(app.getHttpServer())
      .post(`/api/contracts/void-requests/${requestId}/approve`)
      .send(approvalPayload)
      .expect(201);
    expect(completedResponse.body).toMatchObject({
      code: 200,
      message: 'success',
      data: {
        requestId,
        status: 'COMPLETED',
        contractId: fixture.contractId,
        contractStatus: 'VOIDED',
      },
    });
    const retriedResponse = await request(app.getHttpServer())
      .post(`/api/contracts/void-requests/${requestId}/approve`)
      .send(approvalPayload)
      .expect(201);
    expect(retriedResponse.body.data).toEqual(completedResponse.body.data);

    await verifyScenario(fixture, requestId, completedResponse.body.data);
    const result = { fixture, requestId, requestNo };
    completed.push(result);
    return result;
  }

  async function verifyScenario(
    fixture: ScenarioFixture,
    requestId: number,
    result: {
      roomStatusAfter: string;
    },
  ) {
    const [
      contract,
      bills,
      payments,
      allocations,
      sourceDeposits,
      sourcePrepayments,
    ] = await Promise.all([
      prisma.db.contract.findUniqueOrThrow({
        where: { id: fixture.contractId },
        select: { status: true },
      }),
      prisma.db.rentBill.findMany({
        where: { id: { in: fixture.sources.bills } },
        select: { id: true, status: true },
      }),
      prisma.db.payment.findMany({
        where: { id: { in: fixture.sources.payments } },
        select: { id: true, contractId: true, status: true },
        orderBy: { id: 'asc' },
      }),
      prisma.db.paymentAllocation.findMany({
        where: { id: { in: fixture.sources.allocations } },
        select: {
          id: true,
          paymentId: true,
          rentBillId: true,
          allocatedAmount: true,
          reversedAmount: true,
          allocationType: true,
          payment: { select: { contractId: true } },
          rentBill: { select: { contractId: true } },
        },
        orderBy: { id: 'asc' },
      }),
      prisma.db.depositTransaction.findMany({
        where: { id: { in: fixture.sources.deposits } },
        select: { id: true },
      }),
      prisma.db.prepaymentTransaction.findMany({
        where: { id: { in: fixture.sources.prepayments } },
        select: { id: true },
      }),
    ]);
    expect(contract.status).toBe('VOIDED');
    expect(bills).toHaveLength(fixture.sources.bills.length);
    expect(bills.every((bill) => bill.status === 'VOIDED')).toBe(true);
    expect(
      payments.map(({ id, contractId, status }) => ({
        id,
        contractId,
        status,
      })),
    ).toEqual(
      fixture.sources.payments.map((id) => ({
        id,
        contractId: fixture.contractId,
        status: 'VOIDED',
      })),
    );
    expect(
      allocations.map((allocation) => ({
        id: allocation.id,
        paymentId: allocation.paymentId,
        rentBillId: allocation.rentBillId,
        allocatedAmount: allocation.allocatedAmount.toFixed(2),
        reversedAmount: allocation.reversedAmount.toFixed(2),
        allocationType: allocation.allocationType,
      })),
    ).toEqual(fixture.allocationSources);
    expect(
      allocations.every(
        (allocation) =>
          allocation.payment.contractId === fixture.contractId &&
          allocation.rentBill.contractId === fixture.contractId,
      ),
    ).toBe(true);
    expect(sourceDeposits).toHaveLength(fixture.sources.deposits.length);
    expect(sourcePrepayments).toHaveLength(fixture.sources.prepayments.length);

    const [latestDeposit, latestPrepayment, storedRequest] = await Promise.all([
      prisma.db.depositTransaction.findFirst({
        where: { contractId: fixture.contractId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { balanceAfter: true },
      }),
      prisma.db.prepaymentTransaction.findFirst({
        where: { contractId: fixture.contractId },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { balanceAfter: true },
      }),
      prisma.db.contractVoidRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: {
          status: true,
          impactSnapshot: true,
          resultSnapshot: true,
        },
      }),
    ]);
    expect(latestDeposit?.balanceAfter.toFixed(2) ?? '0.00').toBe('0.00');
    expect(latestPrepayment?.balanceAfter.toFixed(2) ?? '0.00').toBe('0.00');
    expect(storedRequest.status).toBe('COMPLETED');
    expect(
      (
        storedRequest.impactSnapshot as {
          summary: { postReversalNetImpact: string };
        }
      ).summary.postReversalNetImpact,
    ).toBe('0.00');
    expect(storedRequest.resultSnapshot).not.toBeNull();
    const reversals = await prisma.db.contractVoidReversal.findMany({
      where: { contractVoidRequestId: requestId },
      select: {
        category: true,
        originalEntityType: true,
        originalEntityId: true,
        amount: true,
        balanceBefore: true,
        balanceAfter: true,
        generatedEntityType: true,
        generatedEntityId: true,
        metadata: true,
      },
    });
    const bySource = (
      left: {
        category: string;
        originalEntityType: string;
        originalEntityId: number | null;
      },
      right: {
        category: string;
        originalEntityType: string;
        originalEntityId: number | null;
      },
    ) =>
      `${left.category}:${left.originalEntityType}:${left.originalEntityId ?? 0}`.localeCompare(
        `${right.category}:${right.originalEntityType}:${right.originalEntityId ?? 0}`,
      );
    expect(
      reversals
        .map((reversal) => ({
          category: reversal.category,
          originalEntityType: reversal.originalEntityType,
          originalEntityId: reversal.originalEntityId,
          amount: reversal.amount.toFixed(2),
          balanceBefore: reversal.balanceBefore?.toFixed(2) ?? null,
          balanceAfter: reversal.balanceAfter?.toFixed(2) ?? null,
          generatedEntityType: reversal.generatedEntityType,
        }))
        .sort(bySource),
    ).toEqual([...fixture.expectedReversals].sort(bySource));

    const persistedPlannedNetReversal = reversals.reduce((total, reversal) => {
      const metadata =
        reversal.metadata &&
        typeof reversal.metadata === 'object' &&
        !Array.isArray(reversal.metadata)
          ? reversal.metadata
          : {};
      return metadata.affectsNetImpact === true
        ? total.plus(reversal.amount)
        : total;
    }, new Prisma.Decimal(0));
    expect(persistedPlannedNetReversal.toFixed(2)).toBe(
      new Prisma.Decimal(fixture.expectedCurrentNetImpact).negated().toFixed(2),
    );
    expect(
      new Prisma.Decimal(fixture.expectedCurrentNetImpact)
        .plus(persistedPlannedNetReversal)
        .toFixed(2),
    ).toBe('0.00');

    for (const expected of fixture.expectedReversals.filter(
      (row) => row.generatedEntityType !== null,
    )) {
      const reversal = reversals.find(
        (row) =>
          row.category === expected.category &&
          row.originalEntityType === expected.originalEntityType &&
          row.originalEntityId === expected.originalEntityId,
      );
      expect(reversal?.generatedEntityId).not.toBeNull();
      if (expected.generatedEntityType === 'DepositTransaction') {
        const generated = await prisma.db.depositTransaction.findUniqueOrThrow({
          where: { id: reversal!.generatedEntityId! },
          select: {
            contractId: true,
            transactionType: true,
            amount: true,
            balanceAfter: true,
          },
        });
        expect({
          contractId: generated.contractId,
          transactionType: generated.transactionType,
          amount: generated.amount.toFixed(2),
          balanceAfter: generated.balanceAfter.toFixed(2),
        }).toEqual({
          contractId: fixture.contractId,
          transactionType: 'REVERSAL',
          amount: expected.balanceBefore,
          balanceAfter: '0.00',
        });
      }
      if (expected.generatedEntityType === 'PrepaymentTransaction') {
        const generated =
          await prisma.db.prepaymentTransaction.findUniqueOrThrow({
            where: { id: reversal!.generatedEntityId! },
            select: {
              contractId: true,
              transactionType: true,
              amount: true,
              balanceAfter: true,
            },
          });
        expect({
          contractId: generated.contractId,
          transactionType: generated.transactionType,
          amount: generated.amount.toFixed(2),
          balanceAfter: generated.balanceAfter.toFixed(2),
        }).toEqual({
          contractId: fixture.contractId,
          transactionType: 'REVERSAL',
          amount: expected.balanceBefore,
          balanceAfter: '0.00',
        });
      }
    }
    const sourceCheckouts = await prisma.db.checkoutSettlement.findMany({
      where: { id: { in: fixture.sources.checkouts } },
      select: { id: true, status: true },
    });
    expect(sourceCheckouts).toHaveLength(fixture.sources.checkouts.length);
    expect(sourceCheckouts.every((item) => item.status === 'COMPLETED')).toBe(
      true,
    );
    await expect(
      prisma.db.securityAuditLog.count({
        where: {
          eventType: 'CONTRACT_VOID_COMPLETED',
          entityType: 'CONTRACT_VOID_REQUEST',
          entityId: requestId,
        },
      }),
    ).resolves.toBe(1);

    if (fixture.successorContractId) {
      const [room, successor] = await Promise.all([
        prisma.db.room.findUniqueOrThrow({
          where: { id: fixture.roomId },
          select: { roomStatus: true },
        }),
        prisma.db.contract.findUniqueOrThrow({
          where: { id: fixture.successorContractId },
          select: { status: true },
        }),
      ]);
      expect(room.roomStatus).toBe(fixture.roomStatusBefore);
      expect(result.roomStatusAfter).toBe(fixture.roomStatusBefore);
      expect(successor.status).toBe('ACTIVE');
    }
  }

  it('作废简单未收合同并强制执行完整角色、确认和幂等边界', async () => {
    const fixture = await createDirectContract({
      label: '简单未收',
      roomStatus: 'RENTED',
      contractStatus: 'ACTIVE',
      billStatus: 'PENDING',
      billAmount: '300.00',
      expectedCurrentNetImpact: '0.00',
    });
    await executeScenario(fixture, true);
  });

  it('冲销已收租金、自动押金和预收款并让两类最新余额归零', async () => {
    const fixture = await createPaidAutoDepositFixture();
    expect(fixture.sources.deposits.length).toBeGreaterThan(0);
    expect(fixture.sources.prepayments.length).toBeGreaterThan(0);
    await executeScenario(fixture);
  });

  it('纠正已完成退租合同且保留 COMPLETED 退租来源', async () => {
    const fixture = await createDirectContract({
      label: '已完成退租',
      roomStatus: 'EMPTY',
      contractStatus: 'ENDED',
      billStatus: 'PAID',
      billAmount: '400.00',
      expectedCurrentNetImpact: '400.00',
      withPayment: true,
      withCompletedCheckout: true,
    });
    expect(fixture.sources.checkouts).toHaveLength(1);
    await executeScenario(fixture);
  });

  it('纠正同房历史合同且保持后续 ACTIVE 合同和当前房态不变', async () => {
    const fixture = await createDirectContract({
      label: '同房后续合同',
      roomStatus: 'RENTED',
      contractStatus: 'ENDED',
      billStatus: 'PENDING',
      billAmount: '500.00',
      expectedCurrentNetImpact: '0.00',
      withSuccessor: true,
    });
    await executeScenario(fixture);
  });

  it('在真实 MySQL 中排除 VOIDED 关系来源的经营余额、租金、退租和提成', async () => {
    currentUser = superAdmin;
    const [overviewBefore, rentBefore, dashboardBefore, commissionsBefore] =
      await Promise.all([
        request(app.getHttpServer()).get('/api/finance/overview').expect(200),
        request(app.getHttpServer())
          .get('/api/finance/rent-collection')
          .expect(200),
        request(app.getHttpServer()).get('/api/dashboard').expect(200),
        request(app.getHttpServer()).get('/api/commissions').expect(200),
      ]);
    const sentinel = await createDirectContract({
      label: '关系过滤哨兵',
      roomStatus: 'EMPTY',
      contractStatus: 'ENDED',
      billStatus: 'PENDING',
      billAmount: '777.77',
      expectedCurrentNetImpact: '0.00',
    });
    try {
      await prisma.db.contract.update({
        where: { id: sentinel.contractId },
        data: { status: 'VOIDED' },
      });
      await prisma.db.depositTransaction.create({
        data: {
          contractId: sentinel.contractId,
          transactionNo: `CV10-FYJ-${marker}`.slice(0, 40),
          transactionType: 'ADJUSTMENT',
          amount: new Prisma.Decimal('111.11'),
          balanceAfter: new Prisma.Decimal('111.11'),
          reason: `${prefix}-relation-filter-sentinel`,
        },
      });
      await prisma.db.prepaymentTransaction.create({
        data: {
          contractId: sentinel.contractId,
          transactionNo: `CV10-FYS-${marker}`.slice(0, 40),
          transactionType: 'ADJUSTMENT',
          amount: new Prisma.Decimal('222.22'),
          balanceAfter: new Prisma.Decimal('222.22'),
          reason: `${prefix}-relation-filter-sentinel`,
        },
      });
      const commission = await prisma.db.contractCommission.create({
        data: {
          contractId: sentinel.contractId,
          recipientName: `${prefix}-relation-filter-sentinel`,
          amount: new Prisma.Decimal('333.33'),
          createdBy: superAdmin.id,
          updatedBy: superAdmin.id,
        },
      });
      await prisma.db.checkoutSettlement.create({
        data: {
          settlementNo: `CV10-FCT-${marker}`.slice(0, 40),
          contractId: sentinel.contractId,
          checkoutType: '过滤哨兵',
          originContractStatus: 'ACTIVE',
          plannedCheckoutDate: new Date(),
          actualCheckoutDate: new Date(),
          checkoutReason: `${prefix}-relation-filter-sentinel`,
          targetRoomStatus: 'EMPTY',
          status: 'COMPLETED',
          submittedBy: superAdmin.id,
          submittedAt: new Date(),
          approvedBy: superAdmin.id,
          approvedAt: new Date(),
        },
      });

      const [overviewAfter, rentAfter, dashboardAfter, commissionsAfter] =
        await Promise.all([
          request(app.getHttpServer()).get('/api/finance/overview').expect(200),
          request(app.getHttpServer())
            .get('/api/finance/rent-collection')
            .expect(200),
          request(app.getHttpServer()).get('/api/dashboard').expect(200),
          request(app.getHttpServer()).get('/api/commissions').expect(200),
        ]);
      expect(overviewAfter.body.data).toEqual(overviewBefore.body.data);
      expect(rentAfter.body.data.total).toEqual(rentBefore.body.data.total);
      expect(
        rentAfter.body.data.rows.some(
          (row: { billNo: string }) =>
            row.billNo ===
            `CV10-ZD-${marker}${sentinel.sequence.toString().padStart(2, '0')}`,
        ),
      ).toBe(false);
      expect(dashboardAfter.body.data.monthlyCheckoutCount).toBe(
        dashboardBefore.body.data.monthlyCheckoutCount,
      );
      expect(dashboardAfter.body.data.rentCollectionOverview).toEqual(
        dashboardBefore.body.data.rentCollectionOverview,
      );
      expect(
        commissionsAfter.body.data.some(
          (item: { id: number }) => item.id === commission.id,
        ),
      ).toBe(false);
      expect(commissionsAfter.body.data).toEqual(commissionsBefore.body.data);
    } finally {
      await cleanupEntry(sentinel.cleanup);
      cleanupRegistry.splice(cleanupRegistry.indexOf(sentinel.cleanup), 1);
    }
  });

  it('现金流和 Excel 对合同纠错非外部流水使用精确中文语义', async () => {
    const target = completed[1] ?? completed[0];
    if (!target) throw new Error('缺少已完成的合同纠错场景');
    currentUser = superAdmin;
    const flows = await request(app.getHttpServer())
      .get('/api/finance/cash-flows')
      .expect(200);
    const correctionFlows = flows.body.data.flows.filter(
      (row: { requestNo: string | null }) => row.requestNo === target.requestNo,
    );
    expect(correctionFlows.length).toBeGreaterThan(0);
    expect(
      correctionFlows.every(
        (row: { external: boolean; type: string }) =>
          row.external === false && row.type === '合同纠错冲销',
      ),
    ).toBe(true);

    const exported = await request(app.getHttpServer())
      .get('/api/finance/exports/cash-flows.xlsx')
      .buffer(true)
      .parse(collectBinaryResponse)
      .expect(200);
    expect(Buffer.isBuffer(exported.body)).toBe(true);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body as Buffer);
    const sheet = workbook.getWorksheet('资金流水');
    expect(sheet).toBeDefined();
    const rows = sheet!.getRows(1, sheet!.rowCount) ?? [];
    const correctionRows = rows.filter(
      (row) => row.getCell(10).value === target.requestNo,
    );
    expect(correctionRows.length).toBeGreaterThan(0);
    expect(
      correctionRows.every((row) => row.getCell(7).value === '否（内部纠错）'),
    ).toBe(true);
  });
});
