import { beforeEach, describe, expect, it, vi } from "vitest";
import { http } from "./http";
import * as contracts from "./contracts";

vi.mock("./http", () => ({
  http: { delete: vi.fn(), get: vi.fn(), post: vi.fn() },
}));
const impactHash = "a".repeat(64);

describe("合同作废 API 客户端", () => {
  beforeEach(() => vi.clearAllMocks());

  it("调用后端定义的预览、列表和详情地址，并解包统一响应", async () => {
    vi.mocked(http.get)
      .mockResolvedValueOnce({
        data: { code: 200, message: "success", data: { impactHash } },
  })
      .mockResolvedValueOnce({
        data: { code: 200, message: "success", data: [{ id: 9 }] },
      })
      .mockResolvedValueOnce({
        data: { code: 200, message: "success", data: { id: 9 } },
      });
    expect(contracts.previewContractVoid).toBeTypeOf("function");
    await expect((contracts as any).previewContractVoid(7)).resolves.toEqual({
      impactHash,
    });
    await expect(
      (contracts as any).listContractVoidRequests({
        status: "PENDING",
        contractId: 7,
      }),
    ).resolves.toEqual([{ id: 9 }]);
    await expect((contracts as any).getContractVoidRequest(9)).resolves.toEqual(
      { id: 9 },
    );
    expect(http.get).toHaveBeenNthCalledWith(1, "/contracts/7/void-preview");
    expect(http.get).toHaveBeenNthCalledWith(2, "/contracts/void-requests", {
      params: { status: "PENDING", contractId: 7 },
    });
    expect(http.get).toHaveBeenNthCalledWith(3, "/contracts/void-requests/9");
  });

  it("普通管理员提交申请不携带确认文案", async () => {
    const body = {
      contractId: 7,
      reason: "租户录入错误",
      impactHash,
      fileAssetIds: [12],
      idempotencyKey: "submit-contract-void-0001",
    };
    vi.mocked(http.post).mockResolvedValue({
      data: { code: 200, message: "success", data: { id: 9 } },
    });
    await expect(
      (contracts as any).submitContractVoidRequest(body),
    ).resolves.toEqual({ id: 9 });
    expect(http.post).toHaveBeenCalledWith("/contracts/void-requests", body);
  });

  it("仅确认和驳回调用携带后端所需的请求体", async () => {
    vi.mocked(http.post)
      .mockResolvedValueOnce({
        data: {
          code: 200,
          message: "success",
          data: { id: 9, status: "CANCELLED" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          code: 200,
          message: "success",
          data: { requestId: 9, status: "COMPLETED" },
        },
  })
      .mockResolvedValueOnce({
        data: {
          code: 200,
          message: "success",
          data: { id: 9, status: "REJECTED" },
        },
      });
    await (contracts as any).cancelContractVoidRequest(9);
    await (contracts as any).approveContractVoidRequest(9, {
      previewHash: impactHash,
      confirmation: "确认作废合同",
      idempotencyKey: "execute-contract-void-0001",
    });
    await (contracts as any).rejectContractVoidRequest(9, "资料不完整");
    expect(http.post).toHaveBeenNthCalledWith(
      1,
      "/contracts/void-requests/9/cancel",
    );
    expect(http.post).toHaveBeenNthCalledWith(
      2,
      "/contracts/void-requests/9/approve",
      {
        previewHash: impactHash,
        confirmation: "确认作废合同",
        idempotencyKey: "execute-contract-void-0001",
      },
    );
    expect(http.post).toHaveBeenNthCalledWith(
      3,
      "/contracts/void-requests/9/reject",
      { reason: "资料不完整" },
    );
  });

  it("调用受保护端点刷新待确认申请的持久化影响快照", async () => {
    const refreshed = { id: 9, status: "PENDING", impactHash: "b".repeat(64) };
    vi.mocked(http.post).mockResolvedValue({
      data: { code: 200, message: "success", data: refreshed },
    });

    await expect(
      (contracts as any).refreshContractVoidRequestSnapshot(9),
    ).resolves.toEqual(refreshed);

    expect(http.post).toHaveBeenCalledWith(
      "/contracts/void-requests/9/refresh-snapshot",
    );
  });

  it("保留详情返回的冲销来源、金额字符串和日期字段", async () => {
    const detail = {
      id: 9,
      reversals: [
        {
          id: 4,
          category: "PAYMENT",
          amount: "-12.50",
          originalEntityType: "Payment",
          originalEntityId: 31,
          generatedEntityType: "PaymentReversal",
          generatedEntityId: 71,
          originalOccurredAt: "2026-08-20T00:00:00.000Z",
          correctionOccurredAt: "2026-08-26T00:00:00.000Z",
          idempotencyKey: "contract-void:9:PAYMENT:31",
        },
      ],
    };
    vi.mocked(http.get).mockResolvedValue({
      data: { code: 200, message: "success", data: detail },
    });

    const result = await (contracts as any).getContractVoidRequest(9);

    expect(result.reversals).toEqual(detail.reversals);
    expect(result.reversals[0].amount).toBe("-12.50");
    expect(http.get).toHaveBeenCalledWith("/contracts/void-requests/9");
  });

  it("通过后端定义的 multipart 字段上传真实作废证明附件", async () => {
    const file = new File(["proof-image"], "作废证明.png", {
      type: "image/png",
    });
    const asset = {
      id: 501,
      originalName: "作废证明.png",
      mimeType: "image/png",
      sizeBytes: "11",
      uploadedAt: "2026-08-26T08:00:00.000Z",
    };
    vi.mocked(http.post).mockResolvedValue({
      data: { code: 200, message: "success", data: asset },
    });

    await expect(
      (contracts as any).uploadContractVoidProof(file),
    ).resolves.toEqual(asset);

    expect(http.post).toHaveBeenCalledTimes(1);
    const [url, body] = vi.mocked(http.post).mock.calls[0];
    expect(url).toBe("/contracts/void-request-files");
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("file")).toBe(file);
  });

  it("调用受保护端点删除尚未关联的作废证明", async () => {
    vi.mocked(http.delete).mockResolvedValue({
      data: { code: 200, message: "success", data: { id: 501 } },
    });

    await expect(
      (contracts as any).deleteContractVoidProof(501),
    ).resolves.toEqual({ id: 501 });

    expect(http.delete).toHaveBeenCalledWith(
      "/contracts/void-request-files/501",
    );
  });

  it("按申请和资产编号下载已关联的历史证明", async () => {
    const blob = new Blob(["proof"], { type: "image/png" });
    vi.mocked(http.get).mockResolvedValue({ data: blob });

    await expect(
      (contracts as any).downloadContractVoidProof(901, 501),
    ).resolves.toBe(blob);

    expect(http.get).toHaveBeenCalledWith(
      "/contracts/void-requests/901/files/501/download",
      {
        responseType: "blob",
      },
    );
  });
});
