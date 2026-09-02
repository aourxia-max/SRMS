// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../services/property-affairs'
import { useSessionStore, type SessionUser } from '../../stores/session'
import type { PropertyAffairSummary } from '../../types/property-affairs'
import RelatedPropertyAffairs from './RelatedPropertyAffairs.vue'

vi.mock('../../services/property-affairs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/property-affairs')>()),
  listPropertyAffairs: vi.fn(),
}))

const Page = defineComponent({ template: '<div />' })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function affair(id: number, overrides: Partial<PropertyAffairSummary> = {}): PropertyAffairSummary {
  return {
    id,
    affairNo: `WY20260902${String(id).padStart(4, '0')}`,
    title: `关联事项${id}`,
    category: null,
    priority: 'IMPORTANT',
    status: 'IN_PROGRESS',
    content: '跟进中',
    responsibleUserId: null,
    responsibleSnapshot: null,
    externalHandlerName: null,
    externalPhone: null,
    externalContact: null,
    completedAt: null,
    cancelledAt: null,
    createdBy: 1,
    updatedBy: 1,
    deletedAt: null,
    deletedBy: null,
    version: 1,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-02T08:30:00.000Z',
    buildings: [],
    rooms: [],
    tenants: [],
    contracts: [],
    ...overrides,
  }
}

async function mountRelated(
  props: { roomId?: number; tenantId?: number; contractId?: number },
  role: SessionUser['role'] = 'ADMIN',
) {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = { id: 1, username: role.toLowerCase(), displayName: role, role }
  session.accessToken = 'test-token'
  session.initialized = true
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page },
      { path: '/property-affairs', name: 'property-affairs', component: Page },
      { path: '/property-affairs/:id', name: 'property-affair-detail', component: Page },
    ],
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(RelatedPropertyAffairs, {
    props,
    global: { plugins: [pinia, router, ElementPlus] },
  })
  return { wrapper, router }
}

describe('业务对象关联物业办事', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listPropertyAffairs).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 })
  })

  it.each([
    [{ roomId: 11 }, { roomId: 11, page: 1, pageSize: 5 }],
    [{ tenantId: 21 }, { tenantId: 21, page: 1, pageSize: 5 }],
    [{ contractId: 31 }, { contractId: 31, page: 1, pageSize: 5 }],
    [
      { roomId: 11, tenantId: 21, contractId: 31 },
      { roomId: 11, tenantId: 21, contractId: 31, page: 1, pageSize: 5 },
    ],
  ])('仅把已定义目标属性加入精确查询 %#', async (props, expected) => {
    const { wrapper } = await mountRelated(props)
    await flushPromises()

    expect(api.listPropertyAffairs).toHaveBeenCalledTimes(1)
    expect(api.listPropertyAffairs).toHaveBeenCalledWith(expected)
    wrapper.unmount()
  })

  it('游客不渲染且不发起查询', async () => {
    const { wrapper } = await mountRelated({ roomId: 11 }, 'VISITOR')
    await flushPromises()

    expect(wrapper.find('[data-test="related-property-affairs"]').exists()).toBe(false)
    expect(api.listPropertyAffairs).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('保持后端顺序、防御性排除已删除项并只显示中文标签', async () => {
    vi.mocked(api.listPropertyAffairs).mockResolvedValue({
      items: [
        affair(8, { title: '后端第一项', status: 'PENDING', priority: 'URGENT' }),
        affair(7, { title: '已删除事项', deletedAt: '2026-09-02T09:00:00.000Z' }),
        affair(6, { title: '后端第二项', status: 'COMPLETED', priority: 'NORMAL' }),
      ],
      total: 3,
      page: 1,
      pageSize: 5,
    })
    const { wrapper } = await mountRelated({ roomId: 11 })
    await flushPromises()

    const rows = wrapper.findAll('[data-test="related-affair-row"]')
    expect(rows.map((row) => row.get('[data-test="related-affair-title"]').text())).toEqual(['后端第一项', '后端第二项'])
    expect(wrapper.text()).toContain('WY202609020008')
    expect(wrapper.text()).toContain('待办理')
    expect(wrapper.text()).toContain('紧急')
    expect(wrapper.text()).toContain('已完成')
    expect(wrapper.text()).toContain('普通')
    expect(wrapper.text()).toContain('2026')
    expect(wrapper.text()).not.toContain('已删除事项')
    expect(wrapper.text()).not.toContain('PENDING')
    expect(wrapper.text()).not.toContain('URGENT')
    expect(wrapper.text()).not.toContain('???')
    wrapper.unmount()
  })

  it('事项行进入详情，查看全部保留完全相同的目标查询', async () => {
    vi.mocked(api.listPropertyAffairs).mockResolvedValue({ items: [affair(8)], total: 1, page: 1, pageSize: 5 })
    const { wrapper, router } = await mountRelated({ tenantId: 21 })
    await flushPromises()

    await wrapper.get('[data-test="related-affair-row"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/property-affairs/8')

    await router.push('/')
    await wrapper.get('[data-test="related-affairs-view-all"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('property-affairs')
    expect(router.currentRoute.value.query).toEqual({ tenantId: '21' })
    wrapper.unmount()
  })

  it('属性变化时旧响应不能覆盖新目标的事项或结束新请求的加载状态', async () => {
    const oldRequest = deferred<Awaited<ReturnType<typeof api.listPropertyAffairs>>>()
    const newRequest = deferred<Awaited<ReturnType<typeof api.listPropertyAffairs>>>()
    vi.mocked(api.listPropertyAffairs)
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise)
    const { wrapper } = await mountRelated({ roomId: 11 })
    await nextTick()

    await wrapper.setProps({ roomId: 12 })
    oldRequest.resolve({ items: [affair(1, { title: '旧房源事项' })], total: 1, page: 1, pageSize: 5 })
    await flushPromises()

    expect(wrapper.text()).not.toContain('旧房源事项')
    expect(wrapper.text()).toContain('正在加载物业办事')

    newRequest.resolve({ items: [affair(2, { title: '新房源事项' })], total: 1, page: 1, pageSize: 5 })
    await flushPromises()
    expect(wrapper.text()).toContain('新房源事项')
    expect(wrapper.text()).not.toContain('旧房源事项')
    wrapper.unmount()
  })

  it('提供中文加载、空和错误状态', async () => {
    const loadingRequest = deferred<Awaited<ReturnType<typeof api.listPropertyAffairs>>>()
    vi.mocked(api.listPropertyAffairs).mockReturnValueOnce(loadingRequest.promise)
    const loading = await mountRelated({ contractId: 31 })
    await nextTick()
    expect(loading.wrapper.text()).toContain('正在加载物业办事')
    loadingRequest.resolve({ items: [], total: 0, page: 1, pageSize: 5 })
    await flushPromises()
    expect(loading.wrapper.text()).toContain('暂无关联的物业办事事项')
    loading.wrapper.unmount()

    vi.mocked(api.listPropertyAffairs).mockRejectedValueOnce(new Error('network'))
    const failed = await mountRelated({ contractId: 31 })
    await flushPromises()
    expect(failed.wrapper.text()).toContain('关联物业办事加载失败，请稍后重试')
    failed.wrapper.unmount()
  })
})
