export type PaymentMethod = 'WECHAT' | 'ALIPAY' | 'BANK_TRANSFER' | 'CASH' | 'POS' | 'OTHER' | 'SYSTEM_AUTO'
export type ManualPaymentMethod = Exclude<PaymentMethod, 'SYSTEM_AUTO'>
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'

export interface RentBill {
  id: number
  billCategory: 'RENT' | 'CHECKOUT_SUPPLEMENTAL'
  billNo?: string
  periodSeq: number
  periodStart?: string
  periodEnd?: string
  dueDate?: string
  payableAmount?: string
  receivedAmount?: string
  outstandingAmount: string
  status?: string
}

export interface ContractSummary {
  id: number
  contractNo: string
  room?: { id: number; fullHouseNo: string }
  members?: Array<{ tenant?: { id: number; name: string; phone?: string } }>
}

export interface PaymentListItem {
  id: number
  receiptNo: string
  receiptType: string
  paymentCategory: 'RENT' | 'CHECKOUT_SUPPLEMENTAL' | 'DEPOSIT' | 'PREPAYMENT'
  paymentDate: string
  amount: string
  method: PaymentMethod
  status: string
  contract: ContractSummary
  tenant?: { id: number; name: string; phone?: string } | null
}

export interface PaymentListPage {
  items: PaymentListItem[]
  page: number
  pageSize: number
  total: number
}

export interface PaymentDetail extends PaymentListItem {
  externalReference?: string | null
  remark?: string | null
  editReason?: string | null
  operator?: { id: number; displayName: string } | null
  metrics: { receivedAmount: string; confirmedAdjustmentAmount: string; prepaymentAmount: string; coveredBillCount: number }
  allocations: Array<{ id: number; allocationOrder: number; allocationType: string; allocatedAmount: string; reversedAmount: string; effectiveAmount: string; bill: RentBill }>
  adjustments: Array<Record<string, unknown> & { id: number; adjustmentNo: string; adjustmentType: string; amount: string; approvalStatus: ApprovalStatus; reason?: string }>
  prepayments: Array<Record<string, unknown>>
  files: Array<{ id: number; originalName: string; mimeType: string; sizeBytes: string; uploadedAt: string }>
  refunds: Array<Record<string, unknown>>
  voidRequests: Array<Record<string, unknown>>
  operationLogs: Array<Record<string, unknown>>
  receipt: Record<string, unknown>
}

export interface ReviewItem {
  type: 'REFUND' | 'VOID'
  id: number
  requestNo: string
  status: ApprovalStatus
  submittedAt: string
  amount?: string | null
  paymentId: number
  receiptNo: string
  contract: ContractSummary
  tenant?: { id: number; name: string; phone?: string } | null
}

export interface RecordPaymentPayload {
  contractId: number
  paymentDate: string
  amount: string
  method: ManualPaymentMethod
  selectedBillIds: number[]
  externalReference?: string
  remark?: string
  manualAllocationReason?: string
  proofFileIds?: number[]
  adjustments?: Array<{ rentBillId: number; adjustmentType: 'DISCOUNT' | 'WAIVER'; amount: string; reason: string }>
}
