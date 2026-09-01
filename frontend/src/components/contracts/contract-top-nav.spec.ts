// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import { useApprovalTasksStore } from "../../stores/approval-tasks";
import ContractTopNav from "./ContractTopNav.vue";

function approvalPinia() {
  const pinia = createPinia();
  const approvals = useApprovalTasksStore(pinia);
  approvals.counts = {
    contractChanges: 1,
    fixedRentRebates: 3,
    contractVoidRequests: 4,
    billAdjustments: 5,
    paymentRefunds: 6,
    paymentVoidRequests: 7,
    checkoutSettlements: 8,
    depositRefunds: 9,
    contractsTotal: 8,
    paymentsTotal: 18,
    checkoutsTotal: 17,
    total: 43,
  };
  return pinia;
}

describe("合同工作区顶部导航", () => {
  it("第五页签进入合同作废纠错工作区并发送精确 key", async () => {
    const wrapper = mount(ContractTopNav, {
      props: { modelValue: "list", role: "ADMIN" },
      global: { plugins: [createPinia()] },
    });

    const items = wrapper.findAll("nav button");
    expect(items).toHaveLength(5);
    expect(items[4].text()).toBe("合同作废／纠错");

    await items[4].trigger("click");

    expect(wrapper.emitted("update:modelValue")).toEqual([["void-correction"]]);
  });

  it("仅管理员和超级管理员显示合同作废纠错页签", () => {
    const visitor = mount(ContractTopNav, {
      props: { modelValue: "list", role: "VISITOR" },
      global: { plugins: [approvalPinia()] },
    });
    const admin = mount(ContractTopNav, {
      props: { modelValue: "list", role: "ADMIN" },
      global: { plugins: [approvalPinia()] },
    });
    const superAdmin = mount(ContractTopNav, {
      props: { modelValue: "list", role: "SUPER_ADMIN" },
      global: { plugins: [approvalPinia()] },
    });

    expect(visitor.text()).not.toContain("合同作废／纠错");
    expect(admin.text()).toContain("合同作废／纠错");
    expect(superAdmin.text()).toContain("合同作废／纠错");
  });

  it("仅超级管理员在对应审批入口看到待处理数量", () => {
    const admin = mount(ContractTopNav, {
      props: { modelValue: "list", role: "ADMIN" },
      global: { plugins: [approvalPinia()] },
    });
    const wrapper = mount(ContractTopNav, {
      props: { modelValue: "list", role: "SUPER_ADMIN" },
      global: { plugins: [approvalPinia()] },
    });

    expect(admin.find('[data-test^="badge-"]').exists()).toBe(false);
    expect(wrapper.get('[data-test="badge-fixed-rebate"]').text()).toBe("3");
    expect(wrapper.get('[data-test="badge-void-correction"]').text()).toBe("4");
  });

  it("访客不显示待处理数量", () => {
    const wrapper = mount(ContractTopNav, {
      props: { modelValue: "list", role: "VISITOR" },
      global: { plugins: [approvalPinia()] },
    });

    expect(wrapper.find('[data-test^="badge-"]').exists()).toBe(false);
  });
});
