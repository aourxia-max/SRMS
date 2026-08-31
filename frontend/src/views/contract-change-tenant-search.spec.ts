// @vitest-environment happy-dom

import ElementPlus, { ElSelect } from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { useApprovalTasksStore } from '../stores/approval-tasks'
import ContractChangesView from './ContractChangesView.vue'

vi.mock('../services/http', () => ({
  http: { get: vi.fn(), post: vi.fn() },
}))

const contract = {
  id: 12,
  contractNo: 'HT202608250001｜1栋101｜张三01',
  concessions: [],
}

const approvalRefresh = vi.fn().mockResolvedValue(undefined)

function mockApi() {
  vi.mocked(http.get).mockImplementation(async (url, config) => {
    if (url === '/contracts') return { data: { data: [contract] } }
    if (url === '/contracts/12') return { data: { data: contract } }
    if (url === '/contracts/12/changes') return { data: { data: [] } }
    if (url === '/tenants') {
      const params = config?.params
      expect(params).toMatchObject({ status: 'ACTIVE', page: 1, pageSize: 20 })
      if (params?.keyword === '不存在') {
        return { data: { data: { items: [], total: 0 } } }
      }
      expect(params?.keyword).toBe('张')
      return {
        data: {
          data: {
            items: [{ id: 9, name: '张三02', phone: '13800000009', status: 'ACTIVE' }],
            total: 1,
          },
        },
      }
    }
    throw new Error(`unexpected GET ${url}`)
  })
  vi.mocked(http.post).mockResolvedValue({ data: { code: 200 } })
}

async function mountPrimaryTenantChange() {
  const pinia = createPinia()
  vi.spyOn(useApprovalTasksStore(pinia), 'refresh').mockImplementation(approvalRefresh)
  const wrapper = mount(ContractChangesView, {
    global: { plugins: [pinia, ElementPlus] },
  })
  await flushPromises()
  const selects = wrapper.findAllComponents(ElSelect)
  selects[0].vm.$emit('update:modelValue', 12)
  selects[0].vm.$emit('change', 12)
  selects[1].vm.$emit('update:modelValue', 'PRIMARY_TENANT')
  await flushPromises()
  return wrapper
}

describe('合同变更承租人搜索选择', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('alert', vi.fn())
    approvalRefresh.mockClear()
    mockApi()
  })

  it('按姓名或电话远程搜索启用承租人并显示姓名与电话', async () => {
    const wrapper = await mountPrimaryTenantChange()
    const tenantSelect = wrapper.findAllComponents(ElSelect)[2]
    expect(wrapper.text()).not.toContain('新主承租人 ID')
    await (tenantSelect.props('remoteMethod') as (query: string) => Promise<void>)('张')
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/tenants', {
      params: { keyword: '张', status: 'ACTIVE', page: 1, pageSize: 20 },
    })
    expect(wrapper.findAllComponents({ name: 'ElOption' }).some(
      (option) => option.props('label') === '张三02｜13800000009',
    )).toBe(true)
    wrapper.unmount()
  })

  it('选择搜索结果后仍以承租人 ID 提交给后端', async () => {
    const wrapper = await mountPrimaryTenantChange()
    const tenantSelect = wrapper.findAllComponents(ElSelect)[2]
    await (tenantSelect.props('remoteMethod') as (query: string) => Promise<void>)('张')
    tenantSelect.vm.$emit('update:modelValue', 9)
    ;(wrapper.vm as any).form.effectiveDate = '2026-09-01'
    ;(wrapper.vm as any).form.reason = '更换主承租人'
    await flushPromises()
    const submit = wrapper.findAll('button').find((button) => button.text() === '提交变更')
    await submit!.trigger('click')
    await flushPromises()

    expect(http.post).toHaveBeenCalledWith('/contracts/12/changes', {
      changeType: 'PRIMARY_TENANT',
      effectiveDate: '2026-09-01',
      afterSnapshot: { primaryTenantId: 9 },
      reason: '更换主承租人',
    })
    expect(approvalRefresh).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('提交失败时不会刷新待审批数量', async () => {
    vi.mocked(http.post).mockRejectedValueOnce(new Error('提交失败'))
    const wrapper = await mountPrimaryTenantChange()
    const tenantSelect = wrapper.findAllComponents(ElSelect)[2]
    await (tenantSelect.props('remoteMethod') as (query: string) => Promise<void>)('张')
    tenantSelect.vm.$emit('update:modelValue', 9)
    ;(wrapper.vm as any).form.effectiveDate = '2026-09-01'
    ;(wrapper.vm as any).form.reason = '更换主承租人'
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === '提交变更')!.trigger('click')
    await flushPromises()

    expect(approvalRefresh).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('只输入姓名但未选择搜索结果时阻止提交', async () => {
    const alert = vi.mocked(globalThis.alert)
    const wrapper = await mountPrimaryTenantChange()
    const tenantSelect = wrapper.findAllComponents(ElSelect)[2]
    await (tenantSelect.props('remoteMethod') as (query: string) => Promise<void>)('不存在')
    await flushPromises()
    expect((wrapper.vm as any).form.primaryTenantId).toBeUndefined()
    ;(wrapper.vm as any).form.effectiveDate = '2026-09-01'
    ;(wrapper.vm as any).form.reason = '更换主承租人'
    await flushPromises()
    const submit = wrapper.findAll('button').find((button) => button.text() === '提交变更')
    await submit!.trigger('click')

    expect(alert).toHaveBeenCalledWith('请搜索并选择新的主承租人')
    expect(http.post).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
