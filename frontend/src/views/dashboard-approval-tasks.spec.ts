// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { useApprovalTasksStore } from '../stores/approval-tasks'
import { useSessionStore } from '../stores/session'
import DashboardView from './DashboardView.vue'

const routerPush = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
  useRoute: () => ({ query: {} }),
}))
vi.mock('../services/http', () => ({
  http: { get: vi.fn() },
}))

const types = [
  ['CONTRACT_CHANGE', '合同变更', 'BG001'],
  ['PRICING_REBATE', '固定月租退差', 'TC002'],
  ['CONTRACT_VOID_REQUEST', '合同作废/纠错', 'HTZF003'],
  ['BILL_ADJUSTMENT', '账单调整', 'TZ004'],
  ['PAYMENT_REFUND', '退款申请', 'TK005'],
  ['PAYMENT_VOID_REQUEST', '收款作废', 'ZF006'],
  ['CHECKOUT_SETTLEMENT', '退租结算', 'TZ007'],
  ['DEPOSIT_REFUND', '押金退款', 'YJTK008'],
] as const

function piniaFor(role: 'SUPER_ADMIN' | 'ADMIN') {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = { id: 1, username: 'tester', displayName: '测试员', role }
  session.accessToken = 'test-token'
  const approvals = useApprovalTasksStore(pinia)
  approvals.counts = {
    contractChanges: 1,
    fixedRentRebates: 1,
    contractVoidRequests: 1,
    billAdjustments: 1,
    paymentRefunds: 1,
    paymentVoidRequests: 1,
    checkoutSettlements: 1,
    depositRefunds: 1,
    contractsTotal: 3,
    paymentsTotal: 3,
    checkoutsTotal: 2,
    total: 8,
  }
  approvals.items = types.map(([type, label, businessNo], index) => ({
    id: index + 1,
    type,
    label,
    businessNo,
    contractId: 100 + index,
    contractNo: `HT${index + 1}`,
    roomId: 11 + index,
    fullHouseNo: `1栋10${index + 1}`,
    submittedAt: `2026-09-01T0${index}:00:00.000Z`,
  }))
  return pinia
}

const dashboardData = {
  roomSummary: { total: 0, operating: 0, occupancyRate: null, statusCounts: {}, rooms: [] },
  rentReminders: [],
  rentReminderDays: 7,
  arrears: [],
  expiringContracts: [],
  contractExpiryDays: 30,
  longVacancyRooms: [],
  longVacancyDays: 30,
  approvals: { billAdjustments: 0, paymentRefunds: 0, pricingRebates: 0 },
  approvalRooms: [],
  monthlyMoveInCount: 0,
  monthlyCheckoutCount: 0,
  arrearsTotal: '0.00',
  rentCollectionOverview: null,
}

describe('驾驶舱统一审批待办', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === '/properties/buildings') return { data: { data: [] } }
      if (url === '/dashboard') return { data: { data: dashboardData } }
      return { data: { data: [] } }
    })
  })

  it('超级管理员看到八类总数，点击后显示业务类型、编号和房号', async () => {
    const wrapper = mount(DashboardView, {
      attachTo: document.body,
      global: { plugins: [piniaFor('SUPER_ADMIN'), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.get('.todo.purple strong').text()).toBe('8')
    await wrapper.get('.todo.purple').trigger('click')
    await flushPromises()
    for (const [, label, businessNo] of types) {
      expect(document.body.textContent).toContain(label)
      expect(document.body.textContent).toContain(businessNo)
    }
    expect(document.body.textContent).toContain('1栋101')
    wrapper.unmount()
  })

  it('普通管理员不显示审批待办', async () => {
    const wrapper = mount(DashboardView, {
      global: { plugins: [piniaFor('ADMIN'), ElementPlus] },
    })
    await flushPromises()
    expect(wrapper.find('.todo.purple').exists()).toBe(false)
    wrapper.unmount()
  })
})
