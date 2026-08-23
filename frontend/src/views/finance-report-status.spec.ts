// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import FinanceView from './FinanceView.vue'

vi.mock('../services/http', () => ({
  http: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

const billStatuses = ['PENDING', 'PARTIAL', 'PAID', 'OVERDUE', 'VOIDED', 'REFUNDED']

function mockFinanceResponses() {
  vi.mocked(http.get).mockImplementation(async (url) => {
    if (url === '/finance/overview') return { data: { data: { depositBalanceTotal: '10000.00' } } }
    if (url === '/finance/rent-collection') {
      return {
        data: {
          data: {
            rows: billStatuses.map((status, index) => ({
              billNo: 'BILL-' + index,
              contractNo: 'HT-' + index,
              houseNo: '1栋10' + index,
              tenantName: '测试租户',
              originalReceivable: '1000.00',
              concessionAmount: '0.00',
              netReceivable: '1000.00',
              validReceived: '0.00',
              outstanding: '1000.00',
              status,
            })),
            total: {
              originalReceivable: '6000.00',
              concessionAmount: '0.00',
              netReceivable: '6000.00',
              validReceived: '0.00',
              outstanding: '6000.00',
            },
            collectionRate: '0.00',
          },
        },
      }
    }
    if (url === '/finance/cash-flows') return { data: { data: { flows: [], inflow: '0.00', outflow: '0.00', netCashFlow: '0.00' } } }
    if (url === '/commissions') return { data: { data: [] } }
    if (url === '/contracts') return { data: { data: [] } }
    if (url === '/finance/export-tasks') return { data: { data: [] } }
    return { data: { data: {} } }
  })
}

describe('财务报表账单状态中文显示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFinanceResponses()
  })

  it('displays all six rent bill statuses with Chinese labels', async () => {
    const wrapper = mount(FinanceView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('待支付')
    expect(text).toContain('部分支付')
    expect(text).toContain('已支付')
    expect(text).toContain('已逾期')
    expect(text).toContain('已作废')
    expect(text).toContain('已退款')
    for (const status of billStatuses) expect(text).not.toContain(status)
    wrapper.unmount()
  })

  it('displays the current deposit balance total from the protected overview API', async () => {
    const wrapper = mount(FinanceView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(http.get).toHaveBeenCalledWith('/finance/overview')
    expect(wrapper.text()).toContain('押金余额总额')
    expect(wrapper.text()).toContain('￥10,000.00')
    expect(wrapper.text()).toContain('当前实际保管押金')
    wrapper.unmount()
  })
})