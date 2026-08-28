import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { ContractsService } from './contracts.service';

describe('new contract initial deposit receipt', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-23T02:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates one confirmed deposit payment and ledger balance in the contract transaction', async () => {
    const payments: Array<Record<string, unknown>> = [];
    const depositTransactions: Array<Record<string, unknown>> = [];
    const finalizedContract = {
      id: 42,
      contractNo: 'HT202608230042 | 1栋101 | 张三',
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      room: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          roomStatus: 'EMPTY',
          fullHouseNo: '1栋101',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 42 }),
        update: jest.fn().mockResolvedValue(finalizedContract),
      },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: '张三' }),
      },
      rentBill: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      roomStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      payment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            const payment = { id: 81, ...data };
            payments.push(payment);
            return payment;
          }),
      },
      depositTransaction: {
        create: jest
          .fn()
          .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            const item = { id: 91, ...data };
            depositTransactions.push(item);
            return item;
          }),
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    const user: AuthUser = {
      id: 7,
      role: UserRole.ADMIN,
      username: 'admin',
      displayName: '管理员',
    };

    await new ContractsService(prisma as never).createFixedContract(
      {
        roomId: 1,
        startDate: new Date('2026-08-23'),
        endDate: new Date('2026-09-22'),
        monthlyRent: '3000.00',
        paymentCycleMonths: 1,
        depositRequired: '10000.00',
        primaryTenantId: 1,
      },
      user,
    );

    const roomLockSql =
      (
        tx.$queryRaw.mock.calls[0]?.[0] as
          { strings?: readonly string[] } | undefined
      )?.strings?.join('?') ?? '';
    expect(roomLockSql).toContain('FROM rooms');
    expect(roomLockSql).toContain('FOR UPDATE');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.room.findFirstOrThrow.mock.invocationCallOrder[0],
    );
    expect(prisma.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });

    expect(payments).toEqual([
      expect.objectContaining({
        contractId: 42,
        paymentCategory: 'DEPOSIT',
        amount: new Prisma.Decimal('10000.00'),
        method: 'SYSTEM_AUTO',
        status: 'CONFIRMED',
        autoSourceKey: 'CONTRACT_INITIAL_DEPOSIT:42',
        operatorId: 7,
      }),
    ]);
    expect(depositTransactions).toEqual([
      expect.objectContaining({
        contractId: 42,
        transactionType: 'RECEIPT',
        amount: new Prisma.Decimal('10000.00'),
        balanceAfter: new Prisma.Decimal('10000.00'),
        paymentId: 81,
      }),
    ]);
  });
});
