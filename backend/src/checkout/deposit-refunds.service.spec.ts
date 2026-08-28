import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DepositRefundsService } from './deposit-refunds.service';

function transactional<T extends object>(tx: T) {
  const client = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    ...tx,
  };
  return {
    client,
    db: {
      ...client,
      $transaction: jest.fn(
        (callback: (value: typeof client) => Promise<unknown>) =>
          callback(client),
      ),
    },
  };
}

function expectContractMutationOrder(
  entry: string,
  contractLock: jest.Mock,
  reload: jest.Mock,
  firstWrite: jest.Mock,
  reloadCallIndex = -1,
) {
  const lockIndex = contractLock.mock.calls.findIndex(([query]) => {
    const statement =
      (query as { strings?: readonly string[] }).strings?.join('?') ?? '';
    return (
      statement.includes('FROM contracts') && statement.includes('FOR UPDATE')
    );
  });
  const sql = contractLock.mock.calls[lockIndex]?.[0] as
    { strings?: readonly string[] } | undefined;
  const statement = sql?.strings?.join('?') ?? '';
  const lockOrder = contractLock.mock.invocationCallOrder[lockIndex];
  const reloadOrder =
    reloadCallIndex === -1
      ? reload.mock.invocationCallOrder.at(-1)
      : reload.mock.invocationCallOrder[reloadCallIndex];
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
function expectRoomBeforeTargetContractLock(queryRaw: jest.Mock) {
  const queries = queryRaw.mock.calls.map(([query], index) => ({
    statement:
      (query as { strings?: readonly string[] }).strings?.join('?') ?? '',
    callOrder: queryRaw.mock.invocationCallOrder[index],
  }));
  const roomLock = queries.find(
    ({ statement }) =>
      statement.includes('FROM rooms') && statement.includes('FOR UPDATE'),
  );
  const contractLock = queries.find(
    ({ statement }) =>
      statement.includes('FROM contracts') && statement.includes('FOR UPDATE'),
  );

  expect(roomLock?.callOrder).toBeLessThan(contractLock?.callOrder ?? 0);
}
function mockRoomContractLocks(
  tx: { $queryRaw: jest.Mock; contract?: Record<string, unknown> },
  contractId: number,
  roomId: number,
) {
  tx.contract ??= {};
  tx.contract.findUnique = jest
    .fn()
    .mockResolvedValue({ id: contractId, roomId });
  tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
    const statement = query.strings?.join('?') ?? '';
    if (statement.includes('FROM rooms')) return [{ id: roomId }];
    if (statement.includes('FROM contracts')) {
      return [{ id: contractId, roomId }];
    }
    return [{ id: 1 }];
  });
}

describe('DepositRefundsService', () => {
  it('serializes refund proof file sizes for JSON responses', async () => {
    const service = new DepositRefundsService({
      db: {
        depositRefund: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 1,
              files: [
                {
                  fileAsset: { id: 1, sizeBytes: 128n },
                },
              ],
            },
          ]),
        },
      },
    } as never);

    const result = await service.list();

    expect(result[0].files[0].fileAsset.sizeBytes).toBe('128');
  });
  it('accepts only the locked deposit plus prepayment refund total', async () => {
    const settlement = {
      id: 1,
      contractId: 3,
      status: 'APPROVED',
      handoverDate: new Date('2026-08-01'),
      finalReceivable: '0.00',
      depositRefundableAmount: '800.00',
      prepaymentRefundableAmount: '500.00',
      prepaymentBalance: '500.00',
      contract: { status: 'PENDING_CHECKOUT' },
    };
    const create = jest.fn().mockResolvedValue({ id: 9 });
    const harness = transactional({
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(settlement),
      },
      fileAsset: { findMany: jest.fn().mockResolvedValue([{ id: 4 }]) },
      depositRefund: { create },
    });
    const service = new DepositRefundsService({
      db: harness.db,
    } as never);
    const dto = {
      checkoutSettlementId: 1,
      refundAmount: '1300.00',
      refundDate: '2026-08-02',
      refundMethod: 'BANK_TRANSFER',
      proofFileIds: [4],
    } as never;

    await expect(
      service.submit(dto, { id: 2, username: 'admin', role: 'ADMIN' }),
    ).resolves.toEqual({ id: 9 });
    await expect(
      service.submit(
        { ...dto, refundAmount: '1299.99' },
        { id: 2, username: 'admin', role: 'ADMIN' },
      ),
    ).rejects.toThrow('退款金额必须等于结算单锁定的合计应退金额');
    expect(create).toHaveBeenCalledTimes(1);
    expectContractMutationOrder(
      'depositRefund.submit',
      harness.client.$queryRaw,
      harness.client.checkoutSettlement.findUniqueOrThrow,
      create,
      0,
    );
  });

  it('allows refund registration after a required supplemental receivable is fully collected', async () => {
    const create = jest.fn().mockResolvedValue({ id: 9 });
    const service = new DepositRefundsService({
      db: transactional({
        checkoutSettlement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 1,
            contractId: 3,
            status: 'APPROVED',
            handoverDate: new Date('2026-08-01'),
            finalReceivable: '150.00',
            supplementalRequired: true,
            supplementalOutstandingAmount: '0.00',
            depositRefundableAmount: '800.00',
            prepaymentRefundableAmount: '0.00',
            contract: { status: 'PENDING_CHECKOUT' },
          }),
        },
        fileAsset: { findMany: jest.fn().mockResolvedValue([{ id: 4 }]) },
        depositRefund: { create },
      }).db,
    } as never);

    await expect(
      service.submit(
        {
          checkoutSettlementId: 1,
          refundAmount: '800.00',
          refundDate: '2026-08-02',
          refundMethod: 'CASH',
          proofFileIds: [4],
        } as never,
        { id: 2, username: 'admin', role: 'ADMIN' },
      ),
    ).resolves.toEqual({ id: 9 });
  });
  it('writes deposit and prepayment refund transactions when a combined refund is approved', async () => {
    const depositTransactionCreate = jest.fn();
    const prepaymentTransactionCreate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      depositRefund: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          refundAmount: '1300.00',
          approvalStatus: 'PENDING',
          files: [{ fileAssetId: 4 }],
          checkoutSettlement: {
            id: 8,
            status: 'APPROVED',
            handoverDate: new Date('2026-08-01'),
            finalReceivable: '0.00',
            depositRefundableAmount: '800.00',
            prepaymentRefundableAmount: '500.00',
            prepaymentBalance: '500.00',
            contract: {
              status: 'PENDING_CHECKOUT',
              roomId: 7,
              room: { roomStatus: 'PENDING_CHECKOUT' },
            },
          },
        }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '800.00' }),
        create: depositTransactionCreate,
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '500.00' }),
        create: prepaymentTransactionCreate,
      },
      fileAsset: { updateMany: jest.fn() },
      checkoutSettlement: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: 3, roomId: 7 }),
        update: jest.fn(),
      },
      room: { update: jest.fn() },
      roomStatusHistory: { create: jest.fn() },
    };
    mockRoomContractLocks(tx, 3, 7);
    const transaction = jest.fn(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const service = new DepositRefundsService({
      db: {
        $transaction: transaction,
      },
    } as never);

    await service.approve(1, { id: 1, username: 'root', role: 'SUPER_ADMIN' });

    expect(depositTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ transactionType: 'REFUND' }),
      }),
    );
    expect(
      depositTransactionCreate.mock.calls[0][0].data.amount.toString(),
    ).toBe('800');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(5);
    expect(prepaymentTransactionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ transactionType: 'REFUND' }),
      }),
    );
    expect(
      prepaymentTransactionCreate.mock.calls[0][0].data.amount.toString(),
    ).toBe('500');
    expectContractMutationOrder(
      'depositRefund.approve',
      tx.$queryRaw,
      tx.depositRefund.findUniqueOrThrow,
      tx.depositRefund.updateMany,
    );
    expectRoomBeforeTargetContractLock(tx.$queryRaw);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  });

  it('rejects duplicate refund approval before creating any ledger transaction', async () => {
    const ledgerCreate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      depositRefund: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          refundAmount: '800.00',
          approvalStatus: 'PENDING',
          files: [{ fileAssetId: 4 }],
          checkoutSettlement: {
            id: 8,
            status: 'APPROVED',
            handoverDate: new Date('2026-08-01'),
            finalReceivable: '0.00',
            depositRefundableAmount: '800.00',
            prepaymentRefundableAmount: '0.00',
            contract: {
              status: 'PENDING_CHECKOUT',
              roomId: 7,
              room: { roomStatus: 'PENDING_CHECKOUT' },
            },
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '800.00' }),
        create: ledgerCreate,
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '0.00' }),
        create: jest.fn(),
      },
      fileAsset: { updateMany: jest.fn() },
      checkoutSettlement: { updateMany: jest.fn() },
      contract: { update: jest.fn() },
      room: { update: jest.fn() },
      roomStatusHistory: { create: jest.fn() },
    };
    mockRoomContractLocks(tx, 3, 7);
    const service = new DepositRefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.approve(1, { id: 1, username: 'root', role: 'SUPER_ADMIN' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('rejects deposit-refund submission and approval for a voided contract', async () => {
    const submitCreate = jest.fn();
    const submitHarness = transactional({
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'APPROVED',
          handoverDate: new Date('2026-08-01'),
          finalReceivable: '0.00',
          depositRefundableAmount: '800.00',
          prepaymentRefundableAmount: '0.00',
          contract: { status: 'VOIDED' },
        }),
      },
      depositRefund: { create: submitCreate },
    });
    const submitService = new DepositRefundsService({
      db: submitHarness.db,
    } as never);

    await expect(
      submitService.submit(
        {
          checkoutSettlementId: 1,
          refundAmount: '800.00',
          refundDate: '2026-08-02',
          refundMethod: 'BANK_TRANSFER',
          proofFileIds: [4],
        } as never,
        { id: 2, username: 'admin', role: 'ADMIN' },
      ),
    ).rejects.toThrow('已作废合同不能登记押金退款');
    expect(submitCreate).not.toHaveBeenCalled();
    expect(
      submitHarness.client.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      submitHarness.client.checkoutSettlement.findUniqueOrThrow.mock
        .invocationCallOrder[0],
    );

    const approveUpdate = jest.fn();
    const approveTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      depositRefund: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          refundAmount: '800.00',
          approvalStatus: 'PENDING',
          files: [{ fileAssetId: 4 }],
          checkoutSettlement: {
            id: 8,
            status: 'APPROVED',
            handoverDate: new Date('2026-08-01'),
            finalReceivable: '0.00',
            depositRefundableAmount: '800.00',
            prepaymentRefundableAmount: '0.00',
            contract: {
              status: 'VOIDED',
              roomId: 7,
              room: { roomStatus: 'PENDING_CHECKOUT' },
            },
          },
        }),
        updateMany: approveUpdate,
      },
    };
    mockRoomContractLocks(approveTx, 3, 7);
    const approveService = new DepositRefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof approveTx) => Promise<unknown>) =>
            callback(approveTx),
        ),
      },
    } as never);

    await expect(
      approveService.approve(1, {
        id: 1,
        username: 'root',
        role: 'SUPER_ADMIN',
      }),
    ).rejects.toThrow('已作废合同不能确认押金退款');
    expect(approveUpdate).not.toHaveBeenCalled();
    expectRoomBeforeTargetContractLock(approveTx.$queryRaw);
  });
});
