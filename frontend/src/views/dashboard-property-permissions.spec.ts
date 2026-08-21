// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'
import DashboardView from './DashboardView.vue'
import PropertiesView from './PropertiesView.vue'

const routerPush = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
  useRoute: () => ({ query: {} }),
}))
vi.mock('../services/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const dashboardData = {
  roomSummary: { total: 1, operating: 1, occupancyRate: 100, statusCounts: { RENTED: 1 }, rooms: [] },
  rentReminders: [],
  rentReminderDays: 7,
  arrears: [{ contract: { room: { id: 11, fullHouseNo: '1栋101' }, members: [] } }],
  expiringContracts: [],
  contractExpiryDays: 30,
  longVacancyRooms: [],
  longVacancyDays: 30,
  approvals: { billAdjustments: 0, paymentRefunds: 0, pricingRebates: 0 },
  approvalRooms: [],
  monthlyMoveInCount: 0,
  monthlyCheckoutCount: 0,
  arrearsTotal: '3000.00',
  rentCollectionOverview: {
    period: { from: '2026-08-01', to: '2026-08-31' },
    netReceivable: '3000.00',
    validReceived: '0.00',
    outstanding: '3000.00',
    collectionRate: '0.00',
  },
}

function sessionFor(role: 'SUPER_ADMIN' | 'ADMIN' | 'VISITOR') {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = { id: 1, username: role.toLowerCase(), displayName: role, role }
  session.accessToken = 'test-token'
  return pinia
}

describe('驾驶舱角色可见性和今日待办', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === '/properties/buildings') return { data: { data: [] } }
      if (url === '/dashboard') return { data: { data: dashboardData } }
      return { data: { data: [] } }
    })
  })

  it.each(['ADMIN', 'VISITOR'] as const)('%s cannot see the monthly collection overview', async (role) => {
    const wrapper = mount(DashboardView, { global: { plugins: [sessionFor(role), ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('本月租金收缴概览')
    wrapper.unmount()
  })

  it('shows the collection overview to a super administrator', async () => {
    const wrapper = mount(DashboardView, { global: { plugins: [sessionFor('SUPER_ADMIN'), ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).toContain('本月租金收缴概览')
    wrapper.unmount()
  })

  it('opens a room list instead of navigating immediately when a todo is clicked', async () => {
    const wrapper = mount(DashboardView, {
      attachTo: document.body,
      global: { plugins: [sessionFor('ADMIN'), ElementPlus] },
    })
    await flushPromises()
    await wrapper.findAll('button.todo')[0].trigger('click')
    await flushPromises()

    expect(routerPush).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('1栋101')
    wrapper.unmount()
  })
})

describe('房源管理角色操作权限', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === '/properties/buildings') {
        return { data: { data: [{ id: 1, buildingNo: '1栋', buildingName: '一号楼', floorCount: 6, status: 'ACTIVE' }] } }
      }
      return {
        data: {
          data: [{ id: 11, buildingId: 1, fullHouseNo: '1栋101', houseNo: '101', floorNo: 1, roomStatus: 'EMPTY', building: { buildingNo: '1栋' } }],
        },
      }
    })
  })

  it('keeps edit actions but hides create and delete actions from an administrator', async () => {
    const wrapper = mount(PropertiesView, { global: { plugins: [sessionFor('ADMIN'), ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).toContain('编辑')
    expect(wrapper.text()).not.toContain('新增楼栋')
    expect(wrapper.text()).not.toContain('新增房源')
    expect(wrapper.text()).not.toContain('删除')
    wrapper.unmount()
  })

  it('shows create and delete actions to a super administrator', async () => {
    const wrapper = mount(PropertiesView, { global: { plugins: [sessionFor('SUPER_ADMIN'), ElementPlus] } })
    await flushPromises()
    expect(wrapper.text()).toContain('新增楼栋')
    expect(wrapper.text()).toContain('新增房源')
    expect(wrapper.text()).toContain('删除')
    wrapper.unmount()
  })
})
