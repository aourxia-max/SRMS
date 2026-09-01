import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getApprovalTaskSummary,
  type ApprovalTaskSummary,
} from '../services/approval-tasks'
import { useApprovalTasksStore } from './approval-tasks'

vi.mock('../services/approval-tasks', () => ({
  getApprovalTaskCounts: vi.fn(),
  getApprovalTaskSummary: vi.fn(),
}))

const summary: ApprovalTaskSummary = {
  counts: {
    contractChanges: 1,
    fixedRentRebates: 0,
    contractVoidRequests: 0,
    billAdjustments: 0,
    paymentRefunds: 0,
    paymentVoidRequests: 1,
    checkoutSettlements: 0,
    depositRefunds: 0,
    contractsTotal: 1,
    paymentsTotal: 1,
    checkoutsTotal: 0,
    total: 2,
  },
  items: [
    {
      id: 2,
      type: 'PAYMENT_VOID_REQUEST',
      label: '收款作废',
      businessNo: 'ZF002',
      contractId: 9,
      contractNo: 'HT002',
      roomId: 12,
      fullHouseNo: '1栋102',
      submittedAt: '2026-09-01T02:00:00.000Z',
    },
    {
      id: 1,
      type: 'CONTRACT_CHANGE',
      label: '合同变更',
      businessNo: 'BG001',
      contractId: 8,
      contractNo: 'HT001',
      roomId: 11,
      fullHouseNo: '1栋101',
      submittedAt: '2026-09-01T01:00:00.000Z',
    },
  ],
}

describe('统一待审批状态仓库', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('一次刷新同时保存红点数量和待审批明细，重置时一并清空', async () => {
    vi.mocked(getApprovalTaskSummary).mockResolvedValue(summary)
    const store = useApprovalTasksStore()

    await store.refresh()
    expect(store.counts).toEqual(summary.counts)
    expect(store.items).toEqual(summary.items)

    store.reset()
    expect(store.counts.total).toBe(0)
    expect(store.items).toEqual([])
  })
})
