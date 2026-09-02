// @vitest-environment happy-dom

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox, ElOption, ElPagination, ElSelect } from 'element-plus'
import { createPinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../services/property-affairs'
import { http } from '../services/http'
import { useSessionStore, type SessionUser } from '../stores/session'
import type { PropertyAffairSummary, PropertyAffairStatus } from '../types/property-affairs'
import PropertyAffairsView from './PropertyAffairsView.vue'

vi.mock('../services/property-affairs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/property-affairs')>()
  return {
    ...actual,
    listPropertyAffairs: vi.fn(),
    listPropertyAffairsRecycleBin: vi.fn(),
    listPropertyAffairCategories: vi.fn(),
    listPropertyAffairResponsibleUsers: vi.fn(),
    softDeletePropertyAffair: vi.fn(),
    restorePropertyAffair: vi.fn(),
    permanentlyDeletePropertyAffair: vi.fn(),
  }
})

vi.mock('../services/http', () => ({ http: { get: vi.fn() } }))
vi.mock('../services/contracts', () => ({ listContracts: vi.fn().mockResolvedValue([]) }))

enableAutoUnmount(afterEach)

const Page = defineComponent({ template: '<div />' })
const affair: PropertyAffairSummary = {
  id: 7,
  affairNo: 'WY202609020001',
  title: '走廊照明维修',
  category: '公共维修',
  priority: 'URGENT',
  status: 'IN_PROGRESS',
  content: '更换灯具',
  responsibleUserId: 2,
  responsibleSnapshot: '王管理员',
  externalHandlerName: null,
  externalPhone: null,
  externalContact: null,
  completedAt: null,
  cancelledAt: null,
  createdBy: 1,
  updatedBy: 2,
  deletedAt: null,
  deletedBy: null,
  version: 3,
  createdAt: '2026-09-02T01:00:00.000Z',
  updatedAt: '2026-09-02T02:00:00.000Z',
  buildings: [{ id: 1, snapshotLabel: '旧1栋', currentLabel: '1栋', currentStatus: 'ACTIVE', available: true }],
  rooms: [{ id: 11, snapshotLabel: '旧1栋101', currentLabel: '1栋101', currentStatus: 'RENTED', available: true }],
  tenants: [],
  contracts: [],
}

const emptyPage = { items: [], total: 0, page: 1, pageSize: 20 }
const countTotals: Record<string, number> = { ALL: 42, PENDING: 12, IN_PROGRESS: 9, COMPLETED: 18, CANCELLED: 3 }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function installApiMocks() {
  vi.mocked(api.listPropertyAffairs).mockImplementation(async (query = {}) => {
    if (query.pageSize === 1) return { items: [], total: countTotals[query.status ?? 'ALL'], page: 1, pageSize: 1 }
    return { items: [affair], total: 1, page: query.page ?? 1, pageSize: query.pageSize ?? 20 }
  })
  vi.mocked(api.listPropertyAffairsRecycleBin).mockResolvedValue({
    items: [{ ...affair, deletedAt: '2026-09-02T03:00:00.000Z', deletedBy: 2 }],
    total: 1,
    page: 1,
    pageSize: 20,
  })
  vi.mocked(api.listPropertyAffairCategories).mockResolvedValue(['公共维修'])
  vi.mocked(api.listPropertyAffairResponsibleUsers).mockResolvedValue([{ id: 2, displayName: '王管理员', role: 'ADMIN' }])
  vi.mocked(api.softDeletePropertyAffair).mockResolvedValue({ ...affair, deletedAt: '2026-09-02T03:00:00.000Z' } as never)
  vi.mocked(api.restorePropertyAffair).mockResolvedValue(affair as never)
  vi.mocked(api.permanentlyDeletePropertyAffair).mockResolvedValue({ id: 7 })
  vi.mocked(http.get).mockImplementation(async (url: string) => {
    if (url === '/properties/buildings') return { data: { data: [{ id: 1, buildingNo: '1栋' }] } }
    if (url === '/properties/rooms') return { data: { data: [{ id: 11, fullHouseNo: '1栋101' }] } }
    if (url === '/tenants') return { data: { data: { items: [{ id: 21, name: '张三', phone: '13800000000' }] } } }
    throw new Error(`unexpected endpoint ${url}`)
  })
}

async function mountList(path = '/property-affairs', role: SessionUser['role'] = 'ADMIN') {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.accessToken = 'test-token'
  session.initialized = true
  session.user = { id: 2, username: 'admin', displayName: '王管理员', role }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/property-affairs', name: 'property-affairs', component: PropertyAffairsView },
      { path: '/property-affairs/recycle-bin', name: 'property-affairs-recycle-bin', component: PropertyAffairsView },
      { path: '/property-affairs/:id', name: 'property-affair-detail', component: Page },
      { path: '/property-affairs/:id/edit', name: 'property-affair-edit', component: Page },
      { path: '/property-affairs/new', name: 'property-affair-create', component: Page },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(PropertyAffairsView, { global: { plugins: [pinia, router, ElementPlus] } })
  await flushPromises()
  return { wrapper, router }
}

describe('物业办事列表与回收站', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installApiMocks()
  })

  it('使用独立小查询显示全局状态统计且所有枚举和空字段使用中文', async () => {
    const { wrapper } = await mountList()

    expect(wrapper.text()).toContain('全部事项42')
    expect(wrapper.text()).toContain('待办理12')
    expect(wrapper.text()).toContain('办理中9')
    expect(wrapper.text()).toContain('已完成18')
    expect(wrapper.text()).toContain('已取消3')
    expect(wrapper.text()).toContain('紧急')
    expect(wrapper.text()).toContain('办理中')
    expect(wrapper.text()).not.toContain('URGENT')
    expect(wrapper.text()).not.toContain('IN_PROGRESS')
    expect(api.listPropertyAffairs).toHaveBeenCalledWith({ page: 1, pageSize: 1 })
    for (const status of ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as PropertyAffairStatus[]) {
      expect(api.listPropertyAffairs).toHaveBeenCalledWith({ status, page: 1, pageSize: 1 })
    }
  })

  it('查询时去掉空值、保留分页，并在筛选变化后重置到第一页', async () => {
    const { wrapper } = await mountList()
    wrapper.findComponent(ElPagination).vm.$emit('current-change', 3)
    await flushPromises()
    const priority = wrapper.findAllComponents(ElSelect).find((item) => item.attributes('data-test') === 'affair-priority')!
    priority.vm.$emit('update:modelValue', 'URGENT')
    priority.vm.$emit('change', 'URGENT')
    await flushPromises()
    const filterChangeCall = [...vi.mocked(api.listPropertyAffairs).mock.calls].reverse().find(([query]) => query?.pageSize === 20)
    expect(filterChangeCall?.[0]?.page).toBe(1)

    wrapper.findComponent(ElPagination).vm.$emit('current-change', 3)
    await flushPromises()
    await wrapper.get('[data-test="affair-keyword"]').setValue(' 照明 ')
    await wrapper.get('[data-test="search-affairs"]').trigger('click')
    await flushPromises()

    const pageCall = [...vi.mocked(api.listPropertyAffairs).mock.calls].reverse().find(([query]) => query?.pageSize === 20)
    expect(pageCall?.[0]).toEqual({ keyword: '照明', priority: 'URGENT', page: 1, pageSize: 20 })
  })

  it('路由在同一实例中切换时改用回收站端点', async () => {
    const { router } = await mountList()
    await router.push('/property-affairs/recycle-bin')
    await flushPromises()

    expect(api.listPropertyAffairsRecycleBin).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 })
  })

  it('普通列表晚于回收站完成时忽略普通列表的旧行和总数', async () => {
    const ordinary = deferred<Awaited<ReturnType<typeof api.listPropertyAffairs>>>()
    const recycle = deferred<Awaited<ReturnType<typeof api.listPropertyAffairsRecycleBin>>>()
    vi.mocked(api.listPropertyAffairs).mockImplementation((query = {}) => {
      if (query.pageSize === 1) return Promise.resolve({ items: [], total: 90, page: 1, pageSize: 1 })
      return ordinary.promise
    })
    vi.mocked(api.listPropertyAffairsRecycleBin).mockReturnValue(recycle.promise)
    const { wrapper, router } = await mountList()

    await router.push('/property-affairs/recycle-bin')
    recycle.resolve({ items: [{ ...affair, title: '回收站最新结果', deletedAt: '2026-09-02T03:00:00.000Z' }], total: 1, page: 1, pageSize: 20 })
    await flushPromises()
    expect(wrapper.text()).toContain('回收站最新结果')

    ordinary.resolve({ items: [{ ...affair, title: '普通列表过时结果' }], total: 77, page: 1, pageSize: 20 })
    await flushPromises()
    expect(wrapper.text()).toContain('回收站最新结果')
    expect(wrapper.text()).not.toContain('普通列表过时结果')
    expect(wrapper.findComponent(ElPagination).props('total')).toBe(1)
  })

  it('旧请求失败不得覆盖最新模式错误状态或提前结束最新 loading', async () => {
    const ordinary = deferred<Awaited<ReturnType<typeof api.listPropertyAffairs>>>()
    const recycle = deferred<Awaited<ReturnType<typeof api.listPropertyAffairsRecycleBin>>>()
    vi.mocked(api.listPropertyAffairs).mockImplementation((query = {}) => query.pageSize === 1
      ? Promise.resolve({ items: [], total: 1, page: 1, pageSize: 1 })
      : ordinary.promise)
    vi.mocked(api.listPropertyAffairsRecycleBin).mockReturnValue(recycle.promise)
    const { wrapper, router } = await mountList()

    await router.push('/property-affairs/recycle-bin')
    ordinary.reject(new Error('普通列表旧请求失败'))
    await flushPromises()

    expect(wrapper.text()).not.toContain('回收站加载失败')
    expect(wrapper.find('.list-card .el-loading-mask').attributes('style') ?? '').not.toContain('display: none')

    recycle.resolve({ items: [{ ...affair, title: '回收站最终结果', deletedAt: '2026-09-02T03:00:00.000Z' }], total: 1, page: 1, pageSize: 20 })
    await flushPromises()
    expect(wrapper.text()).toContain('回收站最终结果')
  })

  it('切换模式期间晚到的普通列表统计不得提交到后续页面', async () => {
    const staleCounts = Array.from({ length: 5 }, () => deferred<Awaited<ReturnType<typeof api.listPropertyAffairs>>>() )
    const nextOrdinary = deferred<Awaited<ReturnType<typeof api.listPropertyAffairs>>>()
    let ordinaryPageCalls = 0
    let countCalls = 0
    vi.mocked(api.listPropertyAffairs).mockImplementation((query = {}) => {
      if (query.pageSize === 1) return staleCounts[countCalls++].promise
      ordinaryPageCalls += 1
      if (ordinaryPageCalls === 1) return Promise.resolve({ items: [{ ...affair, title: '等待旧统计的普通结果' }], total: 1, page: 1, pageSize: 20 })
      return nextOrdinary.promise
    })
    vi.mocked(api.listPropertyAffairsRecycleBin).mockResolvedValue({ items: [{ ...affair, title: '回收站结果', deletedAt: '2026-09-02T03:00:00.000Z' }], total: 1, page: 1, pageSize: 20 })
    const { wrapper, router } = await mountList()
    await flushPromises()

    await router.push('/property-affairs/recycle-bin')
    await flushPromises()
    staleCounts.forEach((pending, index) => pending.resolve({ items: [], total: 91 + index, page: 1, pageSize: 1 }))
    await flushPromises()

    await router.push('/property-affairs')
    await flushPromises()
    expect(wrapper.text()).toContain('全部事项0')
    expect(wrapper.text()).not.toContain('全部事项91')
    wrapper.unmount()
  })

  it('回收站晚于普通列表完成时忽略回收站的旧结果并保留最新统计', async () => {
    const recycle = deferred<Awaited<ReturnType<typeof api.listPropertyAffairsRecycleBin>>>()
    vi.mocked(api.listPropertyAffairsRecycleBin).mockReturnValue(recycle.promise)
    vi.mocked(api.listPropertyAffairs).mockImplementation(async (query = {}) => {
      if (query.pageSize === 1) return { items: [], total: countTotals[query.status ?? 'ALL'], page: 1, pageSize: 1 }
      return { items: [{ ...affair, title: '普通列表最新结果' }], total: 42, page: 1, pageSize: 20 }
    })
    const { wrapper, router } = await mountList('/property-affairs/recycle-bin')

    await router.push('/property-affairs')
    await flushPromises()
    expect(wrapper.text()).toContain('普通列表最新结果')
    expect(wrapper.text()).toContain('全部事项42')

    recycle.resolve({ items: [{ ...affair, title: '回收站过时结果', deletedAt: '2026-09-02T03:00:00.000Z' }], total: 99, page: 1, pageSize: 20 })
    await flushPromises()
    expect(wrapper.text()).toContain('普通列表最新结果')
    expect(wrapper.text()).not.toContain('回收站过时结果')
    expect(wrapper.text()).toContain('全部事项42')
    expect(wrapper.findComponent(ElPagination).props('total')).toBe(42)
  })

  it('首次导航和同实例 query 变化均同步合法筛选与页码并发送精确参数', async () => {
    const { router } = await mountList('/property-affairs?keyword=%20照明%20&category=公共维修&status=IN_PROGRESS&priority=URGENT&responsibleUserId=2&buildingId=3&roomId=88&tenantId=21&contractId=31&page=4')
    const firstCall = vi.mocked(api.listPropertyAffairs).mock.calls.find(([query]) => query?.pageSize === 20)
    expect(firstCall?.[0]).toEqual({
      keyword: '照明', category: '公共维修', status: 'IN_PROGRESS', priority: 'URGENT', responsibleUserId: 2,
      buildingId: 3, roomId: 88, tenantId: 21, contractId: 31, page: 4, pageSize: 20,
    })

    await router.push('/property-affairs?roomId=88&page=2')
    await flushPromises()
    const latestCall = [...vi.mocked(api.listPropertyAffairs).mock.calls].reverse().find(([query]) => query?.pageSize === 20)
    expect(latestCall?.[0]).toEqual({ roomId: 88, page: 2, pageSize: 20 })
  })

  it('query 中未知枚举、非正整数关联 ID 和非法页码均清空且不发送', async () => {
    await mountList('/property-affairs?keyword=%20%20&status=UNKNOWN&priority=HIGH&responsibleUserId=0&buildingId=-1&roomId=8.5&tenantId=abc&contractId=999999999999999999999&page=0')
    const call = vi.mocked(api.listPropertyAffairs).mock.calls.find(([query]) => query?.pageSize === 20)
    expect(call?.[0]).toEqual({ page: 1, pageSize: 20 })
  })

  it('承租人筛选选项跨页加载，不会截断在前 100 条', async () => {
    vi.mocked(http.get).mockImplementation(async (url: string, config) => {
      if (url === '/properties/buildings' || url === '/properties/rooms') return { data: { data: [] } }
      if (url === '/tenants' && config?.params?.page === 1) {
        return { data: { data: { items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, name: `承租人${index + 1}` })), total: 101, page: 1, pageSize: 100 } } }
      }
      if (url === '/tenants' && config?.params?.page === 2) {
        return { data: { data: { items: [{ id: 101, name: '最后一位承租人' }], total: 101, page: 2, pageSize: 100 } } }
      }
      throw new Error(`unexpected endpoint ${url}`)
    })

    const { wrapper } = await mountList()

    expect(http.get).toHaveBeenCalledWith('/tenants', { params: { page: 2, pageSize: 100 } })
    expect(wrapper.findAllComponents(ElOption).map((option) => option.props('label'))).toContain('最后一位承租人')
  })

  it('回收站恢复最后一行时先退一页再刷新，永久删除仅超级管理员可见并要求不可逆确认', async () => {
    vi.mocked(api.listPropertyAffairsRecycleBin).mockImplementation(async (query = {}) => ({
      items: [{ ...affair, deletedAt: '2026-09-02T03:00:00.000Z', deletedBy: 2 }], total: 21, page: query.page ?? 1, pageSize: 20,
    }))
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper } = await mountList('/property-affairs/recycle-bin', 'SUPER_ADMIN')
    wrapper.findComponent(ElPagination).vm.$emit('current-change', 2)
    await flushPromises()
    await wrapper.get('[data-test="restore-affair-7"]').trigger('click')
    await flushPromises()

    expect(api.restorePropertyAffair).toHaveBeenCalledWith(7, 3)
    expect(api.listPropertyAffairsRecycleBin).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 })
    await wrapper.get('[data-test="permanent-delete-affair-7"]').trigger('click')
    await flushPromises()
    expect(ElMessageBox.confirm).toHaveBeenLastCalledWith(expect.stringContaining('永久删除后不可恢复'), '永久删除确认', expect.any(Object))

    const admin = await mountList('/property-affairs/recycle-bin', 'ADMIN')
    expect(admin.wrapper.find('[data-test="permanent-delete-affair-7"]').exists()).toBe(false)
  })

  it('以中文呈现空状态和加载失败', async () => {
    vi.mocked(api.listPropertyAffairs).mockImplementation(async (query = {}) => {
      if (query.pageSize === 1) return { ...emptyPage, pageSize: 1 }
      return emptyPage
    })
    const empty = await mountList()
    expect(empty.wrapper.text()).toContain('暂无物业办事事项')

    vi.mocked(api.listPropertyAffairs).mockRejectedValue(new Error('network'))
    const failed = await mountList()
    expect(failed.wrapper.text()).toContain('物业办事加载失败，请稍后重试')
  })

  it('删除普通列表事项时要求中文确认且阻止重复提交', async () => {
    let release!: () => void
    vi.mocked(api.softDeletePropertyAffair).mockImplementation(() => new Promise((resolve) => { release = () => resolve(affair as never) }))
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const { wrapper } = await mountList()
    const button = wrapper.get('[data-test="delete-affair-7"]')
    await button.trigger('click')
    await button.trigger('click')
    expect(api.softDeletePropertyAffair).toHaveBeenCalledTimes(1)
    expect(ElMessageBox.confirm).toHaveBeenCalledWith(expect.stringContaining('移入回收站'), '删除确认', expect.any(Object))
    release()
    await flushPromises()
  })
})
