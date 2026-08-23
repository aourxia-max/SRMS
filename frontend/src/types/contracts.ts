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
