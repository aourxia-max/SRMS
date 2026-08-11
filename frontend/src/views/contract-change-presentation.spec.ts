import { describe, expect, it } from 'vitest'
import {
  contractChangeStatusLabel,
  contractChangeTypeLabel,
} from './contract-change-presentation'

describe('contract change presentation', () => {
  it('shows change types in Chinese instead of storage codes', () => {
    expect(contractChangeTypeLabel('RENT')).toBe('租金变更')
    expect(contractChangeTypeLabel('TERM')).toBe('租期变更')
    expect(contractChangeTypeLabel('PRIMARY_TENANT')).toBe('主承租人变更')
    expect(contractChangeTypeLabel('CONCESSION')).toBe('优惠变更')
  })

  it('shows approval statuses in Chinese instead of storage codes', () => {
    expect(contractChangeStatusLabel('PENDING')).toBe('待审批')
    expect(contractChangeStatusLabel('APPROVED')).toBe('已确认')
    expect(contractChangeStatusLabel('REJECTED')).toBe('已驳回')
  })

  it('keeps an unknown server code visible for investigation', () => {
    expect(contractChangeStatusLabel('UNKNOWN')).toBe('UNKNOWN')
  })
})