import { Prisma } from '@prisma/client';
import { reverseCompletedCheckoutAccounting } from './checkout-completed-reversal';

describe('reverseCompletedCheckoutAccounting', () => {
  it('cancels an approved combined refund and restores deposit and prepayment balances by reversal entries', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      depositRefund: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 5,
            approvalStatus: 'APPROVED',
            depositRefundAmount: new Prisma.Decimal('100.00'),
            prepaymentRefundAmount: new Prisma.Decimal('50.00'),
            rentRefundAmount: new Prisma.Decimal('0.00'),
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: new Prisma.Decimal(0) }),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: new Prisma.Decimal(0) }),
        create: jest.fn(),
      },
      checkoutRentRefundAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      rentBill: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
      billAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await expect(
      reverseCompletedCheckoutAccounting(tx as never, {
        settlementId: 9,
        contractId: 3,
        actualCheckoutDate: new Date('2026-09-04'),
        operatorId: 2,
        occurredAt: new Date('2026-09-04T10:00:00.000Z'),
      }),
    ).resolves.toEqual({
      cancelledRefundIds: [5],
      restoredDepositAmount: '100.00',
      restoredPrepaymentAmount: '50.00',
      restoredRentRefundAmount: '0.00',
      restoredFutureBillAmount: '0.00',
      restoredDepositOffsetAmount: '0.00',
      voidedSupplementalBillId: null,
    });

    expect(tx.depositRefund.updateMany).toHaveBeenCalledWith({
      where: { id: 5, approvalStatus: 'APPROVED' },
      data: {
        approvalStatus: 'CANCELLED',
        cancelledReason: '撤销已完成退租',
      },
    });
    expect(tx.depositTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 3,
        transactionType: 'REVERSAL',
        amount: new Prisma.Decimal('100.00'),
        balanceAfter: new Prisma.Decimal('100.00'),
        checkoutSettlementId: 9,
        depositRefundId: 5,
      }),
    });
    expect(tx.prepaymentTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 3,
        transactionType: 'REVERSAL',
        amount: new Prisma.Decimal('50.00'),
        balanceAfter: new Prisma.Decimal('50.00'),
      }),
    });
  });

  it('reverses an applied checkout rent refund on its bill and payment allocation', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      prepaymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      checkoutRentRefundAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 71,
            checkoutSettlementItemId: 81,
            paymentAllocationId: 21,
            paymentId: 11,
            rentBillId: 31,
            reservedAmount: new Prisma.Decimal('30.00'),
            status: 'APPLIED',
            depositRefundId: 5,
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      billAdjustment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 61,
            rentBillId: 31,
            amount: new Prisma.Decimal('30.00'),
            rentBill: {
              id: 31,
              payableAmount: new Prisma.Decimal('70.00'),
              receivedAmount: new Prisma.Decimal('70.00'),
              outstandingAmount: new Prisma.Decimal('0.00'),
              adjustmentAmount: new Prisma.Decimal('-30.00'),
            },
          },
        ]),
        create: jest.fn().mockResolvedValue({ id: 62 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rentBill: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
      paymentAllocation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 21, reversedAmount: new Prisma.Decimal('30.00') },
        ]),
        update: jest.fn(),
      },
      payment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          allocations: [
            {
              allocatedAmount: new Prisma.Decimal('100.00'),
              refundAllocations: [],
              checkoutRentRefundAllocations: [],
            },
          ],
        }),
        update: jest.fn(),
      },
    };

    await expect(
      reverseCompletedCheckoutAccounting(tx as never, {
        settlementId: 9,
        contractId: 3,
        actualCheckoutDate: new Date('2026-09-04'),
        operatorId: 2,
        occurredAt: new Date('2026-09-04T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ restoredRentRefundAmount: '30.00' });

    expect(tx.rentBill.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: expect.objectContaining({
        payableAmount: new Prisma.Decimal('100.00'),
        receivedAmount: new Prisma.Decimal('100.00'),
        outstandingAmount: new Prisma.Decimal('0.00'),
        status: 'PAID',
      }),
    });
    expect(tx.paymentAllocation.update).toHaveBeenCalledWith({
      where: { id: 21 },
      data: { reversedAmount: new Prisma.Decimal('0.00') },
    });
    expect(tx.checkoutRentRefundAllocation.updateMany).toHaveBeenCalledWith({
      where: { id: 71, status: 'APPLIED' },
      data: { status: 'RELEASED', releasedAt: new Date('2026-09-04T10:00:00.000Z') },
    });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { status: 'CONFIRMED' },
    });
  });

  it('restores future rent bills previously normalized by the checkout', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      prepaymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      checkoutRentRefundAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      billAdjustment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 81,
            rentBillId: 31,
            amount: new Prisma.Decimal('300.00'),
            rentBill: {
              id: 31,
              payableAmount: new Prisma.Decimal('0.00'),
              receivedAmount: new Prisma.Decimal('0.00'),
              adjustmentAmount: new Prisma.Decimal('-300.00'),
              dueDate: new Date('2026-10-05'),
            },
          },
        ]),
        create: jest.fn().mockResolvedValue({ id: 82 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rentBill: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      reverseCompletedCheckoutAccounting(tx as never, {
        settlementId: 9,
        contractId: 3,
        actualCheckoutDate: new Date('2026-09-04'),
        operatorId: 2,
        occurredAt: new Date('2026-09-04T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ restoredFutureBillAmount: '300.00' });

    expect(tx.rentBill.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: expect.objectContaining({
        payableAmount: new Prisma.Decimal('300.00'),
        outstandingAmount: new Prisma.Decimal('300.00'),
        status: 'PENDING',
      }),
    });
  });

  it('restores a rent bill and deposit balance previously offset by checkout', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: new Prisma.Decimal('0.00') }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 91,
            transactionType: 'OFFSET_ARREARS',
            amount: new Prisma.Decimal('80.00'),
            rentBillId: 31,
            rentBill: {
              id: 31,
              payableAmount: new Prisma.Decimal('100.00'),
              receivedAmount: new Prisma.Decimal('100.00'),
              dueDate: new Date('2026-09-01'),
            },
          },
        ]),
        create: jest.fn(),
      },
      prepaymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      checkoutRentRefundAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      billAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      rentBill: { update: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    };

    await expect(
      reverseCompletedCheckoutAccounting(tx as never, {
        settlementId: 9,
        contractId: 3,
        actualCheckoutDate: new Date('2026-09-04'),
        operatorId: 2,
        occurredAt: new Date('2026-09-04T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ restoredDepositOffsetAmount: '80.00' });

    expect(tx.rentBill.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: expect.objectContaining({
        receivedAmount: new Prisma.Decimal('20.00'),
        outstandingAmount: new Prisma.Decimal('80.00'),
        status: 'PARTIAL',
      }),
    });
    expect(tx.depositTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 3,
        transactionType: 'REVERSAL',
        amount: new Prisma.Decimal('80.00'),
        balanceAfter: new Prisma.Decimal('80.00'),
        checkoutSettlementId: 9,
        rentBillId: 31,
      }),
    });
  });

  it('voids an unpaid checkout supplemental bill', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      prepaymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      checkoutRentRefundAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      billAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      rentBill: {
        findUnique: jest.fn().mockResolvedValue({
          id: 41,
          receivedAmount: new Prisma.Decimal('0.00'),
        }),
        update: jest.fn(),
      },
    };

    await expect(
      reverseCompletedCheckoutAccounting(tx as never, {
        settlementId: 9,
        contractId: 3,
        actualCheckoutDate: new Date('2026-09-04'),
        operatorId: 2,
        occurredAt: new Date('2026-09-04T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ voidedSupplementalBillId: 41 });

    expect(tx.rentBill.update).toHaveBeenCalledWith({
      where: { id: 41 },
      data: { outstandingAmount: new Prisma.Decimal('0.00'), status: 'VOIDED' },
    });
  });
});
