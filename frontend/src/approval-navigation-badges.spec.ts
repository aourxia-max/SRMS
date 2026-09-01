import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import App from './App.vue'
import { useAppStore } from './stores/app'
import { useApprovalTasksStore } from './stores/approval-tasks'
import { useSessionStore, type SessionUser } from './stores/session'

const Page = defineComponent({ template: '<div>页面</div>' })

function approvalCounts() {
  return {
    contractChanges: 2,
    fixedRentRebates: 3,
    contractVoidRequests: 4,
    billAdjustments: 5,
    paymentRefunds: 6,
    paymentVoidRequests: 7,
    checkoutSettlements: 8,
    depositRefunds: 9,
    contractsTotal: 9,
    paymentsTotal: 18,
    checkoutsTotal: 17,
    total: 44,
  }
}

async function mountApp(role: SessionUser['role']) {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.accessToken = 'test-token'
  session.initialized = true
  session.user = { id: 7, username: 'tester', displayName: '测试员', role }
  const approvals = useApprovalTasksStore(pinia)
  approvals.counts = approvalCounts()
  const refresh = vi.spyOn(approvals, 'refresh').mockResolvedValue()
  const reset = vi.spyOn(approvals, 'reset')
  const startPolling = vi.spyOn(approvals, 'startPolling')
  const stopPolling = vi.spyOn(approvals, 'stopPolling')
  vi.spyOn(useAppStore(pinia), 'loadProjectName').mockResolvedValue()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'session', component: Page },
      { path: '/contracts', name: 'contracts', component: Page },
      { path: '/:pathMatch(.*)*', component: Page },
    ],
  })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(App, {
    global: { plugins: [pinia, router], stubs: { ElButton: true } },
  })
  await flushPromises()
  return { wrapper, router, session, approvals, refresh, reset, startPolling, stopPolling }
}

function sidebarBadge(wrapper: Awaited<ReturnType<typeof mountApp>>['wrapper'], label: string) {
  const link = wrapper.findAll('.srms-nav-item').find((item) => item.text().includes(label))
  if (!link) throw new Error(`未找到侧边栏入口：${label}`)
  return link.find('[data-test="pending-count-badge"]')
}

describe('全局待审批导航提醒', () => {
  it('超级管理员侧边栏按模块显示合同、合同变更、收款和退租数量', async () => {
    const { wrapper } = await mountApp('SUPER_ADMIN')

    expect(sidebarBadge(wrapper, '合同管理').text()).toBe('9')
    expect(sidebarBadge(wrapper, '合同变更').text()).toBe('2')
    expect(sidebarBadge(wrapper, '收款管理').text()).toBe('18')
    expect(sidebarBadge(wrapper, '退租结算').text()).toBe('17')
    wrapper.unmount()
  })

  it('普通管理员即使本地有旧数量也不显示任何审批红点', async () => {
    const { wrapper } = await mountApp('ADMIN')

    expect(wrapper.find('[data-test="pending-count-badge"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('访客即使本地有旧数量也不显示任何审批红点', async () => {
    const { wrapper } = await mountApp('VISITOR')

    expect(wrapper.find('[data-test="pending-count-badge"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('登录时启动轮询、路由切换刷新、退出停止并在再次登录后重启', async () => {
    const context = await mountApp('ADMIN')
    const { wrapper, router, session, refresh, reset, startPolling, stopPolling } = context

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(startPolling).toHaveBeenCalledTimes(1)
    await router.push('/contracts')
    await flushPromises()
    expect(refresh).toHaveBeenCalledTimes(2)

    session.user = null
    session.accessToken = null
    await nextTick()
    expect(reset).toHaveBeenCalledTimes(1)

    session.user = {
      id: 8,
      username: 'admin2',
      displayName: '管理员2',
      role: 'ADMIN',
    }
    session.accessToken = 'new-token'
    await nextTick()
    expect(startPolling).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    expect(stopPolling).toHaveBeenCalled()
  })
})
