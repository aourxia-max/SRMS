import type { AxiosRequestConfig, AxiosResponse } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import * as routerModule from './index'

const { routes } = routerModule
const installCleanup = (routerModule as typeof routerModule & {
  installNavigationRequestCleanup?: (target: Router) => void
}).installNavigationRequestCleanup

function response(config: AxiosRequestConfig): AxiosResponse {
  return { data: {}, status: 200, statusText: 'OK', headers: {}, config: config as AxiosResponse['config'] }
}

describe('业务页面按需加载', () => {
  it('主要登录后页面使用异步路由组件', () => {
    const names = ['session', 'properties', 'tenants', 'contracts', 'contract-changes', 'payment-collect', 'payment-detail', 'rent-bills', 'checkout', 'finance']

    for (const name of names) {
      const route = routes.find((candidate) => candidate.name === name)
      expect(route, `缺少路由 ${name}`).toBeDefined()
      expect(route?.component, `路由 ${name} 应按需加载`).toBeTypeOf('function')
    }
  })

  it('首次直接打开深层页面时不取消应用级初始化 GET', async () => {
    setActivePinia(createPinia())
    const Page = defineComponent({ template: '<div />' })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/contracts', component: Page }],
    })
    expect(installCleanup).toBeTypeOf('function')
    installCleanup?.(router)

    let initialConfig: AxiosRequestConfig | undefined
    let finishInitial!: (value: AxiosResponse) => void
    const initialRequest = http.get('/application-bootstrap', {
      adapter: async (config) => {
        initialConfig = config
        return new Promise<AxiosResponse>((resolve) => { finishInitial = resolve })
      },
    })
    await vi.waitFor(() => expect(initialConfig).toBeDefined())

    await router.push('/contracts')

    expect(initialConfig?.signal?.aborted).toBe(false)
    finishInitial(response(initialConfig!))
    await initialRequest
  })

  it('延迟页面确认离开后才中止旧页面期间发起的 GET', async () => {
    setActivePinia(createPinia())
    const Page = defineComponent({ template: '<div />' })
    let resolveSlow!: (component: typeof Page) => void
    const slowComponent = new Promise<typeof Page>((resolve) => { resolveSlow = resolve })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Page },
        { path: '/slow', component: () => slowComponent },
      ],
    })
    expect(installCleanup).toBeTypeOf('function')
    installCleanup?.(router)
    await router.push('/')

    const navigation = router.push('/slow')
    await Promise.resolve()
    let captured: AxiosRequestConfig | undefined
    let finish!: (value: AxiosResponse) => void
    const request = http.get('/old-page-late-read', {
      adapter: async (config) => {
        captured = config
        return new Promise<AxiosResponse>((resolve) => { finish = resolve })
      },
    })
    await vi.waitFor(() => expect(captured).toBeDefined())
    expect(captured?.signal?.aborted).toBe(false)

    resolveSlow(Page)
    await navigation

    expect(captured?.signal?.aborted).toBe(true)
    finish(response(captured!))
    await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  })

  it('重定向回当前页或导航失败时不中止当前页请求', async () => {
    setActivePinia(createPinia())
    const Page = defineComponent({ template: '<div />' })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Page },
        { path: '/redirect', component: Page },
        { path: '/broken', component: () => Promise.reject(new Error('chunk failed')) },
      ],
    })
    expect(installCleanup).toBeTypeOf('function')
    installCleanup?.(router)
    router.beforeEach((to) => to.path === '/redirect' ? '/' : true)
    router.onError(() => undefined)
    await router.push('/')

    let redirectedConfig: AxiosRequestConfig | undefined
    let finishRedirected!: (value: AxiosResponse) => void
    const redirectedRequest = http.get('/still-current', {
      adapter: async (config) => {
        redirectedConfig = config
        return new Promise<AxiosResponse>((resolve) => { finishRedirected = resolve })
      },
    })
    await vi.waitFor(() => expect(redirectedConfig).toBeDefined())
    await router.push('/redirect')
    expect(redirectedConfig?.signal?.aborted).toBe(false)
    finishRedirected(response(redirectedConfig!))
    await redirectedRequest

    let failedConfig: AxiosRequestConfig | undefined
    let finishFailed!: (value: AxiosResponse) => void
    const failedRequest = http.get('/still-current-after-failure', {
      adapter: async (config) => {
        failedConfig = config
        return new Promise<AxiosResponse>((resolve) => { finishFailed = resolve })
      },
    })
    await vi.waitFor(() => expect(failedConfig).toBeDefined())
    await expect(router.push('/broken')).rejects.toThrow('chunk failed')
    expect(failedConfig?.signal?.aborted).toBe(false)
    finishFailed(response(failedConfig!))
    await failedRequest
  })
})
