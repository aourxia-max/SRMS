import type { RentBill } from '../../types/payments'

export function isPrefixSelection(bills: Pick<RentBill, 'id' | 'periodSeq'>[], selectedIds: number[]) {
  const ordered = [...bills].sort((a, b) => a.periodSeq - b.periodSeq)
  const selected = new Set(selectedIds)
  return ordered.every((bill, index) => selected.has(bill.id) === index < selectedIds.length)
}

export function nextSuggestedPaymentAmount(currentAmount: string, previousSuggestedAmount: string, effectiveOutstanding: number) {
  return currentAmount === previousSuggestedAmount
    ? effectiveOutstanding.toFixed(2)
    : currentAmount
}
export function selectedBillsOutstandingAmount(
  bills: Pick<RentBill, 'id' | 'outstandingAmount'>[],
  selectedIds: number[],
) {
  if (!selectedIds.length) return ''
  const selected = new Set(selectedIds)
  return bills
    .filter((bill) => selected.has(bill.id))
    .reduce((sum, bill) => sum + Math.max(0, Number(bill.outstandingAmount) || 0), 0)
    .toFixed(2)
}


export function eligibleAdjustmentBillIds(
  bills: Pick<RentBill, 'id' | 'outstandingAmount'>[],
  selectedIds: number[],
  payment: string | number,
  adjustment: string | number,
) {
  const billById = new Map(bills.map((bill) => [bill.id, bill]))
  let remainingCash = Math.max(0, Number(payment) || 0)
  const adjustmentAmount = Math.max(0, Number(adjustment) || 0)

  return selectedIds.filter((id) => {
    const bill = billById.get(id)
    if (!bill) return false
    const outstanding = Math.max(0, Number(bill.outstandingAmount) || 0)
    const allocated = Math.min(remainingCash, outstanding)
    remainingCash -= allocated
    return outstanding - allocated + Number.EPSILON >= adjustmentAmount && outstanding - allocated > 0
  })
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
