import { describe, expect, it } from 'vitest'
import { allocationSummary, isPrefixSelection } from './payment-collection'

const bills = [
  { id: 11, periodSeq: 1, outstandingAmount: '1000.00' },
  { id: 12, periodSeq: 2, outstandingAmount: '800.00' },
  { id: 13, periodSeq: 3, outstandingAmount: '900.00' },
]

describe('收款账期选择规则', () => {
  it('普通管理员只能从最早未结账期连续选择', () => {
    expect(isPrefixSelection(bills, [11, 12])).toBe(true)
    expect(isPrefixSelection(bills, [12])).toBe(false)
    expect(isPrefixSelection(bills, [11, 13])).toBe(false)
  })

  it('汇总原始应收、优惠和实际覆盖金额', () => {
    expect(allocationSummary(bills, [11, 12], '150', '1700')).toEqual({
      originalOutstanding: 1800,
      adjustmentAmount: 150,
      effectiveOutstanding: 1650,
      paymentAmount: 1700,
      prepaymentAmount: 50,
    })
  })
})
