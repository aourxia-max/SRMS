import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  getApprovalTaskSummary,
  type ApprovalTaskItem,
  type ApprovalTaskCounts,
} from '../services/approval-tasks'

function emptyCounts(): ApprovalTaskCounts {
  return {
    contractChanges: 0,
    fixedRentRebates: 0,
    contractVoidRequests: 0,
    billAdjustments: 0,
    paymentRefunds: 0,
    paymentVoidRequests: 0,
    checkoutSettlements: 0,
    depositRefunds: 0,
    contractsTotal: 0,
    paymentsTotal: 0,
    checkoutsTotal: 0,
    total: 0,
  }
}

export const useApprovalTasksStore = defineStore('approval-tasks', () => {
  const counts = ref<ApprovalTaskCounts>(emptyCounts())
  const items = ref<ApprovalTaskItem[]>([])
  let requestGeneration = 0
  let pollingTimer: number | null = null

  async function refresh() {
    const generation = ++requestGeneration
    try {
      const summary = await getApprovalTaskSummary()
      if (generation === requestGeneration) {
        counts.value = summary.counts
        items.value = summary.items
      }
    } catch {
      // 保留最近一次成功结果，短暂网络错误不应让提醒闪烁或清零。
    }
  }

  function stopPolling() {
    if (pollingTimer !== null) window.clearInterval(pollingTimer)
    pollingTimer = null
  }

  function startPolling() {
    stopPolling()
    pollingTimer = window.setInterval(() => void refresh(), 60_000)
  }

  function reset() {
    requestGeneration += 1
    stopPolling()
    counts.value = emptyCounts()
    items.value = []
  }

  return { counts, items, refresh, reset, startPolling, stopPolling }
})
