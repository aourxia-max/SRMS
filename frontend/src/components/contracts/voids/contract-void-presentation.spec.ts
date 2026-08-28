import { describe, expect, it } from 'vitest'
import { contractVoidCategoryLabel, contractVoidSourceHref, contractVoidStatusLabel } from './contract-void-presentation'

describe('合同作废中文展示', () => {
  it('为申请状态和冲销分类提供完整的中文名称', () => {
    expect(contractVoidStatusLabel('PENDING')).toBe('待确认')
    expect(contractVoidStatusLabel('COMPLETED')).toBe('已完成')
    expect(contractVoidStatusLabel('REJECTED')).toBe('已驳回')
    expect(contractVoidStatusLabel('CANCELLED')).toBe('已取消')
    expect(contractVoidCategoryLabel('RENT_BILL')).toBe('租金账单')
    expect(contractVoidCategoryLabel('PAYMENT')).toBe('收款')
    expect(contractVoidCategoryLabel('PAYMENT_ALLOCATION')).toBe('收款分配')
    expect(contractVoidCategoryLabel('PREPAYMENT')).toBe('预收款')
    expect(contractVoidCategoryLabel('DEPOSIT')).toBe('押金')
    expect(contractVoidCategoryLabel('REFUND')).toBe('退款')
    expect(contractVoidCategoryLabel('ADJUSTMENT')).toBe('账单调整')
    expect(contractVoidCategoryLabel('PRICING_REBATE')).toBe('租金退差')
    expect(contractVoidCategoryLabel('CHECKOUT')).toBe('退租结算')
    expect(contractVoidCategoryLabel('COMMISSION')).toBe('租房提成')
    expect(contractVoidCategoryLabel('ROOM_STATUS')).toBe('房态')
  })

  it('未知代码始终显示中文提示及原始值', () => {
    expect(contractVoidStatusLabel('WAITING')).toBe('未知状态（WAITING）')
    expect(contractVoidCategoryLabel('UNKNOWN_CATEGORY')).toBe('未知状态（UNKNOWN_CATEGORY）')
  })

  it.each([
    ['Contract', 86, '/contracts?tab=detail&contractId=86'],
    ['RentBill', 42, '/rent-bills?rentBillId=42'],
    ['Payment', 701, '/payments/detail/701'],
    ['CheckoutSettlement', 9, '/checkout?tab=completed&settlementId=9'],
  ])('为可安全定位的 %s 原记录生成深链', (sourceType, sourceId, expected) => {
    expect(contractVoidSourceHref(sourceType, sourceId)).toBe(expected)
  })

  it.each([
    ['PaymentAllocation', 33],
    ['UnknownSource', 33],
    ['Payment', null],
    ['Payment', 0],
    ['Payment', -1],
    ['Payment', 1.5],
  ])('不为不能安全定位的 %s #%s 生成链接', (sourceType, sourceId) => {
    expect(contractVoidSourceHref(sourceType, sourceId)).toBeNull()
  })
})
