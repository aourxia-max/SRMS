// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { useSessionStore } from '../stores/session'
import PropertiesView from './PropertiesView.vue'

vi.mock('../services/http', () => ({
  http: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

type RoomResponse = { data: { data: Array<Record<string, unknown>> } }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

async function mountProperties(path: string) {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = { id: 1, username: 'admin', displayName: '管理员', role: 'ADMIN' }
  session.accessToken = 'test-token'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/properties', name: 'properties', component: PropertiesView }],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(PropertiesView, { global: { plugins: [pinia, router, ElementPlus] } })
  return { wrapper, router }
}

describe('房源页楼栋查询联动', () => {
  beforeEach(() => vi.clearAllMocks())

  it('消费初始 buildingId 并在同实例查询切换时仅保留最新房源结果', async () => {
    const first = deferred<RoomResponse>()
    const second = deferred<RoomResponse>()
    const cleared = deferred<RoomResponse>()
    vi.mocked(http.get).mockImplementation((url, config) => {
      if (url === '/properties/buildings') return Promise.resolve({ data: { data: [] } })
      if (url !== '/properties/rooms') return Promise.reject(new Error(`unexpected request: ${String(url)}`))
      const buildingId = config?.params?.buildingId
      if (buildingId === 12) return first.promise
      if (buildingId === 13) return second.promise
      if (buildingId === undefined) return cleared.promise
      return Promise.reject(new Error(`unexpected buildingId: ${String(buildingId)}`))
    })

    const { wrapper, router } = await mountProperties('/properties?buildingId=12')
    await flushPromises()
    expect(http.get).toHaveBeenCalledWith('/properties/rooms', {
      params: { keyword: undefined, buildingId: 12, status: undefined },
    })

    await router.push('/properties?buildingId=13')
    await flushPromises()
    expect(http.get).toHaveBeenCalledWith('/properties/rooms', {
      params: { keyword: undefined, buildingId: 13, status: undefined },
    })
    second.resolve({ data: { data: [{ id: 13, fullHouseNo: '13栋101', floorNo: 1, roomType: 'RESIDENTIAL', roomStatus: 'EMPTY', building: { buildingNo: '13栋' } }] } })
    await flushPromises()
    expect(wrapper.text()).toContain('13栋101')

    first.resolve({ data: { data: [{ id: 12, fullHouseNo: '12栋101', floorNo: 1, roomType: 'RESIDENTIAL', roomStatus: 'EMPTY', building: { buildingNo: '12栋' } }] } })
    await flushPromises()
    expect(wrapper.text()).toContain('13栋101')
    expect(wrapper.text()).not.toContain('12栋101')

    await router.push('/properties?buildingId=非法值')
    await flushPromises()
    expect(http.get).toHaveBeenCalledWith('/properties/rooms', {
      params: { keyword: undefined, buildingId: undefined, status: undefined },
    })
    cleared.resolve({ data: { data: [] } })
    await flushPromises()
    wrapper.unmount()
  })
})
