import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { resolveAllocationPlan } from './payment-policy';

describe('payment allocation policy', () => {
  const bills = [
    { id: 11, outstandingAmount: '100.00' },
    { id: 12, outstandingAmount: '200.00' },
    { id: 13, outstandingAmount: '300.00' },
  ];

  it('uses the earliest consecutive bills for an administrator', () => {
    const result = resolveAllocationPlan(
      bills,
      '250.00',
      [11, 12],
      UserRole.ADMIN,
    );

    expect(
      result.allocations.map((item) => ({
        bill: item.rentBillId,
        amount: item.amount.toFixed(2),
        order: item.allocationOrder,
        type: item.allocationType,
      })),
    ).toEqual([
      {
        bill: 11,
        amount: '100.00',
        order: 1,
        type: 'AUTO_OLDEST_FIRST',
      },
      {
        bill: 12,
        amount: '150.00',
        order: 2,
        type: 'AUTO_OLDEST_FIRST',
      },
    ]);
  });

  it('rejects an administrator who skips an earlier unpaid bill', () => {
    expect(() =>
      resolveAllocationPlan(bills, '100.00', [12], UserRole.ADMIN),
    ).toThrow(new BadRequestException('普通管理员不能跳过更早的未结账单'));
  });

  it('requires a reason when a super administrator allocates manually', () => {
    expect(() =>
      resolveAllocationPlan(bills, '100.00', [13], UserRole.SUPER_ADMIN),
    ).toThrow(new BadRequestException('手工调整收款分配时必须填写原因'));
  });

  it('preserves a super administrator manual order with a reason', () => {
    const result = resolveAllocationPlan(
      bills,
      '250.00',
      [13, 11],
      UserRole.SUPER_ADMIN,
      '租户指定冲抵账期，已复核',
    );

    expect(
      result.allocations.map((item) => [
        item.rentBillId,
        item.amount.toFixed(2),
        item.allocationOrder,
        item.allocationType,
      ]),
    ).toEqual([[13, '250.00', 1, 'MANUAL_SUPER_ADMIN']]);
    expect(result.manualOverride).toBe(true);
  });

  it('rejects duplicate or unknown bill ids', () => {
    expect(() =>
      resolveAllocationPlan(
        bills,
        '100.00',
        [11, 11],
        UserRole.SUPER_ADMIN,
        '复核',
      ),
    ).toThrow(new BadRequestException('选中的账单不能重复'));
    expect(() =>
      resolveAllocationPlan(
        bills,
        '100.00',
        [99],
        UserRole.SUPER_ADMIN,
        '复核',
      ),
    ).toThrow(new BadRequestException('所选账单不存在或不属于当前合同'));
  });

  it('moves the amount above selected balances to prepayment', () => {
    const result = resolveAllocationPlan(
      bills,
      '350.00',
      [11, 12],
      UserRole.ADMIN,
    );

    expect(result.prepaymentAmount.toFixed(2)).toBe('50.00');
  });
});
