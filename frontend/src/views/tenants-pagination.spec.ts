// @vitest-environment happy-dom

import ElementPlus, { ElPagination } from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { pageAfterDeleting } from './tenant-pagination'
import TenantsView from './TenantsView.vue'

vi.mock('../services/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

describe('承租人列表分页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === '/system/defaults') return { data: { data: { defaultTenantType: 'INDIVIDUAL' } } }
      return { data: { data: { items: [], total: 30, page: 1, pageSize: 20 } } }
    })
  })

  it('请求当前页并允许切换页码和每页数量', async () => {
    const wrapper = mount(TenantsView, { global: { plugins: [createPinia(), ElementPlus] } })
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/tenants', {
      params: { keyword: undefined, page: 1, pageSize: 20 },
    })
    const pagination = wrapper.getComponent(ElPagination)
    expect(pagination.props('total')).toBe(30)

    pagination.vm.$emit('update:current-page', 2)
    await flushPromises()
    expect(http.get).toHaveBeenLastCalledWith('/tenants', {
      params: { keyword: undefined, page: 2, pageSize: 20 },
    })

    pagination.vm.$emit('update:page-size', 10)
    await flushPromises()
    expect(http.get).toHaveBeenLastCalledWith('/tenants', {
      params: { keyword: undefined, page: 1, pageSize: 10 },
    })
  })

  it('删除末页唯一记录时回到上一页，其他情况保持当前页', () => {
    expect(pageAfterDeleting(2, 1)).toBe(1)
    expect(pageAfterDeleting(2, 2)).toBe(2)
    expect(pageAfterDeleting(1, 1)).toBe(1)
  })
})
