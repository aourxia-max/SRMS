import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CheckoutRefundPanel from "./CheckoutRefundPanel.vue";

const settlement = {
  id: 2,
  settlementNo: "TZ202608010002",
  status: "APPROVED" as const,
  contractId: 3,
  depositRefundableAmount: "800.00",
  prepaymentRefundableAmount: "500.00",
  rentRefundableAmount: "200.00",
  totalRefundAmount: "1500.00",
  finalReceivable: "0.00",
};

describe("Task8 refund panel hardening", () => {
  it("submits the backend locked total instead of recomputing components", async () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: { role: "ADMIN", settlement },
    });
    (wrapper.vm as unknown as { addProof: (id: number) => void }).addProof(77);
    await wrapper.vm.$nextTick();
    await wrapper.get('[data-test="refund-submit"]').trigger("click");
    expect(wrapper.emitted("submit")?.[0]?.[0]).toMatchObject({
      refundAmount: "1500.00",
      proofFileIds: [77],
    });
  });

  it("blocks submit while proof upload is in flight", () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: { role: "ADMIN", settlement, uploading: true },
    });
    (wrapper.vm as unknown as { addProof: (id: number) => void }).addProof(77);
    expect(
      wrapper.get('[data-test="refund-submit"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("offers a safe proof preview only through the pending refund record", async () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: "ADMIN",
        settlement: {
          ...settlement,
          depositRefunds: [
            {
              id: 9,
              approvalStatus: "PENDING" as const,
              refundAmount: "1500.00",
              files: [{ fileAssetId: 77, originalName: "proof.png" }],
            },
          ],
        },
      },
    });
    await wrapper
      .get('[data-test="refund-proof-preview-9-77"]')
      .trigger("click");
    expect(wrapper.emitted("previewProof")).toEqual([[9, 77]]);
  });
});
