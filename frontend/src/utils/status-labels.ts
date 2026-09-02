type StatusMap = Record<string, string>;

const fallback = (map: StatusMap, value?: string | null) => {
  if (!value) return "\u2014";
  return map[value] ?? value;
};

export const approvalStatusLabels: StatusMap = {
  DRAFT: "\u8349\u7a3f",
  PENDING: "\u5f85\u786e\u8ba4",
  APPROVED: "\u5df2\u786e\u8ba4",
  REJECTED: "\u5df2\u9a73\u56de",
  CANCELLED: "\u5df2\u53d6\u6d88",
};

export const paymentStatusLabels: StatusMap = {
  CONFIRMED: "\u5df2\u786e\u8ba4",
  VOIDED: "\u5df2\u4f5c\u5e9f",
  PARTIALLY_REFUNDED: "\u90e8\u5206\u9000\u6b3e",
  FULLY_REFUNDED: "\u5df2\u5168\u989d\u9000\u6b3e",
};

export const rentBillStatusLabels: StatusMap = {
  PENDING: "\u5f85\u6536\u6b3e",
  PARTIAL: "\u90e8\u5206\u6536\u6b3e",
  PAID: "\u5df2\u7ed3\u6e05",
  OVERDUE: "\u5df2\u903e\u671f",
  VOIDED: "\u5df2\u4f5c\u5e9f",
  REFUNDED: "\u5df2\u9000\u6b3e",
};

export type StatusTagType = "info" | "warning" | "success" | "danger" | "primary";

const contractStatusTagTypes: Record<string, StatusTagType> = {
  DRAFT: "info",
  PENDING_START: "warning",
  ACTIVE: "success",
  PENDING_CHECKOUT: "warning",
  ENDED: "primary",
  VOIDED: "danger",
};

const contractStatusTagClasses: Record<string, string> = {
  PENDING_CHECKOUT: "contract-status-tag--pending-checkout",
};

export const contractStatusLabels: StatusMap = {
  DRAFT: "\u8349\u7a3f",
  PENDING_START: "\u5f85\u5f00\u59cb",
  ACTIVE: "履约中",
  PENDING_CHECKOUT: "\u5f85\u9000\u79df",
  ENDED: "\u5df2\u7ed3\u675f",
  VOIDED: "\u5df2\u4f5c\u5e9f",
};

export const roomStatusLabels: StatusMap = {
  EMPTY: "\u7a7a\u7f6e",
  PENDING_MOVE_IN: "\u5f85\u5165\u4f4f",
  RENTED: "\u5df2\u51fa\u79df",
  PENDING_CHECKOUT: "\u5f85\u9000\u623f",
  MAINTENANCE: "\u7ef4\u4fee\u4e2d",
  FOR_SALE: "\u5f85\u51fa\u552e",
  SOLD: "\u5df2\u51fa\u552e",
  DISABLED: "\u505c\u7528",
  OTHER: "\u5176\u4ed6",
};

export const billAdjustmentTypeLabels: StatusMap = {
  DISCOUNT: "\u4e00\u6b21\u6027\u4f18\u60e0",
  WAIVER: "\u51cf\u514d",
  INCREASE: "\u8865\u6536",
  CORRECTION: "\u66f4\u6b63",
};

export const adjustmentDirectionLabels: StatusMap = {
  DECREASE: "\u51cf\u5c11\u5e94\u6536",
  INCREASE: "\u589e\u52a0\u5e94\u6536",
};

export const pricingRebateSourceLabels: StatusMap = {
  FIXED_RENT_MANUAL: "\u56fa\u5b9a\u6708\u79df\u624b\u5de5\u9000\u5dee",
  TIER_MILESTONE: "\u9636\u68af\u8fbe\u6863\u9000\u5dee\uff08\u5df2\u505c\u7528\uff09",
};

export const pricingRebateTypeLabels: StatusMap = {
  MANUAL: "\u624b\u5de5\u9000\u5dee",
  SUPPLEMENT: "\u8865\u5145\u9000\u5dee",
  MILESTONE: "\u8fbe\u6863\u9000\u5dee\uff08\u5df2\u505c\u7528\uff09",
};

export const settlementMethodLabels: StatusMap = {
  ACTUAL_REFUND: "\u5b9e\u9645\u9000\u6b3e",
  PREPAYMENT_CREDIT: "\u8f6c\u5165\u9884\u6536\u6b3e",
};

export const refundAdjustmentDecisionLabels: StatusMap = {
  REVERSE: "\u968f\u9000\u6b3e\u51b2\u56de",
  KEEP: "\u4fdd\u7559\u4f18\u60e0",
};

export const paymentMethodLabels: StatusMap = {
  WECHAT: "\u5fae\u4fe1",
  ALIPAY: "\u652f\u4ed8\u5b9d",
  BANK_TRANSFER: "\u94f6\u884c\u8f6c\u8d26",
  CASH: "\u73b0\u91d1",
  POS: "POS",
  OTHER: "\u5176\u4ed6",
  SYSTEM_AUTO: "系统自动入账",
};

export const approvalStatusLabel = (value?: string | null) => fallback(approvalStatusLabels, value);
export const paymentStatusLabel = (value?: string | null) => safeBusinessLabel(paymentStatusLabels, value);
export const rentBillStatusLabel = (value?: string | null) => safeBusinessLabel(rentBillStatusLabels, value);
export const contractStatusLabel = (value?: string | null) => {
  if (!value) return '—';
  return contractStatusLabels[value] ?? `未知状态（${value}）`;
};
export const contractStatusTagType = (value?: string | null): StatusTagType =>
  value ? contractStatusTagTypes[value] ?? "info" : "info";
export const contractStatusTagClass = (value?: string | null) =>
  value ? contractStatusTagClasses[value] ?? "" : "";
export const roomStatusLabel = (value?: string | null) => safeBusinessLabel(roomStatusLabels, value);
export const billAdjustmentTypeLabel = (value?: string | null) => fallback(billAdjustmentTypeLabels, value);
export const adjustmentDirectionLabel = (value?: string | null) => fallback(adjustmentDirectionLabels, value);
export const pricingRebateSourceLabel = (value?: string | null) => fallback(pricingRebateSourceLabels, value);
export const pricingRebateTypeLabel = (value?: string | null) => fallback(pricingRebateTypeLabels, value);
export const settlementMethodLabel = (value?: string | null) => fallback(settlementMethodLabels, value);
export const refundAdjustmentDecisionLabel = (value?: string | null) => fallback(refundAdjustmentDecisionLabels, value);
export const paymentMethodLabel = (value?: string | null) => fallback(paymentMethodLabels, value);

export const contractPricingModeLabels: StatusMap = {
  FIXED: '\u56fa\u5b9a\u6708\u79df',
  TIERED_RETROACTIVE: '\u9636\u68af\u8ba1\u4ef7\uff08\u5df2\u505c\u7528\uff09',
};

export const contractPricingModeLabel = (value?: string | null) => fallback(contractPricingModeLabels, value);


export const usageTypeLabels: StatusMap = {
  RESIDENCE: '居住',
  SHOP: '商铺',
  OFFICE: '办公',
  STORAGE: '仓储',
  OTHER: '其他',
};

export const tenantStatusLabels: StatusMap = {
  ACTIVE: '启用',
  INACTIVE: '停用',
};

export const tenantTypeLabels: StatusMap = {
  INDIVIDUAL: '个人',
  COMPANY: '单位',
};

export const tenantIdTypeLabels: StatusMap = {
  ID_CARD: '身份证',
  PASSPORT: '护照',
  BUSINESS_LICENSE: '营业执照',
  HK_MACAO_PASS: '港澳通行证',
  TAIWAN_PASS: '台湾通行证',
  OTHER: '其他证件',
};

const safeBusinessLabel = (map: StatusMap, value?: string | null) => {
  if (!value) return '—';
  return map[value] ?? '未知状态';
};

export const usageTypeLabel = (value?: string | null) => safeBusinessLabel(usageTypeLabels, value);
export const tenantStatusLabel = (value?: string | null) => safeBusinessLabel(tenantStatusLabels, value);
export const tenantTypeLabel = (value?: string | null) => {
  if (!value) return '—';
  return Object.hasOwn(tenantTypeLabels, value) ? tenantTypeLabels[value] : '未知类型';
};
export const tenantIdTypeLabel = (value?: string | null) => {
  if (!value) return '—';
  if (Object.hasOwn(tenantIdTypeLabels, value)) return tenantIdTypeLabels[value];
  return /[一-鿿]/.test(value) ? value : '其他证件';
};
