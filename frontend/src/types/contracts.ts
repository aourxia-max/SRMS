export type ContractRole = 'SUPER_ADMIN' | 'ADMIN' | 'VISITOR'
export type ContractWorkspaceTab = 'list' | 'create' | 'detail' | 'fixed-rebate'

export type ContractCommission = {
  id?: number
  recipientName: string
  amount: string
}

export type ContractConcession = {
  concessionType: 'RENT_FREE' | 'FIXED_AMOUNT' | 'PERCENTAGE'
  applyMode: 'DATE_RANGE' | 'BILLING_PERIODS' | 'ONE_TIME'
  startDate?: string
  endDate?: string
  fixedAmount?: string
  discountRate?: string
  billingPeriodCount?: number
  reason: string
}

export type ContractFormModel = {
  externalContractNo: string
  roomId: number | null
  primaryTenantId: number | null
  secondaryTenantIds: number[]
  startDate: string
  endDate: string
  plannedMoveInDate: string
  monthlyRent: string
  depositRequired: string
  paymentCycleMonths: number
  concessions: ContractConcession[]
  fileAssetIds: number[]
  remark: string
  commission?: ContractCommission
}

export type ContractPayload = Partial<Omit<ContractFormModel, 'roomId' | 'primaryTenantId' | 'commission'>> & {
  roomId?: number
  primaryTenantId?: number
  commission?: ContractCommission
}

export type ContractRoom = {
  id: number
  fullHouseNo: string
  roomStatus?: string
  building?: { buildingNo?: string }
}

export type ContractTenant = {
  id: number
  name: string
  phone?: string
}

export type ContractMember = {
  memberRole: 'PRIMARY' | 'SECONDARY'
  tenant: ContractTenant
}

export type ContractListItem = {
  id: number
  contractNo: string
  externalContractNo?: string | null
  roomId: number
  room?: ContractRoom
  members?: ContractMember[]
  startDate: string
  endDate: string
  monthlyRent: string
  depositRequired?: string
  paymentCycleMonths?: number
  status: string
  pricingMode: 'FIXED' | string
  remark?: string | null
  commissions?: ContractCommission[]
}

export type ContractDraft = {
  id: number
  status: 'DRAFT' | 'CONFIRMED'
  payload: ContractPayload
  updatedAt: string
}

export type ContractPreviewBill = {
  sequence: number
  startDate: string
  endDate: string
  payableAmount: string
}

export type ContractPreview = {
  billCount: number
  totalBaseRent: string
  totalDiscount: string
  totalPayable: string
  bills: ContractPreviewBill[]
}

export type RentBill = {
  id: number
  billCategory?: 'RENT' | 'CHECKOUT_SUPPLEMENTAL'
  billNo?: string
  periodSeq: number
  periodStart: string
  periodEnd: string
  payableAmount: string
  outstandingAmount?: string
  status?: string
}

export type ContractFile = {
  id: number
  originalName: string
  mimeType: string
  sizeBytes?: number | string
}
export type ContractChange = {
  id: number
  changeNo: string
  changeType: string
  effectiveDate: string
  reason: string
  approvalStatus: string
  submittedAt?: string
  approvedAt?: string | null
  rejectedReason?: string | null
  beforeSnapshot: Record<string, unknown>
  afterSnapshot: Record<string, unknown>
  tenantNames?: Record<string, string>
}


export type ContractDetail = ContractListItem & {
  plannedMoveInDate?: string | null
  members: ContractMember[]
  concessions?: ContractConcession[]
  commissions?: ContractCommission[]
}

export type PricingRebate = {
  id: number
  rebateNo: string
  contractId: number
  actualAmount: string
  approvalStatus: string
  periodStart: string
  periodEnd: string
  settlementMethod: 'ACTUAL_REFUND' | 'PREPAYMENT_CREDIT'
  differenceReason?: string | null
}

export const emptyContractForm = (): ContractFormModel => ({
  externalContractNo: '',
  roomId: null,
  primaryTenantId: null,
  secondaryTenantIds: [],
  startDate: '',
  endDate: '',
  plannedMoveInDate: '',
  monthlyRent: '',
  depositRequired: '0.00',
  paymentCycleMonths: 1,
  concessions: [],
  fileAssetIds: [],
  remark: '',
  commission: { recipientName: '', amount: '' },
})

export type ContractVoidRequestStatus = 'PENDING' | 'COMPLETED' | 'REJECTED' | 'CANCELLED'
export type ContractVoidReversalCategory = 'RENT_BILL' | 'PAYMENT' | 'PAYMENT_ALLOCATION' | 'PREPAYMENT' | 'DEPOSIT' | 'REFUND' | 'ADJUSTMENT' | 'PRICING_REBATE' | 'CHECKOUT' | 'COMMISSION' | 'ROOM_STATUS'
export type ContractVoidPendingWorkflows = { adjustments: number[]; refunds: number[]; voidRequests: number[]; depositRefunds: number[]; changes: number[]; rebates: number[]; checkouts: number[] }
export type ContractVoidImpactRow = { category: ContractVoidReversalCategory; originalEntityType: string; originalEntityId: number | null; amount: string; balanceBefore: string | null; balanceAfter: string | null; originalOccurredAt: string | null; affectsNetImpact: boolean; metadata: Record<string, unknown> }
export type ContractVoidSourceSnapshot = { prepaymentBalanceSource: { id: number; balanceAfter: string; occurredAt: string } | null; depositBalanceSource: { id: number; balanceAfter: string; occurredAt: string } | null; contractMembers: Array<{ id: number; tenantId: number; memberRole: string; isCurrent: boolean }>; paymentAllocations: Array<{ id: number; paymentId: number; rentBillId: number; allocatedAmount: string; reversedAmount: string; allocationType: string; occurredAt: string }>; adjustments: Array<{ id: number; rentBillId: number; adjustmentType: string; direction: string; amount: string; beforeAmount: string; afterAmount: string; approvalStatus: string; occurredAt: string; submittedAt: string; approvedAt: string | null }>; rebates: Array<{ id: number; sourceType: string; rebateType: string; rentBillId: number | null; approvalStatus: string; settlementMethod: string; grossBilledAmount: string; previousRebateAmount: string; referenceAmount: string | null; targetNetRentAmount: string | null; actualAmount: string; differenceAmount: string | null; periodStart: string; periodEnd: string; refundDate: string | null; occurredAt: string | null; submittedAt: string | null; approvedAt: string | null }>; checkoutSettlements: Array<{ id: number; checkoutType: string; originContractStatus: string; status: string; rentReceivable: string; rentReceived: string; rentOutstanding: string; prepaymentBalance: string; depositBalance: string; depositOffsetAmount: string; otherDeductionAmount: string; depositRefundableAmount: string; prepaymentRefundableAmount: string; finalReceivable: string; supplementalArrearsAmount: string; supplementalInspectionAmount: string; supplementalReceivedAmount: string; supplementalOutstandingAmount: string; occurredAt: string | null; approvedAt: string | null }>; commissions: Array<{ id: number; amount: string; occurredAt: string; deletedAt: string | null }> }
export type ContractVoidImpact = { contract: { id: number; status: string; roomId: number }; summary: { rentBillPayable: string; effectivePayment: string; depositBalance: string; prepaymentBalance: string; refundNet: string; currentNetImpact: string; plannedReversal: string; postReversalNetImpact: string }; rows: ContractVoidImpactRow[]; pending: ContractVoidPendingWorkflows; completedCheckoutIds: number[]; room: { currentStatus: string; hasLaterContract: boolean; action: 'KEEP_CURRENT_STATUS' | 'RECALCULATE' }; flags: { hasPendingWorkflows: boolean; hasCompletedCheckout: boolean; hasLaterContract: boolean }; sourceSnapshot: ContractVoidSourceSnapshot; impactHash: string }
export type ContractVoidImpactSnapshot = Omit<ContractVoidImpact, 'impactHash'>
export type ContractVoidReversal = { id: number; contractVoidRequestId: number; category: ContractVoidReversalCategory; originalEntityType: string; originalEntityId: number | null; amount: string; balanceBefore: string | null; balanceAfter: string | null; generatedEntityType: string | null; generatedEntityId: number | null; originalOccurredAt: string | null; correctionOccurredAt: string; idempotencyKey: string; metadata: Record<string, unknown> | null }
export type ContractVoidExecutionResult = { requestId: number; requestNo: string; status: 'COMPLETED'; contractId: number; contractNo: string; contractStatus: 'VOIDED'; impactHash: string; executionBatchNo: string; reversalCount: number; categoryTotals: Partial<Record<ContractVoidReversalCategory, string>>; roomAction: 'KEEP_CURRENT_STATUS' | 'RECALCULATE'; roomStatusBefore: string; roomStatusAfter: string }
export type ContractVoidRequest = { id: number; requestNo: string; contractId: number; status: ContractVoidRequestStatus; reason: string; impactSnapshot: ContractVoidImpactSnapshot; impactHash: string; activeContractKey: string | null; completedContractKey: string | null; executionBatchNo: string | null; submissionIdempotencyKey: string; executionIdempotencyKey: string | null; resultSnapshot: ContractVoidExecutionResult | null; submittedBy: number; submittedAt: string; completedBy: number | null; completedAt: string | null; rejectedBy: number | null; rejectedAt: string | null; rejectedReason: string | null; cancelledBy: number | null; cancelledAt: string | null; createdAt: string; updatedAt: string; reversals?: ContractVoidReversal[]; files?: Array<{ contractVoidRequestId: number; fileAssetId: number; createdAt: string; fileAsset: { id: number; originalName: string; mimeType: string; uploadedAt: string } }>; contract?: { id: number; contractNo: string; roomId: number; status: string; room: ContractRoom; members: Array<{ id: number; tenantId: number; memberRole: string; isCurrent: boolean; tenant: ContractTenant }> } }
export type ContractVoidRequestQuery = { status?: ContractVoidRequestStatus; contractId?: number; contractNo?: string; roomKeyword?: string; tenantKeyword?: string }
export type SubmitContractVoidRequestInput = { contractId: number; reason: string; impactHash: string; fileAssetIds?: number[]; idempotencyKey: string }
export const contractVoidConfirmationText = '确认作废合同' as const
export type ApproveContractVoidRequestInput = { previewHash: string; confirmation: typeof contractVoidConfirmationText; idempotencyKey: string }