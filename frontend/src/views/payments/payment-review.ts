type RefundDetail = {
  allocations?: Array<{ paymentAllocation?: { rentBill?: { id: number } } }>
  payment?: {
    adjustments?: Array<{
      id: number
      rentBillId: number
      approvalStatus: string
      reversedByAdjustmentId?: number | null
    }>
  }
}

export function refundAdjustmentDecisions(detail: RefundDetail) {
  const affectedBillIds = new Set(
    (detail.allocations ?? [])
      .map((item) => item.paymentAllocation?.rentBill?.id)
      .filter((id): id is number => typeof id === 'number'),
  )
  return Object.fromEntries(
    (detail.payment?.adjustments ?? [])
      .filter(
        (item) =>
          affectedBillIds.has(item.rentBillId) &&
          ['PENDING', 'APPROVED'].includes(item.approvalStatus) &&
          !item.reversedByAdjustmentId,
      )
      .map((item) => [item.id, { decision: 'REVERSE' as const, keepReason: '' }]),
  )
}

export function refundableAllocationTotal(
  allocations: Array<{ effectiveAmount: string }>,
) {
  return allocations
    .reduce((sum, item) => sum + Number(item.effectiveAmount), 0)
    .toFixed(2)
}
