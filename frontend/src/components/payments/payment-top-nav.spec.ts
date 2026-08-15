import { mount, RouterLinkStub } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/payments/collect' }),
}))

import PaymentTopNav from './PaymentTopNav.vue'

describe('PaymentTopNav', () => {
  it('uses the same capsule top navigation layout as contract management', () => {
    const wrapper = mount(PaymentTopNav, {
      global: { stubs: { RouterLink: RouterLinkStub } },
    })

    expect(wrapper.find('nav.contract-top-nav.payment-top-nav').exists()).toBe(true)
    expect(wrapper.findAll('.contract-top-nav a')).toHaveLength(3)
    expect(wrapper.find('.contract-top-nav .active').text()).toContain('\u6536\u6b3e\u767b\u8bb0')
  })
})
