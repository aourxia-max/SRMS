// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'
import DashboardView from './DashboardView.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('../services/http', () => ({
  http: { get: vi.fn() },
}))

function sessionFor(role: 'SUPER_ADMIN' | 'ADMIN') {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = { id: 1, username: role.toLowerCase(), displayName: role, role }
  session.accessToken = 'test-token'
  return pinia
}

function dashboardData(room: Record<string, unknown>) {
  return {
    roomSummary: {
      total: 1,
      operating: 1,
      occupancyRate: 100,
      statusCounts: { RENTED: 1 },
      rooms: [room],
    },
    rentReminders: [],
    arrears: [],
    expiringContracts: [],
    longVacancyRooms: [],
    approvals: {},
    approvalRooms: [],
    monthlyMoveInCount: 0,
    monthlyCheckoutCount: 0,
    rentCollectionOverview: null,
  }
}

function mockRoom(room: Record<string, unknown>) {
  vi.mocked(http.get).mockImplementation(async (url) => {
    if (url === '/properties/buildings') return { data: { data: [] } }
    if (url === '/dashboard') return { data: { data: dashboardData(room) } }
    return { data: { data: [] } }
  })
}

const baseRoom = {
  id: 11,
  fullHouseNo: '1栋601',
  houseNo: '601',
  floorNo: 6,
  roomStatus: 'RENTED',
  building: { id: 1, buildingNo: '1栋', buildingName: '一号楼' },
}

describe('驾驶舱房态卡片用途与月租', () => {
  beforeEach(() => vi.clearAllMocks())

  it('超级管理员看到用途和当前月租，不再重复显示楼栋名称', async () => {
    mockRoom({ ...baseRoom, usageType: 'RESIDENCE', currentMonthlyRent: '1500.00' })
    const wrapper = mount(DashboardView, {
      global: { plugins: [sessionFor('SUPER_ADMIN'), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.find('.room-owner').text()).toBe('居住 · ¥1,500/月')
    expect(wrapper.find('.room-owner').text()).not.toContain('一号楼')
    wrapper.unmount()
  })

  it('管理员只看到使用用途，不暴露月租金额', async () => {
    mockRoom({ ...baseRoom, usageType: 'SHOP' })
    const wrapper = mount(DashboardView, {
      global: { plugins: [sessionFor('ADMIN'), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.find('.room-owner').text()).toBe('商铺')
    expect(wrapper.find('.room-owner').text()).not.toContain('¥')
    wrapper.unmount()
  })

  it('超级管理员在没有有效合同时看到租金未定', async () => {
    mockRoom({ ...baseRoom, roomStatus: 'EMPTY', usageType: 'RESIDENCE', currentMonthlyRent: null })
    const wrapper = mount(DashboardView, {
      global: { plugins: [sessionFor('SUPER_ADMIN'), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.find('.room-owner').text()).toBe('居住 · 租金未定')
    wrapper.unmount()
  })
})
