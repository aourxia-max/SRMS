import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ElOption, ElSelect } from "element-plus";
import CheckoutSettlementPanel from "./CheckoutSettlementPanel.vue";

const settlement = {
  id: 8,
  settlementNo: "TZ202608250001",
  status: "DRAFT" as const,
  contractId: 3,
  actualCheckoutDate: "2026-08-25",
  handoverDate: "2026-08-25",
  inspectionAt: "2026-08-25",
  targetRoomStatus: "EMPTY" as const,
  depositRefundableAmount: "0.00",
  prepaymentRefundableAmount: "0.00",
  rentRefundableAmount: "0.00",
  finalReceivable: "0.00",
  items: [],
};

const rentRefundPreview = {
  depositRefundableAmount: "7000.00",
  prepaymentRefundableAmount: "500.00",
  rentRefundableAmount: "3000.00",
  maxRentRefundAmount: "3000.00",
  totalRefundAmount: "10500.00",
  finalReceivable: "0.00",
  rentRefundAllocations: [
    {
      paymentAllocationId: 81,
      paymentId: 72,
      receiptNo: "SK20260800072",
      rentBillId: 33,
      billNo: "ZF2026090001",
      amount: "3000.00",
    },
  ],
};

describe("退租结算实时预估", () => {
  afterEach(() => vi.useRealTimers());

  it("offers searchable arrears bills only through the actual checkout date", async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [
          {
            ...settlement,
            arrearsBills: [
              {
                id: 31,
                billNo: "ZD2026070031",
                periodStart: "2026-07-01",
                periodEnd: "2026-07-31",
                outstandingAmount: "300.00",
              },
              {
                id: 32,
                billNo: "ZD2026080032",
                periodStart: "2026-08-01",
                periodEnd: "2026-08-31",
                outstandingAmount: "800.00",
              },
              {
                id: 33,
                billNo: "ZD2026090033",
                periodStart: "2026-09-01",
                periodEnd: "2026-09-30",
                outstandingAmount: "900.00",
              },
            ],
          },
        ],
      },
    });

    const addArrears = wrapper
      .findAll("button")
      .find((button) => button.text().includes("添加欠租"));
    expect(addArrears).toBeDefined();
    await addArrears!.trigger("click");

    const select = wrapper.getComponent(ElSelect);
    expect(select.props("filterable")).toBe(true);
    expect(
      wrapper.findAllComponents(ElOption).map((option) => option.props("label")),
    ).toEqual([
      "ZD2026070031｜2026/07/01–2026/07/31｜未收 ¥300.00",
      "ZD2026080032｜2026/08/01–2026/08/31｜未收 ¥800.00",
    ]);
  });

  it("fills the unpaid amount after an arrears bill is selected", async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [
          {
            ...settlement,
            arrearsBills: [
              {
                id: 32,
                billNo: "ZD2026080032",
                periodStart: "2026-08-01",
                periodEnd: "2026-08-31",
                outstandingAmount: "800.00",
              },
            ],
          },
        ],
      },
    });
    const addArrears = wrapper
      .findAll("button")
      .find((button) => button.text().includes("添加欠租"));
    await addArrears!.trigger("click");

    const select = wrapper.getComponent(ElSelect);
    select.vm.$emit("update:modelValue", 32);
    select.vm.$emit("change", 32);
    await wrapper.vm.$nextTick();

    expect(
      (wrapper.get('input[placeholder="金额"]').element as HTMLInputElement)
        .value,
    ).toBe("800.00");
  });

  it("disables an arrears bill already selected by another item", async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [
          {
            ...settlement,
            arrearsBills: [
              {
                id: 32,
                billNo: "ZD2026080032",
                periodStart: "2026-08-01",
                periodEnd: "2026-08-31",
                outstandingAmount: "800.00",
              },
            ],
          },
        ],
      },
    });
    const addArrears = wrapper
      .findAll("button")
      .find((button) => button.text().includes("添加欠租"))!;
    await addArrears.trigger("click");
    const first = wrapper.getComponent(ElSelect);
    first.vm.$emit("update:modelValue", 32);
    first.vm.$emit("change", 32);
    await wrapper.vm.$nextTick();
    await addArrears.trigger("click");

    const second = wrapper.findAllComponents(ElSelect)[1];
    const selectedBill = second
      .findAllComponents(ElOption)
      .find((option) => option.props("value") === 32);
    expect(selectedBill?.props("disabled")).toBe(true);
  });

  it("shows the five labelled backend summary values, including zero amounts", () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [settlement],
        preview: {
          depositRefundableAmount: "7000.00",
          prepaymentRefundableAmount: "500.00",
          rentRefundableAmount: "0.00",
          maxRentRefundAmount: "0.00",
          rentRefundAllocations: [],
          totalRefundAmount: "7500.00",
          finalReceivable: "0.00",
        },
      },
    });

    const summary = wrapper.get('[data-test="settlement-summary"]');
    expect(summary.text()).toContain("应退押金");
    expect(summary.text()).toContain("应退预收款");
    expect(summary.text()).toContain("¥7,000.00");
    expect(summary.text()).toContain("应退租金");
    expect(summary.text()).toContain("¥0.00");
    expect(summary.text()).toContain("¥500.00");
    expect(summary.text()).toContain("合计应退");
    expect(summary.text()).toContain("¥7,500.00");
    expect(summary.text()).toContain("待补收金额");
    expect(summary.text()).toContain("¥0.00");
    expect(summary.text()).not.toContain("待计算");
  });

  it("maps each summary card to its exact label and amount", () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [settlement],
        preview: {
          ...rentRefundPreview,
          rentRefundableAmount: "0.00",
          totalRefundAmount: "7500.00",
        },
      },
    });
    const cards = wrapper
      .get('[data-test="settlement-summary"]')
      .findAll(":scope > div")
      .map((card) => ({
        label: card.get("span").text(),
        value: card.get("strong").text(),
      }));

    expect(cards).toEqual([
      { label: "\u5e94\u9000\u62bc\u91d1", value: "\u00a57,000.00" },
      { label: "\u5e94\u9000\u9884\u6536\u6b3e", value: "\u00a5500.00" },
      { label: "\u5e94\u9000\u79df\u91d1", value: "\u00a50.00" },
      { label: "\u5408\u8ba1\u5e94\u9000", value: "\u00a57,500.00" },
      { label: "\u5f85\u8865\u6536\u91d1\u989d", value: "\u00a50.00" },
    ]);
  });

  it("adds one rent refund item, presents the server allocation preview, and submits only its allowed DTO fields", async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement], preview: rentRefundPreview },
    });

    await wrapper.get('[data-test="add-rent-refund"]').trigger("click");
    await wrapper.get('[data-test="rent-refund-amount"]').setValue("3000");
    await wrapper
      .get('[data-test="rent-refund-description"]')
      .setValue("提前退房退还未履行租金");

    expect(wrapper.findAll('[data-test="rent-refund-item"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("当前最多可退租金 ¥3,000.00");
    expect(wrapper.text()).toContain("系统自动回冲预览");
    expect(wrapper.text()).toContain("收款单号 SK20260800072");
    expect(wrapper.text()).toContain("¥3,000.00");
    expect(wrapper.text()).not.toContain("paymentId");
    expect(wrapper.text()).toContain("ZF2026090001");
    expect(
      wrapper
        .find('[data-test="rent-refund-item"] [placeholder="验房记录编号"]')
        .exists(),
    ).toBe(false);

    await wrapper.get('[data-test="settlement-submit"]').trigger("click");
    expect(wrapper.emitted("submit")?.[0]?.[1]).toMatchObject({
      items: [
        {
          itemType: "RENT_REFUND",
          amount: "3000.00",
          description: "提前退房退还未履行租金",
        },
      ],
    });
    const submitted = wrapper.emitted("submit")?.[0]?.[1] as {
      items: unknown[];
    };
    expect(submitted.items[0]).toEqual({
      itemType: "RENT_REFUND",
      amount: "3000.00",
      description: "提前退房退还未履行租金",
    });
  });

  it("keeps a single rent refund item and blocks an amount above the backend maximum", async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement], preview: rentRefundPreview },
    });

    await wrapper.get('[data-test="add-rent-refund"]').trigger("click");
    await wrapper.get('[data-test="add-rent-refund"]').trigger("click");
    await wrapper.get('[data-test="rent-refund-amount"]').setValue("3000.01");
    await wrapper.get('[data-test="settlement-submit"]').trigger("click");

    expect(wrapper.findAll('[data-test="rent-refund-item"]')).toHaveLength(1);
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "退还租金不能超过当前可回冲金额 ¥3,000.00。",
    );
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("requires a rent refund description and refreshes its preview after the actual checkout date changes", async () => {
    vi.useFakeTimers();
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement], preview: rentRefundPreview },
    });

    await wrapper.get('[data-test="add-rent-refund"]').trigger("click");
    await wrapper.get('[data-test="rent-refund-amount"]').setValue("100");
    await wrapper.get('[data-test="settlement-submit"]').trigger("click");
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "请填写第 1 项结算说明",
    );

    await wrapper
      .get('[data-test="rent-refund-description"]')
      .setValue("退还租金");
    await wrapper.get('input[type="date"]').setValue("2026-08-26");
    await vi.advanceTimersByTimeAsync(300);

    expect(wrapper.emitted("preview")?.at(-1)?.[1]).toMatchObject({
      actualCheckoutDate: "2026-08-26",
      items: [
        {
          itemType: "RENT_REFUND",
          amount: "100.00",
          description: "退还租金",
        },
      ],
    });
  });
  it("rejects an invalid money string instead of emitting a settlement DTO", async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement], preview: rentRefundPreview },
    });

    await wrapper.get('[data-test="add-rent-refund"]').trigger("click");
    await wrapper.get('[data-test="rent-refund-amount"]').setValue("1e3");
    await wrapper
      .get('[data-test="rent-refund-description"]')
      .setValue("\u9000\u8fd8\u79df\u91d1");
    await wrapper.get('[data-test="settlement-submit"]').trigger("click");

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "\u7b2c 1 \u9879\u7ed3\u7b97\u91d1\u989d\u683c\u5f0f\u4e0d\u6b63\u786e",
    );
    expect(wrapper.emitted("submit")).toBeUndefined();
  });

  it("debounces preview requests when editable settlement data changes", async () => {
    vi.useFakeTimers();
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement] },
    });
    await wrapper.get('input[type="date"]').setValue("2026-08-26");
    await vi.advanceTimersByTimeAsync(300);

    expect(wrapper.emitted("preview")?.at(-1)?.[0]).toBe(8);
    expect(wrapper.emitted("preview")?.at(-1)?.[1]).toMatchObject({
      actualCheckoutDate: "2026-08-26",
      items: [],
    });
  });
  it("keeps the rent-refund input described while the maximum is still loading", async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement], previewLoading: true },
    });

    await wrapper.get('[data-test="add-rent-refund"]').trigger("click");

    expect(
      wrapper
        .get('[data-test="rent-refund-amount"]')
        .attributes("aria-describedby"),
    ).toBe("rent-refund-limit");
    expect(wrapper.get("#rent-refund-limit").attributes("aria-live")).toBe(
      "polite",
    );
  });
});
