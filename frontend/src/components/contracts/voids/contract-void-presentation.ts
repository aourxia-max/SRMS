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

export const contractVoidRoomActionLabels: LabelMap = {
  KEEP_CURRENT_STATUS: '保持当前房态',
  RECALCULATE: '重新计算房态',
}

export const contractVoidSourceLabels: LabelMap = {
  RentBill: '租金账单',
  Payment: '收款',
  PaymentAllocation: '收款分配',
  PrepaymentLedger: '预收款台账',
  DepositLedger: '押金台账',
  PaymentRefund: '退款',
  BillAdjustment: '账单调整',
  PricingRebate: '租金退差',
  CheckoutSettlement: '退租结算',
  Commission: '租房提成',
  Room: '房源',
}

export const contractVoidWorkflowLabels: LabelMap = {
  adjustments: '待处理账单调整',
  refunds: '待处理退款',
  voidRequests: '待处理收款作废',
  depositRefunds: '待处理押金退款',
  changes: '待处理合同变更',
  rebates: '待处理租金退差',
  checkouts: '待处理退租',
}

export const contractVoidStatusLabel = (value?: ContractVoidRequestStatus | string | null) => contractVoidStatusLabels[value ?? ''] ?? unknownStatusLabel(value)
export const contractVoidCategoryLabel = (value?: ContractVoidReversalCategory | string | null) => contractVoidCategoryLabels[value ?? ''] ?? unknownStatusLabel(value)
export const contractVoidRoomActionLabel = (value?: string | null) => contractVoidRoomActionLabels[value ?? ''] ?? unknownStatusLabel(value)
export const contractVoidSourceLabel = (value?: string | null) => contractVoidSourceLabels[value ?? ''] ?? unknownStatusLabel(value)
export const contractVoidWorkflowLabel = (value?: string | null) => contractVoidWorkflowLabels[value ?? ''] ?? unknownStatusLabel(value)

export function contractVoidSourceHref(sourceType?: string | null, sourceId?: number | null) {
  if (!Number.isSafeInteger(sourceId) || Number(sourceId) <= 0) return null
  switch (sourceType) {
    case 'Contract': return `/contracts?tab=detail&contractId=${sourceId}`
    case 'RentBill': return `/rent-bills?rentBillId=${sourceId}`
    case 'Payment': return `/payments/detail/${sourceId}`
    case 'CheckoutSettlement': return `/checkout?tab=completed&settlementId=${sourceId}`
    default: return null
  }
}
