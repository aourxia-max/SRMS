import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import { checkoutApi } from "../../services/checkout";
import CheckoutTopNav from "./CheckoutTopNav.vue";
import CheckoutWorkspace from "./CheckoutWorkspace.vue";
import CheckoutInitiatePanel from "./CheckoutInitiatePanel.vue";
import CheckoutSettlementPanel from "./CheckoutSettlementPanel.vue";
import CheckoutRefundPanel from "./CheckoutRefundPanel.vue";
import CompletedCheckoutContractsPanel from "./CompletedCheckoutContractsPanel.vue";
vi.mock("../../services/checkout", () => ({
  checkoutApi: {
    contracts: vi
      .fn()
      .mockResolvedValue([
        { id: 1, contractNo: "HT202608010001", status: "ACTIVE" },
      ]),
    initiate: vi.fn(),
    financeSnapshot: vi.fn().mockResolvedValue({ depositBalance: "1000.00", rentOutstanding: "0.00", prepaymentBalance: "0.00", futureBillCount: 0 }),
    settlements: vi.fn().mockResolvedValue([
      {
        id: 8,
        settlementNo: "TZ202608010001",
        status: "PENDING",
        contractId: 1,
        depositRefundableAmount: "0.00",
        prepaymentRefundableAmount: "0.00",
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
    submit: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
  },
}));

describe("CheckoutTopNav", () => {
  it("renders the three checkout workflow tabs in Chinese", () => {
    const wrapper = mount(CheckoutTopNav, { props: { activeTab: "initiate" } });

    expect(wrapper.text()).toContain("1 发起退租");
    expect(wrapper.text()).toContain("2 退租结算");
    expect(wrapper.text()).toContain("3 押金退还确认");
  });
  it("places checkout workflow navigation at the top without the old page intro block", () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.find(".checkout-workspace__header").exists()).toBe(false);
    expect(wrapper.find(".checkout-workspace > .checkout-top-nav").exists()).toBe(true);
  });
  it("opens the initiate checkout workspace by default", () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [createPinia()] },
    });

    expect(wrapper.text()).toContain("发起退租");
    expect(wrapper.text()).toContain("请选择正在履行的合同");
  });
  it("requires an active contract and checkout reason before initiation", async () => {
    const wrapper = mount(CheckoutInitiatePanel, {
      props: {
        contracts: [{ id: 1, contractNo: "HT202608010001", status: "ACTIVE" }],
      },
    });

    await wrapper.get('[data-test="initiate-submit"]').trigger("click");

    expect(wrapper.text()).toContain("请选择正在履行的合同");
    expect(wrapper.text()).toContain("请填写退租原因");
  });
  it("loads active contracts into the initiate checkout form", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();

    expect(wrapper.text()).toContain("HT202608010001");
  });
  it("keeps an approved settlement in the final refund confirmation panel", () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        settlement: {
          id: 1,
          settlementNo: "TZ202608010001",
          status: "APPROVED",
          contractId: 3,
          depositRefundableAmount: "800.00",
          prepaymentRefundableAmount: "500.00",
          finalReceivable: "0.00",
        },
        role: "ADMIN",
      },
    });

    expect(wrapper.text()).toContain("押金退还确认");
    expect(wrapper.text()).toContain("1,300.00");
  });
  it("loads settlement records when switching to the settlement tab", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");

    expect(wrapper.text()).toContain("TZ202608010001");
  });
  it("renders the fourth completed-contracts tab and loads only read-only history", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [createPinia()] },
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
      global: { plugins: [createPinia()] },
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
      global: { plugins: [createPinia()] },
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
    expect(wrapper.text()).toContain("已驳回");
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
      global: { plugins: [createPinia()] },
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

  it("shows a Chinese error when a refund proof cannot be downloaded", async () => {
    (
      checkoutApi as unknown as {
        downloadRefundProof: ReturnType<typeof vi.fn>;
      }
    ).downloadRefundProof.mockRejectedValueOnce(new Error("network"));
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [createPinia()] },
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
      global: { plugins: [createPinia()] },
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
      global: { plugins: [createPinia()] },
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
      global: { plugins: [createPinia()] },
    });

    await flushPromises();
    await wrapper.get("button:nth-child(3)").trigger("click");
    await flushPromises();

    expect(api.settlements).toHaveBeenCalled();
    expect(api.refundPendingSettlements).toHaveBeenCalled();
    expect(api.detail).toHaveBeenCalledWith(9);
    expect(wrapper.text()).toContain("\u65e0\u9700\u9000\u6b3e\u786e\u8ba4");
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
          finalReceivable: "120.00",
          supplementalRequired: true,
          supplementalOutstandingAmount: "0.00",
        },
      },
    });

    expect(wrapper.find('[data-test="supplemental-collect"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="zero-complete"]').exists()).toBe(true);
  });
  it("shows the approved zero-refund settlement in the final confirmation tab", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [createPinia()] },
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

  it("omits a blank optional remark when submitting a deposit refund", async () => {
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
          finalReceivable: "0.00",
        },
      },
    });
    (wrapper.vm as unknown as { addProof: (id: number) => void }).addProof(77);
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-test="refund-submit"]').trigger("click");

    expect(wrapper.emitted("submit")?.[0]?.[0]).not.toHaveProperty("remark");
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
            finalReceivable: "0.00",
          },
        ],
      },
    });
    await wrapper.get('[data-test="settlement-submit"]').trigger("click");
    expect(wrapper.emitted("submit")?.[0]?.[0]).toBe(10);
    expect(wrapper.emitted("submit")?.[0]?.[1]).toMatchObject({ items: [] });
  });

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
        finalReceivable: "0.00",
      },
    ]);
    api.submit.mockRejectedValueOnce({
      response: {
        data: { message: ["remark must be longer than or equal to 1 characters"] },
      },
    });
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    await wrapper.get("button:nth-child(2)").trigger("click");
    await wrapper.get('[data-test="settlement-submit"]').trigger("click");
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "提交结算失败，请检查填写内容后重试",
    );
    expect(wrapper.get('[role="alert"]').text()).not.toContain("remark");
  });
});


describe('CheckoutTopNav', () => {
  it('emits tab changes when a workflow tab is clicked', async () => {
    const wrapper = mount(CheckoutInitiatePanel, {
      props: {
        contracts: [{ id: 1, contractNo: 'HT202608010001', status: 'ACTIVE' }],
        selectedContractId: 1,
      },
    })
    await flushPromises()

    const select = wrapper.find('[data-test="checkout-contract-select"]')
    expect((select.element as HTMLSelectElement).value).toBe('1')
    expect(wrapper.emitted('contractChange')).toEqual([[1]])
  })
})
