import { Prisma, UserRole } from '@prisma/client';
import { VoidRequestsService } from './void-requests.service';

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
});
