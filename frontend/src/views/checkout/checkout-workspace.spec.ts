import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import { checkoutApi } from "../../services/checkout";
import { useApprovalTasksStore } from "../../stores/approval-tasks";
import CheckoutTopNav from "./CheckoutTopNav.vue";
import CheckoutWorkspace from "./CheckoutWorkspace.vue";
import CheckoutInitiatePanel from "./CheckoutInitiatePanel.vue";
import CheckoutSettlementPanel from "./CheckoutSettlementPanel.vue";
import CheckoutRefundPanel from "./CheckoutRefundPanel.vue";
import CompletedCheckoutContractsPanel from "./CompletedCheckoutContractsPanel.vue";
const routeQuery = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const approvalRefresh = vi.fn().mockResolvedValue(undefined);
function checkoutTestPinia() {
  const pinia = createPinia();
  pinia.state.value.session = {
    accessToken: "test-token",
    initialized: true,
    user: { id: 1, username: "admin", displayName: "管理员", role: "ADMIN" },
  };
  vi.spyOn(useApprovalTasksStore(pinia), "refresh").mockImplementation(
    approvalRefresh,
  );
  return pinia;
}
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: routeQuery.value }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../../services/checkout", () => ({
  checkoutApi: {
    contracts: vi
      .fn()
      .mockResolvedValue([
        { id: 1, contractNo: "HT202608010001", status: "ACTIVE" },
      ]),
    initiate: vi.fn(),
    financeSnapshot: vi.fn().mockResolvedValue({
      depositBalance: "1000.00",
      rentOutstanding: "0.00",
      prepaymentBalance: "0.00",
      futureBillCount: 0,
    }),
    settlements: vi.fn().mockResolvedValue([
      {
        id: 8,
        settlementNo: "TZ202608010001",
        status: "PENDING",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
    ]),
    refundPendingSettlements: vi.fn().mockResolvedValue([
      {
        id: 9,
        settlementNo: "TZ202608010002",
        status: "APPROVED",
        contractId: 2,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
    ]),
    completedContracts: vi.fn().mockResolvedValue({
      items: [
        {
          settlementId: 9,
          settlementNo: "TZ202608010009",
          contractNo: "HT202608010001",
          roomFullHouseNo: "2栋301",
          tenantName: "李四",
          actualCheckoutDate: "2026-08-01T00:00:00.000Z",
          refundAmount: "1300.00",
          completedAt: "2026-08-02T09:30:00.000Z",
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    }),
    detail: vi.fn().mockResolvedValue({
      id: 9,
      settlementNo: "TZ202608010009",
      status: "APPROVED",
      contractId: 1,
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "0.00",
      totalRefundAmount: "0.00",
      finalReceivable: "0.00",
      contract: {
        id: 1,
        contractNo: "HT202608010001",
        status: "ENDED",
        room: { id: 3, fullHouseNo: "2栋301" },
      },
      targetRoomStatus: "EMPTY",
      items: [],
      depositRefunds: [
        {
          id: 6,
          approvalStatus: "APPROVED",
          refundNo: "TK202608020001",
          refundAmount: "0.00",
          files: [{ fileAssetId: 77 }],
        },
        {
          id: 7,
          approvalStatus: "REJECTED",
          refundNo: "TK202608020002",
          refundAmount: "500.00",
          files: [{ fileAssetId: 78 }],
        },
      ],
    }),
    downloadRefundProof: vi.fn().mockResolvedValue({
      data: new Blob(["proof"]),
      headers: {
        "content-disposition": "attachment; filename*=UTF-8''refund.webp",
      },
    }),
    uploadRefundProof: vi.fn(),
    submitRefund: vi.fn(),
    approveRefund: vi.fn(),
    cancelRefund: vi.fn(),
    completeZeroRefund: vi.fn(),
    submit: vi.fn(),
    preview: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
  },
}));

describe("CheckoutTopNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeQuery.value = {};
  });

  it("renders the three checkout workflow tabs in Chinese", () => {
    const wrapper = mount(CheckoutTopNav, {
      props: { activeTab: "initiate" },
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.text()).toContain("1 发起退租");
    expect(wrapper.text()).toContain("2 退租结算");
    expect(wrapper.text()).toContain("3 退租退款确认");
  });

  it("shows settlement and deposit-refund pending counts on their exact tabs", () => {
    const pinia = createPinia();
    const approvals = useApprovalTasksStore(pinia);
    approvals.counts.checkoutSettlements = 8;
    approvals.counts.depositRefunds = 9;
    const wrapper = mount(CheckoutTopNav, {
      props: { activeTab: "initiate" },
      global: { plugins: [pinia] },
    });

    expect(wrapper.get('[data-test="badge-checkout-settlement"]').text()).toBe("8");
    expect(wrapper.get('[data-test="badge-checkout-refund"]').text()).toBe("9");
  });
  it("places checkout workflow navigation at the top without the old page intro block", () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });

    expect(wrapper.find(".checkout-workspace__header").exists()).toBe(false);
    expect(
      wrapper.find(".checkout-workspace > .checkout-top-nav").exists(),
    ).toBe(true);
  });
  it("opens the initiate checkout workspace by default", () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });

    expect(wrapper.text()).toContain("发起退租");
    expect(wrapper.text()).toContain("请选择待开始或正在履行的合同");
  });
  it("requires an active contract and checkout reason before initiation", async () => {
    const wrapper = mount(CheckoutInitiatePanel, {
      props: {
        contracts: [{ id: 1, contractNo: "HT202608010001", status: "ACTIVE" }],
      },
    });

    await wrapper.get('[data-test="initiate-submit"]').trigger("click");

    expect(wrapper.text()).toContain("请选择待开始或正在履行的合同");
    expect(wrapper.text()).toContain("请填写退租原因");
  });
  it("loads active contracts into the initiate checkout form", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("HT202608010001");
  });
  it("allows a pending-start contract to be selected for checkout", async () => {
    const wrapper = mount(CheckoutInitiatePanel, {
      props: {
        contracts: [
          { id: 2, contractNo: "HT202609010002", status: "PENDING_START" },
        ],
        selectedContractId: 2,
      },
    });
    await flushPromises();

    const select = wrapper.get('[data-test="checkout-contract-select"]');
    expect((select.element as HTMLSelectElement).value).toBe("2");
    expect(wrapper.text()).toContain("HT202609010002");
    expect(wrapper.text()).toContain("未入住退租");
    expect(wrapper.emitted("contractChange")).toEqual([[2]]);
  });
  it("renders the locked combined refund breakdown and reserved rent allocations", () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        settlement: {
          id: 1,
          settlementNo: "TZ202608010001",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "7500.00",
          prepaymentRefundableAmount: "1000.00",
          rentRefundableAmount: "2000.00",
          totalRefundAmount: "10500.00",
          finalReceivable: "0.00",
          rentRefundAllocations: [
            {
              paymentAllocationId: 18,
              status: "RESERVED",
              billNo: "ZJ2026090001",
              periodStart: "2026-09-01",
              periodEnd: "2026-09-30",
              amount: "2000.00",
            },
          ],
        },
        role: "ADMIN",
      },
    });

    expect(wrapper.text()).toContain("退租退款确认");
    expect(wrapper.text()).toContain("应退押金");
    expect(wrapper.text()).toContain("应退预收款");
    expect(wrapper.text()).toContain("应退租金");
    expect(wrapper.text()).toContain("合计退款");
    expect(wrapper.text()).toContain("系统自动回冲明细");
    expect(wrapper.text()).toContain("ZJ2026090001");
    expect(wrapper.text()).toContain("2026-09-01 至 2026-09-30");
    expect(wrapper.text()).toContain("10,500.00");
  });
  it("loads settlement records when switching to the settlement tab", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");

    expect(wrapper.text()).toContain("TZ202608010001");
  });
  it("keeps the newest preview when an older workspace preview resolves last", async () => {
    let resolveFirst!: (value: Record<string, unknown>) => void;
    let resolveSecond!: (value: Record<string, unknown>) => void;
    const api = checkoutApi as unknown as { preview: ReturnType<typeof vi.fn> };
    api.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    api.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("preview", 8, payload);
    panel.vm.$emit("preview", 8, {
      ...payload,
      actualCheckoutDate: "2026-08-21",
    });
    await flushPromises();
    resolveSecond({
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "200.00",
      maxRentRefundAmount: "200.00",
      totalRefundAmount: "200.00",
      finalReceivable: "0.00",
      rentRefundAllocations: [],
    });
    await flushPromises();
    resolveFirst({
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "100.00",
      maxRentRefundAmount: "100.00",
      totalRefundAmount: "100.00",
      finalReceivable: "0.00",
      rentRefundAllocations: [],
    });
    await flushPromises();
    expect(wrapper.get('[data-test="settlement-summary"]').text()).toContain(
      "200.00",
    );
    expect(
      wrapper.get('[data-test="settlement-summary"]').text(),
    ).not.toContain("100.00");
  });
  it("clears an in-flight preview when switching to another settlement", async () => {
    let resolvePreview!: (value: Record<string, unknown>) => void;
    const api = checkoutApi as unknown as {
      preview: ReturnType<typeof vi.fn>;
      settlements: ReturnType<typeof vi.fn>;
    };
    api.settlements.mockResolvedValueOnce([
      {
        id: 8,
        settlementNo: "TZ202608010001",
        status: "DRAFT",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
      {
        id: 10,
        settlementNo: "TZ202608010010",
        status: "DRAFT",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
    ]);
    api.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("preview", 8, payload);
    await flushPromises();
    await wrapper
      .get(".settlement-panel__list button:nth-child(2)")
      .trigger("click");
    resolvePreview({
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "100.00",
      maxRentRefundAmount: "100.00",
      totalRefundAmount: "100.00",
      finalReceivable: "0.00",
      rentRefundAllocations: [],
    });
    await flushPromises();

    expect(wrapper.get('[data-test="settlement-summary"]').text()).toContain(
      "待计算",
    );
    expect(
      wrapper.get('[data-test="settlement-summary"]').text(),
    ).not.toContain("100.00");
  });

  it("does not let an older preview rejection overwrite a newer preview", async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (value: Record<string, unknown>) => void;
    const api = checkoutApi as unknown as { preview: ReturnType<typeof vi.fn> };
    api.preview.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectFirst = reject;
        }),
    );
    api.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("preview", 8, payload);
    panel.vm.$emit("preview", 8, {
      ...payload,
      actualCheckoutDate: "2026-08-21",
    });
    await flushPromises();
    resolveSecond({
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "200.00",
      maxRentRefundAmount: "200.00",
      totalRefundAmount: "200.00",
      finalReceivable: "0.00",
      rentRefundAllocations: [],
    });
    await flushPromises();
    rejectFirst(new Error("old preview failed"));
    await flushPromises();

    expect(wrapper.get('[data-test="settlement-summary"]').text()).toContain(
      "200.00",
    );
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("recovers from a failed preview with a fresh maximum before showing it to the settlement panel", async () => {
    const api = checkoutApi as unknown as { preview: ReturnType<typeof vi.fn> };
    api.preview.mockRejectedValueOnce(new Error("preview failed"));
    api.preview.mockResolvedValueOnce({
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "50.00",
      maxRentRefundAmount: "50.00",
      totalRefundAmount: "50.00",
      finalReceivable: "0.00",
      rentRefundAllocations: [],
    });
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("preview", 8, payload);
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("结算金额预估失败");
    panel.vm.$emit("preview", 8, {
      ...payload,
      actualCheckoutDate: "2026-08-21",
    });
    await flushPromises();

    expect(panel.props("preview")).toMatchObject({
      maxRentRefundAmount: "50.00",
    });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it("sends only one submit and one cancel while their workspace actions are in flight", async () => {
    let resolveSubmit!: () => void;
    let resolveCancel!: () => void;
    const api = checkoutApi as unknown as {
      submit: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
    };
    api.submit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    api.cancel.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("submit", 8, payload);
    panel.vm.$emit("submit", 8, payload);
    await flushPromises();
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(panel.props("submitting")).toBe(true);
    resolveSubmit();
    await flushPromises();
    expect(approvalRefresh).toHaveBeenCalledTimes(1);

    panel.vm.$emit("cancel", 8);
    panel.vm.$emit("cancel", 8);
    await flushPromises();
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(panel.props("cancelling")).toBe(true);
    resolveCancel();
    await flushPromises();
  });
  it("keeps the newer preview loading while an older request resolves", async () => {
    let resolveFirst!: (value: Record<string, unknown>) => void;
    let resolveSecond!: (value: Record<string, unknown>) => void;
    const api = checkoutApi as unknown as { preview: ReturnType<typeof vi.fn> };
    api.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    api.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve;
        }),
    );
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("preview", 8, payload);
    panel.vm.$emit("preview", 8, {
      ...payload,
      actualCheckoutDate: "2026-08-21",
    });
    await flushPromises();
    resolveFirst({
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "100.00",
      maxRentRefundAmount: "100.00",
      totalRefundAmount: "100.00",
      finalReceivable: "0.00",
      rentRefundAllocations: [],
    });
    await flushPromises();
    expect(panel.props("previewLoading")).toBe(true);
    resolveSecond({
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "200.00",
      maxRentRefundAmount: "200.00",
      totalRefundAmount: "200.00",
      finalReceivable: "0.00",
      rentRefundAllocations: [],
    });
    await flushPromises();
  });
  it("clears a preview error when the user switches settlements", async () => {
    const api = checkoutApi as unknown as {
      preview: ReturnType<typeof vi.fn>;
      settlements: ReturnType<typeof vi.fn>;
    };
    api.settlements.mockResolvedValueOnce([
      {
        id: 8,
        settlementNo: "TZ202608010001",
        status: "DRAFT",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
      {
        id: 10,
        settlementNo: "TZ202608010010",
        status: "DRAFT",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
    ]);
    api.preview.mockRejectedValueOnce(new Error("preview failed"));
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("preview", 8, payload);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await wrapper
      .get(".settlement-panel__list button:nth-child(2)")
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it("clears preview state when an actual form change invalidates it", async () => {
    let rejectPreview!: (error: Error) => void;
    const api = checkoutApi as unknown as {
      preview: ReturnType<typeof vi.fn>;
      settlements: ReturnType<typeof vi.fn>;
    };
    api.settlements.mockResolvedValueOnce([
      {
        id: 8,
        settlementNo: "TZ202608010001",
        status: "DRAFT",
        contractId: 1,
        actualCheckoutDate: "2026-08-20",
        handoverDate: "2026-08-20",
        inspectionAt: "2026-08-20",
        targetRoomStatus: "EMPTY",
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
    ]);
    api.preview.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectPreview = reject;
        }),
    );
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("preview", 8, payload);
    await flushPromises();
    expect(panel.props("previewLoading")).toBe(true);
    await panel.get('input[type="date"]').setValue("");
    await flushPromises();
    expect(panel.props("preview")).toBeUndefined();
    expect(panel.props("previewLoading")).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    rejectPreview(new Error("old preview failed"));
    await flushPromises();
    expect(panel.props("preview")).toBeUndefined();
    expect(panel.props("previewLoading")).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it("rejects cancellation while settlement submission is pending", async () => {
    let resolveSubmit!: () => void;
    const api = checkoutApi as unknown as {
      submit: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
      settlements: ReturnType<typeof vi.fn>;
    };
    api.settlements.mockResolvedValueOnce([
      {
        id: 8,
        settlementNo: "TZ202608010001",
        status: "DRAFT",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
    ]);
    api.submit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("submit", 8, payload);
    await flushPromises();
    panel.vm.$emit("cancel", 8);
    await flushPromises();
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(api.cancel).not.toHaveBeenCalled();
    expect(panel.props("submitting")).toBe(true);
    expect(panel.props("cancelling")).toBe(true);
    expect(
      panel.get('[data-test="settlement-submit"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      panel.get('[data-test="settlement-cancel"]').attributes("disabled"),
    ).toBeDefined();
    resolveSubmit();
    await flushPromises();
  });
  it("rejects submission while settlement cancellation is pending", async () => {
    let resolveCancel!: () => void;
    const api = checkoutApi as unknown as {
      submit: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
      settlements: ReturnType<typeof vi.fn>;
    };
    api.settlements.mockResolvedValueOnce([
      {
        id: 8,
        settlementNo: "TZ202608010001",
        status: "DRAFT",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
    ]);
    api.cancel.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCancel = resolve;
        }),
    );
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("cancel", 8);
    await flushPromises();
    panel.vm.$emit("submit", 8, payload);
    await flushPromises();
    expect(api.cancel).toHaveBeenCalledTimes(1);
    expect(api.submit).not.toHaveBeenCalled();
    expect(panel.props("submitting")).toBe(true);
    expect(panel.props("cancelling")).toBe(true);
    resolveCancel();
    await flushPromises();
  });
  it("releases the shared settlement mutation guard after a rejected submission", async () => {
    const api = checkoutApi as unknown as {
      submit: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
      settlements: ReturnType<typeof vi.fn>;
    };
    api.settlements.mockResolvedValueOnce([
      {
        id: 8,
        settlementNo: "TZ202608010001",
        status: "DRAFT",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
    ]);
    api.submit.mockRejectedValueOnce(new Error("submit failed"));
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("submit", 8, payload);
    await flushPromises();
    expect(panel.props("submitting")).toBe(false);
    expect(panel.props("cancelling")).toBe(false);
    panel.vm.$emit("cancel", 8);
    await flushPromises();
    expect(api.cancel).toHaveBeenCalledTimes(1);
  });
  it("clears a preview error when an actual form change invalidates it", async () => {
    const api = checkoutApi as unknown as {
      preview: ReturnType<typeof vi.fn>;
      settlements: ReturnType<typeof vi.fn>;
    };
    api.settlements.mockResolvedValueOnce([
      {
        id: 8,
        settlementNo: "TZ202608010001",
        status: "DRAFT",
        contractId: 1,
        actualCheckoutDate: "2026-08-20",
        handoverDate: "2026-08-20",
        inspectionAt: "2026-08-20",
        targetRoomStatus: "EMPTY",
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
    ]);
    api.preview.mockRejectedValueOnce(new Error("preview failed"));
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    const panel = wrapper.findComponent(CheckoutSettlementPanel);
    const payload = {
      actualCheckoutDate: "2026-08-20",
      handoverDate: "2026-08-20",
      inspectionAt: "2026-08-20",
      targetRoomStatus: "EMPTY",
      items: [],
    };
    panel.vm.$emit("preview", 8, payload);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await panel.get('input[type="date"]').setValue("");
    await flushPromises();
    expect(panel.props("preview")).toBeUndefined();
    expect(panel.props("previewLoading")).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it("renders the fourth completed-contracts tab and loads only read-only history", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("已退租合同");
    expect(wrapper.text()).toContain("HT202608010001");
    expect(wrapper.find('[data-test="completed-contract-edit"]').exists()).toBe(
      false,
    );
  });
  it("opens the completed settlement detail without any editing action", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-test="completed-contract-detail-9"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("只读详情");
    expect(wrapper.text()).toContain("房态结果");
    expect(wrapper.text()).toContain("凭证编号：77");
    expect(wrapper.find('[data-test="completed-contract-edit"]').exists()).toBe(
      false,
    );
  });
  it("opens an existing settlement in the completed read-only detail from a valid route query", async () => {
    routeQuery.value = { settlementId: "17" };
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();

    expect(checkoutApi.detail).toHaveBeenCalledWith(17);
    expect(wrapper.text()).toContain("只读详情");
    expect(wrapper.find('[data-test="completed-contract-edit"]').exists()).toBe(
      false,
    );
    wrapper.unmount();
  });
  it.each(["0", "-1", "1.5", "abc", " 17 "])(
    "does not request settlement detail for invalid settlementId=%s",
    async (settlementId) => {
      routeQuery.value = { settlementId };
      const wrapper = mount(CheckoutWorkspace, {
        global: { plugins: [checkoutTestPinia()] },
      });
      await flushPromises();

      expect(checkoutApi.detail).toHaveBeenCalledTimes(1);
      expect(checkoutApi.detail).toHaveBeenCalledWith(9);
      wrapper.unmount();
    },
  );
  it("sends the keyword search and opens an existing checkout detail in read-only mode", async () => {
    const completedResult = {
      items: [
        {
          settlementId: 9,
          settlementNo: "TZ202608010009",
          contractNo: "HT202608010001",
          roomFullHouseNo: "2栋301",
          tenantName: "李四",
          actualCheckoutDate: "2026-08-01T00:00:00.000Z",
          refundAmount: "1300.00",
          completedAt: "2026-08-02T09:30:00.000Z",
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    };
    const wrapper = mount(CompletedCheckoutContractsPanel, {
      props: { result: completedResult },
    });

    await wrapper
      .get('[data-test="completed-contract-search"]')
      .setValue("李四");
    await wrapper
      .get('[data-test="completed-contract-search-submit"]')
      .trigger("click");
    expect(wrapper.emitted("search")).toEqual([["李四"]]);
    await wrapper
      .get('[data-test="completed-contract-detail-9"]')
      .trigger("click");
    expect(wrapper.emitted("select")).toEqual([[9]]);
  });
  it("shows the completed audit timestamp with seconds", () => {
    const wrapper = mount(CompletedCheckoutContractsPanel, {
      props: {
        result: {
          items: [
            {
              settlementId: 9,
              settlementNo: "TZ202608010009",
              contractNo: "HT202608010001",
              roomFullHouseNo: "2栋301",
              tenantName: "李四",
              actualCheckoutDate: "2026-08-01T00:00:00",
              refundAmount: "1300.00",
              completedAt: "2026-08-02T09:30:40",
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        },
      },
    });

    expect(wrapper.text()).toContain("2026/08/02 09:30:40");
  });
  it("shows room and refund statuses in Chinese in the read-only detail", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-test="completed-contract-detail-9"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("空置");
    expect(wrapper.text()).toContain("已确认");
    expect(wrapper.text()).not.toContain("已驳回");
  });

  it("downloads a refund proof from the read-only detail", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:refund-proof");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-test="completed-contract-detail-9"]')
      .trigger("click");
    await flushPromises();

    await wrapper

      .get('[data-test="refund-proof-download-6-77"]')
      .trigger("click");
    await flushPromises();

    expect(
      (
        checkoutApi as unknown as {
          downloadRefundProof: ReturnType<typeof vi.fn>;
        }
      ).downloadRefundProof,
    ).toHaveBeenCalledWith(6, 77);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:refund-proof");
    click.mockRestore();
  });

  it.each([
    ["image/png", "img"],
    ["application/pdf", "iframe"],
  ])(
    "previews a refund proof with MIME type %s",
    async (mimeType, selector) => {
      const createObjectURL = vi
        .fn()
        .mockReturnValue("blob:refund-proof-preview");
      const revokeObjectURL = vi.fn();
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: createObjectURL,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: revokeObjectURL,
      });
      (
        checkoutApi as unknown as {
          downloadRefundProof: ReturnType<typeof vi.fn>;
        }
      ).downloadRefundProof.mockResolvedValueOnce({
        data: new Blob(["proof"], { type: mimeType }),
        headers: {
          "content-type": mimeType,
          "content-disposition": "attachment; filename*=UTF-8''refund-file",
        },
      });
      const wrapper = mount(CheckoutWorkspace, {
        global: { plugins: [checkoutTestPinia()] },
      });
      await flushPromises();
      await wrapper
        .get('[data-test="checkout-tab-completed"]')
        .trigger("click");
      await flushPromises();
      await wrapper
        .get('[data-test="completed-contract-detail-9"]')
        .trigger("click");
      await flushPromises();

      await wrapper
        .get('[data-test="refund-proof-preview-6-77"]')
        .trigger("click");
      await flushPromises();

      const dialog = wrapper.get('[data-test="refund-proof-preview-dialog"]');
      expect(dialog.get(selector).attributes("src")).toBe(
        "blob:refund-proof-preview",
      );
      expect(
        wrapper.find('[data-test="refund-proof-download-6-77"]').exists(),
      ).toBe(true);

      await dialog
        .get('[data-test="refund-proof-preview-close"]')
        .trigger("click");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:refund-proof-preview");
    },
  );

  it("shows a Chinese error when a refund proof cannot be downloaded", async () => {
    (
      checkoutApi as unknown as {
        downloadRefundProof: ReturnType<typeof vi.fn>;
      }
    ).downloadRefundProof.mockRejectedValueOnce(new Error("network"));
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-test="completed-contract-detail-9"]')
      .trigger("click");
    await flushPromises();

    await wrapper
      .get('[data-test="refund-proof-download-6-77"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "退款凭证下载失败，请稍后重试",
    );
  });

  it("shows only actionable settlement cards and hides approved records from the settlement tab", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");

    expect(wrapper.text()).toContain("TZ202608010001");
    expect(wrapper.text()).not.toContain("TZ202608010002");
  });

  it("confirms and cancels a rejected checkout settlement from the settlement card", async () => {
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: vi.fn(),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [
          {
            id: 10,
            settlementNo: "TZ202608010010",
            status: "REJECTED",
            contractId: 3,
            depositRefundableAmount: "0.00",
            prepaymentRefundableAmount: "0.00",
            rentRefundableAmount: "0.00",
            finalReceivable: "0.00",
          },
        ],
      },
    });

    await wrapper.get('[data-test="settlement-cancel"]').trigger("click");

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining("取消后会恢复合同和房态"),
    );
    expect(wrapper.emitted("cancel")).toEqual([[10]]);
    confirm.mockRestore();
  });

  it("calls the cancel API and reloads checkout data after cancellation", async () => {
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: vi.fn(),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = checkoutApi as unknown as {
      cancel: ReturnType<typeof vi.fn>;
      settlements: ReturnType<typeof vi.fn>;
    };
    const initialSettlementCalls = api.settlements.mock.calls.length;
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");

    await wrapper.get('[data-test="settlement-cancel"]').trigger("click");
    await flushPromises();

    expect(api.cancel).toHaveBeenCalledWith(8);
    expect(api.settlements.mock.calls.length).toBe(initialSettlementCalls + 2);
    confirm.mockRestore();
  });

  it("loads approved settlements for the final refund tab from a dedicated endpoint", async () => {
    const api = checkoutApi as unknown as {
      settlements: ReturnType<typeof vi.fn>;
      refundPendingSettlements: ReturnType<typeof vi.fn>;
      detail: ReturnType<typeof vi.fn>;
    };
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });

    await flushPromises();
    await wrapper.get("button:nth-child(3)").trigger("click");
    await flushPromises();

    expect(api.settlements).toHaveBeenCalled();
    expect(api.refundPendingSettlements).toHaveBeenCalled();
    expect(api.detail).toHaveBeenCalledWith(9);
    expect(wrapper.text()).toContain("\u65e0\u9700\u9000\u6b3e\u786e\u8ba4");
  });
  it("keeps every refund-pending settlement visible instead of dropping all but the first", async () => {
    const api = checkoutApi as unknown as {
      refundPendingSettlements: ReturnType<typeof vi.fn>;
    };
    api.refundPendingSettlements.mockResolvedValueOnce([
      {
        id: 9,
        settlementNo: "TZ-9",
        status: "APPROVED",
        contractId: 2,
        contract: { room: { fullHouseNo: "1栋101" } },
      },
      {
        id: 10,
        settlementNo: "TZ-10",
        status: "APPROVED",
        contractId: 3,
        contract: { room: { fullHouseNo: "2栋201" } },
      },
    ]);
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });

    await flushPromises();
    await wrapper.get("button:nth-child(3)").trigger("click");

    expect(wrapper.find('[data-test="refund-settlement-9"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-test="refund-settlement-10"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain("1栋101");
    expect(wrapper.text()).toContain("2栋201");
  });
  it("confirms and cancels only the pending refund application", async () => {
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: vi.fn(),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = checkoutApi as unknown as {
      detail: ReturnType<typeof vi.fn>;
      cancelRefund: ReturnType<typeof vi.fn>;
    };
    api.detail.mockResolvedValueOnce({
      id: 9,
      settlementNo: "TZ-9",
      status: "APPROVED",
      contractId: 2,
      depositRefundableAmount: "100.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "0.00",
      totalRefundAmount: "100.00",
      finalReceivable: "0.00",
      depositRefunds: [
        { id: 49, approvalStatus: "PENDING", refundAmount: "100.00" },
      ],
    });
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });

    await flushPromises();
    await wrapper.get("button:nth-child(3)").trigger("click");
    await wrapper.get('[data-test="refund-cancel"]').trigger("click");
    await flushPromises();

    expect(confirm).toHaveBeenCalled();
    expect(api.cancelRefund).toHaveBeenCalledWith(49);
    expect(approvalRefresh).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
  it("confirms and cancels the entire approved checkout separately", async () => {
    Object.defineProperty(window, "confirm", {
      configurable: true,
      value: vi.fn(),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = checkoutApi as unknown as {
      detail: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
    };
    api.detail.mockResolvedValueOnce({
      id: 9,
      settlementNo: "TZ-9",
      status: "APPROVED",
      contractId: 2,
      depositRefundableAmount: "100.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "0.00",
      totalRefundAmount: "100.00",
      finalReceivable: "0.00",
      depositRefunds: [],
    });
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });

    await flushPromises();
    await wrapper.get("button:nth-child(3)").trigger("click");
    await wrapper
      .get('[data-test="checkout-cancel-approved"]')
      .trigger("click");
    await flushPromises();

    expect(confirm).toHaveBeenCalled();
    expect(api.cancel).toHaveBeenCalledWith(9);
    confirm.mockRestore();
  });
  it("shows zero-refund final confirmation without proof upload for a super admin", () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "SUPER_ADMIN",
        settlement: {
          id: 1,
          settlementNo: "TZ202608010001",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "0.00",
          prepaymentRefundableAmount: "0.00",
          rentRefundableAmount: "0.00",
          totalRefundAmount: "0.00",
          finalReceivable: "0.00",
        },
      },
    });

    expect(wrapper.text()).toContain("无需退款确认");
    expect(wrapper.find('[data-test="zero-complete"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("上传退款凭证");
  });
  it("shows supplemental collection instead of zero-refund completion when receivable remains", () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "SUPER_ADMIN",
        settlement: {
          id: 1,
          settlementNo: "TZ202608010001",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "0.00",
          prepaymentRefundableAmount: "0.00",
          rentRefundableAmount: "0.00",
          totalRefundAmount: "0.00",
          finalReceivable: "120.00",
        },
      },
    });

    expect(wrapper.text()).toContain("待补收");
    expect(wrapper.find('[data-test="zero-complete"]').exists()).toBe(false);
  });
  it("allows final confirmation after the realtime supplemental balance is collected", () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "SUPER_ADMIN",
        settlement: {
          id: 1,
          settlementNo: "TZ202608010001",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "0.00",
          prepaymentRefundableAmount: "0.00",
          rentRefundableAmount: "0.00",
          totalRefundAmount: "0.00",
          finalReceivable: "120.00",
          supplementalRequired: true,
          supplementalOutstandingAmount: "0.00",
        },
      },
    });

    expect(wrapper.find('[data-test="supplemental-collect"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="zero-complete"]').exists()).toBe(true);
  });
  it("shows the approved zero-refund settlement in the final confirmation tab", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(3)").trigger("click");

    expect(wrapper.text()).toContain("无需退款确认");
  });
  it("disables positive refund submission before a refund proof is uploaded", () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "ADMIN",
        settlement: {
          id: 2,
          settlementNo: "TZ202608010002",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "800.00",
          prepaymentRefundableAmount: "500.00",
          rentRefundableAmount: "0.00",
          totalRefundAmount: "1300.00",
          finalReceivable: "0.00",
        },
      },
    });

    expect(
      wrapper.get('[data-test="refund-submit"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("allows a draft settlement to be maintained and submitted", () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [
          {
            id: 10,
            settlementNo: "TZ202608010010",
            status: "DRAFT",
            contractId: 3,
            depositRefundableAmount: "0.00",
            prepaymentRefundableAmount: "0.00",
            rentRefundableAmount: "0.00",
            finalReceivable: "0.00",
          },
        ],
      },
    });

    expect(wrapper.find('[data-test="settlement-submit"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("提交结算");
  });

  it("lets a super admin finally confirm a registered positive refund", () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "SUPER_ADMIN",
        settlement: {
          id: 2,
          settlementNo: "TZ202608010002",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "800.00",
          prepaymentRefundableAmount: "500.00",
          rentRefundableAmount: "0.00",
          totalRefundAmount: "1300.00",
          finalReceivable: "0.00",
          depositRefunds: [
            { id: 9, approvalStatus: "PENDING", refundAmount: "1300.00" },
          ],
        },
      },
    });

    expect(wrapper.find('[data-test="refund-approve"]').exists()).toBe(true);
  });
  it("shows a read-only finance snapshot for the selected checkout contract", () => {
    const wrapper = mount(CheckoutInitiatePanel, {
      props: {
        contracts: [],
        snapshot: {
          depositBalance: "800.00",
          rentOutstanding: "120.00",
          prepaymentBalance: "500.00",
          futureBillCount: 2,
        },
      },
    });

    expect(wrapper.text()).toContain("财务快照");
    expect(wrapper.text()).toContain("800.00");
    expect(wrapper.text()).toContain("未来账单");
  });
  it("emits the selected pending refund for final approval", async () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "SUPER_ADMIN",
        settlement: {
          id: 2,
          settlementNo: "TZ202608010002",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "800.00",
          prepaymentRefundableAmount: "0.00",
          rentRefundableAmount: "0.00",
          totalRefundAmount: "800.00",
          finalReceivable: "0.00",
          depositRefunds: [
            { id: 9, approvalStatus: "PENDING", refundAmount: "800.00" },
          ],
        },
      },
    });
    await wrapper.get('[data-test="refund-approve"]').trigger("click");
    expect(wrapper.emitted("approve")).toEqual([[9]]);
  });

  it("submits only the locked combined-refund DTO without client split amounts", async () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "ADMIN",
        settlement: {
          id: 2,
          settlementNo: "TZ202608010002",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "800.00",
          prepaymentRefundableAmount: "500.00",
          rentRefundableAmount: "200.00",
          totalRefundAmount: "1500.00",
          finalReceivable: "0.00",
        },
      },
    });
    (wrapper.vm as unknown as { addProof: (id: number) => void }).addProof(77);
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-test="refund-submit"]').trigger("click");

    expect(wrapper.emitted("submit")?.[0]?.[0]).not.toHaveProperty("remark");
    const payload = wrapper.emitted("submit")?.[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      checkoutSettlementId: 2,
      refundAmount: "1500.00",
      proofFileIds: [77],
    });
    expect(payload).not.toHaveProperty("depositRefundAmount");
    expect(payload).not.toHaveProperty("prepaymentRefundAmount");
    expect(payload).not.toHaveProperty("rentRefundAmount");
  });

  it("submits a clean zero-item settlement so a zero-refund checkout can continue", async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [
          {
            id: 10,
            settlementNo: "TZ202608010010",
            status: "DRAFT",
            contractId: 3,
            depositRefundableAmount: "0.00",
            prepaymentRefundableAmount: "0.00",
            rentRefundableAmount: "0.00",
            finalReceivable: "0.00",
          },
        ],
      },
    });
    await wrapper.get('[data-test="settlement-submit"]').trigger("click");
    expect(wrapper.emitted("submit")?.[0]?.[0]).toBe(10);
    expect(wrapper.emitted("submit")?.[0]?.[1]).toMatchObject({ items: [] });
  });

  it.each(["DRAFT", "PENDING", "REJECTED"] as const)(
    "does not present %s settlement amounts as confirmed zero values before approval",
    (status) => {
      const wrapper = mount(CheckoutSettlementPanel, {
        props: {
          settlements: [
            {
              id: 10,
              settlementNo: "TZ202608010010",
              status,
              contractId: 3,
              depositRefundableAmount: "0.00",
              prepaymentRefundableAmount: "0.00",
              rentRefundableAmount: "0.00",
              finalReceivable: "0.00",
            },
          ],
        },
      });

      const summary = wrapper.get('[data-test="settlement-summary"]');
      expect(summary.text()).toContain("填写完整后自动计算");
      expect(summary.text()).not.toContain("¥0.00");
    },
  );

  it("omits a blank optional remark when submitting a settlement", async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [
          {
            id: 10,
            settlementNo: "TZ202608010010",
            status: "DRAFT",
            contractId: 3,
            depositRefundableAmount: "0.00",
            prepaymentRefundableAmount: "0.00",
            rentRefundableAmount: "0.00",
            finalReceivable: "0.00",
          },
        ],
      },
    });

    await wrapper.get('[data-test="settlement-submit"]').trigger("click");

    expect(wrapper.emitted("submit")?.[0]?.[1]).not.toHaveProperty("remark");
  });

  it("replaces backend validator English with a Chinese settlement error", async () => {
    const api = checkoutApi as unknown as {
      settlements: ReturnType<typeof vi.fn>;
      submit: ReturnType<typeof vi.fn>;
    };
    api.settlements.mockResolvedValueOnce([
      {
        id: 10,
        settlementNo: "TZ202608010010",
        status: "DRAFT",
        contractId: 3,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        finalReceivable: "0.00",
      },
    ]);
    api.submit.mockRejectedValueOnce({
      response: {
        data: {
          message: ["remark must be longer than or equal to 1 characters"],
        },
      },
    });
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    await wrapper.get('[data-test="settlement-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "提交结算失败，请检查填写内容后重试",
    );
    expect(wrapper.get('[role="alert"]').text()).not.toContain("remark");
    expect(approvalRefresh).not.toHaveBeenCalled();
  });
  it("does not offer refund registration to visitors", () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "VISITOR",
        settlement: {
          id: 2,
          settlementNo: "TZ202608010002",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "800.00",
          prepaymentRefundableAmount: "0.00",
          rentRefundableAmount: "200.00",
          totalRefundAmount: "1000.00",
          finalReceivable: "0.00",
        },
      },
    });

    expect(wrapper.find('[data-test="refund-submit"]').exists()).toBe(false);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("访客仅可查看，不能登记退款或上传凭证。");
  });
  it("blocks a duplicate combined refund submission while registration is loading", async () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "ADMIN",
        submitting: true,
        settlement: {
          id: 2,
          settlementNo: "TZ202608010002",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "800.00",
          prepaymentRefundableAmount: "0.00",
          rentRefundableAmount: "200.00",
          totalRefundAmount: "1000.00",
          finalReceivable: "0.00",
        },
      },
    });
    (wrapper.vm as unknown as { addProof: (id: number) => void }).addProof(77);
    await wrapper.vm.$nextTick();

    const submit = wrapper.get('[data-test="refund-submit"]');
    expect(submit.attributes("disabled")).toBeDefined();
    await submit.trigger("click");
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("resets all mutable refund registration values when the settlement changes", async () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "ADMIN",
        settlement: {
          id: 2,
          settlementNo: "TZ-OLD",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "100.00",
          prepaymentRefundableAmount: "0.00",
          rentRefundableAmount: "0.00",
          totalRefundAmount: "100.00",
          finalReceivable: "0.00",
        },
      },
    });
    await wrapper.get('input[type="date"]').setValue("2026-08-15");
    await wrapper.get("select").setValue("BANK_TRANSFER");
    await wrapper.get("textarea").setValue("旧工单备注");
    (wrapper.vm as unknown as { addProof: (id: number) => void }).addProof(77);
    await wrapper.setProps({
      settlement: {
        id: 3,
        settlementNo: "TZ-NEW",
        status: "APPROVED",
        contractId: 3,
        depositRefundableAmount: "200.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        totalRefundAmount: "200.00",
        finalReceivable: "0.00",
      },
    });
    (wrapper.vm as unknown as { addProof: (id: number) => void }).addProof(88);
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-test="refund-submit"]').trigger("click");

    expect(wrapper.emitted("submit")?.[0]?.[0]).toMatchObject({
      checkoutSettlementId: 3,
      refundDate: expect.not.stringMatching("2026-08-15"),
      refundMethod: "WECHAT",
      proofFileIds: [88],
    });
    expect(wrapper.emitted("submit")?.[0]?.[0]).not.toHaveProperty("remark");
  });

  it.each(["DRAFT", "PENDING", "REJECTED"] as const)(
    "keeps VISITOR read-only for a %s settlement",
    (status) => {
      const wrapper = mount(CheckoutSettlementPanel, {
        props: {
          role: "VISITOR",
          settlements: [
            {
              id: 10,
              settlementNo: "TZ202608010010",
              status,
              contractId: 3,
              depositRefundableAmount: "0.00",
              prepaymentRefundableAmount: "0.00",
              rentRefundableAmount: "0.00",
              finalReceivable: "0.00",
            },
          ],
        },
      });

      expect(wrapper.find(".settlement-panel__form-grid").exists()).toBe(false);
      expect(wrapper.find('[data-test="settlement-submit"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="settlement-cancel"]').exists()).toBe(
        false,
      );
      expect(wrapper.text()).not.toContain("退回草稿并编辑");
      expect(
        wrapper
          .findAll("button")
          .some((button) => button.text() === "确认结算"),
      ).toBe(false);
    },
  );

  it("allows ADMIN draft operations but reserves pending approval and rejection for SUPER_ADMIN", () => {
    const settlement = {
      id: 10,
      settlementNo: "TZ202608010010",
      contractId: 3,
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "0.00",
      finalReceivable: "0.00",
    };
    const adminDraft = mount(CheckoutSettlementPanel, {
      props: {
        role: "ADMIN",
        settlements: [{ ...settlement, status: "DRAFT" }],
      },
    });
    const adminPending = mount(CheckoutSettlementPanel, {
      props: {
        role: "ADMIN",
        settlements: [{ ...settlement, status: "PENDING" }],
      },
    });
    const adminRejected = mount(CheckoutSettlementPanel, {
      props: {
        role: "ADMIN",
        settlements: [{ ...settlement, status: "REJECTED" }],
      },
    });
    const superAdmin = mount(CheckoutSettlementPanel, {
      props: {
        role: "SUPER_ADMIN",
        settlements: [{ ...settlement, status: "PENDING" }],
      },
    });

    expect(adminDraft.find('[data-test="settlement-submit"]').exists()).toBe(
      true,
    );
    expect(
      adminPending
        .findAll("button")
        .some((button) => button.text() === "确认结算"),
    ).toBe(false);
    expect(adminRejected.text()).not.toContain("退回草稿并编辑");
    expect(superAdmin.text()).toContain("确认结算");
  });
  it("revokes a late refund proof preview after switching tabs", async () => {
    const api = checkoutApi as unknown as {
      detail: ReturnType<typeof vi.fn>;
      downloadRefundProof: ReturnType<typeof vi.fn>;
    };
    let resolveDownload!: (value: {
      data: Blob;
      headers: Record<string, string>;
    }) => void;
    api.detail.mockResolvedValueOnce({
      id: 9,
      settlementNo: "TZ202608010009",
      status: "APPROVED",
      contractId: 1,
      depositRefundableAmount: "100.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "0.00",
      totalRefundAmount: "100.00",
      finalReceivable: "0.00",
      depositRefunds: [
        {
          id: 6,
          approvalStatus: "PENDING",
          refundAmount: "100.00",
          files: [
            {
              fileAssetId: 77,
              originalName: "真实凭证.png",
              mimeType: "image/png",
            },
          ],
        },
      ],
    });
    api.downloadRefundProof.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve;
        }),
    );
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:late-proof");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-refund"]').trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-test="refund-proof-preview-6-77"]')
      .trigger("click");
    await wrapper.get('[data-test="checkout-tab-settlement"]').trigger("click");
    resolveDownload({
      data: new Blob(["proof"], { type: "image/png" }),
      headers: {
        "content-type": "image/png",
        "content-disposition": "attachment; filename*=UTF-8''真实凭证.png",
      },
    });
    await flushPromises();

    expect(
      wrapper.find('[data-test="refund-proof-preview-dialog"]').exists(),
    ).toBe(false);
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:late-proof");
  });
});

describe("CheckoutTopNav", () => {
  it("emits tab changes when a workflow tab is clicked", async () => {
    const wrapper = mount(CheckoutInitiatePanel, {
      props: {
        contracts: [{ id: 1, contractNo: "HT202608010001", status: "ACTIVE" }],
        selectedContractId: 1,
      },
    });
    await flushPromises();

    const select = wrapper.find('[data-test="checkout-contract-select"]');
    expect((select.element as HTMLSelectElement).value).toBe("1");
    expect(wrapper.emitted("contractChange")).toEqual([[1]]);
  });
});

describe("Task8 completed detail requests", () => {
  it("invalidates a completed-detail download when the workspace unmounts", async () => {
    const api = checkoutApi as unknown as {
      detail: ReturnType<typeof vi.fn>;
      downloadRefundProof: ReturnType<typeof vi.fn>;
    };
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();

    api.detail.mockReset();
    api.detail.mockResolvedValueOnce({
      id: 17,
      settlementNo: "TZ-UNMOUNT-A",
      status: "COMPLETED",
      contractId: 1,
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "0.00",
      totalRefundAmount: "0.00",
      finalReceivable: "0.00",
      depositRefunds: [
        {
          id: 6,
          approvalStatus: "APPROVED",
          refundAmount: "100.00",
          files: [{ fileAssetId: 77, originalName: "A-凭证.png" }],
        },
      ],
    });
    let resolveDownload!: (value: {
      data: Blob;
      headers: Record<string, string>;
    }) => void;
    api.downloadRefundProof.mockReset();
    api.downloadRefundProof.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve;
        }),
    );
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:unmounted-download");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    try {
      const completed = wrapper.findComponent(CompletedCheckoutContractsPanel);
      completed.vm.$emit("select", 17);
      await flushPromises();
      const staleDownloadButton = wrapper.get(
        '[data-test="refund-proof-download-6-77"]',
      );
      await staleDownloadButton.trigger("click");
      await flushPromises();
      expect(api.downloadRefundProof).toHaveBeenCalledWith(6, 77);
      createObjectURL.mockClear();
      revokeObjectURL.mockClear();
      click.mockClear();

      wrapper.unmount();
      resolveDownload({
        data: new Blob(["proof"], { type: "image/png" }),
        headers: {
          "content-type": "image/png",
          "content-disposition": "attachment; filename*=UTF-8''A-proof.png",
        },
      });
      await flushPromises();

      expect(createObjectURL).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
      expect(revokeObjectURL).not.toHaveBeenCalled();

      api.downloadRefundProof.mockClear();
      await staleDownloadButton.trigger("click");
      await flushPromises();
      expect(api.downloadRefundProof).not.toHaveBeenCalled();
    } finally {
      click.mockRestore();
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
    }
  });

  it("clears A detail and rejects its stale proof action while B detail is pending", async () => {
    const api = checkoutApi as unknown as {
      detail: ReturnType<typeof vi.fn>;
      downloadRefundProof: ReturnType<typeof vi.fn>;
    };
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();

    let resolveB!: (value: Record<string, unknown>) => void;
    api.detail.mockReset();
    api.detail
      .mockResolvedValueOnce({
        id: 17,
        settlementNo: "TZ-DETAIL-A",
        status: "COMPLETED",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        totalRefundAmount: "0.00",
        finalReceivable: "0.00",
        depositRefunds: [
          {
            id: 6,
            approvalStatus: "APPROVED",
            refundAmount: "100.00",
            files: [{ fileAssetId: 77, originalName: "A-凭证.png" }],
          },
        ],
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveB = resolve;
          }),
      );
    api.downloadRefundProof.mockResolvedValue({
      data: new Blob(["proof"], { type: "image/png" }),
      headers: { "content-type": "image/png" },
    });
    const completed = wrapper.findComponent(CompletedCheckoutContractsPanel);

    completed.vm.$emit("select", 17);
    await flushPromises();
    const staleProofButton = wrapper.get(
      '[data-test="refund-proof-preview-6-77"]',
    );
    expect(wrapper.text()).toContain("TZ-DETAIL-A");

    completed.vm.$emit("select", 18);
    await flushPromises();

    expect(wrapper.find(".checkout-workspace__readonly-detail").exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-test="refund-proof-preview-6-77"]').exists(),
    ).toBe(false);
    api.downloadRefundProof.mockClear();
    await staleProofButton.trigger("click");
    await flushPromises();
    expect(api.downloadRefundProof).not.toHaveBeenCalled();

    resolveB({
      id: 18,
      settlementNo: "TZ-DETAIL-B",
      status: "COMPLETED",
      contractId: 1,
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "0.00",
      totalRefundAmount: "0.00",
      finalReceivable: "0.00",
      depositRefunds: [],
    });
    await flushPromises();

    expect(wrapper.text()).toContain("TZ-DETAIL-B");
    expect(wrapper.text()).not.toContain("TZ-DETAIL-A");
  });

  it("revokes a late proof response when a completed-detail selection replaces its context", async () => {
    const api = checkoutApi as unknown as {
      detail: ReturnType<typeof vi.fn>;
      downloadRefundProof: ReturnType<typeof vi.fn>;
    };
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();

    api.detail.mockReset();
    api.detail
      .mockResolvedValueOnce({
        id: 17,
        settlementNo: "TZ-PROOF-A",
        status: "COMPLETED",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        totalRefundAmount: "0.00",
        finalReceivable: "0.00",
        depositRefunds: [
          {
            id: 6,
            approvalStatus: "APPROVED",
            refundAmount: "100.00",
            files: [
              {
                fileAssetId: 77,
                originalName: "A-凭证.png",
                mimeType: "image/png",
              },
            ],
          },
        ],
      })
      .mockResolvedValueOnce({
        id: 18,
        settlementNo: "TZ-CONTEXT-B",
        status: "COMPLETED",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
        rentRefundableAmount: "0.00",
        totalRefundAmount: "0.00",
        finalReceivable: "0.00",
        depositRefunds: [],
      });
    let resolveProof!: (value: {
      data: Blob;
      headers: Record<string, string>;
    }) => void;
    api.downloadRefundProof.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveProof = resolve;
        }),
    );
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:proof-from-a");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const completed = wrapper.findComponent(CompletedCheckoutContractsPanel);

    completed.vm.$emit("select", 17);
    await flushPromises();
    await wrapper
      .get('[data-test="refund-proof-preview-6-77"]')
      .trigger("click");
    completed.vm.$emit("select", 18);
    await flushPromises();
    resolveProof({
      data: new Blob(["proof"], { type: "image/png" }),
      headers: {
        "content-type": "image/png",
        "content-disposition":
          "attachment; filename*=UTF-8''A-%E5%87%AD%E8%AF%81.png",
      },
    });
    await flushPromises();

    expect(
      wrapper.get(".checkout-workspace__readonly-detail").text(),
    ).toContain("TZ-CONTEXT-B");
    expect(
      wrapper.find('[data-test="refund-proof-preview-dialog"]').exists(),
    ).toBe(false);
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:proof-from-a");
  });

  it("keeps the newer completed detail when an older request resolves late", async () => {
    const api = checkoutApi as unknown as { detail: ReturnType<typeof vi.fn> };
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();

    let resolveFirst!: (value: Record<string, unknown>) => void;
    let resolveSecond!: (value: Record<string, unknown>) => void;
    api.detail.mockReset();
    api.detail
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const completed = wrapper.findComponent(CompletedCheckoutContractsPanel);
    completed.vm.$emit("select", 17);
    completed.vm.$emit("select", 18);
    resolveSecond({
      id: 18,
      settlementNo: "TZ-NEW",
      status: "COMPLETED",
      contractId: 1,
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "0.00",
      totalRefundAmount: "0.00",
      finalReceivable: "0.00",
    });
    await flushPromises();
    expect(wrapper.text()).toContain("TZ-NEW");
    resolveFirst({
      id: 17,
      settlementNo: "TZ-OLD",
      status: "COMPLETED",
      contractId: 1,
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "0.00",
      totalRefundAmount: "0.00",
      finalReceivable: "0.00",
    });
    await flushPromises();
    expect(wrapper.text()).toContain("TZ-NEW");
    expect(wrapper.text()).not.toContain("TZ-OLD");
  });
  it("does not restore a late completed detail after leaving the tab", async () => {
    const api = checkoutApi as unknown as { detail: ReturnType<typeof vi.fn> };
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [checkoutTestPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();

    let resolveDetail!: (value: Record<string, unknown>) => void;
    api.detail.mockReset();
    api.detail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDetail = resolve;
        }),
    );
    wrapper
      .findComponent(CompletedCheckoutContractsPanel)
      .vm.$emit("select", 17);
    await wrapper.get('[data-test="checkout-tab-initiate"]').trigger("click");
    resolveDetail({
      id: 17,
      settlementNo: "TZ-OLD",
      status: "COMPLETED",
      contractId: 1,
      depositRefundableAmount: "0.00",
      prepaymentRefundableAmount: "0.00",
      rentRefundableAmount: "0.00",
      totalRefundAmount: "0.00",
      finalReceivable: "0.00",
    });
    await flushPromises();

    expect(wrapper.text()).not.toContain("TZ-OLD");
  });
});
