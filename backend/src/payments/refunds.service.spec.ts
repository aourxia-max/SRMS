import { Prisma, RefundAdjustmentDecision, UserRole } from '@prisma/client';
import { RefundsService } from './refunds.service';

describe('RefundsService adjustment decisions', () => {
  const user = {
    id: 1,
    username: 'admin',
    displayName: '超级管理员',
    role: UserRole.SUPER_ADMIN,
  };

  function fixture() {
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
    };
    const refund = {
      id: 201,
      paymentId: 81,
      contractId: 7,
      refundAmount: '100.00',
      approvalStatus: 'PENDING',
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
});
