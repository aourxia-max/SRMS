import { describe, expect, it } from 'vitest'
import { allocationSummary, eligibleAdjustmentBillIds, isPrefixSelection, nextSuggestedPaymentAmount } from './payment-collection'

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

  it('填写优惠后自动将默认全额收款改为优惠后的实际应收', () => {
    expect(nextSuggestedPaymentAmount('1350.00', '1350.00', 1250)).toBe('1250.00')
  })

  it('填写优惠后不覆盖手工录入的部分收款金额', () => {
    expect(nextSuggestedPaymentAmount('500.00', '1350.00', 1250)).toBe('500.00')
  })

  it('multi-period discount can only target a bill with balance after cash allocation', () => {
    expect(eligibleAdjustmentBillIds(bills, [11, 12], '1650.00', '150.00')).toEqual([12])
  })
})
