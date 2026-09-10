import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertCheckoutArrearsComplete,
  assertCheckoutRentRefundPlanCurrent,
} from './checkout-accounting-validation';

describe('checkout accounting validation', () => {
  it('identifies missing arrears separately from a stale preview', () => {
    expect(() =>
      assertCheckoutArrearsComplete(
        [],
        [{ id: 1115, outstandingAmount: new Prisma.Decimal('760.00') }],
      ),
    ).toThrow(/欠租.*1115.*760\.00/);
  });
  it('identifies an incomplete arrears amount', () => {
    expect(() =>
      assertCheckoutArrearsComplete(
        [{ itemType: 'RENT_ARREARS', rentBillId: 1115, amount: '100.00' }],
        [{ id: 1115, outstandingAmount: new Prisma.Decimal('760.00') }],
      ),
    ).toThrow(/1115.*760\.00/);
  });
  it('rejects equal-total reservation details with duplicated payment references', () => {
    const reservation = {
      paymentAllocationId: 1,
      paymentId: 10,
      rentBillId: 20,
      reservedAmount: new Prisma.Decimal('50.00'),
    };
    expect(() =>
      assertCheckoutRentRefundPlanCurrent(
        [reservation, reservation],
        [
          {
            paymentAllocationId: 1,
            paymentId: 10,
            rentBillId: 20,
            amount: '50.00',
          },
          {
            paymentAllocationId: 2,
            paymentId: 11,
            rentBillId: 21,
            amount: '50.00',
          },
        ],
      ),
    ).toThrow(
      new ConflictException('实际退房日期或账单已变化，请重新预估结算金额'),
    );
  });

  it('accepts unchanged plans independently of database row ordering', () => {
    expect(() =>
      assertCheckoutRentRefundPlanCurrent(
        [
          {
            paymentAllocationId: 2,
            paymentId: 11,
            rentBillId: 21,
            reservedAmount: new Prisma.Decimal('40.00'),
          },
          {
            paymentAllocationId: 1,
            paymentId: 10,
            rentBillId: 20,
            reservedAmount: new Prisma.Decimal('60.00'),
          },
        ],
        [
          {
            paymentAllocationId: 1,
            paymentId: 10,
            rentBillId: 20,
            amount: '60.00',
          },
          {
            paymentAllocationId: 2,
            paymentId: 11,
            rentBillId: 21,
            amount: '40.00',
          },
        ],
      ),
    ).not.toThrow();
  });
});
