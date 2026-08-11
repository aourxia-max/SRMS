import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import CheckoutTopNav from './CheckoutTopNav.vue'
import CheckoutWorkspace from './CheckoutWorkspace.vue'
import CheckoutInitiatePanel from './CheckoutInitiatePanel.vue'
vi.mock('../../services/checkout', () => ({
  checkoutApi: {
    contracts: vi.fn().mockResolvedValue([{ id: 1, contractNo: 'HT202608010001', status: 'ACTIVE' }]),
    initiate: vi.fn(),
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
    const wrapper = mount(CheckoutWorkspace)

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
    const wrapper = mount(CheckoutWorkspace)
    await flushPromises()

    expect(wrapper.text()).toContain('HT202608010001')
  })
})
