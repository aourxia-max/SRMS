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

export async function getApprovalTaskCounts() {
  const response = await http.get<{ data: ApprovalTaskCounts }>('/approval-tasks/counts')
  return response.data.data
}
