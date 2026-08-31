import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DepositRefundsService } from './deposit-refunds.service';
import * as checkoutRentRefundWriter from './checkout-rent-refund-writer';
import * as futureBillNormalization from './checkout-future-bill-normalization';

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
  tx: {
    $queryRaw: jest.Mock;
    contract?: Record<string, unknown>;
    rentBill?: Record<string, unknown>;
    billAdjustment?: Record<string, unknown>;
  },
  contractId: number,
  roomId: number,
) {
  tx.contract ??= {};
  tx.contract.findUnique = jest
    .fn()
    .mockResolvedValue({ id: contractId, roomId });
  tx.rentBill ??= {};
  tx.rentBill.findMany ??= jest.fn().mockResolvedValue([]);
  tx.rentBill.update ??= jest.fn();
  tx.billAdjustment ??= {};
  tx.billAdjustment.findMany ??= jest.fn().mockResolvedValue([]);
  tx.billAdjustment.create ??= jest.fn();
  tx.billAdjustment.updateMany ??= jest.fn();
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
  it('accepts only the locked three-component refund total', async () => {
    const settlement = {
      id: 1,
      contractId: 3,
      status: 'APPROVED',
      handoverDate: new Date('2026-08-01'),
      finalReceivable: '0.00',
      depositRefundableAmount: '800.00',
      prepaymentRefundableAmount: '500.00',
      rentRefundableAmount: '0.00',
      prepaymentBalance: '500.00',
      contract: { id: 3, status: 'PENDING_CHECKOUT' },
    };
    const create = jest.fn().mockResolvedValue({ id: 9 });
    const harness = transactional({
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(settlement),
      },
      fileAsset: { findMany: jest.fn().mockResolvedValue([{ id: 4 }]) },
      depositRefund: { findFirst: jest.fn().mockResolvedValue(null), create },
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
    ).rejects.toThrow('退款金额必须等于结算单锁定的三类合计应退金额');
    expect(create).toHaveBeenCalledTimes(1);
    expectContractMutationOrder(
      'depositRefund.submit',
      harness.client.$queryRaw,
      harness.client.checkoutSettlement.findUniqueOrThrow,
      create,
      0,
    );
  });

  it('rejects submission when the settlement scalar and related contract disagree', async () => {
    const create = jest.fn();
    const harness = transactional({
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'APPROVED',
          handoverDate: new Date('2026-08-01'),
          finalReceivable: '0.00',
          depositRefundableAmount: '800.00',
          prepaymentRefundableAmount: '0.00',
          rentRefundableAmount: '0.00',
          contract: { id: 4, status: 'PENDING_CHECKOUT' },
        }),
      },
      fileAsset: { findMany: jest.fn().mockResolvedValue([{ id: 4 }]) },
      depositRefund: { findFirst: jest.fn().mockResolvedValue(null), create },
    });
    const service = new DepositRefundsService({ db: harness.db } as never);

    await expect(
      service.submit(
        {
          checkoutSettlementId: 1,
          refundAmount: '800.00',
          refundDate: '2026-08-02',
          refundMethod: 'BANK_TRANSFER',
          proofFileIds: [4],
        } as never,
        { id: 2, username: 'admin', role: 'ADMIN' },
      ),
    ).rejects.toThrow('结算单合同归属异常，不能登记退租合并退款');
    expect(create).not.toHaveBeenCalled();
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
            contract: { id: 3, status: 'PENDING_CHECKOUT' },
          }),
        },
        fileAsset: { findMany: jest.fn().mockResolvedValue([{ id: 4 }]) },
        depositRefund: { findFirst: jest.fn().mockResolvedValue(null), create },
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
          depositRefundAmount: '800.00',
          prepaymentRefundAmount: '500.00',
          rentRefundAmount: '0.00',
          approvalStatus: 'PENDING',
          files: [{ fileAssetId: 4 }],
          checkoutSettlement: {
            id: 8,
            contractId: 3,
            status: 'APPROVED',
            actualCheckoutDate: new Date('2026-08-13T00:00:00.000Z'),
            handoverDate: new Date('2026-08-01'),
            finalReceivable: '0.00',
            depositRefundableAmount: '800.00',
            prepaymentRefundableAmount: '500.00',
            rentRefundableAmount: '0.00',
            prepaymentBalance: '500.00',
            contract: {
              id: 3,
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
      fileAsset: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            category: 'DEPOSIT_REFUND_PROOF',
            lockedAt: null,
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
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
      securityAuditLog: { create: jest.fn() },
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
    expect(tx.$queryRaw).toHaveBeenCalledTimes(7);
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
          depositRefundAmount: '800.00',
          prepaymentRefundAmount: '0.00',
          rentRefundAmount: '0.00',
          approvalStatus: 'PENDING',
          files: [{ fileAssetId: 4 }],
          checkoutSettlement: {
            id: 8,
            contractId: 3,
            status: 'APPROVED',
            handoverDate: new Date('2026-08-01'),
            finalReceivable: '0.00',
            depositRefundableAmount: '800.00',
            prepaymentRefundableAmount: '0.00',
            rentRefundableAmount: '0.00',
            contract: {
              id: 3,
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
      fileAsset: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            category: 'DEPOSIT_REFUND_PROOF',
            lockedAt: null,
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
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
          contract: { id: 3, status: 'VOIDED' },
        }),
      },
      depositRefund: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: submitCreate,
      },
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
    ).rejects.toThrow('已作废合同不能登记退租合并退款');
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
            contractId: 3,
            status: 'APPROVED',
            handoverDate: new Date('2026-08-01'),
            finalReceivable: '0.00',
            depositRefundableAmount: '800.00',
            prepaymentRefundableAmount: '0.00',
            contract: {
              id: 3,
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
    ).rejects.toThrow('已作废合同不能确认退租合并退款');
    expect(approveUpdate).not.toHaveBeenCalled();
    expectRoomBeforeTargetContractLock(approveTx.$queryRaw);
  });

  it('records the locked deposit, prepayment, and rent split instead of client-supplied components', async () => {
    const create = jest.fn().mockResolvedValue({ id: 33 });
    const harness = transactional({
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 9,
          contractId: 4,
          status: 'APPROVED',
          handoverDate: new Date('2026-08-01'),
          finalReceivable: '0.00',
          depositRefundableAmount: '800.00',
          prepaymentRefundableAmount: '500.00',
          rentRefundableAmount: '100.00',
          contract: { id: 4, status: 'PENDING_CHECKOUT' },
        }),
      },
      checkoutRentRefundAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 501,
            paymentAllocationId: 101,
            paymentId: 11,
            rentBillId: 20,
            reservedAmount: new Prisma.Decimal('100.00'),
            item: {
              checkoutSettlementId: 9,
              itemType: 'RENT_REFUND',
              amount: new Prisma.Decimal('100.00'),
            },
            paymentAllocation: { paymentId: 11, rentBillId: 20 },
          },
        ]),
      },
      fileAsset: { findMany: jest.fn().mockResolvedValue([{ id: 4 }]) },
      depositRefund: { findFirst: jest.fn().mockResolvedValue(null), create },
    });
    const service = new DepositRefundsService({ db: harness.db } as never);
    const dto = {
      checkoutSettlementId: 9,
      refundAmount: '1400.00',
      refundDate: '2026-08-30',
      refundMethod: 'BANK_TRANSFER',
      proofFileIds: [4],
      depositRefundAmount: '0.01',
      prepaymentRefundAmount: '0.01',
      rentRefundAmount: '1399.98',
    } as never;

    await expect(
      service.submit(dto, { id: 2, username: 'admin', role: 'ADMIN' }),
    ).resolves.toEqual({ id: 33 });
    const data = create.mock.calls[0][0].data;
    expect({
      refundAmount: new Prisma.Decimal(data.refundAmount).toFixed(2),
      depositRefundAmount: new Prisma.Decimal(data.depositRefundAmount).toFixed(
        2,
      ),
      prepaymentRefundAmount: new Prisma.Decimal(
        data.prepaymentRefundAmount,
      ).toFixed(2),
      rentRefundAmount: new Prisma.Decimal(data.rentRefundAmount).toFixed(2),
    }).toEqual({
      refundAmount: '1400.00',
      depositRefundAmount: '800.00',
      prepaymentRefundAmount: '500.00',
      rentRefundAmount: '100.00',
    });

    await expect(
      service.submit(
        { ...dto, refundAmount: '1399.99' },
        { id: 2, username: 'admin', role: 'ADMIN' },
      ),
    ).rejects.toThrow('退款金额必须等于结算单锁定的三类合计应退金额');
    expect(create).toHaveBeenCalledTimes(1);
  });

  function combinedApprovalTx(
    refundOverrides: Record<string, unknown> = {},
    proofState: {
      id: number;
      category: string;
      lockedAt: Date | null;
    } = {
      id: 4,
      category: 'DEPOSIT_REFUND_PROOF',
      lockedAt: null,
    },
  ) {
    const depositLedgerWrite = jest.fn();
    const prepaymentLedgerWrite = jest.fn();
    const proofRead = jest.fn().mockImplementation(({ where }) => {
      const ids = new Set<number>(where.id.in);
      return ids.has(proofState.id) &&
        proofState.category === where.category &&
        proofState.lockedAt === where.lockedAt
        ? [{ ...proofState }]
        : [];
    });
    const proofWrite = jest.fn().mockImplementation(({ where, data }) => {
      const ids = new Set<number>(where.id.in);
      const categoryMatches =
        where.category === undefined || where.category === proofState.category;
      const lockMatches =
        where.lockedAt === undefined || where.lockedAt === proofState.lockedAt;
      if (!ids.has(proofState.id) || !categoryMatches || !lockMatches)
        return { count: 0 };
      proofState.lockedAt = data.lockedAt;
      return { count: 1 };
    });
    const settlementWrite = jest.fn().mockResolvedValue({ count: 1 });
    const contractWrite = jest.fn();
    const roomWrite = jest.fn();
    const historyWrite = jest.fn();
    const auditWrite = jest.fn();
    const refundStatusWrite = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      depositRefund: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 33,
          contractId: 4,
          checkoutSettlementId: 9,
          refundAmount: new Prisma.Decimal('1400.00'),
          depositRefundAmount: new Prisma.Decimal('800.00'),
          prepaymentRefundAmount: new Prisma.Decimal('500.00'),
          rentRefundAmount: new Prisma.Decimal('100.00'),
          refundDate: new Date('2026-08-30'),
          approvalStatus: 'PENDING',
          files: [{ fileAssetId: 4 }],
          checkoutSettlement: {
            id: 9,
            contractId: 4,
            status: 'APPROVED',
            actualCheckoutDate: new Date('2026-08-13T00:00:00.000Z'),
            handoverDate: new Date('2026-08-01'),
            finalReceivable: new Prisma.Decimal('0.00'),
            supplementalRequired: false,
            depositRefundableAmount: new Prisma.Decimal('800.00'),
            prepaymentRefundableAmount: new Prisma.Decimal('500.00'),
            rentRefundableAmount: new Prisma.Decimal('100.00'),
            targetRoomStatus: 'EMPTY',
            contract: {
              id: 4,
              status: 'PENDING_CHECKOUT',
              roomId: 7,
              room: { roomStatus: 'PENDING_CHECKOUT' },
            },
          },
          ...refundOverrides,
        }),
        updateMany: refundStatusWrite,
      },
      checkoutRentRefundAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 501,
            paymentAllocationId: 101,
            paymentId: 11,
            rentBillId: 20,
            reservedAmount: new Prisma.Decimal('100.00'),
            item: {
              checkoutSettlementId: 9,
              itemType: 'RENT_REFUND',
              amount: new Prisma.Decimal('100.00'),
            },
            paymentAllocation: { paymentId: 11, rentBillId: 20 },
          },
        ]),
      },
      rentBill: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      billAdjustment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '800.00' }),
        create: depositLedgerWrite,
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '500.00' }),
        create: prepaymentLedgerWrite,
      },
      fileAsset: { findMany: proofRead, updateMany: proofWrite },
      checkoutSettlement: { updateMany: settlementWrite },
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: 4, roomId: 7 }),
        update: contractWrite,
      },
      room: { update: roomWrite },
      roomStatusHistory: { create: historyWrite },
      securityAuditLog: { create: auditWrite },
    };
    mockRoomContractLocks(tx, 4, 7);
    return {
      tx,
      depositLedgerWrite,
      prepaymentLedgerWrite,
      proofRead,
      proofWrite,
      settlementWrite,
      contractWrite,
      roomWrite,
      historyWrite,
      auditWrite,
      refundStatusWrite,
    };
  }

  it('rejects a zero-rent refund whose contract differs from the settlement before any write', async () => {
    const harness = combinedApprovalTx();
    const refund = await harness.tx.depositRefund.findUniqueOrThrow({
      where: { id: 33 },
    });
    refund.refundAmount = new Prisma.Decimal('1300.00');
    refund.rentRefundAmount = new Prisma.Decimal('0.00');
    refund.checkoutSettlement.contractId = 5;
    refund.checkoutSettlement.rentRefundableAmount = new Prisma.Decimal('0.00');
    refund.checkoutSettlement.contract.id = 5;
    harness.tx.depositRefund.findUniqueOrThrow.mockResolvedValue(refund);
    const writer = jest.spyOn(
      checkoutRentRefundWriter,
      'applyCheckoutRentRefund',
    );
    const service = new DepositRefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof harness.tx) => Promise<unknown>) =>
            callback(harness.tx),
        ),
      },
    } as never);

    await expect(
      service.approve(33, {
        id: 1,
        username: 'root',
        role: 'SUPER_ADMIN',
      }),
    ).rejects.toThrow('退款申请与结算单合同归属不一致，不能确认退款');

    expect(harness.refundStatusWrite).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
    expect(harness.depositLedgerWrite).not.toHaveBeenCalled();
    expect(harness.prepaymentLedgerWrite).not.toHaveBeenCalled();
    expect(harness.proofWrite).not.toHaveBeenCalled();
    expect(harness.settlementWrite).not.toHaveBeenCalled();
    expect(harness.contractWrite).not.toHaveBeenCalled();
    expect(harness.roomWrite).not.toHaveBeenCalled();
    expect(harness.historyWrite).not.toHaveBeenCalled();
    expect(harness.auditWrite).not.toHaveBeenCalled();
    writer.mockRestore();
  });

  it('rejects a linked proof with the wrong category before claiming the refund', async () => {
    const proofState = {
      id: 4,
      category: 'PAYMENT_PROOF',
      lockedAt: null as Date | null,
    };
    const harness = combinedApprovalTx({}, proofState);
    const writer = jest
      .spyOn(checkoutRentRefundWriter, 'applyCheckoutRentRefund')
      .mockResolvedValue({
        appliedAmount: '100.00',
        affectedBillIds: [20],
        affectedPaymentIds: [11],
      });
    const service = new DepositRefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof harness.tx) => Promise<unknown>) =>
            callback(harness.tx),
        ),
      },
    } as never);

    try {
      await expect(
        service.approve(33, {
          id: 1,
          username: 'root',
          role: 'SUPER_ADMIN',
        }),
      ).rejects.toThrow('退款凭证不存在、类型不正确或已被其他业务占用');
      expect(harness.refundStatusWrite).not.toHaveBeenCalled();
      expect(writer).not.toHaveBeenCalled();
      expect(harness.depositLedgerWrite).not.toHaveBeenCalled();
      expect(harness.proofWrite).not.toHaveBeenCalled();
    } finally {
      writer.mockRestore();
    }
  });

  it('rejects a concurrent proof claim when the conditional update count changes', async () => {
    const harness = combinedApprovalTx();
    harness.proofWrite.mockResolvedValueOnce({ count: 0 });
    const writer = jest
      .spyOn(checkoutRentRefundWriter, 'applyCheckoutRentRefund')
      .mockResolvedValue({
        appliedAmount: '100.00',
        affectedBillIds: [20],
        affectedPaymentIds: [11],
      });
    const service = new DepositRefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof harness.tx) => Promise<unknown>) =>
            callback(harness.tx),
        ),
      },
    } as never);

    try {
      await expect(
        service.approve(33, {
          id: 1,
          username: 'root',
          role: 'SUPER_ADMIN',
        }),
      ).rejects.toThrow('退款凭证已被其他业务占用，请刷新后重试');
      expect(harness.refundStatusWrite).not.toHaveBeenCalled();
      expect(writer).not.toHaveBeenCalled();
      expect(harness.depositLedgerWrite).not.toHaveBeenCalled();
    } finally {
      writer.mockRestore();
    }
  });

  it('allows only the first of two refunds that share one proof to approve', async () => {
    const sharedProof = {
      id: 4,
      category: 'DEPOSIT_REFUND_PROOF',
      lockedAt: null as Date | null,
    };
    const first = combinedApprovalTx({ id: 33 }, sharedProof);
    const second = combinedApprovalTx({ id: 34 }, sharedProof);
    const writer = jest
      .spyOn(checkoutRentRefundWriter, 'applyCheckoutRentRefund')
      .mockResolvedValue({
        appliedAmount: '100.00',
        affectedBillIds: [20],
        affectedPaymentIds: [11],
      });
    const firstService = new DepositRefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof first.tx) => Promise<unknown>) =>
            callback(first.tx),
        ),
      },
    } as never);
    const secondService = new DepositRefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof second.tx) => Promise<unknown>) =>
            callback(second.tx),
        ),
      },
    } as never);

    try {
      await expect(
        firstService.approve(33, {
          id: 1,
          username: 'root',
          role: 'SUPER_ADMIN',
        }),
      ).resolves.toMatchObject({ id: 33 });
      await expect(
        secondService.approve(34, {
          id: 1,
          username: 'root',
          role: 'SUPER_ADMIN',
        }),
      ).rejects.toThrow('退款凭证不存在、类型不正确或已被其他业务占用');

      expect(first.refundStatusWrite).toHaveBeenCalledTimes(1);
      expect(second.refundStatusWrite).not.toHaveBeenCalled();
      expect(sharedProof.lockedAt).toBeInstanceOf(Date);
      const proofLockSql = first.tx.$queryRaw.mock.calls
        .map(
          ([query]) =>
            (query as { strings?: readonly string[] }).strings?.join('?') ?? '',
        )
        .find((sql) => sql.includes('FROM file_assets'));
      expect(proofLockSql).toContain('ORDER BY fa.id FOR UPDATE');
    } finally {
      writer.mockRestore();
    }
  });

  it('approves one external refund and atomically applies all three locked components', async () => {
    const harness = combinedApprovalTx();
    const normalizer = jest
      .spyOn(futureBillNormalization, 'normalizeFutureCheckoutBills')
      .mockResolvedValue({
        normalizedBillIds: [260],
        cancelledOutstandingAmount: '500.00',
      });
    const writer = jest
      .spyOn(checkoutRentRefundWriter, 'applyCheckoutRentRefund')
      .mockResolvedValue({
        appliedAmount: '100.00',
        affectedBillIds: [20],
        affectedPaymentIds: [11],
      });
    const service = new DepositRefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof harness.tx) => Promise<unknown>) =>
            callback(harness.tx),
        ),
      },
    } as never);

    try {
      await service.approve(33, {
        id: 1,
        username: 'root',
        role: 'SUPER_ADMIN',
      });

      expect(normalizer).toHaveBeenCalledWith(harness.tx, {
        settlementId: 9,
        contractId: 4,
        actualCheckoutDate: expect.any(Date),
        operatorId: 1,
        occurredAt: expect.any(Date),
      });
      expect(writer).toHaveBeenCalledWith(harness.tx, {
        settlementId: 9,
        depositRefundId: 33,
        approvedBy: 1,
        occurredAt: expect.any(Date),
      });
      expect(harness.depositLedgerWrite).toHaveBeenCalledTimes(1);
      expect(harness.prepaymentLedgerWrite).toHaveBeenCalledTimes(1);
      expect(harness.proofWrite).toHaveBeenCalledTimes(1);
      expect(harness.settlementWrite).toHaveBeenCalledWith({
        where: { id: 9, status: 'APPROVED' },
        data: { status: 'COMPLETED' },
      });
      expect(harness.contractWrite).toHaveBeenCalledWith({
        where: { id: 4 },
        data: { status: 'ENDED' },
      });
      expect(harness.roomWrite).toHaveBeenCalledTimes(1);
      expect(harness.historyWrite).toHaveBeenCalledTimes(1);
      expect(harness.auditWrite).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'CHECKOUT_REFUND_APPROVED',
          entityType: 'DEPOSIT_REFUND',
          entityId: 33,
          operatorId: 1,
          eventData: {
            checkoutSettlementId: 9,
            refundAmount: '1400.00',
            depositRefundAmount: '800.00',
            prepaymentRefundAmount: '500.00',
            rentRefundAmount: '100.00',
          },
        }),
      });
    } finally {
      normalizer.mockRestore();
      writer.mockRestore();
    }
  });

  it('rejects a tampered stored split before claiming or applying the refund', async () => {
    const harness = combinedApprovalTx({
      rentRefundAmount: new Prisma.Decimal('99.99'),
    });
    const writer = jest.spyOn(
      checkoutRentRefundWriter,
      'applyCheckoutRentRefund',
    );
    const service = new DepositRefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof harness.tx) => Promise<unknown>) =>
            callback(harness.tx),
        ),
      },
    } as never);

    await expect(
      service.approve(33, {
        id: 1,
        username: 'root',
        role: 'SUPER_ADMIN',
      }),
    ).rejects.toThrow('退款申请的三类锁定金额与结算单不一致');

    expect(harness.refundStatusWrite).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
    expect(harness.settlementWrite).not.toHaveBeenCalled();
    writer.mockRestore();
  });

  it('does not execute later ledger or final-state steps when rent accounting fails', async () => {
    const harness = combinedApprovalTx();
    const writer = jest
      .spyOn(checkoutRentRefundWriter, 'applyCheckoutRentRefund')
      .mockRejectedValue(new Error('模拟租金回冲失败'));
    const service = new DepositRefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof harness.tx) => Promise<unknown>) =>
            callback(harness.tx),
        ),
      },
    } as never);

    await expect(
      service.approve(33, {
        id: 1,
        username: 'root',
        role: 'SUPER_ADMIN',
      }),
    ).rejects.toThrow('模拟租金回冲失败');

    expect(harness.refundStatusWrite).toHaveBeenCalledTimes(1);
    expect(harness.depositLedgerWrite).not.toHaveBeenCalled();
    expect(harness.prepaymentLedgerWrite).not.toHaveBeenCalled();
    expect(harness.proofWrite).toHaveBeenCalledTimes(1);
    expect(harness.settlementWrite).not.toHaveBeenCalled();
    expect(harness.contractWrite).not.toHaveBeenCalled();
    expect(harness.roomWrite).not.toHaveBeenCalled();
    expect(harness.historyWrite).not.toHaveBeenCalled();
    expect(harness.auditWrite).not.toHaveBeenCalled();
    writer.mockRestore();
  });
});
