// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ContractFormPanel from '../../components/contracts/ContractFormPanel.vue'
import ContractTopNav from '../../components/contracts/ContractTopNav.vue'
import { toContractPayload } from '../../services/contracts'
import type { ContractFormModel } from '../../types/contracts'

const completeForm = (): ContractFormModel => ({
  externalContractNo: 'ZZ-2026-001',
  roomId: 8,
  primaryTenantId: 19,
  secondaryTenantIds: [20],
  startDate: '2026-08-01',
  endDate: '2027-07-31',
  plannedMoveInDate: '2026-08-01',
  monthlyRent: '2200.00',
  depositRequired: '4400.00',
  paymentCycleMonths: 1,
  concessions: [],
  fileAssetIds: [31],
  remark: '按固定月租履行',
  commission: { recipientName: '员工A', amount: '800.00' },
})

describe('固定合同工作区', () => {
  it('仅展示四项固定合同导航，不出现阶梯功能', () => {
    const wrapper = mount(ContractTopNav, {
      props: { modelValue: 'list' },
    })

    expect(wrapper.text()).toContain('合同列表')
    expect(wrapper.text()).toContain('新增合同')
    expect(wrapper.text()).toContain('合同详情')
    expect(wrapper.text()).toContain('固定月租退差')
    expect(wrapper.text()).not.toContain('自定义弹性阶梯')
    expect(wrapper.text()).not.toContain('阶梯退差')
  })

  it('由 Element Plus rules 标记确认合同必填字段', () => {
    const wrapper = mount(ContractFormPanel, {
      props: {
        role: 'SUPER_ADMIN',
        modelValue: completeForm(),
        rooms: [],
        tenants: [],
      },
      global: { plugins: [ElementPlus] },
    })

    expect(wrapper.findAll('.is-required').length).toBeGreaterThanOrEqual(7)
    expect(wrapper.text()).toContain('房源')
    expect(wrapper.text()).toContain('主承租人')
    expect(wrapper.text()).toContain('固定月租')
  })

  it('普通管理员看不到提成且载荷不会提交提成', () => {
    const wrapper = mount(ContractFormPanel, {
      props: {
        role: 'ADMIN',
        modelValue: completeForm(),
        rooms: [],
        tenants: [],
      },
      global: { plugins: [ElementPlus] },
    })

    expect(wrapper.text()).not.toContain('租房提成')
    expect(toContractPayload(completeForm(), 'ADMIN')).not.toHaveProperty('commission')
  })

  it('超级管理员保存草稿和确认使用同一份固定合同载荷', async () => {
    const form = completeForm()
    const wrapper = mount(ContractFormPanel, {
      props: {
        role: 'SUPER_ADMIN',
        modelValue: form,
        rooms: [],
        tenants: [],
      },
      global: { plugins: [ElementPlus] },
    })

    await wrapper.get('[data-test="save-draft"]').trigger('click')
    await wrapper.get('[data-test="confirm-contract"]').trigger('click')
    await flushPromises()

    const expected = toContractPayload(form, 'SUPER_ADMIN')
    expect(wrapper.emitted('save-draft')?.[0]).toEqual([expected])
    expect(wrapper.emitted('confirm')?.[0]).toEqual([expected])
    expect(expected).toMatchObject({
      roomId: 8,
      primaryTenantId: 19,
      monthlyRent: '2200.00',
      commission: { recipientName: '员工A', amount: '800.00' },
    })
  })

  it('未选择合同时显示真实空状态提示', () => {
    const wrapper = mount(ContractTopNav, {
      props: { modelValue: 'detail', selectedContractId: null },
    })

    expect(wrapper.text()).toContain('请先从合同列表选择合同')
  })
})
