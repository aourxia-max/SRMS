import type { ApprovalTaskCounts } from './approval-task-counts';

export type ApprovalTaskType =
  | 'CONTRACT_CHANGE'
  | 'PRICING_REBATE'
  | 'CONTRACT_VOID_REQUEST'
  | 'BILL_ADJUSTMENT'
  | 'PAYMENT_REFUND'
  | 'PAYMENT_VOID_REQUEST'
  | 'CHECKOUT_SETTLEMENT'
  | 'DEPOSIT_REFUND';

export type ApprovalTaskItem = {
  id: number;
  type: ApprovalTaskType;
  label: string;
  businessNo: string;
  contractId: number;
  contractNo: string;
  roomId: number;
  fullHouseNo: string;
  submittedAt: Date | null;
};

export type ApprovalTaskSummary = {
  counts: ApprovalTaskCounts;
  items: ApprovalTaskItem[];
};

export const emptyApprovalTaskSummary = (): ApprovalTaskSummary => ({
  counts: {
    contractChanges: 0,
    fixedRentRebates: 0,
    contractVoidRequests: 0,
    billAdjustments: 0,
    paymentRefunds: 0,
    paymentVoidRequests: 0,
    checkoutSettlements: 0,
    depositRefunds: 0,
    contractsTotal: 0,
    paymentsTotal: 0,
    checkoutsTotal: 0,
    total: 0,
  },
  items: [],
});
