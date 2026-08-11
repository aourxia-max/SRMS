// @vitest-environment happy-dom

import ElementPlus, { ElOption, ElSelect } from 'element-plus'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ContractDetailPanel from '../../components/contracts/ContractDetailPanel.vue'
import ContractFormPanel from '../../components/contracts/ContractFormPanel.vue'
import FixedRentRebatePanel from '../../components/contracts/FixedRentRebatePanel.vue'
import ContractTopNav from '../../components/contracts/ContractTopNav.vue'
import {
  buildFixedRentRebatePayload,
  contractConcessionError,
  createLatestRequestGuard,
  filterFixedRentRebateContracts,
  fixedRentRebateContractLabel,
  isFixedRentRebateEligible,
  normalizeConcessionType,
  toContractPayload,
} from '../../services/contracts'
import { emptyContractForm, type ContractDetail, type ContractFormModel } from '../../types/contracts'
import type { PaymentListItem } from '../../types/payments'

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

const contractFormRooms = [
  { id: 8, fullHouseNo: '1栋301', roomStatus: 'VACANT' },
  { id: 22, fullHouseNo: '2栋602', roomStatus: 'PENDING_MOVE_IN' },
]

function mountContractFormWithParentFeedback(initial: ContractFormModel) {
  let updateCount = 0
  let wrapper: ReturnType<typeof mount>
  const onUpdate = async (value: ContractFormModel) => {
    updateCount += 1
    if (updateCount <= 5) {
      await wrapper.setProps({ modelValue: value })
    }
  }

  wrapper = mount(ContractFormPanel, {
    props: {
      role: 'SUPER_ADMIN',
      modelValue: initial,
      rooms: contractFormRooms,
      tenants: [],
      'onUpdate:modelValue': onUpdate,
    },
    global: { plugins: [ElementPlus] },
  })

  return { wrapper, updateCount: () => updateCount }
}

describe('固定合同工作区', () => {
  it('选择房源只向父页面发送一次有效更新且不会形成反馈循环', async () => {
    const { wrapper, updateCount } = mountContractFormWithParentFeedback(emptyContractForm())
    const roomSelect = wrapper.findAllComponents(ElSelect)[0]

    await roomSelect.vm.$emit('update:modelValue', 8)
    await flushPromises()
    await nextTick()

    expect(updateCount()).toBe(1)
    expect((wrapper.vm.$props as { modelValue: ContractFormModel }).modelValue.roomId).toBe(8)
    expect(roomSelect.props('modelValue')).toBe(8)
  })

  it('父页面重置或恢复草稿时只同步到子表单而不反向重复发送', async () => {
    const { wrapper, updateCount } = mountContractFormWithParentFeedback(completeForm())
    const roomSelect = wrapper.findAllComponents(ElSelect)[0]

    await wrapper.setProps({ modelValue: emptyContractForm() })
    await flushPromises()
    expect(roomSelect.props('modelValue')).toBeNull()
    expect(updateCount()).toBe(0)

    await wrapper.setProps({ modelValue: { ...completeForm(), roomId: 22 } })
    await flushPromises()
    expect(roomSelect.props('modelValue')).toBe(22)
    expect(updateCount()).toBe(0)
  })

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

const activeContract = (): ContractDetail => ({
  id: 12,
  contractNo: 'HT202608050012 | 1栋301 | 张三',
  externalContractNo: null,
  roomId: 8,
  room: { id: 8, fullHouseNo: '1栋301' },
  members: [{ memberRole: 'PRIMARY', tenant: { id: 19, name: '张三' } }],
  startDate: '2026-08-01',
  endDate: '2027-07-31',
  plannedMoveInDate: '2026-08-01',
  monthlyRent: '2200.00',
  depositRequired: '4400.00',
  paymentCycleMonths: 1,
  status: 'ACTIVE',
  pricingMode: 'FIXED',
  commissions: [],
})

describe('合同工作区复审边界', () => {
  it('只把履行中的固定月租合同认定为可退差', () => {
    expect(isFixedRentRebateEligible(activeContract())).toBe(true)
    expect(isFixedRentRebateEligible({ ...activeContract(), status: 'PENDING_START' })).toBe(false)
    expect(isFixedRentRebateEligible({ ...activeContract(), pricingMode: 'TIERED_RETROACTIVE' })).toBe(false)
    expect(isFixedRentRebateEligible(null)).toBe(false)
  })

  it.each([
    ['合同编号', '050012'],
    ['楼栋房号', '1栋301'],
    ['主租户姓名', '张三'],
  ])('按%s搜索符合退差条件的合同', (_field, keyword) => {
    const eligible = activeContract()
    const ineligible = { ...activeContract(), id: 13, contractNo: 'HT-OTHER', status: 'PENDING_START' }
    expect(filterFixedRentRebateContracts([eligible, ineligible], keyword).map((item) => item.id)).toEqual([12])
  })

  it('搜索忽略首尾空格和英文大小写并生成完整标签', () => {
    const eligible = activeContract()
    expect(filterFixedRentRebateContracts([eligible], '  ht2026  ')).toEqual([eligible])
    expect(fixedRentRebateContractLabel(eligible)).toContain('HT202608050012')
    expect(fixedRentRebateContractLabel(eligible)).toContain('1栋301')
    expect(fixedRentRebateContractLabel(eligible)).toContain('张三')
    expect(fixedRentRebateContractLabel(eligible)).toBe(eligible.contractNo)
  })

  it('仅允许最新预览请求更新状态', () => {
    const guard = createLatestRequestGuard()
    const first = guard.next()
    const second = guard.next()

    expect(guard.isCurrent(first)).toBe(false)
    expect(guard.isCurrent(second)).toBe(true)
    const invalidated = guard.next()
    expect(guard.isCurrent(second)).toBe(false)
    expect(guard.isCurrent(invalidated)).toBe(true)
  })

  it('按优惠类型重置字段、校验并生成无越界字段的载荷', () => {
    const percentage = normalizeConcessionType({
      concessionType: 'FIXED_AMOUNT', applyMode: 'DATE_RANGE', startDate: '2026-08-01', endDate: '2026-08-10',
      fixedAmount: '300.00', reason: '测试',
    }, 'PERCENTAGE')
    expect(percentage).toEqual({
      concessionType: 'PERCENTAGE', applyMode: 'BILLING_PERIODS', billingPeriodCount: 1,
      discountRate: '', reason: '测试',
    })
    expect(contractConcessionError([percentage])).toContain('优惠比例')

    const form = completeForm()
    form.concessions = [
      { concessionType: 'RENT_FREE', applyMode: 'DATE_RANGE', startDate: '2026-08-01', endDate: '2026-08-03', reason: '维修免租' },
      { concessionType: 'FIXED_AMOUNT', applyMode: 'BILLING_PERIODS', billingPeriodCount: 1, fixedAmount: '300.00', reason: '首期优惠' },
      { concessionType: 'PERCENTAGE', applyMode: 'BILLING_PERIODS', billingPeriodCount: 2, discountRate: '0.10', reason: '两期九折' },
    ]
    expect(contractConcessionError(form.concessions)).toBeNull()
    expect(toContractPayload(form, 'ADMIN').concessions).toEqual(form.concessions)
  })

  it('仅在履行中的固定月租合同详情显示退差入口并携带合同编号', async () => {
    const wrapper = mount(ContractDetailPanel, {
      props: { contract: activeContract(), role: 'ADMIN' },
      global: { plugins: [ElementPlus] },
    })
    const button = wrapper.find('[data-test="open-fixed-rent-rebate"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.emitted('rebate')).toEqual([[12]])

    await wrapper.setProps({ contract: { ...activeContract(), status: 'PENDING_START' } })
    expect(wrapper.find('[data-test="open-fixed-rent-rebate"]').exists()).toBe(false)

    await wrapper.setProps({ contract: { ...activeContract(), pricingMode: 'TIERED_RETROACTIVE' } })
    expect(wrapper.find('[data-test="open-fixed-rent-rebate"]').exists()).toBe(false)
  })

  it('退差页按三字段搜索符合资格的合同并支持切换', async () => {
    const eligible = activeContract()
    const second = {
      ...activeContract(),
      id: 14,
      contractNo: 'HT202608050014 | 2栋602 | 李四',
      roomId: 22,
      room: { id: 22, fullHouseNo: '2栋602' },
      members: [{ memberRole: 'PRIMARY' as const, tenant: { id: 31, name: '李四' } }],
    }
    const ineligible = { ...activeContract(), id: 15, contractNo: 'HT-NOT-ELIGIBLE', status: 'PENDING_START' }
    const wrapper = mount(FixedRentRebatePanel, {
      props: { contracts: [eligible, second, ineligible], contract: eligible, role: 'ADMIN' },
      global: { plugins: [ElementPlus] },
    })

    const search = wrapper.findAllComponents(ElSelect).find((item) => item.attributes('data-test') === 'fixed-rebate-contract-search')
    expect(search).toBeDefined()
    expect(search!.props('placeholder')).toBe('搜索合同编号、楼栋房号或租户姓名')
    expect(search!.props('noMatchText')).toBe('未找到符合退差条件的合同')

    const filter = search!.props('filterMethod') as (value: string) => void
    filter('李四')
    await flushPromises()
    let labels = search!.findAllComponents(ElOption).map((option) => option.props('label'))
    expect(labels).toEqual([fixedRentRebateContractLabel(second)])
    expect(labels).not.toContain('HT-NOT-ELIGIBLE')

    await search!.vm.$emit('change', 14)
    expect(wrapper.emitted('select-contract')).toEqual([[14]])

    filter('不存在')
    await flushPromises()
    labels = search!.findAllComponents(ElOption).map((option) => option.props('label'))
    expect(labels).toEqual([])

    filter('')
    await flushPromises()
    labels = search!.findAllComponents(ElOption).map((option) => option.props('label'))
    expect(labels).toHaveLength(2)
  })

  it('仅为履行中的固定月租合同展示并生成退差载荷', () => {
    const inactive = { ...activeContract(), status: 'PENDING_START' }
    const tiered = { ...activeContract(), pricingMode: 'TIERED_RETROACTIVE' }
    const wrapper = mount(FixedRentRebatePanel, {
      props: { contract: inactive, bills: [], rebates: [], role: 'ADMIN' },
      global: { plugins: [ElementPlus] },
    })

    expect(wrapper.text()).toContain('请选择履行中的固定月租合同')
    expect(wrapper.text()).not.toContain('金额与原因')
    expect(() => buildFixedRentRebatePayload(inactive, {})).toThrow('履行中的固定月租合同')
    expect(() => buildFixedRentRebatePayload(tiered, {})).toThrow('履行中的固定月租合同')
    expect(buildFixedRentRebatePayload(activeContract(), {
      rentBillId: 99, periodStart: '2026-08-01', periodEnd: '2026-08-31', actualAmount: '100.00',
      differenceReason: '维修协商', settlementMethod: 'PREPAYMENT_CREDIT',
    })).toMatchObject({ contractId: 12, sourceType: 'FIXED_RENT_MANUAL', rebateType: 'MANUAL', rentBillId: 99 })
  })

  it('合同详情展示仅属于当前合同的收款记录', async () => {
    const payments: PaymentListItem[] = [{
      id: 71, receiptNo: 'SK2026080071', receiptType: '正式收款', paymentDate: '2026-08-02', amount: '2200.00',
      method: 'WECHAT', status: 'CONFIRMED', contract: { id: 12, contractNo: activeContract().contractNo }, tenant: { id: 19, name: '张三' },
    }]
    const wrapper = mount(ContractDetailPanel, {
      props: { contract: activeContract(), bills: [], files: [], changes: [], payments, role: 'ADMIN' },
      global: { plugins: [ElementPlus] },
    })
    const tab = wrapper.findAll('[role="tab"]').find((item) => item.text().includes('收款记录'))
    await tab!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('SK2026080071')
    expect(wrapper.text()).toContain('¥2,200.00')
  })

  it('合同附件提供安全下载动作', async () => {
    const file = { id: 44, originalName: '合同.pdf', mimeType: 'application/pdf', sizeBytes: '1024' }
    const wrapper = mount(ContractDetailPanel, {
      props: { contract: activeContract(), bills: [], files: [file], changes: [], payments: [], role: 'ADMIN' },
      global: { plugins: [ElementPlus] },
    })
    const tab = wrapper.findAll('[role="tab"]').find((item) => item.text().includes('附件'))
    await tab!.trigger('click')
    await wrapper.get('[data-test="download-contract-file-44"]').trigger('click')
    expect(wrapper.emitted('download')?.[0]).toEqual([file])
  })
})