import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Prisma, UserRole } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../authorization/roles.decorator';
import {
  hashContractVoidImpact,
  computeContractVoidImpact,
} from './contract-void-impact';
import { ContractVoidController } from './contract-void.controller';
import { ContractVoidExecutorService } from './contract-void-executor.service';
import { ApproveContractVoidRequestDto } from './dto/contract-void.dto';

const superAdmin = {
  id: 1,
  username: 'root',
  displayName: '超级管理员',
  role: UserRole.SUPER_ADMIN,
};
const admin = { ...superAdmin, id: 2, role: UserRole.ADMIN };
const executionKey = 'execute-contract-void-0001';
const nowSource = '2026-08-01T00:00:00.000Z';

function snapshotInput() {
  return {
    contract: { id: 7, status: 'ACTIVE', roomId: 3 },
    bills: [
      {
        id: 11,
        status: 'PAID',
        payableAmount: '100.00',
        receivedAmount: '100.00',
        outstandingAmount: '0.00',
        occurredAt: nowSource,
      },
    ],
    payments: [
      {
        id: 21,
        status: 'CONFIRMED',
        amount: '100.00',
        allocatedAmount: '100.00',
        refundedAmount: '0.00',
        prepaymentNet: '0.00',
        occurredAt: nowSource,
      },
    ],
    refunds: [],
    prepaymentBalance: '0.00',
    depositBalance: '0.00',
    pending: {
      adjustments: [],
      refunds: [],
      voidRequests: [],
      changes: [],
      rebates: [],
      checkouts: [],
      depositRefunds: [],
    },
    completedCheckoutIds: [],
    laterContractIds: [],
    currentRoomStatus: 'RENTED',
    sourceSnapshot: {
      prepaymentBalanceSource: null,
      depositBalanceSource: null,
      contractMembers: [],
      paymentAllocations: [],
      adjustments: [],
      rebates: [],
      checkoutSettlements: [],
      commissions: [],
    },
  };
}

function currentSnapshot() {
  const input = snapshotInput();
  const impact = computeContractVoidImpact(input);
  const snapshot = { ...impact, sourceSnapshot: input.sourceSnapshot };
  return { input, snapshot, hash: hashContractVoidImpact(snapshot) };
}

function harness() {
  const { input, hash } = currentSnapshot();
  const request = {
    id: 9,
    requestNo: 'HTZF20260826000009',
    contractId: 7,
    status: 'PENDING',
    impactHash: hash,
    executionIdempotencyKey: null,
    resultSnapshot: null,
    contract: { contractNo: 'HT20260007', status: 'ACTIVE' },
  };
  const tx = {
    $queryRaw: jest.fn((query: { strings: string[] }) => {
      const sql = query.strings.join('?');
      if (sql.includes('contract_void_requests')) {
        return Promise.resolve([
          {
            ...request,
            id: BigInt(request.id),
            contractId: BigInt(request.contractId),
          },
        ]);
      }
      if (sql.includes('FROM rooms')) return Promise.resolve([{ id: 3 }]);
      if (sql.includes('FROM contracts')) {
        return Promise.resolve([
          {
            id: BigInt(7),
            roomId: BigInt(3),
            status: 'ACTIVE',
            contractNo: 'HT20260007',
          },
        ]);
      }
      return Promise.resolve([]);
    }),
    contractVoidRequest: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(request)),
      update: jest.fn().mockResolvedValue({}),
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ id: 7, roomId: 3 }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ status: 'VOIDED' }),
    },
    room: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 3,
        roomStatus: 'RENTED',
      }),
      update: jest.fn().mockResolvedValue({ roomStatus: 'EMPTY' }),
    },
    roomStatusHistory: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    operationLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const db = {
    contractVoidRequest: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const previews = { loadInput: jest.fn().mockResolvedValue(input) };
  const reversals = [
    {
      id: 1,
      category: 'PAYMENT',
      amount: '-100.00',
    },
  ];
  const writer = { write: jest.fn().mockResolvedValue(reversals) };
  const audit = {
    appendInTransaction: jest.fn().mockResolvedValue({ id: 1 }),
    appendAtomically: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const service = new ContractVoidExecutorService(
    { db } as never,
    previews as never,
    writer as never,
    audit,
  );
  return { service, tx, db, previews, writer, audit, request, hash, input };
}

describe('contract void approval input and endpoint', () => {
  it('validates exact confirmation, hash, and execution idempotency key', async () => {
    const invalid = plainToInstance(ApproveContractVoidRequestDto, {
      previewHash: 'BAD',
      confirmation: '确认作废',
      idempotencyKey: 'short',
    });
    const valid = plainToInstance(ApproveContractVoidRequestDto, {
      previewHash: 'a'.repeat(64),
      confirmation: '确认作废合同',
      idempotencyKey: executionKey,
    });

    expect(
      (await validate(invalid)).map((error) => error.property).sort(),
    ).toEqual(['confirmation', 'idempotencyKey', 'previewHash']);
    expect(await validate(valid)).toEqual([]);
  });

  it('exposes a super-admin-only approve endpoint and delegates all four inputs', async () => {
    const prototype = ContractVoidController.prototype as unknown as Record<
      string,
      object
    >;
    expect(Reflect.getMetadata(PATH_METADATA, prototype.approve)).toBe(
      'void-requests/:id/approve',
    );
    expect(Reflect.getMetadata(ROLES_KEY, prototype.approve)).toEqual([
      UserRole.SUPER_ADMIN,
    ]);
    const requests = {
      approve: jest.fn().mockResolvedValue({ status: 'COMPLETED' }),
    };
    const controller = Reflect.construct(ContractVoidController, [
      requests,
      {},
      {},
    ]) as ContractVoidController;
    const dto = {
      previewHash: 'a'.repeat(64),
      confirmation: '确认作废合同',
      idempotencyKey: executionKey,
    };

    await expect(controller.approve(9, dto, superAdmin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { status: 'COMPLETED' },
    });
    expect(requests.approve).toHaveBeenCalledWith(9, dto, superAdmin);
  });
});

describe('ContractVoidExecutorService', () => {
  it('executes the whole correction atomically after ordered row locks', async () => {
    const { service, tx, db, previews, writer, audit, hash } = harness();

    await expect(
      service.execute(9, hash, '确认作废合同', executionKey, superAdmin),
    ).resolves.toMatchObject({
      status: 'COMPLETED',
      contractStatus: 'VOIDED',
      requestId: 9,
      impactHash: hash,
      roomAction: 'RECALCULATE',
      roomStatusBefore: 'RENTED',
      roomStatusAfter: 'EMPTY',
    });
    const lockOrder = tx.$queryRaw.mock.calls.map(([query]) =>
      query.strings.join('?'),
    );
    expect(lockOrder).toEqual([
      expect.stringContaining('rooms'),
      expect.stringContaining('contracts'),
      expect.stringContaining('contract_void_requests'),
      expect.stringContaining('contract_members'),
      expect.stringContaining('contract_concessions'),
      expect.stringContaining('rent_bills'),
      expect.stringContaining('payments'),
      expect.stringContaining('contract_changes'),
      expect.stringContaining('bill_adjustments'),
      expect.stringContaining('payment_allocations'),
      expect.stringContaining('payment_refunds'),
      expect.stringContaining('payment_void_requests'),
      expect.stringContaining('prepayment_transactions'),
      expect.stringContaining('pricing_rebates'),
      expect.stringContaining('checkout_settlements'),
      expect.stringContaining('checkout_settlement_items'),
      expect.stringContaining('checkout_rent_refund_allocations'),
      expect.stringContaining('deposit_refunds'),
      expect.stringContaining('deposit_transactions'),
      expect.stringContaining('contract_commissions'),
    ]);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(tx.contractVoidRequest.findUnique).toHaveBeenCalledWith({
      where: { id: 9 },
      select: { contractId: true },
    });
    expect(tx.contract.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { id: true, roomId: true },
    });
    expect(tx.contract.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0],
    );
    expect(previews.loadInput.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.$queryRaw.mock.invocationCallOrder.at(-1)!,
    );
    expect(writer.write).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: 9, operatorId: 1 }),
      expect.objectContaining({ sourceSnapshot: expect.any(Object) }),
      expect.any(Date),
    );
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { status: 'VOIDED' },
    });
    expect(tx.contract.findMany).toHaveBeenCalledWith({
      where: {
        roomId: 3,
        id: { not: 7 },
        status: { in: ['PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT'] },
      },
      orderBy: { id: 'asc' },
      select: { status: true },
    });
    expect(tx.room.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { roomStatus: 'EMPTY', statusChangedAt: expect.any(Date) },
    });
    expect(tx.roomStatusHistory.create).toHaveBeenCalledWith({
      data: {
        roomId: 3,
        fromStatus: 'RENTED',
        toStatus: 'EMPTY',
        changeReason: '合同作废纠错后重算房态',
        businessType: 'CONTRACT_VOID',
        businessId: 9,
        changedBy: 1,
        changedAt: expect.any(Date),
      },
    });
    expect(tx.contractVoidRequest.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        status: 'COMPLETED',
        activeContractKey: null,
        completedContractKey: 'contract:7',
        executionIdempotencyKey: executionKey,
        resultSnapshot: expect.objectContaining({ status: 'COMPLETED' }),
      }),
    });
    expect(audit.appendInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: 'CONTRACT_VOID_COMPLETED',
        entityType: 'CONTRACT_VOID_REQUEST',
        entityId: 9,
        operatorId: 1,
        eventData: expect.objectContaining({
          requestNo: 'HTZF20260826000009',
          contractNo: 'HT20260007',
          impactHash: hash,
          categoryTotals: { PAYMENT: '-100.00' },
          roomAction: 'RECALCULATE',
          roomStatusBefore: 'RENTED',
          roomStatusAfter: 'EMPTY',
          beforeStatus: 'ACTIVE',
          afterStatus: 'VOIDED',
        }),
      }),
    );
    expect(audit.appendAtomically).not.toHaveBeenCalled();
  });

  it('keeps the current room status when another active contract exists', async () => {
    const { service, tx, hash } = harness();
    tx.contract.findMany.mockResolvedValue([{ status: 'ACTIVE' }]);

    await expect(
      service.execute(9, hash, '确认作废合同', executionKey, superAdmin),
    ).resolves.toMatchObject({
      roomAction: 'KEEP_CURRENT_STATUS',
      roomStatusBefore: 'RENTED',
      roomStatusAfter: 'RENTED',
    });
    expect(tx.room.update).not.toHaveBeenCalled();
    expect(tx.roomStatusHistory.create).not.toHaveBeenCalled();
  });

  it('rolls back by propagating reversal failures before any terminal update', async () => {
    const { service, tx, writer, audit, hash } = harness();
    writer.write.mockRejectedValue(new Error('forced reversal failure'));

    await expect(
      service.execute(9, hash, '确认作废合同', executionKey, superAdmin),
    ).rejects.toThrow('forced reversal failure');
    expect(tx.contract.update).not.toHaveBeenCalled();
    expect(tx.contractVoidRequest.update).not.toHaveBeenCalled();
    expect(tx.room.update).not.toHaveBeenCalled();
    expect(audit.appendInTransaction).not.toHaveBeenCalled();
  });

  it('fails closed inside the locked execution when a prepayment transfer appears after preview', async () => {
    const { service, tx, writer, input, request } = harness();
    input.sourceSnapshot.prepaymentTransfers = [
      { id: 301, transactionType: 'TRANSFER_IN' },
    ];

    const hash = hashContractVoidImpact({
      ...computeContractVoidImpact(input),
      sourceSnapshot: input.sourceSnapshot,
    });
    request.impactHash = hash;
    await expect(
      service.execute(9, hash, '确认作废合同', executionKey, superAdmin),
    ).rejects.toThrow('存在预收款转账记录，暂不支持自动合同纠错，请人工核对');
    expect(writer.write).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it('rejects a stale combined impact and source-snapshot hash in the transaction', async () => {
    const { service, tx, writer, hash, input } = harness();
    input.sourceSnapshot.commissions.push({
      id: 111,
      amount: '500.00',
      occurredAt: nowSource,
      deletedAt: null,
    });

    await expect(
      service.execute(9, hash, '确认作废合同', executionKey, superAdmin),
    ).rejects.toThrow('合同关联数据已变化，请重新预览');
    expect(writer.write).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it('enforces super-admin authorization and the exact confirmation text in the backend', async () => {
    const { service, db, hash } = harness();

    await expect(
      service.execute(9, hash, '确认作废合同', executionKey, admin),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.execute(9, hash, ' 确认作废合同', executionKey, superAdmin),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.execute(9, hash, '确认作废合同 ', executionKey, superAdmin),
    ).rejects.toThrow('请输入“确认作废合同”以继续');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('returns the stored result for the same completed execution key', async () => {
    const { service, tx, writer, hash, request } = harness();
    const result = {
      requestId: 9,
      requestNo: request.requestNo,
      status: 'COMPLETED',
      contractId: 7,
      contractNo: 'HT20260007',
      contractStatus: 'VOIDED',
      impactHash: hash,
      executionBatchNo: 'HTZFZX-9',
      reversalCount: 2,
      categoryTotals: { PAYMENT: '-100.00' },
      roomAction: 'RECALCULATE',
      roomStatusBefore: 'RENTED',
      roomStatusAfter: 'RENTED',
    };
    Object.assign(request, {
      status: 'COMPLETED',
      executionIdempotencyKey: executionKey,
      resultSnapshot: result,
      contract: { contractNo: 'HT20260007', status: 'VOIDED' },
    });

    await expect(
      service.execute(9, hash, '确认作废合同', executionKey, superAdmin),
    ).resolves.toEqual(result);
    expect(writer.write).not.toHaveBeenCalled();
    expect(tx.contract.update).not.toHaveBeenCalled();
  });

  it('rejects a different execution key after completion', async () => {
    const { service, writer, hash, request } = harness();
    Object.assign(request, {
      status: 'COMPLETED',
      executionIdempotencyKey: executionKey,
      resultSnapshot: { status: 'COMPLETED' },
      contract: { contractNo: 'HT20260007', status: 'VOIDED' },
    });

    await expect(
      service.execute(
        9,
        hash,
        '确认作废合同',
        'execute-contract-void-0002',
        superAdmin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.execute(
        9,
        hash,
        '确认作废合同',
        'execute-contract-void-0002',
        superAdmin,
      ),
    ).rejects.toThrow('合同已作废，不能重复冲销');
    expect(writer.write).not.toHaveBeenCalled();
  });

  it('serializes concurrent repeats so the reversal is written once', async () => {
    const { service, tx, db, writer, hash, request } = harness();
    let tail = Promise.resolve();
    db.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => {
        const running = tail.then(() => callback(tx));
        tail = running.then(
          () => undefined,
          () => undefined,
        );
        return running;
      },
    );
    tx.contractVoidRequest.update.mockImplementation(({ data }) => {
      Object.assign(request, data);
      return Promise.resolve(request);
    });

    const [left, right] = await Promise.all([
      service.execute(9, hash, '确认作废合同', executionKey, superAdmin),
      service.execute(9, hash, '确认作废合同', executionKey, superAdmin),
    ]);

    expect(left).toEqual(right);
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(tx.contract.update).toHaveBeenCalledTimes(1);
  });
  it('recovers only an execution-idempotency unique collision as a replay', async () => {
    const { service, db, hash, request } = harness();
    const stored = {
      status: 'COMPLETED',
      requestId: 9,
      requestNo: request.requestNo,
    };
    db.$transaction.mockRejectedValue({
      code: 'P2002',
      meta: {
        target: 'contract_void_requests_execution_idempotency_key_key',
      },
    });
    db.contractVoidRequest.findUnique.mockResolvedValue({
      ...request,
      status: 'COMPLETED',
      resultSnapshot: stored,
    });

    await expect(
      service.execute(9, hash, '确认作废合同', executionKey, superAdmin),
    ).resolves.toEqual(stored);
    expect(db.contractVoidRequest.findUnique).toHaveBeenCalledWith({
      where: { executionIdempotencyKey: executionKey },
    });
  });

  it.each([
    [
      'contract_void_requests_completed_contract_key_key',
      '合同已作废，不能重复冲销',
    ],
    [
      'contract_void_requests_execution_batch_no_key',
      '合同作废执行批次号冲突，请重试',
    ],
    [
      'prepayment_transactions_transaction_no_key',
      '合同作废冲销编号冲突，请联系系统管理员',
    ],
    ['unexpected_unique_key', '合同作废执行遇到唯一性冲突，请重试'],
  ])(
    'maps non-idempotency P2002 target %s accurately',
    async (target, message) => {
      const { service, db, hash } = harness();
      db.$transaction.mockRejectedValue({ code: 'P2002', meta: { target } });

      await expect(
        service.execute(9, hash, '确认作废合同', executionKey, superAdmin),
      ).rejects.toThrow(message);
      expect(db.contractVoidRequest.findUnique).not.toHaveBeenCalled();
    },
  );
});
