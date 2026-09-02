// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App.vue'
import RelatedPropertyAffairs from '../components/property-affairs/RelatedPropertyAffairs.vue'
import { resolveRouteAccess, routes } from '../router'
import { http } from '../services/http'
import * as api from '../services/property-affairs'
import { useAppStore } from '../stores/app'
import { useApprovalTasksStore } from '../stores/approval-tasks'
import { useSessionStore, type SessionUser } from '../stores/session'
import TenantDetailView from './TenantDetailView.vue'
import TenantsView from './TenantsView.vue'

vi.mock('../services/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

vi.mock('../services/property-affairs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/property-affairs')>()),
  listPropertyAffairs: vi.fn(),
}))

const Page = defineComponent({ template: '<div>页面</div>' })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function sessionFor(role: SessionUser['role']) {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.accessToken = 'test-token'
  session.initialized = true
  session.user = { id: 7, username: role.toLowerCase(), displayName: role, role }
  return pinia
}

function tenant(id: number, name = '万象科技有限公司') {
  return {
    id,
    tenantType: 'COMPANY',
    name,
    phone: '13800000000',
    idType: 'ID_CARD',
    idNoLast4: '1234',
    maskedIdNo: '****1234',
    contactAddress: '海口市美兰区测试路1号',
    status: 'ACTIVE',
    remark: '重点客户',
    createdAt: '2026-08-01T08:00:00.000Z',
    updatedAt: '2026-09-02T09:30:00.000Z',
  }
}

function tenantRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tenants', name: 'tenants', component: Page },
      { path: '/tenants/:id', name: 'tenant-detail', component: TenantDetailView },
      { path: '/property-affairs', name: 'property-affairs', component: Page },
      { path: '/property-affairs/:id', name: 'property-affair-detail', component: Page },
    ],
  })
}

async function mountDetail(path = '/tenants/41') {
  const pinia = sessionFor('ADMIN')
  const router = tenantRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(TenantDetailView, {
    global: { plugins: [pinia, router, ElementPlus] },
  })
  return { wrapper, router }
}

describe('承租人详情路由与页名', () => {
  it('静态租户路由之后注册管理员详情路由并阻止游客直达', () => {
    const tenantRoutes = routes.filter((route) => String(route.path).startsWith('/tenants'))
    expect(tenantRoutes.map((route) => [route.path, route.name])).toEqual([
      ['/tenants', 'tenants'],
      ['/tenants/:id', 'tenant-detail'],
    ])
    const detailRoute = tenantRoutes[1]
    expect(detailRoute.meta).toEqual({ requiresAuth: true, roles: ['SUPER_ADMIN', 'ADMIN'] })
    expect(resolveRouteAccess(
      { fullPath: '/tenants/41', name: detailRoute.name, meta: detailRoute.meta ?? {} },
      { isAuthenticated: true, user: { role: 'VISITOR' } },
    )).toEqual({ name: 'session' })
  })

  it('应用面包屑显示承租人详情中文页名', async () => {
    const pinia = sessionFor('ADMIN')
    vi.spyOn(useAppStore(pinia), 'loadProjectName').mockResolvedValue()
    const approvals = useApprovalTasksStore(pinia)
    vi.spyOn(approvals, 'refresh').mockResolvedValue()
    vi.spyOn(approvals, 'startPolling').mockImplementation(() => undefined)
    vi.spyOn(approvals, 'stopPolling').mockImplementation(() => undefined)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'session', component: Page },
        { path: '/tenants', name: 'tenants', component: Page },
        { path: '/tenants/:id', name: 'tenant-detail', component: Page },
      ],
    })
    await router.push('/tenants/41')
    await router.isReady()
    const wrapper = mount(App, {
      global: { plugins: [pinia, router], stubs: { ElButton: true } },
    })
    await flushPromises()

    expect(wrapper.get('.srms-crumb').text()).toContain('承租人详情')
    wrapper.unmount()
  })
})

describe('承租人详情与关联物业办事', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listPropertyAffairs).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 })
  })

  it('仅请求普通详情，展示脱敏字段与中文标签，并传入真实 tenant.id', async () => {
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === '/tenants/41') return { data: { data: tenant(41) } }
      throw new Error(`unexpected endpoint ${url}`)
    })
    const { wrapper, router } = await mountDetail()
    await flushPromises()

    expect(http.get).toHaveBeenCalledTimes(1)
    expect(http.get).toHaveBeenCalledWith('/tenants/41')
    expect(vi.mocked(http.get).mock.calls.some(([url]) => String(url).includes('/sensitive'))).toBe(false)
    expect(wrapper.text()).toContain('万象科技有限公司')
    expect(wrapper.text()).toContain('单位')
    expect(wrapper.text()).toContain('13800000000')
    expect(wrapper.text()).toContain('身份证')
    expect(wrapper.text()).toContain('****1234')
    expect(wrapper.text()).toContain('海口市美兰区测试路1号')
    expect(wrapper.text()).toContain('启用')
    expect(wrapper.text()).toContain('重点客户')
    expect(wrapper.text()).toContain('2026')
    expect(wrapper.text()).not.toContain('COMPANY')
    expect(wrapper.text()).not.toContain('ID_CARD')
    expect(wrapper.text()).not.toContain('ACTIVE')
    expect(wrapper.text()).not.toContain('???')
    expect(wrapper.getComponent(RelatedPropertyAffairs).props('tenantId')).toBe(41)
    expect(api.listPropertyAffairs).toHaveBeenCalledWith({ tenantId: 41, page: 1, pageSize: 5 })

    await wrapper.get('[data-test="back-to-tenants"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('tenants')
    wrapper.unmount()
  })

  it('提供中文加载、空数据、404 和普通错误状态', async () => {
    const loadingRequest = deferred<{ data: { data: ReturnType<typeof tenant> | null } }>()
    vi.mocked(http.get).mockReturnValueOnce(loadingRequest.promise as never)
    const loading = await mountDetail()
    await nextTick()
    expect(loading.wrapper.text()).toContain('正在加载承租人详情')
    loadingRequest.resolve({ data: { data: null } })
    await flushPromises()
    expect(loading.wrapper.text()).toContain('暂无承租人详情')
    loading.wrapper.unmount()

    vi.mocked(http.get).mockRejectedValueOnce({ response: { status: 404 } })
    const missing = await mountDetail()
    await flushPromises()
    expect(missing.wrapper.text()).toContain('未找到该承租人')
    missing.wrapper.unmount()

    vi.mocked(http.get).mockRejectedValueOnce(new Error('network'))
    const failed = await mountDetail()
    await flushPromises()
    expect(failed.wrapper.text()).toContain('承租人详情加载失败，请稍后重试')
    failed.wrapper.unmount()
  })

  it('同一组件切换 ID 时旧响应不能覆盖新详情或提前结束加载', async () => {
    const oldRequest = deferred<{ data: { data: ReturnType<typeof tenant> } }>()
    const newRequest = deferred<{ data: { data: ReturnType<typeof tenant> } }>()
    vi.mocked(http.get).mockImplementation((url) => {
      if (url === '/tenants/41') return oldRequest.promise as never
      if (url === '/tenants/42') return newRequest.promise as never
      throw new Error(`unexpected endpoint ${url}`)
    })
    const { wrapper, router } = await mountDetail('/tenants/41')
    await nextTick()

    await router.push('/tenants/42')
    await nextTick()
    oldRequest.resolve({ data: { data: tenant(41, '旧承租人') } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧承租人')
    expect(wrapper.text()).toContain('正在加载承租人详情')

    newRequest.resolve({ data: { data: tenant(42, '新承租人') } })
    await flushPromises()
    expect(wrapper.text()).toContain('新承租人')
    expect(wrapper.text()).not.toContain('旧承租人')
    expect(wrapper.getComponent(RelatedPropertyAffairs).props('tenantId')).toBe(42)
    wrapper.unmount()
  })
})

describe('承租人列表详情入口', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === '/system/defaults') return { data: { data: { defaultTenantType: 'INDIVIDUAL' } } }
      if (url === '/tenants') return { data: { data: { items: [tenant(17, '张三')], total: 1 } } }
      throw new Error(`unexpected endpoint ${url}`)
    })
  })

  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('%s 在每行看到详情入口并通过路由名称和 ID 导航', async (role) => {
    const router = tenantRouter()
    await router.push('/tenants')
    await router.isReady()
    const wrapper = mount(TenantsView, {
      global: { plugins: [sessionFor(role), router, ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('编辑')
    expect(wrapper.text()).toContain('查看证件')
    expect(wrapper.text()).toContain('上传附件')
    await wrapper.get('[data-test="tenant-detail-17"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('tenant-detail')
    expect(router.currentRoute.value.params.id).toBe('17')
    wrapper.unmount()
  })

  it('游客列表不暴露详情入口', async () => {
    const router = tenantRouter()
    await router.push('/tenants')
    await router.isReady()
    const wrapper = mount(TenantsView, {
      global: { plugins: [sessionFor('VISITOR'), router, ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.find('[data-test="tenant-detail-17"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
