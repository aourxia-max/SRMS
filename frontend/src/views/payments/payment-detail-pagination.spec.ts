import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import PaymentRecordList from '../../components/payments/PaymentRecordList.vue'
import PaymentDetailView from './PaymentDetailView.vue'
import { useApprovalTasksStore } from '../../stores/approval-tasks'
import { useSessionStore } from '../../stores/session'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  submitRefund: vi.fn(),
  submitVoid: vi.fn(),
}))

vi.mock('../../services/payments', () => ({
  paymentApi: {
    list: mocks.list,
    detail: mocks.detail,
    downloadProof: vi.fn(),
    edit: vi.fn(),
    submitRefund: mocks.submitRefund,
    submitVoid: mocks.submitVoid,
    approveAdjustment: vi.fn(),
    rejectAdjustment: vi.fn(),
  },
}))

const row = (id: number) => ({
  id,
  receiptNo: `SK-${id}`,
  receiptType: 'FORMAL',
  paymentCategory: 'RENT',
  paymentDate: '2026-08-04',
  amount: '570.00',
  method: 'BANK_TRANSFER',
  status: 'CONFIRMED',
  contract: {
    id: 7,
    contractNo: 'HT202608040001 | 1栋201 | 张三',
    room: { id: 21, fullHouseNo: '1栋201' },
  },
  tenant: { id: 9, name: '张三' },
})

const detail = {
  ...row(81),
  externalReference: null,
  remark: null,
  operator: null,
  metrics: {
    receivedAmount: '570.00',
    confirmedAdjustmentAmount: '0.00',
    prepaymentAmount: '0.00',
    coveredBillCount: 0,
  },
  allocations: [],
  adjustments: [],
  prepayments: [],
  files: [],
  refunds: [],
  voidRequests: [],
  operationLogs: [],
  receipt: {},
}

const approvalRefresh = vi.fn().mockResolvedValue(undefined)

async function mountView() {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = { id: 2, username: 'admin', displayName: '管理员', role: 'ADMIN' }
  session.accessToken = 'test-token'
  vi.spyOn(useApprovalTasksStore(pinia), 'refresh').mockImplementation(approvalRefresh)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/payments/detail/:id?', component: PaymentDetailView },
      { path: '/payments/collect', component: { template: '<div />' } },
      { path: '/payments/reviews', component: { template: '<div />' } },
    ],
  })
  await router.push('/payments/detail')
  await router.isReady()
  const wrapper = mount(PaymentDetailView, {
    global: { plugins: [pinia, router, ElementPlus] },
  })
  await flushPromises()
  return wrapper
}

describe('PaymentDetailView pagination', () => {
  beforeEach(() => {
    mocks.list.mockReset()
    mocks.detail.mockReset()
    mocks.submitRefund.mockReset().mockResolvedValue({})
    mocks.submitVoid.mockReset().mockResolvedValue({})
    approvalRefresh.mockClear()
    mocks.list
      .mockResolvedValueOnce({ items: [row(81)], page: 1, pageSize: 10, total: 21 })
      .mockResolvedValueOnce({ items: [row(71)], page: 2, pageSize: 10, total: 21 })
      .mockResolvedValueOnce({ items: [row(81)], page: 1, pageSize: 10, total: 21 })
    mocks.detail.mockResolvedValue(detail)
  })

  it('loads ten records, resets searches to page one and keeps the open detail while paging', async () => {
    const wrapper = await mountView()

    expect(mocks.list).toHaveBeenNthCalledWith(1, { page: 1, pageSize: 10 })
    expect(mocks.detail).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('SK-81')

    wrapper.findComponent(PaymentRecordList).vm.$emit('page-change', 2)
    await flushPromises()

    expect(mocks.list).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 10 })
    expect(mocks.detail).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('SK-81')

    const searchButton = wrapper.findAll('button').find((button) => button.text() === '查询')
    await searchButton!.trigger('click')
    await flushPromises()

    expect(mocks.list).toHaveBeenNthCalledWith(3, { page: 1, pageSize: 10 })
    expect(mocks.detail).toHaveBeenCalledTimes(1)
  })

  it('提交退款或作废申请成功后立即刷新统一待审批数量', async () => {
    const wrapper = await mountView()
    const view = wrapper.vm as unknown as {
      refund: { refundAmount: string; refundDate: string; refundMethod: string; reason: string; allocations: Record<number, string> }
      voidReason: string
      submitRefund: () => Promise<void>
      submitVoid: () => Promise<void>
    }

    view.refund.refundAmount = '100.00'
    view.refund.reason = '重复收款'
    await view.submitRefund()
    view.voidReason = '票据录入错误'
    await view.submitVoid()

    expect(mocks.submitRefund).toHaveBeenCalledTimes(1)
    expect(mocks.submitVoid).toHaveBeenCalledTimes(1)
    expect(approvalRefresh).toHaveBeenCalledTimes(2)
  })

  it('退款申请提交失败时不刷新待审批数量', async () => {
    mocks.submitRefund.mockRejectedValueOnce(new Error('提交失败'))
    const wrapper = await mountView()
    const view = wrapper.vm as unknown as {
      refund: { refundAmount: string; reason: string }
      submitRefund: () => Promise<void>
    }
    view.refund.refundAmount = '100.00'
    view.refund.reason = '重复收款'

    await expect(view.submitRefund()).rejects.toThrow('提交失败')

    expect(approvalRefresh).not.toHaveBeenCalled()
  })

  it('shows checkout supplemental category and inspection deduction in Chinese', async () => {
    const special = {
      ...detail,
      paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
      allocations: [{
        id: 201,
        allocationOrder: 1,
        allocationType: 'AUTO_OLDEST_FIRST',
        allocatedAmount: '100.00',
        reversedAmount: '0.00',
        effectiveAmount: '100.00',
        bill: { id: 91, billCategory: 'CHECKOUT_SUPPLEMENTAL', periodSeq: 0, outstandingAmount: '0.00' },
      }],
    }
    mocks.list.mockReset()
    mocks.detail.mockReset()
    mocks.list.mockResolvedValue({ items: [{ ...row(81), paymentCategory: 'CHECKOUT_SUPPLEMENTAL' }], page: 1, pageSize: 10, total: 1 })
    mocks.detail.mockResolvedValue(special)

    const wrapper = await mountView()

    expect(wrapper.text()).toContain('退租补收')
    expect(wrapper.text()).toContain('验房扣款')
    expect(wrapper.text()).not.toContain('第 0 期')
  })


  it('shows the automatic contract deposit method in Chinese', async () => {
    const automaticDeposit = {
      ...detail,
      paymentCategory: 'DEPOSIT',
      method: 'SYSTEM_AUTO',
    }
    mocks.list.mockReset()
    mocks.detail.mockReset()
    mocks.list.mockResolvedValue({
      items: [{ ...row(81), paymentCategory: 'DEPOSIT', method: 'SYSTEM_AUTO' }],
      page: 1,
      pageSize: 10,
      total: 1,
    })
    mocks.detail.mockResolvedValue(automaticDeposit)

    const wrapper = await mountView()

    expect(wrapper.text()).toContain('系统自动入账')
    expect(wrapper.text()).not.toContain('SYSTEM_AUTO')
  })

  it('keeps the contract-correction marker visible in the on-screen and printable receipt', async () => {
    const print = vi.fn()
    Object.defineProperty(window, 'print', { configurable: true, value: print })

    mocks.list.mockReset()
    mocks.detail.mockReset()
    mocks.list.mockResolvedValue({
      items: [{ ...row(81), status: 'FULLY_REFUNDED' }],
      page: 1,
      pageSize: 10,
      total: 1,
    })
    mocks.detail.mockResolvedValue({
      ...detail,
      status: 'FULLY_REFUNDED',
      correctionProvenance: {
        source: 'CONTRACT_VOID',
        displayText: '\u56e0\u5408\u540c\u7ea0\u9519\u5df2\u51b2\u9500',
      },
    })

    try {
      const wrapper = await mountView()
      const marker = wrapper.get('[data-testid="contract-correction-marker"]')

      expect(marker.isVisible()).toBe(true)
      expect(marker.text()).toBe('\u56e0\u5408\u540c\u7ea0\u9519\u5df2\u51b2\u9500')
      expect(marker.element.closest('.printable-receipt')).not.toBeNull()

      const printButton = wrapper.findAll('button')
        .find((button) => button.text() === '\u6253\u5370\u7968\u636e')
      await printButton!.trigger('click')

      expect(print).toHaveBeenCalledTimes(1)
    } finally {
      Reflect.deleteProperty(window, 'print')
    }
  })

  it('does not show the contract-correction marker for an ordinary full refund', async () => {
    mocks.list.mockReset()
    mocks.detail.mockReset()
    mocks.list.mockResolvedValue({
      items: [{ ...row(81), status: 'FULLY_REFUNDED' }],
      page: 1,
      pageSize: 10,
      total: 1,
    })
    mocks.detail.mockResolvedValue({
      ...detail,
      status: 'FULLY_REFUNDED',
      correctionProvenance: null,
    })

    const wrapper = await mountView()

    expect(wrapper.text()).not.toContain('\u56e0\u5408\u540c\u7ea0\u9519\u5df2\u51b2\u9500')
  })
})
