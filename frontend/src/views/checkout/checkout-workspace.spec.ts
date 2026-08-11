import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
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
      ],
    }),
    approve: vi.fn(),
  },
}));

describe("CheckoutTopNav", () => {
  it("renders the three checkout workflow tabs in Chinese", () => {
    const wrapper = mount(CheckoutTopNav, { props: { activeTab: "initiate" } });

    expect(wrapper.text()).toContain("1 发起退租");
    expect(wrapper.text()).toContain("2 退租结算");
    expect(wrapper.text()).toContain("3 押金退还确认");
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
  it("shows an approved settlement as waiting for final refund confirmation", () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [
          {
            id: 1,
            settlementNo: "TZ202608010001",
            status: "APPROVED",
            contractId: 3,
            depositRefundableAmount: "800.00",
            prepaymentRefundableAmount: "500.00",
            finalReceivable: "0.00",
          },
        ],
      },
    });

    expect(wrapper.text()).toContain("等待最终退款确认");
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
    expect(wrapper.find('[data-test="completed-contract-edit"]').exists()).toBe(false);
  });
  it("opens the completed settlement detail without any editing action", async () => {
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [createPinia()] },
    });
    await flushPromises();
    await wrapper.get('[data-test="checkout-tab-completed"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-test="completed-contract-detail-9"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("只读详情");
    expect(wrapper.text()).toContain("房态结果");
    expect(wrapper.text()).toContain("凭证编号：77");
    expect(wrapper.find('[data-test="completed-contract-edit"]').exists()).toBe(false);
  });  it("sends the keyword search and opens an existing checkout detail in read-only mode", async () => {
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

    await wrapper.get('[data-test="completed-contract-search"]').setValue("李四");
    await wrapper.get('[data-test="completed-contract-search-submit"]').trigger("click");
    expect(wrapper.emitted("search")).toEqual([["李四"]]);
    await wrapper.get('[data-test="completed-contract-detail-9"]').trigger("click");
    expect(wrapper.emitted("select")).toEqual([[9]]);
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
});
