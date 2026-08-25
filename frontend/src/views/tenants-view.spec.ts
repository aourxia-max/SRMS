// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { ElMessageBox } from "element-plus";
import { createPinia } from "pinia";
import { defineComponent, h } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { http } from "../services/http";
import { useSessionStore } from "../stores/session";
import TenantsView from "./TenantsView.vue";

vi.mock("../services/http", () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const tenant = {
  id: 17,
  tenantType: "INDIVIDUAL",
  name: "张三",
  phone: "13800000000",
  idType: "ID_CARD",
  idNoLast4: "1234",
  maskedIdNo: "****1234",
  contactAddress: "测试地址",
  status: "ACTIVE",
  remark: "测试备注",
};

describe("承租人管理页面", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === "/system/defaults") {
        return { data: { data: { defaultTenantType: "INDIVIDUAL" } } };
      }
      return { data: { data: { items: [tenant], total: 1 } } };
    });
    vi.mocked(http.delete).mockResolvedValue({ data: { code: 200 } });
  });

  it("在编辑弹窗显示删除按钮并在二次确认后删除当前承租人", async () => {
    const pinia = createPinia();
    const session = useSessionStore(pinia);
    session.user = {
      id: 7,
      username: "admin",
      displayName: "管理员",
      role: "ADMIN",
    };
    session.accessToken = "test-token";
    vi.spyOn(ElMessageBox, "confirm").mockResolvedValue("confirm" as never);

    const wrapper = mount(TenantsView, {
      global: {
        plugins: [pinia],
        stubs: {
          "el-tag": { template: "<span><slot /></span>" },
          "el-card": { template: "<div><slot /></div>" },
          "el-table": { template: "<div><slot /></div>" },
          "el-table-column": defineComponent({
            setup(_props, { slots }) {
              return () => h("div", slots.default?.({ row: tenant }));
            },
          }),
          "el-dialog": {
            template: '<div><slot /><slot name="footer" /></div>',
          },
          "el-form": { template: "<form><slot /></form>" },
          "el-form-item": { template: "<label><slot /></label>" },
          "el-row": { template: "<div><slot /></div>" },
          "el-col": { template: "<div><slot /></div>" },
          "el-input": { template: "<input />" },
          "el-select": { template: "<select><slot /></select>" },
          "el-option": { template: "<option />" },
          "el-button": { template: '<button type="button"><slot /></button>' },
        },
      },
    });
    await flushPromises();

    const edit = wrapper
      .findAll("button")
      .find((button) => button.text() === "编辑");
    expect(edit).toBeDefined();
    await edit!.trigger("click");
    await flushPromises();

    const remove = wrapper.find('[data-test="delete-tenant"]');
    expect(remove.exists()).toBe(true);
    await remove.trigger("click");
    await flushPromises();

    expect(http.delete).toHaveBeenCalledWith("/tenants/17");
    expect(http.get).toHaveBeenCalledWith("/tenants", {
      params: { keyword: undefined, page: 1, pageSize: 20 },
    });
  });
});
