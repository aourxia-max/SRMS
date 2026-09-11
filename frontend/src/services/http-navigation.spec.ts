import type { AxiosRequestConfig, AxiosResponse } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import * as httpModule from './http'

type NavigationHttpModule = typeof httpModule & {
  cancelPendingReadRequests?: () => void
}

function response(config: AxiosRequestConfig): AxiosResponse {
  return {
    data: {},
    status: 200,
    statusText: 'OK',
    headers: {},
    config: config as AxiosResponse['config'],
  }
}

describe('路由切换请求清理', () => {
  it('中止尚未完成的 GET 请求', async () => {
    let captured: AxiosRequestConfig | undefined
    let finish!: (value: AxiosResponse) => void
    const pending = new Promise<AxiosResponse>((resolve) => { finish = resolve })
    const request = httpModule.http.get('/slow', {
      adapter: async (config) => {
        captured = config
        return pending
      },
    })
    await vi.waitFor(() => expect(captured).toBeDefined())

    const cancel = (httpModule as NavigationHttpModule).cancelPendingReadRequests
    expect(cancel).toBeTypeOf('function')
    cancel?.()

    expect(captured?.signal?.aborted).toBe(true)
    finish(response(captured!))
    await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  })

  it('已经完成的 GET 请求不会在后续切页时被中止', async () => {
    let captured: AxiosRequestConfig | undefined
    await httpModule.http.get('/done', {
      adapter: async (config) => {
        captured = config
        return response(config)
      },
    })

    const cancel = (httpModule as NavigationHttpModule).cancelPendingReadRequests
    expect(cancel).toBeTypeOf('function')
    cancel?.()

    expect(captured?.signal?.aborted).toBe(false)
  })

  it('不中止 POST 等写入请求', async () => {
    let captured: AxiosRequestConfig | undefined
    const request = httpModule.http.post('/submit', {}, {
      adapter: async (config) => {
        captured = config
        return response(config)
      },
    })
    await request

    const cancel = (httpModule as NavigationHttpModule).cancelPendingReadRequests
    cancel?.()

    expect(captured?.signal).toBeUndefined()
  })

  it('已释放的内部 GET 信号被重试时会重新登记', async () => {
    let firstSignal: AxiosRequestConfig['signal']
    await httpModule.http.get('/first-attempt', {
      adapter: async (config) => {
        firstSignal = config.signal
        return response(config)
      },
    })
    let retried: AxiosRequestConfig | undefined
    let finishRetried!: (value: AxiosResponse) => void
    const retriedRequest = httpModule.http.get('/retried', {
      signal: firstSignal,
      adapter: async (config) => {
        retried = config
        return new Promise<AxiosResponse>((resolve) => { finishRetried = resolve })
      },
    })
    await vi.waitFor(() => expect(retried).toBeDefined())

    ;(httpModule as NavigationHttpModule).cancelPendingReadRequests?.()

    expect(retried?.signal).not.toBe(firstSignal)
    expect(retried?.signal?.aborted).toBe(true)
    finishRetried(response(retried!))
    await expect(retriedRequest).rejects.toMatchObject({ code: 'ERR_CANCELED' })
  })

  it('GET 在响应释放后发生切页，不会在稍后的登录续期重试中复活', async () => {
    let releasedSignal: AxiosRequestConfig['signal']
    await httpModule.http.get('/received-401', {
      adapter: async (config) => {
        releasedSignal = config.signal
        return response(config)
      },
    })

    ;(httpModule as NavigationHttpModule).cancelPendingReadRequests?.()
    let retryAdapterCalled = false
    const retry = httpModule.http.get('/retry-after-navigation', {
      signal: releasedSignal,
      adapter: async (config) => {
        retryAdapterCalled = true
        return response(config)
      },
    })

    await expect(retry).rejects.toMatchObject({ code: 'ERR_CANCELED' })
    expect(retryAdapterCalled).toBe(false)
  })
})
