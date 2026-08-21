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
})
