export type CheckoutTab = "initiate" | "settlement" | "refund" | "completed";

export type CheckoutContract = {
  id: number;
  contractNo: string;
  status: string;
  room?: { id: number; fullHouseNo?: string; roomNo?: string };
  members?: Array<{
    memberRole: "PRIMARY" | "SECONDARY";
    tenant: { name: string };
  }>;
};

export type CheckoutSettlementItem = {
  id?: number;
  itemType:
    | "RENT_ARREARS"
    | "RENT_REFUND"
    | "REPAIR"
    | "DAMAGE"
    | "CLEANING"
    | "OTHER";
  amount: string;
  rentBillId?: number;
  inspectionRecordRef?: string;
  description: string;
  evidenceRequired?: boolean;
  confirmedByTenant?: boolean;
};

export type CheckoutSettlementItemPayload =
  | {
      itemType: "RENT_REFUND";
      amount: string;
      description: string;
    }
  | (Omit<CheckoutSettlementItem, "id"> & {
      itemType: Exclude<CheckoutSettlementItem["itemType"], "RENT_REFUND">;
    });

export type CheckoutSettlementPayload = {
  actualCheckoutDate: string;
  handoverDate: string;
  inspectionAt: string;
  targetRoomStatus: string;
  remark?: string;
  items: CheckoutSettlementItemPayload[];
};

export type DepositRefund = {
  id: number;
  approvalStatus: "PENDING" | "APPROVED" | "REJECTED";
  refundAmount: string;
  refundNo?: string;
  refundDate?: string;
  refundMethod?: string;
  files?: Array<{ fileAssetId: number }>;
};

export type CheckoutSettlement = {
  id: number;
  settlementNo: string;
  status:
    "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED";
  contractId: number;

  actualCheckoutDate?: string;
  handoverDate?: string;
  inspectionAt?: string;
  targetRoomStatus?: "EMPTY" | "MAINTENANCE" | "DISABLED";
  remark?: string;
  rejectedReason?: string;
  depositRefundableAmount: string;
  prepaymentRefundableAmount: string;
  rentRefundableAmount?: string;
  finalReceivable: string;
  supplementalRequired?: boolean;
  supplementalArrearsAmount?: string;
  supplementalInspectionAmount?: string;
  supplementalReceivedAmount?: string;
  supplementalOutstandingAmount?: string;
  supplementalCollectedAt?: string | null;
  contract?: CheckoutContract;
  items?: CheckoutSettlementItem[];
  depositRefunds?: DepositRefund[];
};

export type CheckoutRentRefundAllocationPreview = {
  paymentAllocationId: number;
  paymentId: number;
  rentBillId: number;
  billNo: string;
  amount: string;
};

export type CheckoutSettlementPreview = {
  depositRefundableAmount: string;
  prepaymentRefundableAmount: string;
  rentRefundableAmount: string;
  maxRentRefundAmount: string;
  totalRefundAmount: string;
  finalReceivable: string;
  rentRefundAllocations: CheckoutRentRefundAllocationPreview[];
};
export type CompletedCheckoutContract = {
  settlementId: number;
  settlementNo: string;
  contractNo: string;
  roomFullHouseNo: string;
  tenantName: string;
  actualCheckoutDate: string | null;
  refundAmount: string;
  completedAt: string | null;
};

export type CompletedCheckoutContractsResult = {
  items: CompletedCheckoutContract[];
  page: number;
  pageSize: number;
  total: number;
};
