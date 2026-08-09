import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { routes } from './index'

describe('收款管理路由', () => {
  it('兼容旧入口并保留合同筛选条件', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })

    await router.push('/payments?contractId=18')
    await router.isReady()

    expect(router.currentRoute.value.fullPath).toBe('/payments/collect?contractId=18')
    expect(router.currentRoute.value.name).toBe('payment-collect')
  })

  it.each([
    ['/payments/collect', 'payment-collect'],
    ['/payments/detail/42', 'payment-detail'],
    ['/payments/reviews', 'payment-reviews'],
  ])('解析 %s 为 %s', async (path, name) => {
    const router = createRouter({ history: createMemoryHistory(), routes })

    await router.push(path)
    await router.isReady()

    expect(router.currentRoute.value.name).toBe(name)
  })
})
