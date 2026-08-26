import { PaymentMethod, UserRole } from '@prisma/client';
import { DepositsService } from './deposits.service';

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

describe('DepositsService', () => {
  it('orders deposit record as contract lock, status reload, then payment write', async () => {
    const paymentCreate = jest.fn().mockResolvedValue({ id: 81 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      contract: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 7, status: 'ACTIVE' }),
      },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      payment: { create: paymentCreate },
    };
    const service = new DepositsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.record(
      {
        contractId: 7,
        paymentDate: '2026-08-26',
        amount: '1000.00',
        method: PaymentMethod.BANK_TRANSFER,
      },
      {
        id: 1,
        username: 'root',
        displayName: '超级管理员',
        role: UserRole.SUPER_ADMIN,
      },
    );

    expectContractMutationOrder(
      'deposit.record',
      tx.$queryRaw,
      tx.contract.findUniqueOrThrow,
      paymentCreate,
    );
  });

  it('rejects recording a deposit for a voided contract', async () => {
    const paymentCreate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 7,
          status: 'VOIDED',
        }),
      },
      payment: { create: paymentCreate },
    };
    const service = new DepositsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.record(
        {
          contractId: 7,
          paymentDate: '2026-08-26',
          amount: '1000.00',
          method: PaymentMethod.BANK_TRANSFER,
        },
        {
          id: 1,
          username: 'root',
          displayName: '超级管理员',
          role: UserRole.SUPER_ADMIN,
        },
      ),
    ).rejects.toThrow('已作废合同不能登记押金收取');
    expect(paymentCreate).not.toHaveBeenCalled();
  });
});
