import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import CheckoutTopNav from './CheckoutTopNav.vue'
import CheckoutWorkspace from './CheckoutWorkspace.vue'
import CheckoutInitiatePanel from './CheckoutInitiatePanel.vue'
import CheckoutSettlementPanel from './CheckoutSettlementPanel.vue'
import CheckoutRefundPanel from './CheckoutRefundPanel.vue'
vi.mock('../../services/checkout', () => ({
  checkoutApi: {
    contracts: vi.fn().mockResolvedValue([{ id: 1, contractNo: 'HT202608010001', status: 'ACTIVE' }]),
    initiate: vi.fn(),
    settlements: vi.fn().mockResolvedValue([{ id: 8, settlementNo: 'TZ202608010001', status: 'PENDING', contractId: 1, depositRefundableAmount: '0.00', prepaymentRefundableAmount: '0.00', finalReceivable: '0.00' }, { id: 9, settlementNo: 'TZ202608010002', status: 'APPROVED', contractId: 2, depositRefundableAmount: '0.00', prepaymentRefundableAmount: '0.00', finalReceivable: '0.00' }]),
    approve: vi.fn(),
  },
}))

describe('CheckoutTopNav', () => {
  it('renders the three checkout workflow tabs in Chinese', () => {
    const wrapper = mount(CheckoutTopNav, { props: { activeTab: 'initiate' } })

    expect(wrapper.text()).toContain('1 发起退租')
    expect(wrapper.text()).toContain('2 退租结算')
    expect(wrapper.text()).toContain('3 押金退还确认')
  })
  it('opens the initiate checkout workspace by default', () => {
    const wrapper = mount(CheckoutWorkspace, { global: { plugins: [createPinia()] } })

    expect(wrapper.text()).toContain('发起退租')
    expect(wrapper.text()).toContain('请选择正在履行的合同')
  })
  it('requires an active contract and checkout reason before initiation', async () => {
    const wrapper = mount(CheckoutInitiatePanel, {
      props: { contracts: [{ id: 1, contractNo: 'HT202608010001', status: 'ACTIVE' }] },
    })

    await wrapper.get('[data-test="initiate-submit"]').trigger('click')

    expect(wrapper.text()).toContain('请选择正在履行的合同')
    expect(wrapper.text()).toContain('请填写退租原因')
  })
  it('loads active contracts into the initiate checkout form', async () => {
    const wrapper = mount(CheckoutWorkspace, { global: { plugins: [createPinia()] } })
    await flushPromises()

    expect(wrapper.text()).toContain('HT202608010001')
  })
  it('shows an approved settlement as waiting for final refund confirmation', () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [{
          id: 1,
          settlementNo: 'TZ202608010001',
          status: 'APPROVED',
          contractId: 3,
          depositRefundableAmount: '800.00',
          prepaymentRefundableAmount: '500.00',
          finalReceivable: '0.00',
        }],
      },
    })

    expect(wrapper.text()).toContain('等待最终退款确认')
    expect(wrapper.text()).toContain('1,300.00')
  })
  it('loads settlement records when switching to the settlement tab', async () => {
    const wrapper = mount(CheckoutWorkspace, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.get('button:nth-child(2)').trigger('click')

    expect(wrapper.text()).toContain('TZ202608010001')
  })
  it('shows zero-refund final confirmation without proof upload for a super admin', () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: 'SUPER_ADMIN',
        settlement: {
          id: 1,
          settlementNo: 'TZ202608010001',
          status: 'APPROVED',
          contractId: 3,
          depositRefundableAmount: '0.00',
          prepaymentRefundableAmount: '0.00',
          finalReceivable: '0.00',
        },
      },
    })

    expect(wrapper.text()).toContain('无需退款确认')
    expect(wrapper.find('[data-test="zero-complete"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('上传退款凭证')
  })
  it('shows the approved zero-refund settlement in the final confirmation tab', async () => {
    const wrapper = mount(CheckoutWorkspace, { global: { plugins: [createPinia()] } })
    await flushPromises()
    await wrapper.get('button:nth-child(3)').trigger('click')

    expect(wrapper.text()).toContain('无需退款确认')
  })
  it('disables positive refund submission before a refund proof is uploaded', () => {
    const wrapper = mount(CheckoutRefundPanel, {
      props: {
        role: 'ADMIN',
        settlement: { id: 2, settlementNo: 'TZ202608010002', status: 'APPROVED', contractId: 3, depositRefundableAmount: '800.00', prepaymentRefundableAmount: '500.00', finalReceivable: '0.00' },
      },
    })

    expect(wrapper.get('[data-test="refund-submit"]').attributes('disabled')).toBeDefined()
  })
})
