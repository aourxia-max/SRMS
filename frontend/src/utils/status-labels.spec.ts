import { describe, expect, it } from "vitest";
import {
  approvalStatusLabel,
  billAdjustmentTypeLabel,
  contractStatusLabel,
  paymentStatusLabel,
  pricingRebateSourceLabel,
  rentBillStatusLabel,
} from "./status-labels";

describe("status label helpers", () => {
  it("translates common internal status codes to Chinese labels", () => {
    expect(approvalStatusLabel("PENDING")).toBe("\u5f85\u786e\u8ba4");
    expect(approvalStatusLabel("APPROVED")).toBe("\u5df2\u786e\u8ba4");
    expect(paymentStatusLabel("PARTIALLY_REFUNDED")).toBe("\u90e8\u5206\u9000\u6b3e");
    expect(paymentStatusLabel("FULLY_REFUNDED")).toBe("\u5df2\u5168\u989d\u9000\u6b3e");
    expect(rentBillStatusLabel("OVERDUE")).toBe("\u5df2\u903e\u671f");
    expect(contractStatusLabel("VOIDED")).toBe("\u5df2\u4f5c\u5e9f");
  });

  it("translates business operation codes instead of exposing raw English", () => {
    expect(billAdjustmentTypeLabel("DISCOUNT")).toBe("\u4e00\u6b21\u6027\u4f18\u60e0");
    expect(billAdjustmentTypeLabel("WAIVER")).toBe("\u51cf\u514d");
    expect(pricingRebateSourceLabel("FIXED_RENT_MANUAL")).toBe("\u56fa\u5b9a\u6708\u79df\u624b\u5de5\u9000\u5dee");
  });

  it("keeps unknown codes visible for diagnostics", () => {
    expect(approvalStatusLabel("UNKNOWN_STATUS")).toBe("UNKNOWN_STATUS");
  });
});
