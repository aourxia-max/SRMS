import {
  BadRequestException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { ContractsService } from './contracts.service';

function expectContractMutationOrder(
  entry: string,
  contractLock: jest.Mock,
  reload: jest.Mock,
  firstWrite: jest.Mock,
) {
  const sql = contractLock.mock.calls[0]?.[0] as
    { strings?: readonly string[] } | undefined;
  const statement = sql?.strings?.join('?') ?? '';
  const lockOrder = contractLock.mock.invocationCallOrder[0];
  const reloadOrder = reload.mock.invocationCallOrder.at(-1);
  const writeOrder = firstWrite.mock.invocationCallOrder[0];
  expect({
    entry,
    locksContractForUpdate:
      statement.includes('FROM contracts') && statement.includes('FOR UPDATE'),
    lockBeforeReload: lockOrder < reloadOrder!,
    reloadBeforeFirstWrite: reloadOrder! < writeOrder,
  }).toEqual({
    entry,
    locksContractForUpdate: true,
    lockBeforeReload: true,
    reloadBeforeFirstWrite: true,
  });
}

describe('ContractsService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2025-12-01T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const admin: AuthUser = {
    id: 7,
    role: UserRole.ADMIN,
    username: 'admin',
    displayName: 'Admin',
  };
  const superAdmin: AuthUser = {
    id: 1,
    role: UserRole.SUPER_ADMIN,
    username: 'root',
    displayName: 'Root',
  };
  const input = {
    roomId: 1,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-02-05'),
    monthlyRent: '3000',
    paymentCycleMonths: 1,
    depositRequired: '0',
    primaryTenantId: 1,
  };

  describe('updateRemark', () => {
    function remarkService(
      contract: {
        id: number;
        contractNo: string;
        status: 'ACTIVE' | 'ENDED' | 'VOIDED';
        remark: string | null;
      } = {
        id: 7,
        contractNo: 'HT202608050001 | 2栋301 | 李四',
        status: 'ACTIVE',
        remark: null,
      },
    ) {
      const updatedAt = new Date('2026-09-01T01:00:00.000Z');
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: contract.id }]),
        contract: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(contract),
          update: jest.fn().mockImplementation(({ data }: { data: { remark: string | null } }) =>
            Promise.resolve({ id: contract.id, remark: data.remark, updatedAt }),
          ),
        },
        operationLog: { create: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        db: {
          $transaction: jest.fn((callback: (value: typeof tx) => Promise<unknown>) =>
            callback(tx),
          ),
        },
      };
      return { service: new ContractsService(prisma as never), tx, updatedAt };
    }

    it('trims and updates a remark under a row lock with an audit log', async () => {
      const { service, tx, updatedAt } = remarkService();

      await expect(
        service.updateRemark(7, { remark: '  补充说明  ' }, admin),
      ).resolves.toEqual({ id: 7, remark: '补充说明', updatedAt });

      expect(tx.contract.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 7 },
        select: { id: true, contractNo: true, status: true, remark: true },
      });
      expect(tx.contract.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { remark: '补充说明' },
        select: { id: true, remark: true, updatedAt: true },
      });
      expect(tx.operationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          module: 'CONTRACT',
          action: 'UPDATE_CONTRACT_REMARK',
          entityType: 'CONTRACT',
          entityId: 7,
          entityNo: 'HT202608050001 | 2栋301 | 李四',
          beforeData: { remark: null },
          afterData: { remark: '补充说明' },
          operatorId: admin.id,
          operatorRole: admin.role,
        }),
      });
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.contract.findUniqueOrThrow.mock.invocationCallOrder[0],
      );
      expect(tx.contract.findUniqueOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
        tx.contract.update.mock.invocationCallOrder[0],
      );
      expect(tx.contract.update.mock.invocationCallOrder[0]).toBeLessThan(
        tx.operationLog.create.mock.invocationCallOrder[0],
      );
    });

    it.each([
      { input: { remark: '   ' }, expected: null },
      { input: { remark: null }, expected: null },
    ])('normalizes a blank or null remark to null', async ({ input, expected }) => {
      const { service, tx } = remarkService({
        id: 7,
        contractNo: 'HT202608050001',
        status: 'ENDED',
        remark: '旧备注',
      });

      await expect(service.updateRemark(7, input, admin)).resolves.toMatchObject({
        id: 7,
        remark: expected,
      });
      expect(tx.contract.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { remark: expected } }),
      );
    });

    it('rejects a voided contract before update and audit writes', async () => {
      const { service, tx } = remarkService({
        id: 7,
        contractNo: 'HT202608050001',
        status: 'VOIDED',
        remark: '封存备注',
      });

      await expect(
        service.updateRemark(7, { remark: '不应保存' }, admin),
      ).rejects.toThrow('已作废合同不能修改备注');
      expect(tx.contract.update).not.toHaveBeenCalled();
      expect(tx.operationLog.create).not.toHaveBeenCalled();
    });
  });

  it('returns a stable completed correction summary and ignores cancelled or rejected requests', async () => {
    const completedAt = new Date('2026-08-26T10:00:00.000Z');
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 7,
      contractNo: 'HT20260007',
      status: 'VOIDED',
      members: [],
      concessions: [],
      voidRequests: [
        {
          id: 74,
          requestNo: 'HTZF-CANCELLED',
          status: 'CANCELLED',
          completedAt: null,
        },
        {
          id: 73,
          requestNo: 'HTZF-PENDING',
          status: 'PENDING',
          completedAt: null,
        },
        {
          id: 72,
          requestNo: 'HTZF-COMPLETED',
          status: 'COMPLETED',
          completedAt,
        },
        {
          id: 71,
          requestNo: 'HTZF-REJECTED',
          status: 'REJECTED',
          completedAt: null,
        },
      ],
    });
    const service = new ContractsService({
      db: { contract: { findUniqueOrThrow } },
    } as never);

    const result = await service.detail(7, admin);

    expect(findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        include: expect.objectContaining({
          voidRequests: expect.objectContaining({
            where: { status: { in: ['PENDING', 'COMPLETED'] } },
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 7,
      status: 'VOIDED',
      voidRequest: {
        id: 72,
        requestNo: 'HTZF-COMPLETED',
        status: 'COMPLETED',
        completedAt,
      },
    });
    expect(result).not.toHaveProperty('voidRequests');
  });

  it('returns the newest pending correction summary when no request is completed', async () => {
    const service = new ContractsService({
      db: {
        contract: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 8,
            contractNo: 'HT20260008',
            status: 'ACTIVE',
            members: [],
            concessions: [],
            voidRequests: [
              {
                id: 81,
                requestNo: 'HTZF-PENDING-OLD',
                status: 'PENDING',
                completedAt: null,
              },
              {
                id: 82,
                requestNo: 'HTZF-PENDING-NEW',
                status: 'PENDING',
                completedAt: null,
              },
            ],
          }),
        },
      },
    } as never);

    await expect(service.detail(8, admin)).resolves.toMatchObject({
      voidRequest: {
        id: 82,
        requestNo: 'HTZF-PENDING-NEW',
        status: 'PENDING',
        completedAt: null,
      },
    });
  });

  it('rejects an overlapping effective contract before creating any data', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      room: {
        findFirstOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 1, roomStatus: 'EMPTY' }),
      },
      contract: { findFirst: jest.fn().mockResolvedValue({ id: 9 }) },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    await expect(
      new ContractsService(prisma as never).createFixedContract(input, admin),
    ).rejects.toThrow('已有有效合同');
    expect(tx.contract.findFirst).toHaveBeenCalled();
  });

  it('generates billing snapshots and changes the room to pending move-in', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const roomUpdate = jest.fn().mockResolvedValue({});
    const contractUpdate = jest.fn().mockResolvedValue({
      id: 10,
      contractNo: 'HT202601010001 | 1栋101 | 李四',
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      room: {
        findFirstOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 1, roomStatus: 'EMPTY' }),
        update: roomUpdate,
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 10 }),
        update: contractUpdate,
      },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: '李四' }),
      },
      rentBill: { createMany },
      roomStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    await new ContractsService(prisma as never).createFixedContract(
      input,
      admin,
    );
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ baseRentAmount: expect.anything() }),
        ]),
      }),
    );
    expect(roomUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roomStatus: 'PENDING_MOVE_IN' }),
      }),
    );
  });

  it('previews tiered bills from contract-local tier prices', () => {
    const service = new ContractsService({} as never);
    const result = service.previewTieredBills(
      '3000',
      new Date('2026-01-01'),
      new Date('2026-03-05'),
      [
        {
          tierName: '基础',
          thresholdMonths: 0,
          monthlyRent: '3000',
          requiresFullyPaid: true,
        },
        {
          tierName: '二月档',
          thresholdMonths: 2,
          monthlyRent: '2000',
          requiresFullyPaid: true,
        },
      ],
    );
    expect(result[2].tier?.tierName).toBe('二月档');
    expect(result[2].amount.toFixed(2)).toBe('333.33');
  });

  it('retires new tiered contract creation with HTTP 410 before opening a transaction', async () => {
    const transaction = jest.fn();
    const service = new ContractsService({
      db: { $transaction: transaction },
    } as never);

    await expect(
      service.createTieredContract({
        ...input,
        endDate: new Date('2026-03-05'),
        tiers: [
          {
            tierName: '基础',
            thresholdMonths: 0,
            monthlyRent: '3000',
            requiresFullyPaid: true,
          },
        ],
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: '阶梯合同功能已停用',
        status: 410,
      } as Partial<GoneException>),
    );
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects an invalid rent change before it creates an approval record', async () => {
    const create = jest.fn();
    const service = new ContractsService({
      db: {
        contract: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-03-31'),
            pricingMode: 'FIXED',
            members: [],
            concessions: [],
          }),
        },
        contractChange: { create },
      },
    } as never);
    await expect(
      service.submitChange(
        1,
        {
          changeType: 'RENT',
          effectiveDate: '2026-02-01',
          afterSnapshot: { monthlyRent: '-1' },
          reason: 'test',
        },
        { id: 1, role: 'ADMIN', username: 'admin', displayName: 'Admin' },
      ),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('orders contract change submit as contract lock, reload, then change write', async () => {
    const firstWriteError = new Error('contract change submit write reached');
    const firstWrite = jest.fn().mockRejectedValue(firstWriteError);
    const reload = jest.fn().mockResolvedValue({
      id: 1,
      status: 'ACTIVE',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-03-31'),
      pricingMode: 'FIXED',
      members: [],
      concessions: [],
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      contract: { findUniqueOrThrow: reload },
      contractChange: { create: firstWrite },
    };
    const service = new ContractsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submitChange(
        1,
        {
          changeType: 'RENT',
          effectiveDate: '2026-02-01',
          afterSnapshot: { monthlyRent: '3500' },
          reason: '调整月租',
        },
        admin,
      ),
    ).rejects.toBe(firstWriteError);

    expectContractMutationOrder(
      'contractChange.submit',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('orders contract change approve as contract lock, reload, then contract write', async () => {
    const firstWriteError = new Error('contract change approve write reached');
    const firstWrite = jest.fn().mockRejectedValue(firstWriteError);
    const reload = jest.fn().mockResolvedValue({
      id: 9,
      contractId: 1,
      changeType: 'RENT',
      effectiveDate: new Date('2026-02-01'),
      afterSnapshot: { monthlyRent: '3500' },
      reason: '调整月租',
      approvalStatus: 'PENDING',
      contract: {
        id: 1,
        status: 'ACTIVE',
        contractNo: 'HT-1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-03-31'),
        pricingMode: 'FIXED',
        monthlyRent: '3000',
        members: [],
        concessions: [],
        pricingTiers: [],
        bills: [],
      },
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      contractChange: {
        findUniqueOrThrow: reload,
        update: jest.fn(),
      },
      contract: { update: firstWrite },
    };
    const service = new ContractsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(service.approveChange(9, superAdmin)).rejects.toBe(
      firstWriteError,
    );

    expectContractMutationOrder(
      'contractChange.approve',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('orders contract change reject as contract lock, reload, then rejection write', async () => {
    const firstWriteError = new Error('contract change reject write reached');
    const firstWrite = jest.fn().mockRejectedValue(firstWriteError);
    const reload = jest.fn().mockResolvedValue({
      id: 9,
      contractId: 1,
      approvalStatus: 'PENDING',
      contract: { status: 'ACTIVE' },
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      contractChange: {
        findUniqueOrThrow: reload,
        update: firstWrite,
      },
    };
    const service = new ContractsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(service.rejectChange(9, '信息有误', superAdmin)).rejects.toBe(
      firstWriteError,
    );

    expectContractMutationOrder(
      'contractChange.reject',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('does not approve a change when a later bill already has a receipt', async () => {
    const update = jest.fn();
    const tx = {
      contractChange: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 9,
          contractId: 1,
          changeType: 'RENT',
          effectiveDate: new Date('2026-02-01'),
          afterSnapshot: { monthlyRent: '3500' },
          reason: 'test',
          approvalStatus: 'PENDING',
          contract: {
            id: 1,
            contractNo: 'HT-1',
            startDate: new Date('2026-01-01'),
            endDate: new Date('2026-03-31'),
            pricingMode: 'FIXED',
            monthlyRent: '3000',
            members: [],
            concessions: [],
            pricingTiers: [],
            bills: [
              {
                id: 12,
                periodSeq: 2,
                periodStart: new Date('2026-02-01'),
                receivedAmount: '1',
              },
            ],
          },
        }),
        update,
      },
    };
    const service = new ContractsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);
    await expect(
      service.approveChange(9, {
        id: 1,
        role: 'SUPER_ADMIN',
        username: 'root',
        displayName: 'Root',
      }),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects every contract-change mutation for a voided contract', async () => {
    const validContract = {
      id: 1,
      status: 'VOIDED',
      contractNo: 'HT-1',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-03-31'),
      pricingMode: 'FIXED',
      monthlyRent: '3000',
      members: [],
      concessions: [],
      pricingTiers: [],
      bills: [],
    };
    const dto = {
      changeType: 'RENT' as const,
      effectiveDate: '2026-02-01',
      afterSnapshot: { monthlyRent: '3500' },
      reason: '纠正月租',
    };
    const submitCreate = jest.fn();
    const submitReload = jest.fn().mockResolvedValue(validContract);
    const submitTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      contract: { findUniqueOrThrow: submitReload },
      contractChange: { create: submitCreate },
    };
    const submitTransaction = jest.fn(
      (callback: (value: typeof submitTx) => Promise<unknown>) =>
        callback(submitTx),
    );
    const submitService = new ContractsService({
      db: {
        contract: { findUniqueOrThrow: submitReload },
        contractChange: { create: submitCreate },
        $transaction: submitTransaction,
      },
    } as never);

    await expect(submitService.submitChange(1, dto, admin)).rejects.toThrow(
      '已作废合同不能提交合同变更',
    );
    expect(submitTransaction).toHaveBeenCalledTimes(1);
    expect(submitTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      submitReload.mock.invocationCallOrder.at(-1)!,
    );
    expect(submitCreate).not.toHaveBeenCalled();

    const approveUpdate = jest.fn();
    const approveTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      contractChange: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 9,
          contractId: 1,
          changeType: 'RENT',
          effectiveDate: new Date('2026-02-01'),
          afterSnapshot: { monthlyRent: '3500' },
          reason: '纠正月租',
          approvalStatus: 'PENDING',
          contract: validContract,
        }),
        update: approveUpdate,
      },
    };
    const approveService = new ContractsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof approveTx) => Promise<unknown>) =>
            callback(approveTx),
        ),
      },
    } as never);

    await expect(approveService.approveChange(9, superAdmin)).rejects.toThrow(
      '已作废合同不能确认合同变更',
    );
    expect(approveTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      approveTx.contractChange.findUniqueOrThrow.mock.invocationCallOrder.at(
        -1,
      )!,
    );
    expect(approveUpdate).not.toHaveBeenCalled();

    const rejectUpdate = jest.fn();
    const rejectReload = jest.fn().mockResolvedValue({
      id: 9,
      contractId: 1,
      approvalStatus: 'PENDING',
      contract: { status: 'VOIDED' },
    });
    const rejectTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      contractChange: { findUniqueOrThrow: rejectReload, update: rejectUpdate },
    };
    const rejectTransaction = jest.fn(
      (callback: (value: typeof rejectTx) => Promise<unknown>) =>
        callback(rejectTx),
    );
    const rejectService = new ContractsService({
      db: {
        contractChange: {
          findUniqueOrThrow: rejectReload,
          update: rejectUpdate,
        },
        $transaction: rejectTransaction,
      },
    } as never);

    await expect(
      rejectService.rejectChange(9, '信息有误', superAdmin),
    ).rejects.toThrow('已作废合同不能驳回合同变更');
    expect(rejectTransaction).toHaveBeenCalledTimes(1);
    expect(rejectTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      rejectReload.mock.invocationCallOrder.at(-1)!,
    );
    expect(rejectUpdate).not.toHaveBeenCalled();
  });

  function confirmationTx() {
    const contractNo = 'HT202601010010 | 1栋101 | 李四';
    return {
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
        create: jest.fn().mockResolvedValue({ id: 10 }),
        update: jest.fn().mockResolvedValue({ id: 10, contractNo }),
      },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: '李四' }),
      },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]) },
      rentBill: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      roomStatusHistory: { create: jest.fn().mockResolvedValue({}) },
      contractDraft: {
        findFirst: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }

  function serviceFor(tx: ReturnType<typeof confirmationTx>) {
    return new ContractsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);
  }
  function fixedConfirmationHarness(tx = confirmationTx()) {
    const transaction = jest.fn(
      (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    );
    return {
      tx,
      transaction,
      service: new ContractsService({
        db: { $transaction: transaction },
      } as never),
    };
  }

  function expectRoomFirstFixedConfirmationGate(
    entry: string,
    tx: ReturnType<typeof confirmationTx>,
  ) {
    const roomLockCall = tx.$queryRaw.mock.calls.findIndex((call) => {
      const sql = call[0] as { strings?: readonly string[] } | undefined;
      const statement = sql?.strings?.join('?') ?? '';
      return (
        statement.includes('FROM rooms') && statement.includes('FOR UPDATE')
      );
    });
    const roomLockOrder = tx.$queryRaw.mock.invocationCallOrder[roomLockCall];
    expect({
      entry,
      locksRoomForUpdate: roomLockCall >= 0,
      lockBeforeRoomReload:
        roomLockOrder < tx.room.findFirstOrThrow.mock.invocationCallOrder[0],
      lockBeforeConflictQuery:
        roomLockOrder < tx.contract.findFirst.mock.invocationCallOrder[0],
      lockBeforeContractCreate:
        roomLockOrder < tx.contract.create.mock.invocationCallOrder[0],
    }).toEqual({
      entry,
      locksRoomForUpdate: true,
      lockBeforeRoomReload: true,
      lockBeforeConflictQuery: true,
      lockBeforeContractCreate: true,
    });
  }

  it('previews fixed bills and totals without reading or writing the database', () => {
    const db = { contract: { findFirst: jest.fn() } };
    const service = new ContractsService({ db } as never);

    expect(
      service.previewFixedContract({
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-02-05'),
        monthlyRent: '3000',
        concessions: [
          {
            concessionType: 'FIXED_AMOUNT',
            applyMode: 'BILLING_PERIODS',
            fixedAmount: '100',
            billingPeriodCount: 2,
            reason: '签约优惠',
          },
        ],
      }),
    ).toEqual({
      billCount: 2,
      totalBaseRent: '3500.00',
      totalDiscount: '100.00',
      totalPayable: '3400.00',
      bills: [
        {
          sequence: 1,
          startDate: '2026-01-01',
          endDate: '2026-01-31',
          payableAmount: '2950.00',
        },
        {
          sequence: 2,
          startDate: '2026-02-01',
          endDate: '2026-02-05',
          payableAmount: '450.00',
        },
      ],
    });
    expect(db.contract.findFirst).not.toHaveBeenCalled();
  });

  it('directly confirms a fixed contract through one transaction', async () => {
    const tx = confirmationTx();
    const service = serviceFor(tx);

    await expect(service.createFixedContract(input, admin)).resolves.toEqual(
      expect.objectContaining({ id: 10 }),
    );

    expect(tx.contract.create).toHaveBeenCalledTimes(1);
    expect(tx.rentBill.createMany).toHaveBeenCalledTimes(1);
    expect(tx.room.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roomStatus: 'PENDING_MOVE_IN' }),
      }),
    );
  });

  it.each(['direct', 'draft'] as const)(
    'locks the room before fixed-contract conflict checks and writes for %s confirmation',
    async (entry) => {
      const { service, tx } = fixedConfirmationHarness();
      if (entry === 'draft') {
        tx.contractDraft.findFirst.mockResolvedValue({
          id: 25,
          roomId: 1,
          status: 'DRAFT',
          createdBy: admin.id,
          payload: {
            ...input,
            startDate: '2026-01-01',
            endDate: '2026-02-05',
          },
        });
        await service.confirmFixedContractDraft(25, admin);
      } else {
        await service.createFixedContract(input, admin);
      }

      expectRoomFirstFixedConfirmationGate(entry, tx);
    },
  );

  it.each(['direct', 'draft'] as const)(
    'uses read committed for %s fixed-contract confirmation',
    async (entry) => {
      const { service, transaction, tx } = fixedConfirmationHarness();
      if (entry === 'draft') {
        tx.contractDraft.findFirst.mockResolvedValue({
          id: 26,
          roomId: 1,
          status: 'DRAFT',
          createdBy: admin.id,
          payload: {
            ...input,
            startDate: '2026-01-01',
            endDate: '2026-02-05',
          },
        });
        await service.confirmFixedContractDraft(26, admin);
      } else {
        await service.createFixedContract(input, admin);
      }

      expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    },
  );

  it('immediately activates a contract whose China start date has arrived', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-21T01:00:00.000Z'));
    const tx = confirmationTx();

    try {
      await serviceFor(tx).createFixedContract(
        {
          ...input,
          startDate: new Date('2026-08-20T00:00:00.000Z'),
          endDate: new Date('2027-08-20T00:00:00.000Z'),
        },
        admin,
      );

      expect(tx.contract.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'ACTIVE',
          activatedAt: new Date('2026-08-21T01:00:00.000Z'),
        }),
      });
      expect(tx.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ roomStatus: 'RENTED' }),
        }),
      );
    } finally {
      jest.setSystemTime(new Date('2025-12-01T00:00:00.000Z'));
    }
  });

  it('confirms a draft and marks it confirmed only after every formal write', async () => {
    const tx = confirmationTx();
    tx.contractDraft.findFirst.mockResolvedValue({
      id: 21,
      roomId: 1,
      status: 'DRAFT',
      createdBy: admin.id,
      payload: {
        roomId: 1,
        startDate: '2026-01-01',
        endDate: '2026-02-05',
        monthlyRent: '3000',
        paymentCycleMonths: 1,
        depositRequired: '0',
        primaryTenantId: 1,
      },
    });

    await expect(
      serviceFor(tx).confirmFixedContractDraft(21, admin),
    ).resolves.toEqual(expect.objectContaining({ id: 10 }));

    expect(tx.contractDraft.updateMany).toHaveBeenCalledWith({
      where: { id: 21, status: 'DRAFT' },
      data: { status: 'CONFIRMED', confirmedAt: expect.any(Date) },
    });
    expect(
      tx.contractDraft.updateMany.mock.invocationCallOrder[0],
    ).toBeGreaterThan(tx.roomStatusHistory.create.mock.invocationCallOrder[0]);
  });

  it('leaves an invalid draft unconfirmed and performs no formal writes', async () => {
    const tx = confirmationTx();
    tx.contractDraft.findFirst.mockResolvedValue({
      id: 22,
      roomId: 1,
      status: 'DRAFT',
      createdBy: admin.id,
      payload: {
        roomId: 1,
        startDate: '2026-02-01',
        endDate: '2026-01-01',
        monthlyRent: '3000',
        paymentCycleMonths: 1,
        depositRequired: '0',
        primaryTenantId: 1,
      },
    });

    await expect(
      serviceFor(tx).confirmFixedContractDraft(22, admin),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.contract.create).not.toHaveBeenCalled();
    expect(tx.rentBill.createMany).not.toHaveBeenCalled();
    expect(tx.room.update).not.toHaveBeenCalled();
    expect(tx.contractDraft.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a draft that was already confirmed', async () => {
    const tx = confirmationTx();
    tx.contractDraft.findFirst.mockResolvedValue({
      id: 23,
      roomId: 1,
      status: 'CONFIRMED',
      createdBy: admin.id,
      payload: {},
    });

    await expect(
      serviceFor(tx).confirmFixedContractDraft(23, admin),
    ).rejects.toThrow('草稿已确认');
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it('denies commission data from an admin for direct and draft confirmation', async () => {
    const directTx = confirmationTx();
    await expect(
      serviceFor(directTx).createFixedContract(
        {
          ...input,
          commission: { recipientName: 'Broker', amount: '500' },
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(directTx.contract.create).not.toHaveBeenCalled();

    const draftTx = confirmationTx();
    draftTx.contractDraft.findFirst.mockResolvedValue({
      id: 24,
      roomId: 1,
      status: 'DRAFT',
      createdBy: admin.id,
      payload: {
        ...input,
        startDate: '2026-01-01',
        endDate: '2026-02-05',
        commission: { recipientName: 'Broker', amount: '500' },
      },
    });
    await expect(
      serviceFor(draftTx).confirmFixedContractDraft(24, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(draftTx.contract.create).not.toHaveBeenCalled();
  });

  it('persists external fields, owned attachments, and super-admin commission', async () => {
    const tx = confirmationTx();
    tx.fileAsset.findMany.mockResolvedValue([{ id: 31 }, { id: 32 }]);
    const service = serviceFor(tx);
    const plannedMoveInDate = new Date('2026-01-03');

    await service.createFixedContract(
      {
        ...input,
        externalContractNo: 'EXT-2026-001',
        plannedMoveInDate,
        remark: 'Key handover at reception',
        fileAssetIds: [31, 32],
        commission: { recipientName: 'Broker', amount: '500' },
      },
      superAdmin,
    );

    expect(tx.contract.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalContractNo: 'EXT-2026-001',
        plannedMoveInDate,
        remark: 'Key handover at reception',
        files: {
          create: [{ fileAssetId: 31 }, { fileAssetId: 32 }],
        },
        commissions: {
          create: {
            recipientName: 'Broker',
            amount: '500',
            createdBy: superAdmin.id,
            updatedBy: superAdmin.id,
          },
        },
      }),
    });
  });

  it('rejects attachment ids not uploaded by the confirming admin', async () => {
    const tx = confirmationTx();
    tx.fileAsset.findMany.mockResolvedValue([{ id: 31 }]);

    await expect(
      serviceFor(tx).createFixedContract(
        { ...input, fileAssetIds: [31, 32] },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.fileAsset.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [31, 32] },
        category: 'CONTRACT',
        uploadedBy: admin.id,
      },
      select: { id: true },
    });
    expect(tx.contract.create).not.toHaveBeenCalled();
  });

  it('associates only file assets staged as contract attachments', async () => {
    const tx = confirmationTx();
    tx.fileAsset.findMany.mockImplementation(({ where }) =>
      Promise.resolve(where.category === 'CONTRACT' ? [{ id: 31 }] : []),
    );

    await expect(
      serviceFor(tx).createFixedContract(
        { ...input, fileAssetIds: [31] },
        superAdmin,
      ),
    ).resolves.toEqual(expect.objectContaining({ id: 10 }));
  });

  it.each([
    ['list', admin],
    ['detail', admin],
  ] as const)(
    'never returns commissions to an admin from %s',
    async (method, user) => {
      const commission = { recipientName: 'Broker', amount: '500' };
      const contract = { id: 10, contractNo: 'HT-10' };
      const contractModel = {
        findMany: jest
          .fn()
          .mockImplementation(({ include }) =>
            Promise.resolve([
              include.commissions
                ? { ...contract, commissions: [commission] }
                : contract,
            ]),
          ),
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(({ include }) =>
            Promise.resolve(
              include.commissions
                ? { ...contract, commissions: [commission] }
                : contract,
            ),
          ),
      };
      const service = new ContractsService({
        db: { contract: contractModel },
      } as never);
      const result =
        method === 'list'
          ? await (
              service.list as unknown as (
                currentUser: AuthUser,
              ) => Promise<Array<Record<string, unknown>>>
            )(user)
          : await (
              service.detail as unknown as (
                id: number,
                currentUser: AuthUser,
              ) => Promise<Record<string, unknown>>
            )(10, user);
      const item = Array.isArray(result) ? result[0] : result;

      expect(item).not.toHaveProperty('commissions');
    },
  );

  it.each(['list', 'detail'] as const)(
    'returns commissions to a super administrator from %s',
    async (method) => {
      const commission = { recipientName: 'Broker', amount: '500' };
      const contract = { id: 10, contractNo: 'HT-10' };
      const contractModel = {
        findMany: jest
          .fn()
          .mockImplementation(({ include }) =>
            Promise.resolve([
              include.commissions
                ? { ...contract, commissions: [commission] }
                : contract,
            ]),
          ),
        findUniqueOrThrow: jest
          .fn()
          .mockImplementation(({ include }) =>
            Promise.resolve(
              include.commissions
                ? { ...contract, commissions: [commission] }
                : contract,
            ),
          ),
      };
      const service = new ContractsService({
        db: { contract: contractModel },
      } as never);
      const result =
        method === 'list'
          ? await (
              service.list as unknown as (
                currentUser: AuthUser,
              ) => Promise<Array<Record<string, unknown>>>
            )(superAdmin)
          : await (
              service.detail as unknown as (
                id: number,
                currentUser: AuthUser,
              ) => Promise<Record<string, unknown>>
            )(10, superAdmin);
      const item = Array.isArray(result) ? result[0] : result;

      expect(item).toHaveProperty('commissions', [commission]);
    },
  );

  it('rolls back all staged confirmation writes when a late transaction step fails', async () => {
    const state = {
      contractIds: [] as number[],
      billContractIds: [] as number[],
      roomStatus: 'EMPTY',
      draftStatus: 'DRAFT',
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      room: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          roomStatus: 'EMPTY',
          fullHouseNo: '1栋101',
        }),
        update: jest.fn().mockImplementation(() => {
          state.roomStatus = 'PENDING_MOVE_IN';
          return Promise.resolve({});
        }),
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(() => {
          state.contractIds.push(10);
          return Promise.resolve({ id: 10 });
        }),
        update: jest.fn().mockResolvedValue({ id: 10, contractNo: 'HT-10' }),
      },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: '李四' }),
      },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]) },
      rentBill: {
        createMany: jest.fn().mockImplementation(({ data }) => {
          state.billContractIds.push(
            ...(data as Array<{ contractId: number }>).map(
              (bill) => bill.contractId,
            ),
          );
          return Promise.resolve({ count: data.length });
        }),
      },
      roomStatusHistory: {
        create: jest.fn().mockRejectedValue(new Error('history write failed')),
      },
      contractDraft: {
        findFirst: jest.fn().mockResolvedValue({
          id: 24,
          roomId: 1,
          status: 'DRAFT',
          createdBy: admin.id,
          payload: {
            ...input,
            startDate: '2026-01-01',
            endDate: '2026-02-05',
          },
        }),
        updateMany: jest.fn().mockImplementation(() => {
          state.draftStatus = 'CONFIRMED';
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => Promise<unknown>) => {
            const before = structuredClone(state);
            try {
              return await callback(tx);
            } catch (error) {
              state.contractIds = before.contractIds;
              state.billContractIds = before.billContractIds;
              state.roomStatus = before.roomStatus;
              state.draftStatus = before.draftStatus;
              throw error;
            }
          },
        ),
      },
    };

    await expect(
      new ContractsService(prisma as never).confirmFixedContractDraft(
        24,
        admin,
      ),
    ).rejects.toThrow('history write failed');
    expect(state).toEqual({
      contractIds: [],
      billContractIds: [],
      roomStatus: 'EMPTY',
      draftStatus: 'DRAFT',
    });
    expect(tx.contractDraft.updateMany).not.toHaveBeenCalled();
  });

  it('returns only rent bills and excludes checkout-protected arrears for ordinary collection', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ContractsService({
      db: { rentBill: { findMany } },
    } as never);

    await service.bills(7);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { contractId: 7, billCategory: 'RENT' },
      }),
    );

    await service.bills(7, true);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractId: 7,
          billCategory: 'RENT',
          NOT: expect.any(Object),
        }),
      }),
    );
  });
});
