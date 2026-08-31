import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getApprovalTaskCounts, type ApprovalTaskCounts } from '../services/approval-tasks'
import { useApprovalTasksStore } from './approval-tasks'

vi.mock('../services/approval-tasks', () => ({
  getApprovalTaskCounts: vi.fn(),
}))

const getCountsMock = vi.mocked(getApprovalTaskCounts)

const firstCounts: ApprovalTaskCounts = {
  contractChanges: 1,
  fixedRentRebates: 2,
  contractVoidRequests: 3,
  billAdjustments: 4,
  paymentRefunds: 5,
  paymentVoidRequests: 6,
  checkoutSettlements: 7,
  depositRefunds: 8,
  contractsTotal: 6,
  paymentsTotal: 15,
  checkoutsTotal: 15,
  total: 36,
}

const latestCounts: ApprovalTaskCounts = {
  contractChanges: 9,
  fixedRentRebates: 8,
  contractVoidRequests: 7,
  billAdjustments: 6,
  paymentRefunds: 5,
  paymentVoidRequests: 4,
  checkoutSettlements: 3,
  depositRefunds: 2,
  contractsTotal: 24,
  paymentsTotal: 15,
  checkoutsTotal: 5,
  total: 44,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useApprovalTasksStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getCountsMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('刷新成功后保存服务端返回的完整数量', async () => {
    getCountsMock.mockResolvedValue(firstCounts)
    const store = useApprovalTasksStore()

    await store.refresh()

    expect(store.counts).toEqual(firstCounts)
  })

  it('较晚发起的请求先返回时不会被旧响应覆盖', async () => {
    const older = deferred<ApprovalTaskCounts>()
    const newer = deferred<ApprovalTaskCounts>()
    getCountsMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const store = useApprovalTasksStore()

    const olderRefresh = store.refresh()
    const newerRefresh = store.refresh()
    newer.resolve(latestCounts)
    await newerRefresh
    older.resolve(firstCounts)
    await olderRefresh

    expect(store.counts).toEqual(latestCounts)
  })

  it('后续刷新失败时保留最近一次成功数量', async () => {
    getCountsMock.mockResolvedValueOnce(firstCounts).mockRejectedValueOnce(new Error('网络暂时不可用'))
    const store = useApprovalTasksStore()

    await store.refresh()
    await store.refresh()

    expect(store.counts).toEqual(firstCounts)
  })

  it('重置时清零、停止轮询并阻止在途响应恢复旧登录数据', async () => {
    vi.useFakeTimers()
    const pending = deferred<ApprovalTaskCounts>()
    getCountsMock.mockReturnValue(pending.promise)
    const store = useApprovalTasksStore()
    store.startPolling()
    const refresh = store.refresh()

    store.reset()
    pending.resolve(firstCounts)
    await refresh

    expect(store.counts.total).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('每六十秒触发一次刷新且重复启动不会叠加计时器', async () => {
    vi.useFakeTimers()
    getCountsMock.mockResolvedValue(firstCounts)
    const store = useApprovalTasksStore()

    store.startPolling()
    store.startPolling()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(getCountsMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
  })
})
