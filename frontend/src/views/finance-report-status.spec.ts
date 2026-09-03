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

function mockFinanceResponses(depositTotals = ['10000.00']) {
  let overviewIndex = 0
  vi.mocked(http.get).mockImplementation(async (url) => {
    if (url === '/finance/overview') {
      const depositBalanceTotal = depositTotals[Math.min(overviewIndex, depositTotals.length - 1)]
      overviewIndex += 1
      return { data: { data: { depositBalanceTotal } } }
    }
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
              concessionAmount: index === 0 ? '200.00' : '0.00',
              netReceivable: index === 0 ? '800.00' : '1000.00',
              validReceived: '0.00',
              outstanding: index === 0 ? '800.00' : '1000.00',
              status,
            })),
            total: {
              originalReceivable: '6000.00',
              concessionAmount: '200.00',
              netReceivable: '5800.00',
              validReceived: '0.00',
              outstanding: '5800.00',
            },
            collectionRate: '0.00',
          },
        },
      }
    }
    if (url === '/finance/cash-flows') return { data: { data: { flows: [], inflow: '0.00', outflow: '0.00', netCashFlow: '0.00', rentAndDepositReceivedTotal: '3000.00', operatingIncome: '200.00' } } }
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

  it('refreshes deposit and rent metrics when the finance page regains focus after a refund', async () => {
    mockFinanceResponses(['10000.00', '9100.00'])
    const wrapper = mount(FinanceView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('￥10,000.00')

    window.dispatchEvent(new Event('focus'))
    await flushPromises()

    expect(wrapper.text()).toContain('￥9,100.00')
    expect(wrapper.text()).not.toContain('￥10,000.00')
    wrapper.unmount()
  })

  it('displays the rent concession returned by the finance API in the KPI and bill row', async () => {
    const wrapper = mount(FinanceView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.find('.metrics').text()).toContain('优惠减免￥200.00')
    expect(wrapper.find('.el-table').text()).toContain('￥200.00')
    wrapper.unmount()
  })

  it('shows operating income instead of outstanding receivables in the KPI cards', async () => {
    const wrapper = mount(FinanceView, {
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()

    const labels = wrapper
      .findAll('.metrics .metric')
      .map((card) => card.find('span').text())

    expect(labels).toEqual([
      '有效实收',
      '押金余额总额',
      '租金及押金入账合计',
      '原应收',
      '优惠减免',
      '经营收入',
    ])
    expect(wrapper.find('.metrics').text()).toContain('￥3,000.00')
    expect(wrapper.find('.metrics').text()).not.toContain('净应收')
    expect(wrapper.find('.metrics').text()).not.toContain('未收')
    expect(wrapper.find('.metrics').text()).not.toContain('收租率')
    wrapper.unmount()
  })
})
