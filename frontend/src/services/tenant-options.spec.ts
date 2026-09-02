import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from './http'
import { listAllTenantOptions } from './tenant-options'

vi.mock('./http', () => ({ http: { get: vi.fn() } }))

function tenant(id: number) {
  return { id, name: `承租人${id}`, phone: id % 2 ? null : `1380000${id}` }
}

describe('承租人全量选项分页', () => {
  beforeEach(() => vi.clearAllMocks())

  it('跨越 100 条上限拉取全部页面并按 ID 去重', async () => {
    vi.mocked(http.get)
      .mockResolvedValueOnce({ data: { data: { items: Array.from({ length: 100 }, (_, index) => tenant(index + 1)), total: 201, page: 1, pageSize: 100 } } })
      .mockResolvedValueOnce({ data: { data: { items: Array.from({ length: 100 }, (_, index) => tenant(index + 101)), total: 201, page: 2, pageSize: 100 } } })
      .mockResolvedValueOnce({ data: { data: { items: [tenant(200), tenant(201)], total: 201, page: 3, pageSize: 100 } } })

    const result = await listAllTenantOptions()

    expect(result).toHaveLength(201)
    expect(result[0].id).toBe(1)
    expect(result.at(-1)?.id).toBe(201)
    expect(new Set(result.map((item) => item.id)).size).toBe(201)
    expect(http.get).toHaveBeenNthCalledWith(1, '/tenants', { params: { page: 1, pageSize: 100 } })
    expect(http.get).toHaveBeenNthCalledWith(2, '/tenants', { params: { page: 2, pageSize: 100 } })
    expect(http.get).toHaveBeenNthCalledWith(3, '/tenants', { params: { page: 3, pageSize: 100 } })
    expect(http.get).toHaveBeenCalledTimes(3)
  })

  it('服务返回空页时停止，不会因异常 total 无限请求', async () => {
    vi.mocked(http.get)
      .mockResolvedValueOnce({ data: { data: { items: [tenant(1)], total: 300, page: 1, pageSize: 100 } } })
      .mockResolvedValueOnce({ data: { data: { items: [], total: 300, page: 2, pageSize: 100 } } })

    await expect(listAllTenantOptions()).resolves.toEqual([tenant(1)])
    expect(http.get).toHaveBeenCalledTimes(2)
  })

  it('后续页面失败时立即向调用方报告且不再请求', async () => {
    const failure = new Error('第二页失败')
    vi.mocked(http.get)
      .mockResolvedValueOnce({ data: { data: { items: Array.from({ length: 100 }, (_, index) => tenant(index + 1)), total: 300, page: 1, pageSize: 100 } } })
      .mockRejectedValueOnce(failure)

    await expect(listAllTenantOptions()).rejects.toBe(failure)
    expect(http.get).toHaveBeenCalledTimes(2)
  })
})
