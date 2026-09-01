import { http } from './http'

export type ApprovalTaskCounts = {
  contractChanges: number
  fixedRentRebates: number
  contractVoidRequests: number
  billAdjustments: number
  paymentRefunds: number
  paymentVoidRequests: number
  checkoutSettlements: number
  depositRefunds: number
  contractsTotal: number
  paymentsTotal: number
  checkoutsTotal: number
  total: number
}

export type ApprovalTaskType =
  | 'CONTRACT_CHANGE'
  | 'PRICING_REBATE'
  | 'CONTRACT_VOID_REQUEST'
  | 'BILL_ADJUSTMENT'
  | 'PAYMENT_REFUND'
  | 'PAYMENT_VOID_REQUEST'
  | 'CHECKOUT_SETTLEMENT'
  | 'DEPOSIT_REFUND'

export type ApprovalTaskItem = {
  id: number
  type: ApprovalTaskType
  label: string
  businessNo: string
  contractId: number
  contractNo: string
  roomId: number
  fullHouseNo: string
  submittedAt: string | null
}

export type ApprovalTaskSummary = {
  counts: ApprovalTaskCounts
  items: ApprovalTaskItem[]
}

export async function getApprovalTaskCounts() {
  const response = await http.get<{ data: ApprovalTaskCounts }>('/approval-tasks/counts')
  return response.data.data
}

export async function getApprovalTaskSummary() {
  const response = await http.get<{ data: ApprovalTaskSummary }>('/approval-tasks/summary')
  return response.data.data
}
