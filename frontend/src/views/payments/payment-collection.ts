import type { RentBill } from '../../types/payments'

export function isPrefixSelection(bills: Pick<RentBill, 'id' | 'periodSeq'>[], selectedIds: number[]) {
  const ordered = [...bills].sort((a, b) => a.periodSeq - b.periodSeq)
  const selected = new Set(selectedIds)
  return ordered.every((bill, index) => selected.has(bill.id) === index < selectedIds.length)
}

export function allocationSummary(
  bills: Pick<RentBill, 'id' | 'outstandingAmount'>[],
  selectedIds: number[],
  adjustment: string | number,
  payment: string | number,
) {
  const selected = new Set(selectedIds)
  const originalOutstanding = bills.filter((bill) => selected.has(bill.id)).reduce((sum, bill) => sum + Number(bill.outstandingAmount), 0)
  const adjustmentAmount = Math.max(0, Number(adjustment) || 0)
  const effectiveOutstanding = Math.max(0, originalOutstanding - adjustmentAmount)
  const paymentAmount = Math.max(0, Number(payment) || 0)
  return { originalOutstanding, adjustmentAmount, effectiveOutstanding, paymentAmount, prepaymentAmount: Math.max(0, paymentAmount - effectiveOutstanding) }
}
