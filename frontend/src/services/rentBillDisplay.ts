import type { RentBillStatus } from './http'

export const rentBillStatusMap: Record<RentBillStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  PENDING: { label: '待支付', type: 'info' }, PARTIAL: { label: '部分支付', type: 'warning' }, PAID: { label: '已支付', type: 'success' },
  OVERDUE: { label: '逾期', type: 'danger' }, VOIDED: { label: '已作废', type: 'info' }, REFUNDED: { label: '已退款', type: 'info' },
}

export const currentRentBillMonth = (now = new Date()) => now.toISOString().slice(0, 7)
export const rentBillStatusInfo = (value: string) => rentBillStatusMap[value as RentBillStatus] ?? { label: value, type: 'info' as const }
