import { Prisma, UserRole } from '@prisma/client';
import { AdjustmentsService } from './adjustments.service';

describe('AdjustmentsService checkout supplemental protection', () => {
  const user = {
    id: 1,
    username: 'admin',
    displayName: '超级管理员',
    role: UserRole.SUPER_ADMIN,
  };

  it('rejects submitting an adjustment for a checkout supplemental bill', async () => {
    const create = jest.fn();
    const service = new AdjustmentsService({
      db: {
        rentBill: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 19,
            status: 'PENDING',
            billCategory: 'CHECKOUT_SUPPLEMENTAL',
          }),
        },
        billAdjustment: { create },
      },
    } as never);

    await expect(
      service.submit(
        {
          rentBillId: 19,
          adjustmentType: 'DISCOUNT',
          direction: 'DECREASE',
          amount: '10.00',
          reason: '不应允许',
        } as never,
        user,
      ),
    ).rejects.toThrow('退租补收账单不能优惠、减免或调整');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects approving an existing adjustment for a checkout supplemental bill', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      billAdjustment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 501,
          approvalStatus: 'PENDING',
          rentBillId: 19,
          direction: 'DECREASE',
          amount: new Prisma.Decimal('10.00'),
          rentBill: {
            id: 19,
            contractId: 7,
            status: 'PENDING',
            billCategory: 'CHECKOUT_SUPPLEMENTAL',
          },
        }),
        update: jest.fn(),
      },
      rentBill: { update: jest.fn() },
    };
    const service = new AdjustmentsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(service.approve(501, user)).rejects.toThrow(
      '退租补收账单不能优惠、减免或调整',
    );
    expect(tx.rentBill.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    expect(tx.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
      tx.billAdjustment.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });

  it('rejects adjusting original arrears locked by an approved checkout settlement', async () => {
    const create = jest.fn();
    const service = new AdjustmentsService({
      db: {
        rentBill: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 11,
            status: 'PARTIAL',
            billCategory: 'RENT',
          }),
        },
        checkoutSettlementItem: {
          findFirst: jest.fn().mockResolvedValue({ id: 51 }),
        },
        billAdjustment: { create },
      },
    } as never);

    await expect(
      service.submit(
        {
          rentBillId: 11,
          adjustmentType: 'DISCOUNT',
          direction: 'DECREASE',
          amount: '10.00',
          reason: '不应允许',
        } as never,
        user,
      ),
    ).rejects.toThrow('该欠租账单已锁定到退租补收，不能修改');
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects every adjustment mutation for a voided contract', async () => {
    const create = jest.fn();
    const submitService = new AdjustmentsService({
      db: {
        rentBill: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 11,
            status: 'PENDING',
            billCategory: 'RENT',
            payableAmount: '100.00',
            receivedAmount: '0.00',
            outstandingAmount: '100.00',
            adjustmentAmount: '0.00',
            contract: { status: 'VOIDED' },
          }),
        },
        checkoutSettlementItem: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        billAdjustment: { create },
      },
    } as never);

    await expect(
      submitService.submit(
        {
          rentBillId: 11,
          adjustmentType: 'DISCOUNT',
          direction: 'DECREASE',
          amount: '10.00',
          reason: '不应允许',
        } as never,
        user,
      ),
    ).rejects.toThrow('已作废合同不能提交账单调整');
    expect(create).not.toHaveBeenCalled();

    const approveTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      billAdjustment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 501,
          approvalStatus: 'PENDING',
          rentBillId: 11,
          direction: 'DECREASE',
          amount: new Prisma.Decimal('10.00'),
          rentBill: {
            id: 11,
            contractId: 7,
            status: 'PENDING',
            billCategory: 'RENT',
            contract: { status: 'VOIDED' },
          },
        }),
        update: jest.fn(),
      },
      checkoutSettlementItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      rentBill: { update: jest.fn() },
    };
    const approveService = new AdjustmentsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof approveTx) => Promise<unknown>) =>
            callback(approveTx),
        ),
      },
    } as never);

    await expect(approveService.approve(501, user)).rejects.toThrow(
      '已作废合同不能确认账单调整',
    );
    expect(approveTx.rentBill.update).not.toHaveBeenCalled();

    const rejectUpdate = jest.fn();
    const rejectService = new AdjustmentsService({
      db: {
        billAdjustment: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 501,
            approvalStatus: 'PENDING',
            rentBill: { contract: { status: 'VOIDED' } },
          }),
          update: rejectUpdate,
        },
      },
    } as never);

    await expect(rejectService.reject(501, '信息有误', user)).rejects.toThrow(
      '已作废合同不能驳回账单调整',
    );
    expect(rejectUpdate).not.toHaveBeenCalled();
  });
});
