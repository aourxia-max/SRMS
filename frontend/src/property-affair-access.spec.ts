// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { resolveRouteAccess, routes } from './router'
import { useAppStore } from './stores/app'
import { useApprovalTasksStore } from './stores/approval-tasks'
import { useSessionStore, type SessionUser } from './stores/session'

const Page = defineComponent({ template: '<div>页面</div>' })

async function mountApp(role: SessionUser['role'], path = '/property-affairs') {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.accessToken = 'test-token'
  session.initialized = true
  session.user = { id: 7, username: 'tester', displayName: '测试员', role }
  vi.spyOn(useAppStore(pinia), 'loadProjectName').mockResolvedValue()
  const approvals = useApprovalTasksStore(pinia)
  vi.spyOn(approvals, 'refresh').mockResolvedValue()
  vi.spyOn(approvals, 'startPolling').mockImplementation(() => undefined)
  vi.spyOn(approvals, 'stopPolling').mockImplementation(() => undefined)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'session', component: Page },
      { path: '/property-affairs', name: 'property-affairs', component: Page },
      { path: '/property-affairs/new', name: 'property-affair-create', component: Page },
      { path: '/property-affairs/recycle-bin', name: 'property-affairs-recycle-bin', component: Page },
      { path: '/property-affairs/:id', name: 'property-affair-detail', component: Page },
      { path: '/property-affairs/:id/edit', name: 'property-affair-edit', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, { global: { plugins: [pinia, router], stubs: { ElButton: true } } })
  await flushPromises()
  return { wrapper, router }
}

describe('通用路由角色访问控制', () => {
  const protectedMeta = { requiresAuth: true, roles: ['SUPER_ADMIN', 'ADMIN'] }

  it('未登录访问受保护元路由时保留完整登录跳转地址', () => {
    expect(resolveRouteAccess(
      { fullPath: '/synthetic?tab=all', name: 'synthetic', meta: protectedMeta },
      { isAuthenticated: false, user: null },
    )).toEqual({ name: 'login', query: { redirect: '/synthetic?tab=all' } })
  })

  it.each(['SUPER_ADMIN', 'ADMIN'])('允许已登录的 %s 访问角色匹配路由', (role) => {
    expect(resolveRouteAccess(
      { fullPath: '/synthetic', name: 'synthetic', meta: protectedMeta },
      { isAuthenticated: true, user: { role } },
    )).toBe(true)
  })

  it('将已登录但角色不匹配的用户带回会话页', () => {
    expect(resolveRouteAccess(
      { fullPath: '/synthetic', name: 'synthetic', meta: protectedMeta },
      { isAuthenticated: true, user: { role: 'VISITOR' } },
    )).toEqual({ name: 'session' })
  })

  it('保持已有的登录页跳转行为', () => {
    expect(resolveRouteAccess(
      { fullPath: '/login', name: 'login', meta: {} },
      { isAuthenticated: true, user: { role: 'ADMIN' } },
    )).toEqual({ name: 'session' })
  })
})

describe('物业办事具体路由与导航', () => {
  const expectedMeta = { requiresAuth: true, roles: ['SUPER_ADMIN', 'ADMIN'] }

  it('按防碰撞顺序注册五条管理员路由并使用完全一致的访问元信息', () => {
    const affairRoutes = routes.filter((route) => String(route.path).startsWith('/property-affairs'))
    expect(affairRoutes.map((route) => [route.path, route.name])).toEqual([
      ['/property-affairs', 'property-affairs'],
      ['/property-affairs/new', 'property-affair-create'],
      ['/property-affairs/recycle-bin', 'property-affairs-recycle-bin'],
      ['/property-affairs/:id', 'property-affair-detail'],
      ['/property-affairs/:id/edit', 'property-affair-edit'],
    ])
    affairRoutes.forEach((route) => expect(route.meta).toEqual(expectedMeta))
    expect(affairRoutes.findIndex((route) => route.path === '/property-affairs/new')).toBeLessThan(affairRoutes.findIndex((route) => route.path === '/property-affairs/:id'))
    expect(affairRoutes.findIndex((route) => route.path === '/property-affairs/recycle-bin')).toBeLessThan(affairRoutes.findIndex((route) => route.path === '/property-affairs/:id'))
  })

  it.each(['SUPER_ADMIN', 'ADMIN'] as const)('%s 可直接访问全部物业办事路由', (role) => {
    const affairRoutes = routes.filter((route) => String(route.path).startsWith('/property-affairs'))
    affairRoutes.forEach((route) => {
      expect(resolveRouteAccess({ fullPath: route.path, name: route.name, meta: route.meta ?? {} }, { isAuthenticated: true, user: { role } })).toBe(true)
    })
  })

  it('访客直达任一物业办事页面均回到会话页，未登录仍保留完整地址', () => {
    const editRoute = routes.find((route) => route.name === 'property-affair-edit')!
    expect(resolveRouteAccess({ fullPath: '/property-affairs/7/edit?from=detail', name: editRoute.name, meta: editRoute.meta ?? {} }, { isAuthenticated: true, user: { role: 'VISITOR' } })).toEqual({ name: 'session' })
    expect(resolveRouteAccess({ fullPath: '/property-affairs/7/edit?from=detail', name: editRoute.name, meta: editRoute.meta ?? {} }, { isAuthenticated: false, user: null })).toEqual({ name: 'login', query: { redirect: '/property-affairs/7/edit?from=detail' } })
  })

  it.each(['SUPER_ADMIN', 'ADMIN'] as const)('%s 在工作台看到唯一物业办事入口', async (role) => {
    const { wrapper } = await mountApp(role)
    expect(wrapper.findAll('[data-test="property-affairs-sidebar"]')).toHaveLength(1)
    expect(wrapper.get('[data-test="property-affairs-sidebar"]').text()).toContain('物业办事')
    wrapper.unmount()
  })

  it('访客不显示物业办事入口', async () => {
    const { wrapper } = await mountApp('VISITOR')
    expect(wrapper.find('[data-test="property-affairs-sidebar"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('离开物业办事模块后不保留模块高亮', async () => {
    const { wrapper } = await mountApp('ADMIN', '/')
    expect(wrapper.get('[data-test="property-affairs-sidebar"]').classes()).not.toContain('section-active')
    wrapper.unmount()
  })

  it('五个路由名称均显示对应中文页名', async () => {
    const { wrapper, router } = await mountApp('ADMIN')
    const pages = [
      ['/property-affairs', '物业办事'],
      ['/property-affairs/new', '新建办事事项'],
      ['/property-affairs/recycle-bin', '物业办事回收站'],
      ['/property-affairs/7', '办事事项详情'],
      ['/property-affairs/7/edit', '编辑办事事项'],
    ] as const
    for (const [path, label] of pages) {
      await router.push(path)
      await flushPromises()
      expect(wrapper.get('.srms-crumb').text()).toContain(label)
      expect(wrapper.get('[data-test="property-affairs-sidebar"]').classes()).toContain('section-active')
    }
    wrapper.unmount()
  })
})
