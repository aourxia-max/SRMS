import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import PaymentRecordList from '../../components/payments/PaymentRecordList.vue'
import PaymentDetailView from './PaymentDetailView.vue'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
}))

vi.mock('../../services/payments', () => ({
  paymentApi: {
    list: mocks.list,
    detail: mocks.detail,
    downloadProof: vi.fn(),
    edit: vi.fn(),
    submitRefund: vi.fn(),
    submitVoid: vi.fn(),
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

async function mountView() {
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
    global: { plugins: [createPinia(), router, ElementPlus] },
  })
  await flushPromises()
  return wrapper
}

describe('PaymentDetailView pagination', () => {
  beforeEach(() => {
    mocks.list.mockReset()
    mocks.detail.mockReset()
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
})
