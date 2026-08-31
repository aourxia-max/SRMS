import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { paymentApi } from '../../services/payments'
import { useApprovalTasksStore } from '../../stores/approval-tasks'
import { useSessionStore } from '../../stores/session'
import PaymentReviewsView from './PaymentReviewsView.vue'
import { refundAdjustmentDecisions, refundableAllocationTotal } from './payment-review'

vi.mock('../../services/payments', () => ({
  paymentApi: {
    reviews: vi.fn(),
    reviewDetail: vi.fn(),
    approveReview: vi.fn(),
    rejectReview: vi.fn(),
  },
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/payments/reviews' }),
}))

describe('退款确认辅助规则', () => {
  it('仅为退款涉及账期的待确认或已确认且未撤销优惠生成决定', () => {
    const detail = {
      allocations: [{ paymentAllocation: { rentBill: { id: 11 } } }],
      payment: { adjustments: [
        { id: 1, rentBillId: 11, approvalStatus: 'PENDING', reversedByAdjustmentId: null },
        { id: 2, rentBillId: 11, approvalStatus: 'APPROVED', reversedByAdjustmentId: null },
        { id: 3, rentBillId: 12, approvalStatus: 'APPROVED', reversedByAdjustmentId: null },
        { id: 4, rentBillId: 11, approvalStatus: 'APPROVED', reversedByAdjustmentId: 99 },
      ] },
    }

    expect(refundAdjustmentDecisions(detail)).toEqual({
      1: { decision: 'REVERSE', keepReason: '' },
      2: { decision: 'REVERSE', keepReason: '' },
    })
  })

  it('退款默认金额是当前有效分配合计', () => {
    expect(refundableAllocationTotal([
      { effectiveAmount: '100.25' },
      { effectiveAmount: '20.00' },
    ])).toBe('120.25')
  })
})

describe('退款作废审批后的待处理数量', () => {
  const review = {
    id: 72,
    type: 'REFUND' as const,
    requestNo: 'TK202609010001',
    receiptNo: 'SK202609010001',
    amount: '100.00',
    submittedAt: '2026-09-01T08:00:00.000Z',
    status: 'PENDING',
    contract: {
      id: 8,
      contractNo: 'HT202609010001 | 1栋101 | 张三',
      room: { id: 1, fullHouseNo: '1栋101' },
    },
    tenant: { id: 1, name: '张三', phone: '13800000000' },
  }
  const detail = {
    id: 72,
    approvalStatus: 'PENDING',
    refundAmount: '100.00',
    submittedAt: review.submittedAt,
    reason: '重复收款',
    allocations: [],
    payment: { amount: '100.00', adjustments: [], allocations: [] },
  }
  const approvalRefresh = vi.fn().mockResolvedValue(undefined)

  async function mountView() {
    const pinia = createPinia()
    const session = useSessionStore(pinia)
    session.user = { id: 1, username: 'root', displayName: '超级管理员', role: 'SUPER_ADMIN' }
    session.accessToken = 'test-token'
    vi.spyOn(useApprovalTasksStore(pinia), 'refresh').mockImplementation(approvalRefresh)
    const wrapper = mount(PaymentReviewsView, {
      global: {
        plugins: [pinia, ElementPlus],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    vi.clearAllMocks()
    approvalRefresh.mockClear()
    vi.mocked(paymentApi.reviews).mockResolvedValue([review] as never)
    vi.mocked(paymentApi.reviewDetail).mockResolvedValue(detail)
    vi.mocked(paymentApi.approveReview).mockResolvedValue({})
    vi.mocked(paymentApi.rejectReview).mockResolvedValue({})
  })

  it('确认申请并重载队列后立即刷新数量', async () => {
    const wrapper = await mountView()
    await wrapper.get('.queue-item').trigger('click')
    await flushPromises()
    await wrapper.findAll('.review-actions button')[1].trigger('click')
    await flushPromises()

    expect(paymentApi.approveReview).toHaveBeenCalledWith('REFUND', 72, [])
    expect(approvalRefresh).toHaveBeenCalledTimes(1)
  })

  it('确认接口失败时不刷新数量', async () => {
    vi.mocked(paymentApi.approveReview).mockRejectedValueOnce(new Error('确认失败'))
    const wrapper = await mountView()
    await wrapper.get('.queue-item').trigger('click')
    await flushPromises()

    await expect(
      (wrapper.vm as unknown as { approve: () => Promise<void> }).approve(),
    ).rejects.toThrow('确认失败')

    expect(approvalRefresh).not.toHaveBeenCalled()
  })
})
