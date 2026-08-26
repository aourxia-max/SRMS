import { Prisma, UserRole } from '@prisma/client';
import { VoidRequestsService } from './void-requests.service';

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

describe('VoidRequestsService adjustment reversal', () => {
  it('keeps the original discount and appends an approved reversal', async () => {
    const bill = {
      id: 11,
      contractId: 7,
      baseRentAmount: '550.00',
      rentFreeAmount: '0.00',
      discountAmount: '0.00',
      adjustmentAmount: '-50.00',
      payableAmount: '500.00',
      receivedAmount: '500.00',
      outstandingAmount: '0.00',
      status: 'PAID',
      periodSeq: 1,
      periodEnd: new Date('2026-08-31'),
      dueDate: new Date('2026-08-01'),
    };
    const request = {
      id: 301,
      paymentId: 81,
      reason: '整笔录入错误',
      approvalStatus: 'PENDING',
      payment: {
        id: 81,
        receiptNo: 'SK-TEST-81',
        contractId: 7,
        status: 'CONFIRMED',
        paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
        contract: { status: 'ACTIVE' },
        allocations: [
          {
            id: 101,
            allocatedAmount: new Prisma.Decimal('500.00'),
            reversedAmount: new Prisma.Decimal('0.00'),
            rentBill: bill,
          },
        ],
        prepaymentTransactions: [
          { id: 1, transactionType: 'CREDIT_RECEIPT', amount: '100.00' },
          { id: 2, transactionType: 'REVERSAL', amount: '100.00' },
          { id: 3, transactionType: 'CREDIT_RECEIPT', amount: '40.00' },
        ],
        adjustments: [
          {
            id: 501,
            rentBillId: 11,
            amount: new Prisma.Decimal('50.00'),
            approvalStatus: 'APPROVED',
          },
        ],
      },
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 301 }]),
      paymentVoidRequest: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(request),
        update: jest.fn().mockResolvedValue({
          ...request,
          approvalStatus: 'APPROVED',
        }),
      },
      paymentAllocation: { update: jest.fn().mockResolvedValue({}) },
      rentBill: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([bill]),
      },
      billAdjustment: {
        create: jest.fn().mockResolvedValue({ id: 502 }),
        update: jest.fn().mockResolvedValue({}),
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '40.00' }),
        create: jest.fn().mockResolvedValue({}),
      },
      payment: { update: jest.fn().mockResolvedValue({}) },
      checkoutSettlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: 901,
          supplementalArrearsAmount: new Prisma.Decimal('300.00'),
          supplementalInspectionAmount: new Prisma.Decimal('200.00'),
          supplementalReceivedAmount: new Prisma.Decimal('500.00'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      contract: { update: jest.fn().mockResolvedValue({}) },
      securityAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new VoidRequestsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.approve(301, {
      id: 1,
      username: 'admin',
      displayName: '超级管理员',
      role: UserRole.SUPER_ADMIN,
    });

    expect(tx.billAdjustment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rentBillId: 11,
        direction: 'INCREASE',
        amount: expect.anything(),
        approvalStatus: 'APPROVED',
      }),
    });
    expect(tx.billAdjustment.update).toHaveBeenCalledWith({
      where: { id: 501 },
      data: { reversedByAdjustmentId: 502 },
    });
    expect(tx.rentBill.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({
        adjustmentAmount: expect.anything(),
        payableAmount: expect.anything(),
        outstandingAmount: expect.anything(),
      }),
    });
    expect(tx.prepaymentTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionType: 'REVERSAL',
        amount: expect.objectContaining({}),
        balanceAfter: expect.objectContaining({}),
        paymentId: 81,
      }),
    });
    const reversal = tx.prepaymentTransaction.create.mock.calls[0][0].data;
    expect(reversal.amount.toFixed(2)).toBe('40.00');
    expect(reversal.balanceAfter.toFixed(2)).toBe('0.00');
    const settlementData = tx.checkoutSettlement.update.mock.calls[0][0].data;
    expect(settlementData.supplementalReceivedAmount.toFixed(2)).toBe('0.00');
    expect(settlementData.supplementalOutstandingAmount.toFixed(2)).toBe(
      '500.00',
    );
    expect(settlementData.supplementalCollectedAt).toBeNull();
    expect(tx.rentBill.findMany).toHaveBeenCalledWith({
      where: { contractId: 7, billCategory: 'RENT' },
      orderBy: { periodSeq: 'asc' },
    });
    expectContractMutationOrder(
      'paymentVoid.approve',
      tx.$queryRaw,
      tx.paymentVoidRequest.findUniqueOrThrow,
      tx.billAdjustment.create,
    );
  });

  it('orders payment void submit as contract lock, payment reload, then request write', async () => {
    const firstWrite = jest.fn().mockResolvedValue({ id: 301 });
    const reload = jest.fn().mockResolvedValue({
      id: 81,
      contractId: 7,
      paymentCategory: 'RENT',
      status: 'CONFIRMED',
      contract: { status: 'ACTIVE' },
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      payment: { findUniqueOrThrow: reload },
      paymentAllocation: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentVoidRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: firstWrite,
      },
    };
    const service = new VoidRequestsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);
    const user = {
      id: 1,
      username: 'admin',
      displayName: '超级管理员',
      role: UserRole.SUPER_ADMIN,
    };

    await service.submit({ paymentId: 81, reason: '录入错误' }, user);

    expectContractMutationOrder(
      'paymentVoid.submit',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('orders payment void reject as contract lock, request reload, then reject write', async () => {
    const firstWrite = jest.fn().mockResolvedValue({ id: 301 });
    const reload = jest.fn().mockResolvedValue({
      id: 301,
      approvalStatus: 'PENDING',
      payment: { contract: { status: 'ACTIVE' } },
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 301 }]),
      paymentVoidRequest: { findUniqueOrThrow: reload, update: firstWrite },
    };
    const service = new VoidRequestsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);
    const user = {
      id: 1,
      username: 'admin',
      displayName: '超级管理员',
      role: UserRole.SUPER_ADMIN,
    };

    await service.reject(301, '信息有误', user);

    expectContractMutationOrder(
      'paymentVoid.reject',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('enforces super admin approval in the service layer', async () => {
    const service = new VoidRequestsService({ db: {} } as never);

    await expect(
      service.approve(301, {
        id: 2,
        username: 'operator',
        displayName: '管理员',
        role: UserRole.ADMIN,
      }),
    ).rejects.toThrow('只有超级管理员可以确认作废');
  });

  it('rejects voiding a normal payment allocated to protected checkout arrears', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      payment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 81,
          contractId: 7,
          paymentCategory: 'RENT',
          status: 'CONFIRMED',
        }),
      },
      paymentAllocation: {
        findFirst: jest.fn().mockResolvedValue({ id: 101 }),
      },
      paymentVoidRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
    };
    const service = new VoidRequestsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submit(
        { paymentId: 81, reason: '不应允许' },
        {
          id: 1,
          username: 'admin',
          displayName: '超级管理员',
          role: UserRole.SUPER_ADMIN,
        },
      ),
    ).rejects.toThrow('该收款已用于退租补收锁定的欠租，不能修改、退款或作废');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects voiding a contract automatic deposit payment', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      payment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 81,
          contractId: 7,
          paymentCategory: 'DEPOSIT',
          autoSourceKey: 'CONTRACT_INITIAL_DEPOSIT:7',
          status: 'CONFIRMED',
        }),
      },
      paymentVoidRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
    };
    const service = new VoidRequestsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submit(
        { paymentId: 81, reason: '不应允许' },
        {
          id: 1,
          username: 'admin',
          displayName: '超级管理员',
          role: UserRole.SUPER_ADMIN,
        },
      ),
    ).rejects.toThrow(
      '合同自动入账押金不能通过通用收款修改、退款或作废，请使用押金专用流程',
    );
    expect(create).not.toHaveBeenCalled();
  });
  it('locks the contract and rejects a void request after checkout completed', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      payment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 81,
          contractId: 7,
          paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
          status: 'CONFIRMED',
        }),
      },
      checkoutSettlement: {
        findFirst: jest.fn().mockResolvedValue({ status: 'COMPLETED' }),
      },
      paymentVoidRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create,
      },
    };
    const service = new VoidRequestsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submit(
        { paymentId: 81, reason: '结算完成后不应允许' },
        {
          id: 1,
          username: 'admin',
          displayName: '超级管理员',
          role: UserRole.SUPER_ADMIN,
        },
      ),
    ).rejects.toThrow('退租已完成，不能再退款或作废退租补收款');
    expect(create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.payment.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('rejects every payment-void mutation for a voided contract', async () => {
    const user = {
      id: 1,
      username: 'admin',
      displayName: '超级管理员',
      role: UserRole.SUPER_ADMIN,
    };
    const submitCreate = jest.fn();
    const submitTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      payment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 81,
          contractId: 7,
          paymentCategory: 'RENT',
          status: 'CONFIRMED',
          contract: { status: 'VOIDED' },
        }),
      },
      paymentAllocation: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentVoidRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: submitCreate,
      },
    };
    const submitService = new VoidRequestsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof submitTx) => Promise<unknown>) =>
            callback(submitTx),
        ),
      },
    } as never);

    await expect(
      submitService.submit({ paymentId: 81, reason: '不应允许' }, user),
    ).rejects.toThrow('已作废合同不能发起收款作废');
    expect(submitCreate).not.toHaveBeenCalled();

    const approveRequest = {
      id: 301,
      paymentId: 81,
      reason: '不应允许',
      approvalStatus: 'PENDING',
      payment: {
        id: 81,
        contractId: 7,
        status: 'CONFIRMED',
        paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
        contract: { status: 'VOIDED' },
        allocations: [],
        prepaymentTransactions: [],
        adjustments: [],
      },
    };
    const approveTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 301 }]),
      paymentVoidRequest: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(approveRequest),
        update: jest.fn(),
      },
      payment: { update: jest.fn() },
    };
    const approveService = new VoidRequestsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof approveTx) => Promise<unknown>) =>
            callback(approveTx),
        ),
      },
    } as never);

    await expect(approveService.approve(301, user)).rejects.toThrow(
      '已作废合同不能确认收款作废',
    );
    expect(approveTx.payment.update).not.toHaveBeenCalled();

    const rejectUpdate = jest.fn();
    const rejectTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 301 }]),
      paymentVoidRequest: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 301,
          approvalStatus: 'PENDING',
          payment: { contract: { status: 'VOIDED' } },
        }),
        update: rejectUpdate,
      },
    };
    const rejectService = new VoidRequestsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof rejectTx) => Promise<unknown>) =>
            callback(rejectTx),
        ),
      },
    } as never);

    await expect(rejectService.reject(301, '信息有误', user)).rejects.toThrow(
      '已作废合同不能驳回收款作废',
    );
    expect(rejectTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      rejectTx.paymentVoidRequest.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(rejectTx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(rejectUpdate).not.toHaveBeenCalled();
  });
});
