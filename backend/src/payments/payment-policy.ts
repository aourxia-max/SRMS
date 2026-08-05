import { BadRequestException } from '@nestjs/common';
import { PaymentAllocationType, UserRole } from '@prisma/client';
import { allocatePayment, type AllocatableBill } from './payment-allocation';

function sameOrder(left: number[], right: number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function resolveAllocationPlan(
  eligibleBills: AllocatableBill[],
  amount: string,
  selectedBillIds: number[] | undefined,
  role: UserRole,
  manualAllocationReason?: string,
) {
  const requestedIds = selectedBillIds?.length
    ? selectedBillIds
    : eligibleBills.map((bill) => bill.id);

  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new BadRequestException('选中的账单不能重复');
  }

  const billById = new Map(eligibleBills.map((bill) => [bill.id, bill]));
  if (requestedIds.some((id) => !billById.has(id))) {
    throw new BadRequestException('所选账单不存在或不属于当前合同');
  }

  const expectedPrefix = eligibleBills
    .slice(0, requestedIds.length)
    .map((bill) => bill.id);
  const manualOverride = !sameOrder(requestedIds, expectedPrefix);

  if (manualOverride && role !== UserRole.SUPER_ADMIN) {
    throw new BadRequestException('普通管理员不能跳过更早的未结账单');
  }
  if (manualOverride && !manualAllocationReason?.trim()) {
    throw new BadRequestException('手工调整收款分配时必须填写原因');
  }

  const selectedBills = requestedIds.map((id) => billById.get(id)!);
  const result = allocatePayment(amount, selectedBills);
  const allocationType = manualOverride
    ? PaymentAllocationType.MANUAL_SUPER_ADMIN
    : PaymentAllocationType.AUTO_OLDEST_FIRST;

  return {
    ...result,
    manualOverride,
    allocations: result.allocations.map((allocation) => ({
      ...allocation,
      allocationType,
    })),
  };
}
