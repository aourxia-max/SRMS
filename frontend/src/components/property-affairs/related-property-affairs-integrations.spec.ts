// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ContractDetailPanel from '../contracts/ContractDetailPanel.vue'
import * as api from '../../services/property-affairs'
import { http } from '../../services/http'
import { useSessionStore, type SessionUser } from '../../stores/session'
import type { ContractDetail } from '../../types/contracts'
import RoomDetailView from '../../views/RoomDetailView.vue'
import RelatedPropertyAffairs from './RelatedPropertyAffairs.vue'

vi.mock('../../services/property-affairs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/property-affairs')>()),
  listPropertyAffairs: vi.fn(),
}))

vi.mock('../../services/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const Page = defineComponent({ template: '<div />' })

function sessionFor(role: SessionUser['role']) {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = { id: 1, username: role.toLowerCase(), displayName: role, role }
  session.accessToken = 'test-token'
  session.initialized = true
  return pinia
}

function testRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Page },
      { path: '/properties/:id', name: 'room-detail', component: Page },
      { path: '/property-affairs', name: 'property-affairs', component: Page },
      { path: '/property-affairs/:id', name: 'property-affair-detail', component: Page },
    ],
  })
}

const roomDetail = {
  focusContractId: null,
  riskLabels: [],
  financial: null,
  room: {
    id: 44,
    fullHouseNo: '4栋401',
    houseNo: '401',
    floorNo: 4,
    area: '40.00',
    roomType: 'RESIDENTIAL',
    roomStatus: 'EMPTY',
    decorationStatus: 'UNKNOWN',
    usageType: 'RESIDENCE',
    statusChangedAt: '2026-09-01T00:00:00.000Z',
    ownerName: null,
    ownerPhone: null,
    ownerRemark: null,
    remark: null,
    building: { id: 4, buildingNo: '4栋', buildingName: '四号楼' },
    histories: [],
    contracts: [],
  },
}

const contract: ContractDetail = {
  id: 73,
  contractNo: 'HT202609020073',
  roomId: 44,
  room: { id: 44, fullHouseNo: '4栋401' },
  members: [{ memberRole: 'PRIMARY', tenant: { id: 21, name: '张三' } }],
  startDate: '2026-09-01',
  endDate: '2027-08-31',
  monthlyRent: '3000.00',
  depositRequired: '3000.00',
  paymentCycleMonths: 1,
  status: 'ACTIVE',
  pricingMode: 'FIXED',
  commissions: [],
}

describe('房源和合同详情接入关联物业办事', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.listPropertyAffairs).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 })
    vi.mocked(http.get).mockResolvedValue({ data: { data: roomDetail } })
  })

  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('房源详情为 %s 传入真实 room.id 并触发精确查询', async (role) => {
    const router = testRouter()
    await router.push('/properties/44')
    await router.isReady()
    const wrapper = mount(RoomDetailView, {
      global: { plugins: [sessionFor(role), router, ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.getComponent(RelatedPropertyAffairs).props('roomId')).toBe(44)
    expect(api.listPropertyAffairs).toHaveBeenCalledWith({ roomId: 44, page: 1, pageSize: 5 })
    wrapper.unmount()
  })

  it('房源详情对游客不渲染且不查询关联事项', async () => {
    const router = testRouter()
    await router.push('/properties/44')
    await router.isReady()
    const wrapper = mount(RoomDetailView, {
      global: { plugins: [sessionFor('VISITOR'), router, ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.findComponent(RelatedPropertyAffairs).exists()).toBe(false)
    expect(api.listPropertyAffairs).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('合同详情为 %s 传入真实 contract.id 并触发精确查询', async (role) => {
    const router = testRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(ContractDetailPanel, {
      props: { role, contract },
      global: { plugins: [sessionFor(role), router, ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.getComponent(RelatedPropertyAffairs).props('contractId')).toBe(73)
    expect(api.listPropertyAffairs).toHaveBeenCalledWith({ contractId: 73, page: 1, pageSize: 5 })
    wrapper.unmount()
  })

  it.each([
    ['游客', 'VISITOR' as const, contract],
    ['没有合同的管理员', 'ADMIN' as const, null],
  ])('%s 的合同详情不渲染且不查询关联事项', async (_case, role, value) => {
    const router = testRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(ContractDetailPanel, {
      props: { role, contract: value },
      global: { plugins: [sessionFor(role), router, ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.findComponent(RelatedPropertyAffairs).exists()).toBe(false)
    expect(api.listPropertyAffairs).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
