import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import { checkoutApi } from "../../services/checkout";
import { useApprovalTasksStore } from "../../stores/approval-tasks";
import CheckoutWorkspace from "./CheckoutWorkspace.vue";
import CheckoutSettlementPanel from "./CheckoutSettlementPanel.vue";
import CheckoutInitiatePanel from "./CheckoutInitiatePanel.vue";
import type { CheckoutSettlementPreview } from "./checkout-types";

const settlement = {
  id: 8,
  settlementNo: "TZ8",
  status: "DRAFT" as const,
  contractId: 3,
  actualCheckoutDate: "2026-09-01",
  handoverDate: "2026-09-01",
  inspectionAt: "2026-09-01",
  targetRoomStatus: "EMPTY" as const,
  depositRefundableAmount: "0.00",
  prepaymentRefundableAmount: "0.00",
  rentRefundableAmount: "0.00",
  finalReceivable: "0.00",
  items: [],
};
const payload = {
  actualCheckoutDate: "2026-09-01",
  handoverDate: "2026-09-01",
  inspectionAt: "2026-09-01",
  targetRoomStatus: "EMPTY",
  items: [],
};
const preview = {
  previewFingerprint: "backend-version-A",
  depositRefundableAmount: "100.00",
  prepaymentRefundableAmount: "0.00",
  rentRefundableAmount: "0.00",
  maxRentRefundAmount: "0.00",
  totalRefundAmount: "100.00",
  finalReceivable: "0.00",
  rentRefundAllocations: [],
};
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { tab: "settlement" } }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("../../services/checkout", () => ({
  checkoutApi: {
    contracts: vi.fn(),
    settlements: vi.fn(),
    refundPendingSettlements: vi.fn(),
    completedContracts: vi.fn(),
    financeSnapshot: vi.fn(),
    preview: vi.fn(),
    submit: vi.fn(),
  },
}));

describe("checkout preview fingerprint UI", () => {
  const mounted: ReturnType<typeof mount>[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-09T03:00:00Z"));
    vi.mocked(checkoutApi.contracts).mockResolvedValue([]);
    vi.mocked(checkoutApi.settlements).mockResolvedValue([settlement]);
    vi.mocked(checkoutApi.refundPendingSettlements).mockResolvedValue([]);
    vi.mocked(checkoutApi.completedContracts).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    vi.mocked(checkoutApi.financeSnapshot).mockResolvedValue({
      depositBalance: "100.00",
      prepaymentBalance: "0.00",
      rentOutstanding: "0.00",
      futureBillCount: 0,
      arrearsBills: [],
    });
    vi.mocked(checkoutApi.preview).mockReset().mockResolvedValue(preview);
    vi.mocked(checkoutApi.submit).mockReset().mockResolvedValue(settlement);
  });
  afterEach(() => {
    mounted.forEach((wrapper) => wrapper.unmount());
    mounted.length = 0;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  async function workspace() {
    const pinia = createPinia();
    pinia.state.value.session = {
      accessToken: "test",
      initialized: true,
      user: { id: 1, username: "admin", role: "ADMIN" },
    };
    vi.spyOn(useApprovalTasksStore(pinia), "refresh").mockResolvedValue(
      undefined,
    );
    const wrapper = mount(CheckoutWorkspace, {
      global: { plugins: [pinia, ElementPlus] },
    });
    mounted.push(wrapper);
    await flushPromises();
    const panel = wrapper.getComponent(CheckoutSettlementPanel);
    return { wrapper, panel };
  }
  async function getPreview(
    panel: Awaited<ReturnType<typeof workspace>>["panel"],
  ) {
    panel.vm.$emit("preview", 8, payload);
    await flushPromises();
  }

  it("submits the exact backend version with the reviewed payload", async () => {
    const { panel } = await workspace();
    await getPreview(panel);
    await panel.get('[data-test="settlement-submit"]').trigger("click");
    await flushPromises();
    expect(checkoutApi.submit).toHaveBeenCalledWith(8, {
      ...payload,
      previewFingerprint: "backend-version-A",
    });
  });
  it("requires re-preview before submitting even when there is no rent refund item", async () => {
    const { panel } = await workspace();
    await panel.get('[data-test="settlement-submit"]').trigger("click");
    await flushPromises();
    expect(checkoutApi.submit).not.toHaveBeenCalled();
    expect(panel.text()).toContain("请重新预估结算金额");
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();
    expect(checkoutApi.preview).toHaveBeenCalled();
  });
  it("removes the prior version immediately when another preview starts", async () => {
    const { panel } = await workspace();
    await getPreview(panel);
    vi.mocked(checkoutApi.preview).mockReturnValueOnce(new Promise(() => {}));
    panel.vm.$emit("preview", 8, payload);
    await flushPromises();
    expect(panel.props("preview")).toBeUndefined();
    await panel.get('[data-test="settlement-submit"]').trigger("click");
    expect(checkoutApi.submit).not.toHaveBeenCalled();
  });
  it.each(["date", "amount", "items", "contract", "reset", "tab"])(
    "cannot revive an invalidated version after a %s change",
    async (change) => {
      if (change === "contract")
        vi.mocked(checkoutApi.settlements).mockResolvedValueOnce([
          settlement,
          { ...settlement, id: 9, settlementNo: "TZ9", contractId: 4 },
        ]);
      let { wrapper, panel } = await workspace();
      await getPreview(panel);
      let resolve!: (value: CheckoutSettlementPreview) => void;
      vi.mocked(checkoutApi.preview).mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      panel.vm.$emit("preview", 8, payload);
      await flushPromises();
      if (change === "date")
        await panel.get('input[type="date"]').setValue("2026-09-02");
      else if (change === "amount" || change === "items") {
        await panel.get('[data-test="add-rent-refund"]').trigger("click");
        if (change === "amount")
          await panel.get('[data-test="rent-refund-amount"]').setValue("10");
      } else if (change === "tab" || change === "reset") {
        await wrapper.findAll("nav button")[0]!.trigger("click");
        if (change === "reset") {
          await wrapper.findAll("nav button")[1]!.trigger("click");
          await flushPromises();
          panel = wrapper.getComponent(CheckoutSettlementPanel);
        }
      } else {
        await panel
          .findAll(".settlement-panel__list button")[1]!
          .trigger("click");
        await flushPromises();
      }
      resolve(preview);
      await flushPromises();
      if (change !== "tab") {
        expect(panel.props("preview")).toBeUndefined();
        await panel.get('[data-test="settlement-submit"]').trigger("click");
      }
      expect(checkoutApi.submit).not.toHaveBeenCalled();
    },
  );
  it("keeps only the latest successful response version and clears a failed refresh", async () => {
    const { panel } = await workspace();
    let resolve!: (value: CheckoutSettlementPreview) => void;
    vi.mocked(checkoutApi.preview).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    panel.vm.$emit("preview", 8, payload);
    vi.mocked(checkoutApi.preview).mockResolvedValueOnce({
      ...preview,
      previewFingerprint: "backend-version-B",
    });
    panel.vm.$emit("preview", 8, payload);
    await flushPromises();
    resolve(preview);
    await flushPromises();
    expect(panel.props("preview")).toMatchObject({
      previewFingerprint: "backend-version-B",
    });
    vi.mocked(checkoutApi.preview).mockRejectedValueOnce(
      new Error("failed refresh"),
    );
    await getPreview(panel);
    await panel.get('[data-test="settlement-submit"]').trigger("click");
    expect(checkoutApi.submit).not.toHaveBeenCalled();
  });
  it("does not let a payload changed outside the panel borrow a current version", async () => {
    const { panel } = await workspace();
    await getPreview(panel);
    panel.vm.$emit("submit", 8, {
      ...payload,
      actualCheckoutDate: "2026-09-02",
      previewFingerprint: preview.previewFingerprint,
    });
    await flushPromises();
    expect(checkoutApi.submit).not.toHaveBeenCalled();
  });
  it("uses the Shanghai date when browser calendar getters are in UTC", () => {
    vi.setSystemTime(new Date("2026-09-08T16:30:00Z"));
    vi.spyOn(Date.prototype, "getFullYear").mockImplementation(function (
      this: Date,
    ) {
      return this.getUTCFullYear();
    });
    vi.spyOn(Date.prototype, "getMonth").mockImplementation(function (
      this: Date,
    ) {
      return this.getUTCMonth();
    });
    vi.spyOn(Date.prototype, "getDate").mockImplementation(function (
      this: Date,
    ) {
      return this.getUTCDate();
    });
    const wrapper = mount(CheckoutInitiatePanel, {
      props: { contracts: [] },
      global: { plugins: [ElementPlus] },
    });
    mounted.push(wrapper);
    expect(
      wrapper
        .get('[data-test="initiate-actual-checkout-date"]')
        .attributes("max"),
    ).toBe("2026-09-09");
  });
});
