// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'
import DashboardView from './DashboardView.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('../services/http', () => ({
  http: { get: vi.fn() },
}))

describe('驾驶舱楼栋房态图可视高度', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === '/properties/buildings') return { data: { data: [] } }
      if (url === '/dashboard') {
        return {
          data: {
            data: {
              roomSummary: {
                total: 1,
                operating: 1,
                occupancyRate: 100,
                statusCounts: { RENTED: 1 },
                rooms: [
                  {
                    id: 11,
                    fullHouseNo: '1栋601',
                    houseNo: '601',
                    floorNo: 6,
                    roomStatus: 'RENTED',
                    usageType: 'RESIDENCE',
                    building: { id: 1, buildingNo: '1栋', buildingName: '一号楼' },
                  },
                ],
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
            },
          },
        }
      }
      return { data: { data: [] } }
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('高度提高50%但不强制撑高，房间卡片尺寸保持不变', async () => {
    const pinia = createPinia()
    const session = useSessionStore(pinia)
    session.user = {
      id: 1,
      username: 'root',
      displayName: '超级管理员',
      role: 'SUPER_ADMIN',
    }
    session.accessToken = 'test-token'
    const wrapper = mount(DashboardView, {
      attachTo: document.body,
      global: { plugins: [pinia, ElementPlus] },
    })
    await flushPromises()
    const map = wrapper.get('[data-test="building-map"]').element
    const floor = wrapper.get('[data-test="floor-name"]').element
    const room = wrapper.get('[data-test="room-cell"]').element

    expect(getComputedStyle(map).maxHeight).toBe('645px')
    expect(getComputedStyle(map).minHeight).not.toBe('645px')
    expect(getComputedStyle(floor).minHeight).toBe('76px')
    expect(getComputedStyle(room).minHeight).toBe('76px')
    wrapper.unmount()
  })
})
