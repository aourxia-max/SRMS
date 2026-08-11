import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import CheckoutTopNav from './CheckoutTopNav.vue'
import CheckoutWorkspace from './CheckoutWorkspace.vue'

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
})
