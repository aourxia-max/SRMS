// @vitest-environment happy-dom

import ElementPlus from "element-plus";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PaymentDetailView from "./PaymentDetailView.vue";
import { checkoutApi } from "../../services/checkout";
import { paymentLifecycleTags } from "./payment-lifecycle-tags";
import { paymentApi } from "../../services/payments";

vi.mock("../../services/checkout", () => ({
  checkoutApi: { downloadRefundProof: vi.fn() },
}));
vi.mock("../../services/payments", () => ({
  paymentApi: { list: vi.fn(), detail: vi.fn() },
}));

describe("paymentLifecycleTags", () => {
  it("only shows the receipt type for a confirmed payment without completed lifecycle changes", () => {
    expect(
      paymentLifecycleTags({ receiptType: "FORMAL", status: "CONFIRMED" }),
    ).toEqual([{ text: "正式票据", type: "success" }]);
  });

  it("shows both completed correction and void states while keeping the receipt type", () => {
    expect(
      paymentLifecycleTags({
        receiptType: "FORMAL",
        status: "VOIDED",
        editReason: "更正收款方式",
      }),
    ).toEqual([
      { text: "正式票据", type: "success" },
      { text: "已更正", type: "info" },
      { text: "已作废", type: "danger" },
    ]);
  });

  it("distinguishes a partial refund from a full refund", () => {
    expect(
      paymentLifecycleTags({
        receiptType: "FORMAL",
        status: "PARTIALLY_REFUNDED",
      }),
    ).toContainEqual({ text: "部分退款", type: "warning" });
    expect(
      paymentLifecycleTags({ receiptType: "FORMAL", status: "FULLY_REFUNDED" }),
    ).toContainEqual({ text: "已退款", type: "danger" });
  });

  it("does not infer completed lifecycle tags from an unchanged confirmed status", () => {
    expect(
      paymentLifecycleTags({
        receiptType: "PROVISIONAL",
        status: "CONFIRMED",
        editReason: null,
      }),
    ).toEqual([{ text: "临时票据", type: "warning" }]);
  });
});
describe("收款详情退租租金退款", () => {
  const originalCreateObjectURL = Object.getOwnPropertyDescriptor(
    URL,
    "createObjectURL",
  );
  const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(
    URL,
    "revokeObjectURL",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    vi.mocked(paymentApi.list).mockResolvedValue({
      items: [
        {
          id: 81,
          receiptNo: "SK202608300081",
          receiptType: "FORMAL",
          paymentCategory: "RENT",
          paymentDate: "2026-08-01",
          amount: "1000.00",
          method: "BANK_TRANSFER",
          status: "FULLY_REFUNDED",
          contract: {
            id: 7,
            contractNo: "HT202608300007",
            room: { id: 3, fullHouseNo: "1-101" },
          },
        },
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    vi.mocked(paymentApi.detail).mockResolvedValue({
      id: 81,
      receiptNo: "SK202608300081",
      receiptType: "FORMAL",
      paymentCategory: "RENT",
      paymentDate: "2026-08-01",
      amount: "1000.00",
      method: "BANK_TRANSFER",
      status: "FULLY_REFUNDED",
      contract: {
        id: 7,
        contractNo: "HT202608300007",
        room: { id: 3, fullHouseNo: "1-101" },
      },
      correctionProvenance: null,
      metrics: {
        receivedAmount: "1000.00",
        confirmedAdjustmentAmount: "0.00",
        prepaymentAmount: "0.00",
        coveredBillCount: 1,
      },
      allocations: [],
      adjustments: [],
      prepayments: [],
      files: [],
      refunds: [],
      voidRequests: [],
      operationLogs: [],
      checkoutRentRefunds: [
        {
          id: 701,
          checkoutSettlementId: 91,
          settlementNo: "TZ202608300001",
          amount: "1000.00",
          status: "APPLIED",
          statusText: "已完成",
          appliedAt: "2026-08-30T04:00:00.000Z",
          depositRefund: {
            id: 33,
            refundNo: "YJTK202608300033",
            refundDate: "2026-08-30",
            refundMethod: "BANK_TRANSFER",
            proofFiles: [
              {
                id: 43,
                originalName: "退租合并退款凭证.webp",
                mimeType: "image/webp",
                sizeBytes: "2048",
              },
            ],
          },
        },
      ],
      receipt: { correctionProvenance: null },
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalCreateObjectURL)
      Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
    else Reflect.deleteProperty(URL, "createObjectURL");
    if (originalRevokeObjectURL)
      Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
    else Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("shows an applied checkout rent refund as read-only detail rather than a refund action", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/payments/detail/:id?", component: PaymentDetailView },
        { path: "/payments/collect", component: { template: "<div />" } },
        { path: "/payments/reviews", component: { template: "<div />" } },
      ],
    });
    await router.push("/payments/detail/81");
    await router.isReady();
    const wrapper = mount(PaymentDetailView, {
      global: { plugins: [createPinia(), router, ElementPlus] },
    });
    await flushPromises();

    const refunds = wrapper.get('[data-testid="checkout-rent-refunds"]');
    expect(refunds.text()).toContain("退租租金退款");
    expect(refunds.text()).toContain("TZ202608300001");
    expect(refunds.text()).toContain("¥1000.00");
    expect(refunds.findAll("button")).toHaveLength(1);
    expect(refunds.text()).toContain("退租合并退款凭证.webp");
    wrapper.unmount();
  });
  it("shows the actual combined-refund proof filename and previews it through the checkout API", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:checkout-refund-43");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    vi.mocked(checkoutApi.downloadRefundProof).mockResolvedValue({
      data: new Blob(["checkout refund proof"], { type: "image/webp" }),
    } as never);
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/payments/detail/:id?", component: PaymentDetailView },
        { path: "/payments/collect", component: { template: "<div />" } },
        { path: "/payments/reviews", component: { template: "<div />" } },
      ],
    });
    await router.push("/payments/detail/81");
    await router.isReady();
    const wrapper = mount(PaymentDetailView, {
      global: { plugins: [createPinia(), router, ElementPlus] },
    });
    await flushPromises();

    const refunds = wrapper.get('[data-testid="checkout-rent-refunds"]');
    expect(refunds.text()).toContain("退款单号：YJTK202608300033");
    expect(refunds.text()).toContain("退租合并退款凭证.webp");
    await wrapper
      .get('[data-test="preview-checkout-refund-proof-43"]')
      .trigger("click");
    await flushPromises();

    expect(checkoutApi.downloadRefundProof).toHaveBeenCalledWith(33, 43);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(
      document.body
        .querySelector('[data-test="checkout-refund-proof-preview"]')
        ?.getAttribute("src"),
    ).toBe("blob:checkout-refund-43");
    wrapper.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:checkout-refund-43");
  });
});
