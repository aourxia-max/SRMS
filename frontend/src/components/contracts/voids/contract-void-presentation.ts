import type { ContractVoidRequestStatus, ContractVoidReversalCategory } from '../../../types/contracts'

type LabelMap = Record<string, string>

const unknownStatusLabel = (value?: string | null) => value ? `未知状态（${value}）` : '未知状态（未记录）'

export const contractVoidStatusLabels: LabelMap = {
  PENDING: '待确认',
  COMPLETED: '已完成',
  REJECTED: '已驳回',
  CANCELLED: '已取消',
}

export const contractVoidCategoryLabels: LabelMap = {
  RENT_BILL: '租金账单',
  PAYMENT: '收款',
  PAYMENT_ALLOCATION: '收款分配',
  PREPAYMENT: '预收款',
  DEPOSIT: '押金',
  REFUND: '退款',
  ADJUSTMENT: '账单调整',
  PRICING_REBATE: '租金退差',
  CHECKOUT: '退租结算',
  COMMISSION: '租房提成',
  ROOM_STATUS: '房态',
}

export const contractVoidStatusLabel = (value?: ContractVoidRequestStatus | string | null) => contractVoidStatusLabels[value ?? ''] ?? unknownStatusLabel(value)
export const contractVoidCategoryLabel = (value?: ContractVoidReversalCategory | string | null) => contractVoidCategoryLabels[value ?? ''] ?? unknownStatusLabel(value)
