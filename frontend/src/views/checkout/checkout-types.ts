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
  itemType: "RENT_ARREARS" | "REPAIR" | "DAMAGE" | "CLEANING" | "OTHER";
  amount: string;
  rentBillId?: number;
  inspectionRecordRef?: string;
  description: string;
  evidenceRequired?: boolean;
  confirmedByTenant?: boolean;
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
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED";
  contractId: number;
  actualCheckoutDate?: string;
  handoverDate?: string;
  inspectionAt?: string;
  targetRoomStatus?: "EMPTY" | "MAINTENANCE" | "DISABLED";
  remark?: string;
  rejectedReason?: string;
  depositRefundableAmount: string;
  prepaymentRefundableAmount: string;
  finalReceivable: string;
  contract?: CheckoutContract;
  items?: CheckoutSettlementItem[];
  depositRefunds?: DepositRefund[];
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
