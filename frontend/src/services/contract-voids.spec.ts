import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './http'
import * as contracts from './contracts'

vi.mock('./http', () => ({ http: { get: vi.fn(), post: vi.fn() } }))
const impactHash = 'a'.repeat(64)

describe('合同作废 API 客户端', () => {
  beforeEach(() => vi.clearAllMocks())

  it('调用后端定义的预览、列表和详情地址，并解包统一响应', async () => {
    vi.mocked(http.get).mockResolvedValueOnce({ data: { code: 200, message: 'success', data: { impactHash } } }).mockResolvedValueOnce({ data: { code: 200, message: 'success', data: [{ id: 9 }] } }).mockResolvedValueOnce({ data: { code: 200, message: 'success', data: { id: 9 } } })
    expect(contracts.previewContractVoid).toBeTypeOf('function')
    await expect((contracts as any).previewContractVoid(7)).resolves.toEqual({ impactHash })
    await expect((contracts as any).listContractVoidRequests({ status: 'PENDING', contractId: 7 })).resolves.toEqual([{ id: 9 }])
    await expect((contracts as any).getContractVoidRequest(9)).resolves.toEqual({ id: 9 })
    expect(http.get).toHaveBeenNthCalledWith(1, '/contracts/7/void-preview')
    expect(http.get).toHaveBeenNthCalledWith(2, '/contracts/void-requests', { params: { status: 'PENDING', contractId: 7 } })
    expect(http.get).toHaveBeenNthCalledWith(3, '/contracts/void-requests/9')
  })

  it('普通管理员提交申请不携带确认文案', async () => {
    const body = { contractId: 7, reason: '租户录入错误', impactHash, fileAssetIds: [12], idempotencyKey: 'submit-contract-void-0001' }
    vi.mocked(http.post).mockResolvedValue({ data: { code: 200, message: 'success', data: { id: 9 } } })
    await expect((contracts as any).submitContractVoidRequest(body)).resolves.toEqual({ id: 9 })
    expect(http.post).toHaveBeenCalledWith('/contracts/void-requests', body)
  })

  it('仅确认和驳回调用携带后端所需的请求体', async () => {
    vi.mocked(http.post).mockResolvedValueOnce({ data: { code: 200, message: 'success', data: { id: 9, status: 'CANCELLED' } } }).mockResolvedValueOnce({ data: { code: 200, message: 'success', data: { requestId: 9, status: 'COMPLETED' } } }).mockResolvedValueOnce({ data: { code: 200, message: 'success', data: { id: 9, status: 'REJECTED' } } })
    await (contracts as any).cancelContractVoidRequest(9)
    await (contracts as any).approveContractVoidRequest(9, { previewHash: impactHash, confirmation: '确认作废合同', idempotencyKey: 'execute-contract-void-0001' })
    await (contracts as any).rejectContractVoidRequest(9, '资料不完整')
    expect(http.post).toHaveBeenNthCalledWith(1, '/contracts/void-requests/9/cancel')
    expect(http.post).toHaveBeenNthCalledWith(2, '/contracts/void-requests/9/approve', { previewHash: impactHash, confirmation: '确认作废合同', idempotencyKey: 'execute-contract-void-0001' })
    expect(http.post).toHaveBeenNthCalledWith(3, '/contracts/void-requests/9/reject', { reason: '资料不完整' })
  })
})
