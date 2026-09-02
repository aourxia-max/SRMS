// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'
import type { PropertyAffairSummary } from '../types/property-affairs'
import DashboardView from './DashboardView.vue'

const routerPush = vi.hoisted(() => vi.fn())

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('../services/http', () => ({
  http: { get: vi.fn() },
}))

function sessionFor(role: 'SUPER_ADMIN' | 'ADMIN' | 'VISITOR') {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = { id: 1, username: role.toLowerCase(), displayName: role, role }
  session.accessToken = 'test-token'
  return pinia
}

function affair(id: number, overrides: Partial<PropertyAffairSummary> = {}): PropertyAffairSummary {
  return {
    id,
    affairNo: `WY20260902${String(id).padStart(4, '0')}`,
    title: `后端顺序事项${id}`,
    category: '公共维修',
    priority: 'IMPORTANT',
    status: 'IN_PROGRESS',
    content: '跟进中',
    responsibleUserId: 2,
    responsibleSnapshot: `管理员${id}`,
    externalHandlerName: null,
    externalPhone: null,
    externalContact: null,
    completedAt: null,
    cancelledAt: null,
    createdBy: 1,
    updatedBy: 2,
    deletedAt: null,
    deletedBy: null,
    version: 1,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: `2026-09-02T0${id % 10}:00:00.000Z`,
    buildings: [],
    rooms: [],
    tenants: [],
    contracts: [],
    ...overrides,
  }
}

function dashboardData(propertyAffairs: PropertyAffairSummary[]) {
  return {
    roomSummary: { total: 0, operating: 0, occupancyRate: null, statusCounts: {}, rooms: [] },
    rentReminders: [],
    arrears: [],
    expiringContracts: [],
    longVacancyRooms: [],
    approvals: {},
    approvalRooms: [],
    monthlyMoveInCount: 0,
    monthlyCheckoutCount: 0,
    rentCollectionOverview: null,
    propertyAffairs,
  }
}

function mockDashboard(propertyAffairs: PropertyAffairSummary[]) {
  vi.mocked(http.get).mockImplementation(async (url) => {
    if (url === '/properties/buildings') return { data: { data: [] } }
    if (url === '/dashboard') return { data: { data: dashboardData(propertyAffairs) } }
    throw new Error(`unexpected endpoint ${url}`)
  })
}

describe('驾驶舱物业办事', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('游客完全不渲染物业办事区，也不发出额外办事请求', async () => {
    mockDashboard([affair(1)])

    const wrapper = mount(DashboardView, {
      global: { plugins: [sessionFor('VISITOR'), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.find('[data-test="dashboard-property-affairs"]').exists()).toBe(false)
    expect(vi.mocked(http.get).mock.calls.filter(([url]) => url === '/dashboard')).toHaveLength(2)
    expect(vi.mocked(http.get).mock.calls.some(([url]) => String(url).startsWith('/property-affairs'))).toBe(false)
    wrapper.unmount()
  })

  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('%s 按后端顺序展示至多八项并提供完整中文信息与详情跳转', async (role) => {
    const rows = [
      affair(9, {
        title: '电梯年度检修',
        priority: 'URGENT',
        status: 'PENDING',
        responsibleUserId: null,
        responsibleSnapshot: null,
        buildings: [{ id: 1, snapshotLabel: '旧1号楼', currentLabel: '1号楼', currentStatus: 'ACTIVE', available: true }],
        rooms: [{ id: 11, snapshotLabel: '旧1栋101', currentLabel: '1栋101', currentStatus: 'RENTED', available: true }],
        tenants: [{ id: 21, snapshotLabel: '旧承租人', currentLabel: '张三', currentStatus: 'ACTIVE', available: true }],
        contracts: [{ id: 31, snapshotLabel: '旧合同', currentLabel: 'HT-001', currentStatus: 'ACTIVE', available: true }],
        updatedAt: '2026-09-02T08:30:00.000Z',
      }),
      ...Array.from({ length: 8 }, (_, index) => affair(index + 1)),
    ]
    mockDashboard(rows)

    const wrapper = mount(DashboardView, {
      global: { plugins: [sessionFor(role), ElementPlus] },
    })
    await flushPromises()

    const section = wrapper.get('[data-test="dashboard-property-affairs"]')
    const renderedRows = section.findAll('[data-test="dashboard-affair-row"]')
    expect(renderedRows).toHaveLength(8)
    expect(renderedRows.map((row) => row.get('[data-test="dashboard-affair-title"]').text())).toEqual([
      '电梯年度检修',
      '后端顺序事项1',
      '后端顺序事项2',
      '后端顺序事项3',
      '后端顺序事项4',
      '后端顺序事项5',
      '后端顺序事项6',
      '后端顺序事项7',
    ])
    expect(section.text()).toContain('1号楼、1栋101、张三、HT-001')
    expect(section.text()).toContain('未指定')
    expect(section.text()).toContain('待办理')
    expect(section.text()).toContain('紧急')
    expect(section.text()).toContain('2026')
    expect(section.text()).not.toContain('PENDING')
    expect(section.text()).not.toContain('URGENT')
    expect(section.text()).not.toContain('???')
    expect(section.element.closest('.right-stack')).toBeNull()
    expect(wrapper.get('.todo-list').text()).not.toContain('电梯年度检修')
    expect(vi.mocked(http.get).mock.calls.some(([url]) => String(url).startsWith('/property-affairs'))).toBe(false)

    await renderedRows[0].trigger('click')
    expect(routerPush).toHaveBeenCalledWith({ name: 'property-affair-detail', params: { id: 9 } })
    wrapper.unmount()
  })

  it('管理员在没有事项时看到简洁中文空状态', async () => {
    mockDashboard([])

    const wrapper = mount(DashboardView, {
      global: { plugins: [sessionFor('ADMIN'), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.get('[data-test="dashboard-property-affairs"]').text()).toContain('暂无待办理的物业办事事项')
    wrapper.unmount()
  })
})
