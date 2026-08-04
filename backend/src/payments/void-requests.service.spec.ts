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
        allocations: [
          {
            id: 101,
            allocatedAmount: new Prisma.Decimal('500.00'),
            reversedAmount: new Prisma.Decimal('0.00'),
            rentBill: bill,
          },
        ],
        prepaymentTransactions: [],
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
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      payment: { update: jest.fn().mockResolvedValue({}) },
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
  });
});
