// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'
import RoomDetailView from './RoomDetailView.vue'

const routerPush = vi.hoisted(() => vi.fn())

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '11' } }),
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('../services/http', () => ({
  http: { get: vi.fn(), patch: vi.fn() },
}))

function adminPinia() {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = {
    id: 2,
    username: 'admin',
    displayName: '普通管理员',
    role: 'ADMIN',
  }
  session.accessToken = 'test-token'
  return pinia
}

function contract(id: number, contractNo: string, status: string) {
  return {
    id,
    contractNo,
    pricingMode: 'FIXED',
    status,
    startDate: '2026-08-01T00:00:00.000Z',
    endDate: '2027-07-31T00:00:00.000Z',
    monthlyRent: '2000.00',
    hasOverdueBill: false,
    members: [],
  }
}

describe('房源详情合同状态中文化', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(http.get).mockResolvedValue({
      data: {
        data: {
          focusContractId: 101,
          riskLabels: [],
          financial: null,
          room: {
            id: 11,
            fullHouseNo: '1栋603',
            houseNo: '603',
            floorNo: 6,
            area: '44.21',
            roomType: 'RESIDENTIAL',
            roomStatus: 'RENTED',
            decorationStatus: 'UNKNOWN',
            usageType: 'RESIDENCE',
            statusChangedAt: '2026-08-18T00:00:00.000Z',
            ownerName: null,
            ownerPhone: null,
            ownerRemark: null,
            remark: null,
            building: { id: 1, buildingNo: '1栋', buildingName: '1栋' },
            histories: [],
            contracts: [
              contract(101, 'HT202608180010', 'ACTIVE'),
              contract(100, 'HT202508180010', 'ENDED'),
            ],
          },
        },
      },
    })
  })

  it('当前合同和历史合同都使用统一中文状态', async () => {
    const wrapper = mount(RoomDetailView, {
      global: { plugins: [adminPinia(), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('履约中')
    expect(wrapper.text()).toContain('已结束')
    expect(wrapper.text()).not.toContain('???')
    wrapper.unmount()
  })
})
