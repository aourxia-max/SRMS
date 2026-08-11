import { describe, expect, it } from 'vitest'
import { paymentLifecycleTags } from './payment-lifecycle-tags'

describe('paymentLifecycleTags', () => {
  it('only shows the receipt type for a confirmed payment without completed lifecycle changes', () => {
    expect(paymentLifecycleTags({ receiptType: 'FORMAL', status: 'CONFIRMED' })).toEqual([
      { text: '正式票据', type: 'success' },
    ])
  })

  it('shows both completed correction and void states while keeping the receipt type', () => {
    expect(paymentLifecycleTags({
      receiptType: 'FORMAL',
      status: 'VOIDED',
      editReason: '更正收款方式',
    })).toEqual([
      { text: '正式票据', type: 'success' },
      { text: '已更正', type: 'info' },
      { text: '已作废', type: 'danger' },
    ])
  })

  it('distinguishes a partial refund from a full refund', () => {
    expect(paymentLifecycleTags({ receiptType: 'FORMAL', status: 'PARTIALLY_REFUNDED' }))
      .toContainEqual({ text: '部分退款', type: 'warning' })
    expect(paymentLifecycleTags({ receiptType: 'FORMAL', status: 'FULLY_REFUNDED' }))
      .toContainEqual({ text: '已退款', type: 'danger' })
  })

  it('does not infer completed lifecycle tags from an unchanged confirmed status', () => {
    expect(paymentLifecycleTags({ receiptType: 'PROVISIONAL', status: 'CONFIRMED', editReason: null }))
      .toEqual([{ text: '临时票据', type: 'warning' }])
  })
})