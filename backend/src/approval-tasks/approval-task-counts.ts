export type ApprovalTaskCounts = {
  contractChanges: number;
  fixedRentRebates: number;
  contractVoidRequests: number;
  billAdjustments: number;
  paymentRefunds: number;
  paymentVoidRequests: number;
  checkoutSettlements: number;
  depositRefunds: number;
  contractsTotal: number;
  paymentsTotal: number;
  checkoutsTotal: number;
  total: number;
};

export function emptyApprovalTaskCounts(): ApprovalTaskCounts {
  return {
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
  };
}
