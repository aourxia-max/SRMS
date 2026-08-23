import { Prisma } from '@prisma/client';
import {
  assertNoPendingCheckoutSupplementalReversal,
  assertPaymentDoesNotTouchProtectedCheckoutArrears,
  assertRentBillNotProtectedByCheckout,
  reopenCheckoutSupplementalBalance,
} from './checkout-supplemental-balance';

describe('checkout supplemental safety', () => {
  it('rejects reopening a completed checkout settlement', async () => {
    const tx = {
      checkoutSettlement: {
        findFirst: jest.fn().mockResolvedValue({
          id: 901,
          status: 'COMPLETED',
          supplementalArrearsAmount: new Prisma.Decimal('300.00'),
          supplementalInspectionAmount: new Prisma.Decimal('200.00'),
          supplementalReceivedAmount: new Prisma.Decimal('500.00'),
        }),
        update: jest.fn(),
      },
    };

    await expect(
      reopenCheckoutSupplementalBalance(
        tx as never,
        7,
        'CHECKOUT_SUPPLEMENTAL',
        '100.00',
      ),
    ).rejects.toThrow('退租已完成，不能再退款或作废退租补收款');
    expect(tx.checkoutSettlement.update).not.toHaveBeenCalled();
  });

  it('blocks final checkout while a supplemental refund or void request is pending', async () => {
    const tx = {
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 81 }) },
    };

    await expect(
      assertNoPendingCheckoutSupplementalReversal(tx as never, 7),
    ).rejects.toThrow('退租补收款存在待审批退款或作废申请');
  });

  it('rejects changes to a rent bill protected by an approved checkout settlement', async () => {
    const tx = {
      checkoutSettlementItem: {
        findFirst: jest.fn().mockResolvedValue({ id: 51 }),
      },
    };

    await expect(
      assertRentBillNotProtectedByCheckout(tx as never, 11),
    ).rejects.toThrow('该欠租账单已锁定到退租补收，不能修改');
    expect(tx.checkoutSettlementItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          settlement: expect.objectContaining({
            status: { in: ['APPROVED', 'COMPLETED'] },
          }),
        }),
      }),
    );
  });

  it('rejects reversing a normal payment that touches protected checkout arrears', async () => {
    const tx = {
      paymentAllocation: {
        findFirst: jest.fn().mockResolvedValue({ id: 101 }),
      },
    };

    await expect(
      assertPaymentDoesNotTouchProtectedCheckoutArrears(tx as never, 81),
    ).rejects.toThrow('该收款已用于退租补收锁定的欠租，不能修改、退款或作废');
  });
});
