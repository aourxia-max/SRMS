// @vitest-environment happy-dom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ContractTopNav from './ContractTopNav.vue'

describe('合同工作区顶部导航', () => {
  it('第五页签进入合同作废纠错工作区并发送精确 key', async () => {
    const wrapper = mount(ContractTopNav, {
      props: { modelValue: 'list', role: 'ADMIN' },
    })

    const items = wrapper.findAll('nav button')
    expect(items).toHaveLength(5)
    expect(items[4].text()).toBe('合同作废／纠错')

    await items[4].trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['void-correction']])
  })

  it('仅管理员和超级管理员显示合同作废纠错页签', () => {
    const visitor = mount(ContractTopNav, {
      props: { modelValue: 'list', role: 'VISITOR' },
    })
    const admin = mount(ContractTopNav, {
      props: { modelValue: 'list', role: 'ADMIN' },
    })
    const superAdmin = mount(ContractTopNav, {
      props: { modelValue: 'list', role: 'SUPER_ADMIN' },
    })

    expect(visitor.text()).not.toContain('合同作废／纠错')
    expect(admin.text()).toContain('合同作废／纠错')
    expect(superAdmin.text()).toContain('合同作废／纠错')
  })
})
