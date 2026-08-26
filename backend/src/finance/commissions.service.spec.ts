import { Prisma, UserRole } from '@prisma/client';
import { CommissionsService } from './commissions.service';

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

describe('CommissionsService', () => {
  const user = {
    id: 7,
    username: 'super',
    displayName: '超级管理员',
    role: UserRole.SUPER_ADMIN,
  };

  it('excludes commissions belonging to voided contracts from list and export data', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CommissionsService({
      db: { contractCommission: { findMany } },
    } as never);

    await service.list();

    expect(findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        contract: { status: { not: 'VOIDED' } },
      },
      include: { contract: { include: { room: true } } },
      orderBy: { id: 'desc' },
    });
  });

  it('restores a matching soft-deleted commission instead of violating the unique key', async () => {
    const deleted = {
      id: 31,
      contractId: 8,
      recipientName: '招商主管',
      amount: new Prisma.Decimal('600.00'),
      deletedAt: new Date('2026-08-20T00:00:00.000Z'),
      deletedBy: 9,
    };
    const restored = {
      ...deleted,
      amount: new Prisma.Decimal('800.00'),
      deletedAt: null,
      deletedBy: null,
      updatedBy: 7,
    };
    const create = jest.fn();
    const update = jest.fn().mockResolvedValue(restored);
    const auditCreate = jest.fn().mockResolvedValue({ id: 99 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 8 }]),
      contract: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 8, status: 'ACTIVE' }),
      },
      contractCommission: {
        findUnique: jest.fn().mockResolvedValue(deleted),
        create,
        update,
      },
      securityAuditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: auditCreate,
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never;
    const service = new CommissionsService(prisma);

    const result = await service.create(
      { contractId: 8, recipientName: '招商主管', amount: '800.00' },
      user,
    );

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: {
        amount: new Prisma.Decimal('800.00'),
        deletedAt: null,
        deletedBy: null,
        updatedBy: 7,
      },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'CREATE_COMMISSION',
        entityType: 'CONTRACT_COMMISSION',
        entityId: 31,
        operatorId: 7,
      }),
    });
    expect(result).toEqual(restored);
    expectContractMutationOrder(
      'commission.create',
      tx.$queryRaw,
      tx.contract.findUniqueOrThrow,
      update,
    );
  });

  it('orders commission update as contract lock, status reload, then update', async () => {
    const firstWrite = jest.fn().mockResolvedValue({
      id: 31,
      contractId: 8,
      recipientName: '招商主管',
      amount: new Prisma.Decimal('900.00'),
    });
    const reload = jest
      .fn()
      .mockResolvedValueOnce({ contractId: 8 })
      .mockResolvedValueOnce({
        id: 31,
        contractId: 8,
        recipientName: '招商主管',
        amount: new Prisma.Decimal('800.00'),
        contract: { status: 'ACTIVE' },
      });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 8 }]),
      contractCommission: {
        findFirstOrThrow: reload,
        update: firstWrite,
      },
      securityAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new CommissionsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.update(
      31,
      { recipientName: '招商主管', amount: '900.00' },
      user,
    );

    expectContractMutationOrder(
      'commission.update',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('orders commission delete as contract lock, status reload, then soft-delete update', async () => {
    const firstWrite = jest.fn().mockResolvedValue({
      id: 31,
      contractId: 8,
      deletedAt: new Date(),
    });
    const reload = jest
      .fn()
      .mockResolvedValueOnce({ contractId: 8 })
      .mockResolvedValueOnce({
        id: 31,
        contractId: 8,
        recipientName: '招商主管',
        amount: new Prisma.Decimal('800.00'),
        contract: { status: 'ACTIVE' },
      });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 8 }]),
      contractCommission: {
        findFirstOrThrow: reload,
        update: firstWrite,
      },
      securityAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new CommissionsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.remove(31, user);

    expectContractMutationOrder(
      'commission.remove',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('rejects commission create, update, and delete for a voided contract', async () => {
    const create = jest.fn();
    const createTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 8 }]),
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 8,
          status: 'VOIDED',
        }),
      },
      contractCommission: { create },
    };
    const createService = new CommissionsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof createTx) => Promise<unknown>) =>
            callback(createTx),
        ),
      },
    } as never);

    await expect(
      createService.create(
        { contractId: 8, recipientName: '招商主管', amount: '800.00' },
        user,
      ),
    ).rejects.toThrow('已作废合同不能新增租房提成');
    expect(create).not.toHaveBeenCalled();

    const update = jest.fn();
    const updateTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 31 }]),
      contractCommission: {
        findFirstOrThrow: jest
          .fn()
          .mockResolvedValueOnce({ id: 31, contractId: 8 })
          .mockResolvedValueOnce({
            id: 31,
            contractId: 8,
            contract: { status: 'VOIDED' },
          }),
        update,
      },
    };
    const updateService = new CommissionsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof updateTx) => Promise<unknown>) =>
            callback(updateTx),
        ),
      },
    } as never);

    await expect(
      updateService.update(
        31,
        { recipientName: '招商主管', amount: '900.00' },
        user,
      ),
    ).rejects.toThrow('已作废合同不能修改租房提成');
    expect(update).not.toHaveBeenCalled();

    const remove = jest.fn();
    updateTx.contractCommission.findFirstOrThrow
      .mockReset()
      .mockResolvedValueOnce({ id: 31, contractId: 8 })
      .mockResolvedValueOnce({
        id: 31,
        contractId: 8,
        contract: { status: 'VOIDED' },
      });
    updateTx.contractCommission.update = remove;

    await expect(
      new CommissionsService({
        db: {
          $transaction: jest.fn(
            (callback: (client: typeof updateTx) => Promise<unknown>) =>
              callback(updateTx),
          ),
        },
      } as never).remove(31, user),
    ).rejects.toThrow('已作废合同不能删除租房提成');
    expect(remove).not.toHaveBeenCalled();
  });
});
