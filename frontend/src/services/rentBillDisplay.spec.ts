import { describe, expect, it } from 'vitest'
import { currentRentBillMonth, rentBillStatusInfo } from './rentBillDisplay'

describe('rent bill display helpers', () => {
  it('shows unperformed checkout bills as a Chinese accounting warning', () => {
    expect(rentBillStatusInfo('PENDING_CHECKOUT_REVIEW')).toEqual({ label: '待退租核算', type: 'warning' })
  })

  it('uses the current month as the initial bill filter', () => {
    expect(currentRentBillMonth(new Date('2026-08-05T12:00:00.000Z'))).toBe('2026-08')
  })

  it('maps frozen bill statuses to Chinese labels and safe colors', () => {
    expect(rentBillStatusInfo('PAID')).toEqual({ label: '已支付', type: 'success' })
    expect(rentBillStatusInfo('OVERDUE')).toEqual({ label: '逾期', type: 'danger' })
    expect(rentBillStatusInfo('UNKNOWN')).toEqual({ label: 'UNKNOWN', type: 'info' })
  })
})
