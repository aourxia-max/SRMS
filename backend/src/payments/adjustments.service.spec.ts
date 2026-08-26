import { Prisma, UserRole } from '@prisma/client';
import { AdjustmentsService } from './adjustments.service';

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
      db: transactional({
        rentBill: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 19,
            status: 'PENDING',
            billCategory: 'CHECKOUT_SUPPLEMENTAL',
          }),
        },
        billAdjustment: { create },
      }).db,
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
      db: transactional({
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
      }).db,
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
    const submitHarness = transactional({
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
    });
    const submitService = new AdjustmentsService({
      db: submitHarness.db,
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
    expect(
      submitHarness.client.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      submitHarness.client.rentBill.findUniqueOrThrow.mock
        .invocationCallOrder[0],
    );

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
    const rejectHarness = transactional({
      billAdjustment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 501,
          approvalStatus: 'PENDING',
          rentBill: { contract: { status: 'VOIDED' } },
        }),
        update: rejectUpdate,
      },
    });
    const rejectService = new AdjustmentsService({
      db: rejectHarness.db,
    } as never);

    await expect(rejectService.reject(501, '信息有误', user)).rejects.toThrow(
      '已作废合同不能驳回账单调整',
    );
    expect(rejectUpdate).not.toHaveBeenCalled();
    expect(
      rejectHarness.client.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      rejectHarness.client.billAdjustment.findUniqueOrThrow.mock
        .invocationCallOrder[0],
    );
  });
});
