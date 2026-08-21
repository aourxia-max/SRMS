import { describe, expect, it } from "vitest";
import {
  tenantFormFromListItem,
  tenantUpdatePayload,
  type TenantListItem,
} from "./tenant-form";

describe("承租人编辑表单", () => {
  const listItem: TenantListItem = {
    id: 17,
    tenantType: "INDIVIDUAL",
    name: "张三",
    phone: "13800000000",
    idType: "ID_CARD",
    idNoLast4: "1234",
    maskedIdNo: "****1234",
    contactAddress: "旧地址",
    status: "ACTIVE",
    remark: "旧备注",
  };

  it("重新打开编辑时只载入可编辑字段并清空上次输入的证件号码", () => {
    const first = tenantFormFromListItem(listItem);
    first.idNo = "440101199001011234";

    const reopened = tenantFormFromListItem({
      ...listItem,
      name: "张三（更新）",
    });

    expect(reopened).toEqual({
      tenantType: "INDIVIDUAL",
      name: "张三（更新）",
      phone: "13800000000",
      idType: "ID_CARD",
      idNo: "",
      contactAddress: "旧地址",
      status: "ACTIVE",
      remark: "旧备注",
    });
    expect(reopened).not.toHaveProperty("id");
    expect(reopened).not.toHaveProperty("maskedIdNo");
    expect(reopened).not.toHaveProperty("idNoLast4");
  });

  it("更新时仅提交允许字段并保留清空可选资料的意图", () => {
    const payload = tenantUpdatePayload({
      tenantType: "INDIVIDUAL",
      name: "李四",
      phone: "",
      idType: "ID_CARD",
      idNo: "",
      contactAddress: "",
      status: "ACTIVE",
      remark: "",
    });

    expect(payload).toEqual({
      tenantType: "INDIVIDUAL",
      name: "李四",
      phone: null,
      idType: "ID_CARD",
      contactAddress: null,
      status: "ACTIVE",
      remark: null,
    });
  });

  it("填写新证件号码时将其包含在更新内容中", () => {
    const payload = tenantUpdatePayload({
      tenantType: "COMPANY",
      name: "测试商户",
      phone: "020-12345678",
      idType: "BUSINESS_LICENSE",
      idNo: "91440101TEST000001",
      contactAddress: "新地址",
      status: "ACTIVE",
      remark: "新备注",
    });

    expect(payload.idNo).toBe("91440101TEST000001");
  });
});
