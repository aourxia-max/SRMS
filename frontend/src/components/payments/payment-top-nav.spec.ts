import { mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { useApprovalTasksStore } from '../../stores/approval-tasks'

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/payments/collect' }),
}))

import PaymentTopNav from './PaymentTopNav.vue'

describe('PaymentTopNav', () => {
  it('uses the same capsule top navigation layout as contract management', () => {
    const wrapper = mount(PaymentTopNav, {
      global: { plugins: [createPinia()], stubs: { RouterLink: RouterLinkStub } },
    })

    expect(wrapper.find('nav.contract-top-nav.payment-top-nav').exists()).toBe(true)
    expect(wrapper.findAll('.contract-top-nav a')).toHaveLength(3)
    expect(wrapper.find('.contract-top-nav .active').text()).toContain('\u6536\u6b3e\u767b\u8bb0')
  })

  it('在退款作废确认入口显示退款与作废申请合计', () => {
    const pinia = createPinia()
    const approvals = useApprovalTasksStore(pinia)
    approvals.counts.paymentRefunds = 6
    approvals.counts.paymentVoidRequests = 7
    const wrapper = mount(PaymentTopNav, {
      global: { plugins: [pinia], stubs: { RouterLink: RouterLinkStub } },
    })

    expect(wrapper.get('[data-test="badge-payment-reviews"]').text()).toBe('13')
  })
})
