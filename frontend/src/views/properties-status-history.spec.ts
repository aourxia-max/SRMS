// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'
import PropertiesView from './PropertiesView.vue'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))
vi.mock('../services/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

function sessionForAdmin() {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = { id: 1, username: 'admin', displayName: '管理员', role: 'ADMIN' }
  session.accessToken = 'test-token'
  return pinia
}

describe('房态历史状态展示', () => {
  it('将历史中的原状态和新状态显示为中文名称', async () => {
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === '/properties/buildings') return { data: { data: [] } }
      if (url === '/properties/rooms') {
        return { data: { data: [{ id: 7, buildingId: 1, fullHouseNo: '1栋101', houseNo: '101', floorNo: 1, roomStatus: 'EMPTY', building: { buildingNo: '1栋' } }] } }
      }
      if (url === '/properties/rooms/7/history') {
        return { data: { data: [{ fromStatus: 'EMPTY', toStatus: 'PENDING_MOVE_IN', changeReason: null, changedAt: '2026-08-21T10:00:00.000Z' }] } }
      }
      throw new Error(`unexpected request: ${String(url)}`)
    })

    const wrapper = mount(PropertiesView, { global: { plugins: [sessionForAdmin(), ElementPlus] } })
    await flushPromises()
    const historyButton = wrapper.findAll('button').find((button) => button.text().includes('历史'))
    await historyButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('空置')
    expect(wrapper.text()).toContain('待入住')
    expect(wrapper.text()).not.toContain('EMPTY')
    expect(wrapper.text()).not.toContain('PENDING_MOVE_IN')
    wrapper.unmount()
  })

  it('将房源列表中的住宅和商铺类型显示为中文', async () => {
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === '/properties/buildings') return { data: { data: [] } }
      if (url === '/properties/rooms') {
        return {
          data: {
            data: [
              { id: 7, fullHouseNo: '1栋101', floorNo: 1, roomType: 'RESIDENTIAL', roomStatus: 'EMPTY', building: { buildingNo: '1栋' } },
              { id: 8, fullHouseNo: '1栋102', floorNo: 1, roomType: 'SHOP', roomStatus: 'EMPTY', building: { buildingNo: '1栋' } },
            ],
          },
        }
      }
      throw new Error('unexpected request: ' + String(url))
    })

    const wrapper = mount(PropertiesView, { global: { plugins: [sessionForAdmin(), ElementPlus] } })
    await flushPromises()

    expect(wrapper.text()).toContain('住宅')
    expect(wrapper.text()).toContain('商铺')
    expect(wrapper.text()).not.toContain('RESIDENTIAL')
    expect(wrapper.text()).not.toContain('SHOP')
    wrapper.unmount()
  })
})