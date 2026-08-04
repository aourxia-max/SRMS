import { describe, expect, it } from 'vitest'
import { refundAdjustmentDecisions, refundableAllocationTotal } from './payment-review'

describe('退款确认辅助规则', () => {
  it('仅为退款涉及账期的待确认或已确认且未撤销优惠生成决定', () => {
    const detail = {
      allocations: [{ paymentAllocation: { rentBill: { id: 11 } } }],
      payment: { adjustments: [
        { id: 1, rentBillId: 11, approvalStatus: 'PENDING', reversedByAdjustmentId: null },
        { id: 2, rentBillId: 11, approvalStatus: 'APPROVED', reversedByAdjustmentId: null },
        { id: 3, rentBillId: 12, approvalStatus: 'APPROVED', reversedByAdjustmentId: null },
        { id: 4, rentBillId: 11, approvalStatus: 'APPROVED', reversedByAdjustmentId: 99 },
      ] },
    }

    expect(refundAdjustmentDecisions(detail)).toEqual({
      1: { decision: 'REVERSE', keepReason: '' },
      2: { decision: 'REVERSE', keepReason: '' },
    })
  })

  it('退款默认金额是当前有效分配合计', () => {
    expect(refundableAllocationTotal([
      { effectiveAmount: '100.25' },
      { effectiveAmount: '20.00' },
    ])).toBe('120.25')
  })
})
