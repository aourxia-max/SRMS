import { Prisma, RefundAdjustmentDecision, UserRole } from '@prisma/client';
import { RefundsService } from './refunds.service';

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

describe('RefundsService adjustment decisions', () => {
  const user = {
    id: 1,
    username: 'admin',
    displayName: '超级管理员',
    role: UserRole.SUPER_ADMIN,
  };

  function fixture(reversedByAdjustmentId: number | null = null) {
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
    const adjustment = {
      id: 501,
      rentBillId: 11,
      adjustmentType: 'DISCOUNT',
      direction: 'DECREASE',
      amount: '50.00',
      approvalStatus: 'APPROVED',
      reason: '一次性优惠',
      reversedByAdjustmentId,
    };
    const refund = {
      id: 201,
      paymentId: 81,
      contractId: 7,
      refundAmount: '100.00',
      approvalStatus: 'PENDING',
      contract: { status: 'ACTIVE' },
      allocations: [
        {
          reversedAmount: new Prisma.Decimal('100.00'),
          paymentAllocation: {
            id: 101,
            allocatedAmount: new Prisma.Decimal('500.00'),
            reversedAmount: new Prisma.Decimal('0.00'),
            rentBill: bill,
          },
        },
      ],
      payment: {
        id: 81,
        amount: new Prisma.Decimal('500.00'),
        status: 'CONFIRMED',
        paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
        adjustments: [adjustment],
      },
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 201 }]),
      paymentRefund: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(refund),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { refundAmount: null },
        }),
        update: jest.fn().mockResolvedValue({
          ...refund,
          approvalStatus: 'APPROVED',
        }),
      },
      paymentAllocation: { update: jest.fn().mockResolvedValue({}) },
      rentBill: {
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([bill]),
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
      billAdjustment: {
        create: jest.fn().mockResolvedValue({ id: 502 }),
        update: jest.fn().mockResolvedValue({}),
      },
      paymentRefundAdjustmentDecision: {
        create: jest.fn().mockResolvedValue({}),
      },
      contract: { update: jest.fn().mockResolvedValue({}) },
      securityAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    return { tx, service: new RefundsService(prisma as never) };
  }

  it('defaults the business flow to an explicit reversal decision', async () => {
    const { tx, service } = fixture();

    await service.approve(
      201,
      {
        adjustmentDecisions: [
          {
            billAdjustmentId: 501,
            decision: RefundAdjustmentDecision.REVERSE,
          },
        ],
      },
      user,
    );

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
    expect(tx.paymentRefundAdjustmentDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentRefundId: 201,
        billAdjustmentId: 501,
        decision: 'REVERSE',
        reversalAdjustmentId: 502,
        decidedBy: 1,
      }),
    });
    expect(tx.rentBill.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({
        adjustmentAmount: expect.anything(),
        payableAmount: expect.anything(),
        outstandingAmount: expect.anything(),
      }),
    });
    expectContractMutationOrder(
      'refund.approve',
      tx.$queryRaw,
      tx.paymentRefund.findUniqueOrThrow,
      tx.billAdjustment.create,
    );
  });

  it('orders refund submit as contract lock, payment reload, then refund write', async () => {
    const firstWrite = jest.fn().mockResolvedValue({ id: 201 });
    const reload = jest.fn().mockResolvedValue({
      id: 81,
      contractId: 7,
      paymentCategory: 'RENT',
      status: 'CONFIRMED',
      contract: { status: 'ACTIVE' },
      allocations: [
        {
          id: 101,
          allocatedAmount: new Prisma.Decimal('100.00'),
          reversedAmount: new Prisma.Decimal('0.00'),
        },
      ],
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      payment: { findUniqueOrThrow: reload },
      paymentAllocation: { findFirst: jest.fn().mockResolvedValue(null) },
      checkoutRentRefundAllocation: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      paymentRefund: { create: firstWrite },
    };
    const service = new RefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.submit(
      {
        paymentId: 81,
        refundAmount: '100.00',
        refundDate: '2026-08-22',
        refundMethod: 'BANK_TRANSFER',
        reason: '测试退款',
        allocations: [{ paymentAllocationId: 101, amount: '100.00' }],
      } as never,
      user,
    );

    expectContractMutationOrder(
      'refund.submit',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
    const locks = tx.$queryRaw.mock.calls.map(([sql]) => ({
      statement:
        (sql as { strings?: readonly string[] }).strings?.join('?') ?? '',
      values: (sql as { values?: readonly unknown[] }).values,
    }));
    expect(
      locks.map(({ statement, values }) => ({
        table: [
          'contracts',
          'payments',
          'checkout_rent_refund_allocations',
        ].find((table) => statement.includes('FROM ' + table)),
        ordered:
          !statement.includes('checkout_rent_refund_allocations') ||
          statement.includes('ORDER BY crra.id FOR UPDATE'),
        values,
      })),
    ).toEqual([
      { table: 'contracts', ordered: true, values: [81] },
      { table: 'payments', ordered: true, values: [81] },
      {
        table: 'checkout_rent_refund_allocations',
        ordered: true,
        values: [81],
      },
    ]);
    expect(reload.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[2],
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
      tx.checkoutRentRefundAllocation.findFirst.mock.invocationCallOrder[0],
    );
    expect(
      tx.checkoutRentRefundAllocation.findFirst.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.paymentAllocation.findFirst.mock.invocationCallOrder[0]);
    expect(
      tx.paymentAllocation.findFirst.mock.invocationCallOrder[0],
    ).toBeLessThan(firstWrite.mock.invocationCallOrder[0]);
  });

  it('orders refund reject as contract lock, refund reload, then reject write', async () => {
    const firstWrite = jest.fn().mockResolvedValue({ id: 201 });
    const reload = jest.fn().mockResolvedValue({
      id: 201,
      approvalStatus: 'PENDING',
      contract: { status: 'ACTIVE' },
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 201 }]),
      paymentRefund: { findUniqueOrThrow: reload, update: firstWrite },
    };
    const service = new RefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.reject(201, '信息有误', user);

    expectContractMutationOrder(
      'refund.reject',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('requires a reason to keep an affected discount', async () => {
    const { service } = fixture();

    await expect(
      service.approve(
        201,
        {
          adjustmentDecisions: [
            {
              billAdjustmentId: 501,
              decision: RefundAdjustmentDecision.KEEP,
            },
          ],
        },
        user,
      ),
    ).rejects.toThrow('保留优惠时必须填写原因');
  });

  it('requires a decision for every affected discount', async () => {
    const { service } = fixture();

    await expect(
      service.approve(201, { adjustmentDecisions: [] }, user),
    ).rejects.toThrow('必须逐条确认受退款影响的优惠处理方式');
  });

  it('enforces super admin approval in the service layer', async () => {
    const { service } = fixture();

    await expect(
      service.approve(
        201,
        { adjustmentDecisions: [] },
        {
          ...user,
          role: UserRole.ADMIN,
        },
      ),
    ).rejects.toThrow('只有超级管理员可以确认退款');
  });

  it('does not reverse the same approved discount twice', async () => {
    const { tx, service } = fixture(502);

    await service.approve(201, { adjustmentDecisions: [] }, user);

    expect(tx.billAdjustment.create).not.toHaveBeenCalled();
    expect(tx.paymentRefundAdjustmentDecision.create).not.toHaveBeenCalled();
  });

  it('reopens the checkout supplemental balance after an approved refund', async () => {
    const { tx, service } = fixture(502);

    await service.approve(201, { adjustmentDecisions: [] }, user);

    expect(tx.checkoutSettlement.update).toHaveBeenCalledWith({
      where: { id: 901 },
      data: {
        supplementalReceivedAmount: expect.anything(),
        supplementalOutstandingAmount: expect.anything(),
        supplementalCollectedAt: null,
      },
    });
    const data = tx.checkoutSettlement.update.mock.calls[0][0].data;
    expect(data.supplementalReceivedAmount.toFixed(2)).toBe('400.00');
    expect(data.supplementalOutstandingAmount.toFixed(2)).toBe('100.00');
    expect(tx.rentBill.findMany).toHaveBeenCalledWith({
      where: { contractId: 7, billCategory: 'RENT' },
      orderBy: { periodSeq: 'asc' },
    });
  });

  it('rejects refunding a normal payment allocated to protected checkout arrears', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      payment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 81,
          contractId: 7,
          paymentCategory: 'RENT',
          status: 'CONFIRMED',
          contract: { status: 'ACTIVE' },
          allocations: [
            {
              id: 101,
              allocatedAmount: new Prisma.Decimal('100.00'),
              reversedAmount: new Prisma.Decimal('0.00'),
            },
          ],
        }),
      },
      paymentAllocation: {
        findFirst: jest.fn().mockResolvedValue({ id: 101 }),
      },
      checkoutRentRefundAllocation: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      paymentRefund: { create },
    };
    const service = new RefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submit(
        {
          paymentId: 81,
          refundAmount: '100.00',
          refundDate: '2026-08-22',
          refundMethod: 'BANK_TRANSFER',
          reason: '不应允许',
          allocations: [{ paymentAllocationId: 101, amount: '100.00' }],
        } as never,
        user,
      ),
    ).rejects.toThrow('该收款已用于退租补收锁定的欠租，不能修改、退款或作废');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects submitting a refund when the payment has an active checkout rent refund reservation', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      payment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 81,
          contractId: 7,
          paymentCategory: 'RENT',
          autoSourceKey: null,
          status: 'CONFIRMED',
          contract: { status: 'ACTIVE' },
          allocations: [
            {
              id: 101,
              paymentId: 81,
              rentBillId: 11,
              allocatedAmount: new Prisma.Decimal('100.00'),
              reversedAmount: new Prisma.Decimal('0.00'),
            },
          ],
        }),
      },
      paymentAllocation: {
        findFirst: jest.fn().mockResolvedValue({ id: 101 }),
      },
      checkoutRentRefundAllocation: {
        findFirst: jest.fn().mockResolvedValue({ id: 501 }),
      },
      paymentRefund: { create },
    };
    const service = new RefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submit(
        {
          paymentId: 81,
          refundAmount: '100.00',
          refundDate: '2026-08-22',
          refundMethod: 'BANK_TRANSFER',
          reason: '重复退款',
          allocations: [{ paymentAllocationId: 101, amount: '100.00' }],
        } as never,
        user,
      ),
    ).rejects.toThrow('相关租金已被退租退款流程占用，不能重复退款或作废。');
    expect(create).not.toHaveBeenCalled();
    expect(tx.paymentAllocation.findFirst).not.toHaveBeenCalled();
    const locks = tx.$queryRaw.mock.calls.map(([sql]) => ({
      statement:
        (sql as { strings?: readonly string[] }).strings?.join('?') ?? '',
      values: (sql as { values?: readonly unknown[] }).values,
    }));
    expect(
      locks.map(({ statement, values }) => ({
        table: [
          'contracts',
          'payments',
          'checkout_rent_refund_allocations',
        ].find((table) => statement.includes('FROM ' + table)),
        forUpdate: statement.includes('FOR UPDATE'),
        values,
      })),
    ).toEqual([
      { table: 'contracts', forUpdate: true, values: [81] },
      { table: 'payments', forUpdate: true, values: [81] },
      {
        table: 'checkout_rent_refund_allocations',
        forUpdate: true,
        values: [81],
      },
    ]);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.payment.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(
      tx.payment.findUniqueOrThrow.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[2]);
  });

  it('rejects refunding a contract automatic deposit payment', async () => {
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
          allocations: [
            {
              id: 101,
              allocatedAmount: new Prisma.Decimal('100.00'),
              reversedAmount: new Prisma.Decimal('0.00'),
            },
          ],
        }),
      },
      paymentRefund: { create },
    };
    const service = new RefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submit(
        {
          paymentId: 81,
          refundAmount: '100.00',
          refundDate: '2026-08-22',
          refundMethod: 'BANK_TRANSFER',
          reason: '不应允许',
          allocations: [{ paymentAllocationId: 101, amount: '100.00' }],
        } as never,
        user,
      ),
    ).rejects.toThrow(
      '合同自动入账押金不能通过通用收款修改、退款或作废，请使用押金专用流程',
    );
    expect(create).not.toHaveBeenCalled();
  });
  it('locks the contract and rejects a refund request after checkout completed', async () => {
    const create = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      payment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 81,
          contractId: 7,
          paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
          status: 'CONFIRMED',
          contract: { status: 'ACTIVE' },
          allocations: [
            {
              id: 101,
              allocatedAmount: new Prisma.Decimal('100.00'),
              reversedAmount: new Prisma.Decimal('0.00'),
            },
          ],
        }),
      },
      checkoutRentRefundAllocation: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      checkoutSettlement: {
        findFirst: jest.fn().mockResolvedValue({ status: 'COMPLETED' }),
      },
      paymentRefund: { create },
    };
    const service = new RefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submit(
        {
          paymentId: 81,
          refundAmount: '100.00',
          refundDate: '2026-08-22',
          refundMethod: 'BANK_TRANSFER',
          reason: '结算完成后不应允许',
          allocations: [{ paymentAllocationId: 101, amount: '100.00' }],
        } as never,
        user,
      ),
    ).rejects.toThrow('退租已完成，不能再退款或作废退租补收款');
    expect(create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
      tx.payment.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('rejects every refund mutation for a voided contract', async () => {
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
          allocations: [
            {
              id: 101,
              allocatedAmount: new Prisma.Decimal('100.00'),
              reversedAmount: new Prisma.Decimal('0.00'),
            },
          ],
        }),
      },
      paymentAllocation: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentRefund: { create: submitCreate },
    };
    const submitService = new RefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof submitTx) => Promise<unknown>) =>
            callback(submitTx),
        ),
      },
    } as never);

    await expect(
      submitService.submit(
        {
          paymentId: 81,
          refundAmount: '100.00',
          refundDate: '2026-08-22',
          refundMethod: 'BANK_TRANSFER',
          reason: '不应允许',
          allocations: [{ paymentAllocationId: 101, amount: '100.00' }],
        } as never,
        user,
      ),
    ).rejects.toThrow('已作废合同不能发起退款');
    expect(submitCreate).not.toHaveBeenCalled();

    const approve = fixture();
    const approval = await approve.tx.paymentRefund.findUniqueOrThrow();
    approval.contract.status = 'VOIDED';
    approve.tx.paymentRefund.findUniqueOrThrow.mockResolvedValue(approval);

    await expect(
      approve.service.approve(
        201,
        {
          adjustmentDecisions: [{ billAdjustmentId: 501, decision: 'REVERSE' }],
        },
        user,
      ),
    ).rejects.toThrow('已作废合同不能确认退款');
    expect(approve.tx.paymentRefund.update).not.toHaveBeenCalled();

    const rejectUpdate = jest.fn();
    const rejectTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 201 }]),
      paymentRefund: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 201,
          approvalStatus: 'PENDING',
          contract: { status: 'VOIDED' },
        }),
        update: rejectUpdate,
      },
    };
    const rejectService = new RefundsService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof rejectTx) => Promise<unknown>) =>
            callback(rejectTx),
        ),
      },
    } as never);

    await expect(rejectService.reject(201, '信息有误', user)).rejects.toThrow(
      '已作废合同不能驳回退款',
    );
    expect(rejectTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      rejectTx.paymentRefund.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(rejectTx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(rejectUpdate).not.toHaveBeenCalled();
  });
});
