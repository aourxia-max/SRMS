import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CheckoutRefundPanel from "./CheckoutRefundPanel.vue";

const approvedSettlement = (overrides: Record<string, unknown> = {}) => ({
  id: 9,
  settlementNo: "TZ202608310009",
  status: "APPROVED" as const,
  contractId: 3,
  depositRefundableAmount: "800.00",
  prepaymentRefundableAmount: "500.00",
  rentRefundableAmount: "200.00",
  totalRefundAmount: "1500.00",
  finalReceivable: "0.00",
  contract: {
    id: 3,
    contractNo: "HT202608010001",
    status: "PENDING_CHECKOUT",
    room: { id: 7, fullHouseNo: "1栋101" },
  },
  ...overrides,
});

describe("checkout refund recovery controls", () => {
  it("shows every pending checkout and emits the selected settlement", async () => {
    const first = approvedSettlement();
    const second = approvedSettlement({
      id: 10,
      settlementNo: "TZ202608310010",
      contractId: 4,
      contract: {
        id: 4,
        contractNo: "HT202608010002",
        status: "PENDING_CHECKOUT",
        room: { id: 8, fullHouseNo: "2栋201" },
      },
    });
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "ADMIN",
        settlement: first,
        settlements: [first, second],
      },
    });

    expect(wrapper.text()).toContain("1栋101");
    expect(wrapper.text()).toContain("2栋201");
    await wrapper.get('[data-test="refund-settlement-10"]').trigger("click");
    expect(wrapper.emitted("selectSettlement")).toEqual([[10]]);
  });

  it("blocks financial actions when the locked total is missing or mismatched", () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "SUPER_ADMIN",
        settlement: approvedSettlement({ totalRefundAmount: "1499.99" }),
      },
    });

    expect(wrapper.text()).toContain(
      "退款总额数据缺失或与分项不一致，请刷新后重试",
    );
    expect(wrapper.find('[data-test="refund-submit"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="refund-approve"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="zero-complete"]').exists()).toBe(false);
  });

  it("offers separate controls for cancelling the refund and the whole checkout", async () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "ADMIN",
        settlement: approvedSettlement({
          depositRefunds: [
            {
              id: 49,
              approvalStatus: "PENDING" as const,
              refundAmount: "1500.00",
            },
          ],
        }),
      },
    });

    await wrapper.get('[data-test="refund-cancel"]').trigger("click");
    await wrapper
      .get('[data-test="checkout-cancel-approved"]')
      .trigger("click");
    expect(wrapper.emitted("cancelRefund")).toEqual([[49]]);
    expect(wrapper.emitted("cancelCheckout")).toEqual([[9]]);
  });
});
