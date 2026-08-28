// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRentBill, fetchRentBills, http } from '../services/http'
import RentBillsView from './RentBillsView.vue'

const routerPush = vi.hoisted(() => vi.fn())
const routeQuery = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeQuery.value }),
  useRouter: () => ({ push: routerPush }),
}))
vi.mock('../services/http', () => ({
  http: { get: vi.fn() },
  fetchRentBills: vi.fn(),
  fetchRentBill: vi.fn(),
}))

describe('租金账单关联收款', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeQuery.value = {}
  })

  it('从账单详情登记收款时同时传递合同和账单编号', async () => {
    vi.mocked(http.get).mockResolvedValue({ data: { data: [] } })
    vi.mocked(fetchRentBills).mockResolvedValue({
      items: [
        {
          id: 42,
          billNo: 'ZD-42',
          room: { id: 8, fullHouseNo: '1栋101', buildingId: 1, buildingName: '一号楼' },
          contract: { id: 7, contractNo: 'HT-007' },
          tenant: { id: 9, name: '张三' },
          periodStart: '2026-08-01',
          periodEnd: '2026-08-31',
          dueDate: '2026-08-01',
          baseRentAmount: '1000.00',
          rentFreeAmount: '0.00',
          discountAmount: '0.00',
          payableAmount: '1000.00',
          receivedAmount: '0.00',
          outstandingAmount: '1000.00',
          status: 'PENDING',
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
      summary: { payable: '1000.00', received: '0.00', outstanding: '1000.00', count: 1, overdueCount: 0 },
    })
    vi.mocked(fetchRentBill).mockResolvedValue({
      id: 42,
      billNo: 'ZD-42',
      room: { id: 8, fullHouseNo: '1栋101', buildingId: 1, buildingName: '一号楼' },
      contract: { id: 7, contractNo: 'HT-007' },
      tenant: { id: 9, name: '张三' },
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      dueDate: '2026-08-01',
      baseRentAmount: '1000.00',
      rentFreeAmount: '0.00',
      discountAmount: '0.00',
      payableAmount: '1000.00',
      receivedAmount: '0.00',
      outstandingAmount: '1000.00',
      status: 'PENDING',
      adjustments: [],
      allocations: [],
      prepaymentTransactions: [],
    })
    const wrapper = mount(RentBillsView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text().includes('查看详情'))!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text().includes('登记收款'))!.trigger('click')

    expect(routerPush).toHaveBeenCalledWith({
      path: '/payments/collect',
      query: { contractId: 7, rentBillId: 42 },
    })
    wrapper.unmount()
  })
  it('从合法 rentBillId 查询参数直接打开现有账单详情', async () => {
    routeQuery.value = { rentBillId: '42' }
    vi.mocked(http.get).mockResolvedValue({ data: { data: [] } })
    vi.mocked(fetchRentBills).mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
      summary: { payable: '0.00', received: '0.00', outstanding: '0.00', count: 0, overdueCount: 0 },
    })
    vi.mocked(fetchRentBill).mockResolvedValue({
      id: 42,
      billNo: 'ZD-42',
      room: { id: 8, fullHouseNo: '1栋101', buildingId: 1, buildingName: '一号楼' },
      contract: { id: 7, contractNo: 'HT-007' },
      tenant: { id: 9, name: '张三' },
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      dueDate: '2026-08-01',
      baseRentAmount: '1000.00',
      rentFreeAmount: '0.00',
      discountAmount: '0.00',
      payableAmount: '1000.00',
      receivedAmount: '0.00',
      outstandingAmount: '1000.00',
      status: 'PENDING',
      adjustments: [],
      allocations: [],
      prepaymentTransactions: [],
    })

    const wrapper = mount(RentBillsView, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(fetchRentBill).toHaveBeenCalledWith(42)
    expect(wrapper.text()).toContain('ZD-42')
    wrapper.unmount()
  })

  it.each(['0', '-1', '1.5', 'abc', ' 42 '])('无效 rentBillId=%s 不触发账单详情请求', async (rentBillId) => {
    routeQuery.value = { rentBillId }
    vi.mocked(http.get).mockResolvedValue({ data: { data: [] } })
    vi.mocked(fetchRentBills).mockResolvedValue({
      items: [], page: 1, pageSize: 20, total: 0,
      summary: { payable: '0.00', received: '0.00', outstanding: '0.00', count: 0, overdueCount: 0 },
    })

    const wrapper = mount(RentBillsView, { global: { plugins: [ElementPlus] } })
    await flushPromises()

    expect(fetchRentBill).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
