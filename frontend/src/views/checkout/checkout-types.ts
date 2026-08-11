export type CheckoutTab = 'initiate' | 'settlement' | 'refund'

export type CheckoutContract = {
  id: number
  contractNo: string
  status: string
  room?: { id: number; fullHouseNo?: string; roomNo?: string }
  members?: Array<{ memberRole: 'PRIMARY' | 'SECONDARY'; tenant: { name: string } }>
}

export type CheckoutSettlement = {
  id: number
  settlementNo: string
  status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'COMPLETED'
  contractId: number
  depositRefundableAmount: string
  prepaymentRefundableAmount: string
  finalReceivable: string
  contract?: CheckoutContract
}
