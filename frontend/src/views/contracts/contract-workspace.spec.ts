// @vitest-environment happy-dom

import ElementPlus, { ElDialog, ElMessage, ElOption, ElSelect } from 'element-plus'
import { nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ContractDetailPanel from '../../components/contracts/ContractDetailPanel.vue'
import ContractVoidPanel from '../../components/contracts/voids/ContractVoidPanel.vue'
import ContractsWorkspace from './ContractsWorkspace.vue'
import ContractFormPanel from '../../components/contracts/ContractFormPanel.vue'
import ContractListPanel from '../../components/contracts/ContractListPanel.vue'
import FixedRentRebatePanel from '../../components/contracts/FixedRentRebatePanel.vue'
import ContractTopNav from '../../components/contracts/ContractTopNav.vue'
import * as contractService from '../../services/contracts'
import { http } from '../../services/http'
import * as paymentService from '../../services/payments'
import { useSessionStore } from '../../stores/session'
import { buildFixedRentRebatePayload, contractConcessionError, createLatestRequestGuard, filterFixedRentRebateContracts, fixedRentRebateContractLabel, isFixedRentRebateEligible, normalizeConcessionType, toContractPayload } from '../../services/contracts'
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

  it('明确提示合同押金填写后即视为已经收到', () => {
    const wrapper = mount(ContractFormPanel, {
      props: {
        role: 'SUPER_ADMIN',
        modelValue: completeForm(),
        rooms: [],
        tenants: [],
      },
      global: { plugins: [ElementPlus] },
    })

    expect(wrapper.text()).toContain('押金（填写即视为已收）')
    wrapper.unmount()
  })

  it('合同附件文件选择器允许选择 GIF 文件', () => {
    const wrapper = mount(ContractFormPanel, {
      props: {
        role: 'ADMIN',
        modelValue: completeForm(),
        rooms: [],
        tenants: [],
      },
      global: { plugins: [ElementPlus] },
    })

    const accept = wrapper.get('input[type="file"]').attributes('accept') || ''
    expect(accept.split(',')).toContain('.gif')
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
  it('详情事件打开作废纠错页并预选当前合同', async () => {
    vi.spyOn(http, 'get').mockImplementation(
      (url: string) =>
        Promise.resolve({
          data: { data: url === '/properties/rooms' ? [] : { items: [] } },
        }) as never,
    )
    vi.spyOn(contractService, 'listContracts').mockResolvedValue([activeContract()])
    vi.spyOn(contractService, 'getContract').mockResolvedValue(activeContract())
    vi.spyOn(contractService, 'getContractBills').mockResolvedValue([])
    vi.spyOn(contractService, 'getContractFiles').mockResolvedValue([])
    vi.spyOn(contractService, 'getContractChanges').mockResolvedValue([])
    vi.spyOn(contractService, 'listFixedRentRebates').mockResolvedValue([])
    vi.spyOn(contractService, 'listContractVoidRequests').mockResolvedValue([])
    vi.spyOn(paymentService, 'listAllPayments').mockResolvedValue([])
    const previewVoid = vi.spyOn(contractService, 'previewContractVoid').mockResolvedValue({
      contract: { id: 12, status: 'ACTIVE', roomId: 8 },
      summary: {
        rentBillPayable: '2200.00',
        effectivePayment: '2200.00',
        depositBalance: '4400.00',
        prepaymentBalance: '0.00',
        refundNet: '0.00',
        currentNetImpact: '6600.00',
        plannedReversal: '-6600.00',
        postReversalNetImpact: '0.00',
      },
      rows: [],
      pending: {
        adjustments: [],
        refunds: [],
        voidRequests: [],
        depositRefunds: [],
        changes: [],
        rebates: [],
        checkouts: [],
      },
      completedCheckoutIds: [],
      room: {
        currentStatus: 'RENTED',
        hasLaterContract: false,
        action: 'RECALCULATE',
      },
      flags: {
        hasPendingWorkflows: false,
        hasCompletedCheckout: false,
        hasLaterContract: false,
      },
      sourceSnapshot: {
        prepaymentBalanceSource: null,
        depositBalanceSource: null,
        contractMembers: [],
        paymentAllocations: [],
        adjustments: [],
        rebates: [],
        checkoutSettlements: [],
        commissions: [],
      },
      impactHash: 'a'.repeat(64),
    })

    const pinia = createPinia()
    const session = useSessionStore(pinia)
    session.user = {
      id: 2,
      username: 'admin',
      displayName: '管理员',
      role: 'ADMIN',
    }
    session.accessToken = 'access-token'
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/contracts',
          name: 'contracts',
          component: ContractsWorkspace,
        },
      ],
    })
    await router.push('/contracts?tab=detail&contractId=12')
    await router.isReady()
    const wrapper = mount(ContractsWorkspace, {
      global: { plugins: [pinia, router, ElementPlus] },
    })
    await flushPromises()

    await wrapper.get('[data-test="open-contract-void-correction"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-test="contract-void-panel"]').text()).toContain(activeContract().contractNo)
    expect(previewVoid).toHaveBeenCalledWith(12)
    expect(router.currentRoute.value.query).toMatchObject({
      tab: 'void-correction',
      contractId: '12',
    })
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('作废完成后重载合同与当前详情并立即隐藏危险操作', async () => {
    const active = activeContract()
    const voided = { ...active, status: 'VOIDED' as const }
    vi.spyOn(http, 'get').mockImplementation(
      (url: string) =>
        Promise.resolve({
          data: { data: url === '/properties/rooms' ? [] : { items: [] } },
        }) as never,
    )
    const listContracts = vi.spyOn(contractService, 'listContracts').mockResolvedValueOnce([active]).mockResolvedValueOnce([voided])
    const getContract = vi.spyOn(contractService, 'getContract').mockResolvedValueOnce(active).mockResolvedValueOnce(voided)
    vi.spyOn(contractService, 'getContractBills').mockResolvedValue([])
    vi.spyOn(contractService, 'getContractFiles').mockResolvedValue([
      {
        id: 44,
        originalName: '原合同.pdf',
        mimeType: 'application/pdf',
        sizeBytes: '1024',
      },
    ])
    vi.spyOn(contractService, 'getContractChanges').mockResolvedValue([])
    vi.spyOn(contractService, 'listFixedRentRebates').mockResolvedValue([])
    vi.spyOn(contractService, 'listContractVoidRequests').mockResolvedValue([])
    vi.spyOn(paymentService, 'listAllPayments').mockResolvedValue([])
    vi.spyOn(contractService, 'previewContractVoid').mockResolvedValue({
      contract: { id: 12, status: 'ACTIVE', roomId: 8 },
      summary: {
        rentBillPayable: '2200.00',
        effectivePayment: '2200.00',
        depositBalance: '4400.00',
        prepaymentBalance: '0.00',
        refundNet: '0.00',
        currentNetImpact: '6600.00',
        plannedReversal: '-6600.00',
        postReversalNetImpact: '0.00',
      },
      rows: [],
      pending: {
        adjustments: [],
        refunds: [],
        voidRequests: [],
        depositRefunds: [],
        changes: [],
        rebates: [],
        checkouts: [],
      },
      completedCheckoutIds: [],
      room: {
        currentStatus: 'RENTED',
        hasLaterContract: false,
        action: 'RECALCULATE',
      },
      flags: {
        hasPendingWorkflows: false,
        hasCompletedCheckout: false,
        hasLaterContract: false,
      },
      sourceSnapshot: {
        prepaymentBalanceSource: null,
        depositBalanceSource: null,
        contractMembers: [],
        paymentAllocations: [],
        adjustments: [],
        rebates: [],
        checkoutSettlements: [],
        commissions: [],
      },
      impactHash: 'a'.repeat(64),
    })

    const pinia = createPinia()
    const session = useSessionStore(pinia)
    session.user = {
      id: 1,
      username: 'root',
      displayName: '超级管理员',
      role: 'SUPER_ADMIN',
    }
    session.accessToken = 'access-token'
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/contracts',
          name: 'contracts',
          component: ContractsWorkspace,
        },
      ],
    })
    await router.push('/contracts?tab=void-correction&contractId=12')
    await router.isReady()
    const wrapper = mount(ContractsWorkspace, {
      global: { plugins: [pinia, router, ElementPlus] },
    })
    await flushPromises()

    wrapper.getComponent(ContractVoidPanel).vm.$emit('completed', 12)
    await flushPromises()

    expect(listContracts).toHaveBeenCalledTimes(2)
    expect(getContract).toHaveBeenCalledTimes(2)
    expect(wrapper.findComponent(ContractDetailPanel).exists()).toBe(true)
    expect(wrapper.get('[data-test="contract-status-tag"]').text()).toBe('已作废')
    expect(wrapper.get('[data-test="contract-status-tag"]').classes()).toContain('el-tag--danger')
    expect(wrapper.find('[data-test="open-payment-collect"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="open-checkout"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="open-fixed-rent-rebate"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="open-contract-void-correction"]').exists()).toBe(false)
    expect(router.currentRoute.value.query).toMatchObject({
      tab: 'detail',
      contractId: '12',
    })
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('作废完成后详情重载失败时关闭旧详情并回到列表，路由监听不会恢复旧 ACTIVE 对象', async () => {
    const active = activeContract()
    const voided = { ...active, status: 'VOIDED' as const }
    vi.spyOn(http, 'get').mockImplementation(
      (url: string) => Promise.resolve({ data: { data: url === '/properties/rooms' ? [] : { items: [] } } }) as never,
    )
    vi.spyOn(contractService, 'listContracts').mockResolvedValueOnce([active]).mockResolvedValueOnce([voided])
    vi.spyOn(contractService, 'getContract').mockResolvedValueOnce(active).mockRejectedValue(new Error('detail timeout'))
    vi.spyOn(contractService, 'getContractBills').mockResolvedValue([])
    vi.spyOn(contractService, 'getContractFiles').mockResolvedValue([])
    vi.spyOn(contractService, 'getContractChanges').mockResolvedValue([])
    vi.spyOn(contractService, 'listFixedRentRebates').mockResolvedValue([])
    vi.spyOn(contractService, 'listContractVoidRequests').mockResolvedValue([])
    vi.spyOn(contractService, 'previewContractVoid').mockResolvedValue({
      contract: { id: 12, status: 'ACTIVE', roomId: 8 },
      summary: {
        rentBillPayable: '0.00', effectivePayment: '0.00', depositBalance: '0.00', prepaymentBalance: '0.00', refundNet: '0.00', currentNetImpact: '0.00', plannedReversal: '0.00', postReversalNetImpact: '0.00',
      },
      rows: [],
      pending: { adjustments: [], refunds: [], voidRequests: [], depositRefunds: [], changes: [], rebates: [], checkouts: [] },
      completedCheckoutIds: [],
      room: { currentStatus: 'RENTED', hasLaterContract: false, action: 'RECALCULATE' },
      flags: { hasPendingWorkflows: false, hasCompletedCheckout: false, hasLaterContract: false },
      sourceSnapshot: { prepaymentBalanceSource: null, depositBalanceSource: null, contractMembers: [], paymentAllocations: [], adjustments: [], rebates: [], checkoutSettlements: [], commissions: [] },
      impactHash: 'a'.repeat(64),
    })
    vi.spyOn(paymentService, 'listAllPayments').mockResolvedValue([])
    const error = vi.spyOn(ElMessage, 'error')

    const pinia = createPinia()
    const session = useSessionStore(pinia)
    session.user = { id: 1, username: 'root', displayName: '超级管理员', role: 'SUPER_ADMIN' }
    session.accessToken = 'access-token'
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/contracts', name: 'contracts', component: ContractsWorkspace }],
    })
    await router.push('/contracts?tab=void-correction&contractId=12')
    await router.isReady()
    const wrapper = mount(ContractsWorkspace, { global: { plugins: [pinia, router, ElementPlus] } })
    await flushPromises()

    wrapper.getComponent(ContractVoidPanel).vm.$emit('completed', 12)
    await flushPromises()
    await router.replace('/contracts?tab=detail&contractId=12')
    await flushPromises()

    expect(error).toHaveBeenCalledWith(expect.stringContaining('合同作废后详情刷新失败'))
    expect(wrapper.getComponent(ContractDetailPanel).props('contract')).toBeNull()
    expect(wrapper.find('[data-test="open-payment-collect"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="open-checkout"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="open-contract-void-correction"]').exists()).toBe(false)
    wrapper.unmount()
    vi.restoreAllMocks()
  })
  it('访客不能通过查询参数强制进入合同作废纠错工作区', async () => {
    vi.spyOn(http, 'get').mockImplementation(
      (url: string) =>
        Promise.resolve({
          data: { data: url === '/properties/rooms' ? [] : { items: [] } },
        }) as never,
    )
    vi.spyOn(contractService, 'listContracts').mockResolvedValue([activeContract()])
    vi.spyOn(contractService, 'getContract').mockResolvedValue(activeContract())
    vi.spyOn(contractService, 'getContractBills').mockResolvedValue([])
    vi.spyOn(contractService, 'getContractFiles').mockResolvedValue([])
    vi.spyOn(contractService, 'getContractChanges').mockResolvedValue([])
    vi.spyOn(contractService, 'listFixedRentRebates').mockResolvedValue([])
    vi.spyOn(contractService, 'listContractVoidRequests').mockResolvedValue([])
    vi.spyOn(paymentService, 'listAllPayments').mockResolvedValue([])

    const pinia = createPinia()
    const session = useSessionStore(pinia)
    session.user = {
      id: 9,
      username: 'visitor',
      displayName: '访客',
      role: 'VISITOR',
    }
    session.accessToken = 'access-token'
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/contracts',
          name: 'contracts',
          component: ContractsWorkspace,
        },
      ],
    })
    await router.push('/contracts?tab=void-correction&contractId=12')
    await router.isReady()
    const wrapper = mount(ContractsWorkspace, {
      global: { plugins: [pinia, router, ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.find('[data-test="contract-void-panel"]').exists()).toBe(false)
    expect(wrapper.findComponent(ContractListPanel).exists()).toBe(true)
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('合同列表使用统一中文状态和标签颜色', async () => {
    const contracts = [
      ['DRAFT', '草稿'],
      ['PENDING_START', '待开始'],
      ['ACTIVE', '履约中'],
      ['PENDING_CHECKOUT', '待退租'],
      ['ENDED', '已结束'],
      ['VOIDED', '已作废'],
    ].map(([status, expectedLabel], index) => ({
      ...activeContract(),
      id: index + 1,
      contractNo: `HT-STATUS-${index + 1}`,
      status,
      expectedLabel,
    }))
    const wrapper = mount(ContractListPanel, {
      props: { contracts },
      global: { plugins: [ElementPlus] },
    })
    await nextTick()
    await flushPromises()

    for (const contract of contracts) {
      expect(wrapper.get(`[data-test="contract-status-${contract.id}"]`).text()).toBe(contract.expectedLabel)
    }

    expect(wrapper.get('[data-test="contract-status-2"]').classes()).toContain('el-tag--warning')
    expect(wrapper.get('[data-test="contract-status-2"]').classes()).not.toContain('contract-status-tag--pending-checkout')
    expect(wrapper.get('[data-test="contract-status-3"]').classes()).toContain('el-tag--success')
    expect(wrapper.get('[data-test="contract-status-4"]').classes()).toContain('contract-status-tag--pending-checkout')
    expect(wrapper.get('[data-test="contract-status-6"]').classes()).toContain('el-tag--danger')
    expect(wrapper.text()).not.toContain('ACTIVE')
    expect(wrapper.text()).not.toContain('PENDING_CHECKOUT')
  })

  it('合同详情将合同、账单和收款状态显示为中文', async () => {
    const payments: PaymentListItem[] = [
      {
        id: 71,
        receiptNo: 'SK2026080071',
        receiptType: '正式收款',
        paymentCategory: 'RENT',
        paymentDate: '2026-08-02',
        amount: '2200.00',
        method: 'WECHAT',
        status: 'CONFIRMED',
        contract: { id: 12, contractNo: activeContract().contractNo },
        tenant: { id: 19, name: '张三' },
      },
    ]
    const wrapper = mount(ContractDetailPanel, {
      props: {
        contract: activeContract(),
        bills: [
          {
            id: 1,
            periodSeq: 1,
            periodStart: '2026-08-01',
            periodEnd: '2026-08-31',
            payableAmount: '2200.00',
            outstandingAmount: '2200.00',
            status: 'OVERDUE',
          },
        ],
        payments,
        role: 'ADMIN',
      },
      global: { plugins: [ElementPlus] },
    })
    await nextTick()
    await flushPromises()

    expect(wrapper.text()).toContain('履约中')
    expect(wrapper.find('[data-test="contract-status-tag"]').classes()).toContain('el-tag--success')

    const billsTab = wrapper.findAll('[role="tab"]').find((item) => item.text().includes('租金账单'))
    await billsTab!.trigger('click')
    await flushPromises()
    const paymentsTab = wrapper.findAll('[role="tab"]').find((item) => item.text().includes('收款记录'))
    await paymentsTab!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已逾期')
    expect(wrapper.text()).toContain('已确认')
    expect(wrapper.text()).not.toContain('ACTIVE')
    expect(wrapper.text()).not.toContain('OVERDUE')
    expect(wrapper.text()).not.toContain('CONFIRMED')
  })
  it('只把履行中的固定月租合同认定为可退差', () => {
    expect(isFixedRentRebateEligible(activeContract())).toBe(true)
    expect(
      isFixedRentRebateEligible({
        ...activeContract(),
        status: 'PENDING_START',
      }),
    ).toBe(false)
    expect(
      isFixedRentRebateEligible({
        ...activeContract(),
        pricingMode: 'TIERED_RETROACTIVE',
      }),
    ).toBe(false)
    expect(isFixedRentRebateEligible(null)).toBe(false)
  })

  it('合同详情使用统一中文状态名称和待退租橙红色标签', async () => {
    const wrapper = mount(ContractDetailPanel, {
      props: { contract: activeContract(), role: 'ADMIN' },
      global: { plugins: [ElementPlus] },
    })

    expect(wrapper.text()).toContain('履约中')
    await wrapper.setProps({
      contract: { ...activeContract(), status: 'PENDING_CHECKOUT' },
    })
    expect(wrapper.get('[data-test="contract-status-tag"]').classes()).toContain('contract-status-tag--pending-checkout')
  })

  it.each([
    ['合同编号', '050012'],
    ['楼栋房号', '1栋301'],
    ['主租户姓名', '张三'],
  ])('按%s搜索符合退差条件的合同', (_field, keyword) => {
    const eligible = activeContract()
    const ineligible = {
      ...activeContract(),
      id: 13,
      contractNo: 'HT-OTHER',
      status: 'PENDING_START',
    }
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
    const percentage = normalizeConcessionType(
      {
        concessionType: 'FIXED_AMOUNT',
        applyMode: 'DATE_RANGE',
        startDate: '2026-08-01',
        endDate: '2026-08-10',
        fixedAmount: '300.00',
        reason: '测试',
      },
      'PERCENTAGE',
    )
    expect(percentage).toEqual({
      concessionType: 'PERCENTAGE',
      applyMode: 'BILLING_PERIODS',
      billingPeriodCount: 1,
      discountRate: '',
      reason: '测试',
    })
    expect(contractConcessionError([percentage])).toContain('优惠比例')

    const form = completeForm()
    form.concessions = [
      {
        concessionType: 'RENT_FREE',
        applyMode: 'DATE_RANGE',
        startDate: '2026-08-01',
        endDate: '2026-08-03',
        reason: '维修免租',
      },
      {
        concessionType: 'FIXED_AMOUNT',
        applyMode: 'BILLING_PERIODS',
        billingPeriodCount: 1,
        fixedAmount: '300.00',
        reason: '首期优惠',
      },
      {
        concessionType: 'PERCENTAGE',
        applyMode: 'BILLING_PERIODS',
        billingPeriodCount: 2,
        discountRate: '0.10',
        reason: '两期九折',
      },
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

    await wrapper.setProps({
      contract: { ...activeContract(), status: 'PENDING_START' },
    })
    expect(wrapper.find('[data-test="open-fixed-rent-rebate"]').exists()).toBe(false)

    await wrapper.setProps({
      contract: { ...activeContract(), pricingMode: 'TIERED_RETROACTIVE' },
    })
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
    const ineligible = {
      ...activeContract(),
      id: 15,
      contractNo: 'HT-NOT-ELIGIBLE',
      status: 'PENDING_START',
    }
    const wrapper = mount(FixedRentRebatePanel, {
      props: {
        contracts: [eligible, second, ineligible],
        contract: eligible,
        role: 'ADMIN',
      },
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
    wrapper.unmount()
  }, 10_000)

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
    expect(
      buildFixedRentRebatePayload(activeContract(), {
        rentBillId: 99,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        actualAmount: '100.00',
        differenceReason: '维修协商',
        settlementMethod: 'PREPAYMENT_CREDIT',
      }),
    ).toMatchObject({
      contractId: 12,
      sourceType: 'FIXED_RENT_MANUAL',
      rebateType: 'MANUAL',
      rentBillId: 99,
    })
  })

  it('合同详情展示仅属于当前合同的收款记录', async () => {
    const payments: PaymentListItem[] = [
      {
        id: 71,
        receiptNo: 'SK2026080071',
        receiptType: '正式收款',
        paymentCategory: 'RENT',
        paymentDate: '2026-08-02',
        amount: '2200.00',
        method: 'WECHAT',
        status: 'CONFIRMED',
        contract: { id: 12, contractNo: activeContract().contractNo },
        tenant: { id: 19, name: '张三' },
      },
    ]
    const wrapper = mount(ContractDetailPanel, {
      props: {
        contract: activeContract(),
        bills: [],
        files: [],
        changes: [],
        payments,
        role: 'ADMIN',
      },
      global: { plugins: [ElementPlus] },
    })
    const tab = wrapper.findAll('[role="tab"]').find((item) => item.text().includes('收款记录'))
    await tab!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('SK2026080071')
    expect(wrapper.text()).toContain('¥2,200.00')
  })

  it('合同图片附件提供预览和下载动作，非图片附件仅可下载', async () => {
    const jpeg = {
      id: 44,
      originalName: '合同.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: '1024',
    }
    const pdf = {
      id: 45,
      originalName: '合同.pdf',
      mimeType: 'application/pdf',
      sizeBytes: '2048',
    }
    const wrapper = mount(ContractDetailPanel, {
      props: {
        contract: activeContract(),
        bills: [],
        files: [jpeg, pdf],
        changes: [],
        payments: [],
        role: 'ADMIN',
      },
      global: { plugins: [ElementPlus] },
    })
    const tab = wrapper.findAll('[role="tab"]').find((item) => item.text().includes('附件'))
    await tab!.trigger('click')

    await wrapper.get('[data-test="download-contract-file-44"]').trigger('click')
    await wrapper.get('[data-test="preview-contract-file-44"]').trigger('click')

    expect(wrapper.find('[data-test="download-contract-file-45"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="preview-contract-file-45"]').exists()).toBe(false)
    expect(wrapper.emitted('download')?.[0]).toEqual([jpeg])
    expect(wrapper.emitted('preview')?.[0]).toEqual([jpeg])
  })
})

describe('????????', () => {
  it('????????????????', async () => {
    const wrapper = mount(ContractDetailPanel, {
      props: { contract: activeContract(), role: 'ADMIN' },
      global: { plugins: [ElementPlus] },
    })

    const button = wrapper.find('[data-test="open-checkout"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.emitted('checkout')).toEqual([[12]])

    await wrapper.setProps({
      contract: { ...activeContract(), status: 'PENDING_CHECKOUT' },
    })
    expect(wrapper.find('[data-test="open-checkout"]').exists()).toBe(false)

    await wrapper.setProps({
      contract: { ...activeContract(), status: 'ENDED' },
    })
    expect(wrapper.find('[data-test="open-checkout"]').exists()).toBe(false)
  })
})

describe('??????????', () => {
  it('????????????????????', async () => {
    const wrapper = mount(ContractDetailPanel, {
      props: { contract: activeContract(), role: 'ADMIN' },
      global: { plugins: [ElementPlus] },
    })

    const button = wrapper.find('[data-test="open-payment-collect"]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.emitted('payment')).toEqual([[12]])
    await wrapper.setProps({
      contract: { ...activeContract(), status: 'PENDING_CHECKOUT' },
    })
    expect(wrapper.find('[data-test="open-payment-collect"]').exists()).toBe(false)

    await wrapper.setProps({
      contract: { ...activeContract(), status: 'ENDED' },
    })
    expect(wrapper.find('[data-test="open-payment-collect"]').exists()).toBe(false)
  })
})

describe('合同附件图片预览生命周期', () => {
  type DownloadContractFile = (contractId: number, fileId: number) => Promise<Blob>
  const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')

  afterEach(() => {
    vi.restoreAllMocks()
    if (originalCreateObjectURL) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectURL)
    else Reflect.deleteProperty(URL, 'createObjectURL')
    if (originalRevokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectURL)
    else Reflect.deleteProperty(URL, 'revokeObjectURL')
  })

  async function mountWorkspace(download: DownloadContractFile) {
    const jpeg = {
      id: 44,
      originalName: '合同.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: '1024',
    }
    const png = {
      id: 45,
      originalName: '补充条款.png',
      mimeType: 'image/png',
      sizeBytes: '2048',
    }
    vi.spyOn(http, 'get').mockImplementation(
      (url: string) =>
        Promise.resolve({
          data: { data: url === '/properties/rooms' ? [] : { items: [] } },
        }) as never,
    )
    vi.spyOn(contractService, 'listContracts').mockResolvedValue([activeContract()])
    vi.spyOn(contractService, 'getContract').mockResolvedValue(activeContract())
    vi.spyOn(contractService, 'getContractBills').mockResolvedValue([])
    vi.spyOn(contractService, 'getContractFiles').mockResolvedValue([jpeg, png])
    vi.spyOn(contractService, 'getContractChanges').mockResolvedValue([])
    vi.spyOn(contractService, 'listFixedRentRebates').mockResolvedValue([])
    vi.spyOn(contractService, 'downloadContractFile').mockImplementation(download)
    vi.spyOn(paymentService, 'listAllPayments').mockResolvedValue([])

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/contracts',
          name: 'contracts',
          component: ContractsWorkspace,
        },
      ],
    })
    await router.push('/contracts?tab=detail&contractId=12')
    await router.isReady()
    const wrapper = mount(ContractsWorkspace, {
      global: { plugins: [createPinia(), router, ElementPlus] },
    })
    await flushPromises()
    return { wrapper, jpeg, png }
  }

  it('提供可见缩放控件并在切换附件时重置缩放比例', async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:contract-image-1').mockReturnValueOnce('blob:contract-image-2')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    const { wrapper } = await mountWorkspace(vi.fn<DownloadContractFile>().mockResolvedValue(new Blob(['image'])))

    await wrapper.get('[data-test="preview-contract-file-44"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="contract-preview-scale"]').text()).toBe('100%')
    expect(wrapper.get('[data-test="contract-image-preview"]').attributes('style')).toContain('scale(1)')

    await wrapper.get('[data-test="contract-preview-zoom-in"]').trigger('click')
    expect(wrapper.get('[data-test="contract-preview-scale"]').text()).toBe('125%')
    expect(wrapper.get('[data-test="contract-image-preview"]').attributes('style')).toContain('scale(1.25)')

    await wrapper.get('[data-test="contract-preview-reset"]').trigger('click')
    expect(wrapper.get('[data-test="contract-preview-scale"]').text()).toBe('100%')

    await wrapper.get('[data-test="contract-preview-zoom-in"]').trigger('click')
    await wrapper.get('[data-test="preview-contract-file-45"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="contract-preview-scale"]').text()).toBe('100%')
    expect(wrapper.get('[data-test="contract-image-preview"]').attributes('style')).toContain('scale(1)')
    wrapper.unmount()
  })
  it('预览关闭、切换附件和卸载时各释放一次临时对象地址', async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:contract-image-1').mockReturnValueOnce('blob:contract-image-2').mockReturnValueOnce('blob:contract-image-3')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    const { wrapper } = await mountWorkspace(vi.fn<DownloadContractFile>().mockResolvedValue(new Blob(['image'])))

    await wrapper.get('[data-test="preview-contract-file-44"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="contract-image-preview"]').attributes('src')).toBe('blob:contract-image-1')

    await wrapper.get('[data-test="preview-contract-file-45"]').trigger('click')
    await flushPromises()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:contract-image-1')
    expect(wrapper.get('[data-test="contract-image-preview"]').attributes('src')).toBe('blob:contract-image-2')

    wrapper
      .findAllComponents(ElDialog)
      .find((dialog) => dialog.props('modelValue'))!
      .vm.$emit('closed')
    await nextTick()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:contract-image-2')

    await wrapper.get('[data-test="preview-contract-file-44"]').trigger('click')
    await flushPromises()
    wrapper.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:contract-image-3')
    expect(revokeObjectURL).toHaveBeenCalledTimes(3)
  })

  it('旧预览请求晚于新请求返回时不覆盖当前图片且释放自身对象地址', async () => {
    let resolveOld!: (blob: Blob) => void
    let resolveNew!: (blob: Blob) => void
    const oldPreview = new Promise<Blob>((resolve) => {
      resolveOld = resolve
    })
    const newPreview = new Promise<Blob>((resolve) => {
      resolveNew = resolve
    })
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:contract-image-new').mockReturnValueOnce('blob:contract-image-stale')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    const download = vi
      .fn<DownloadContractFile>()
      .mockImplementationOnce(() => oldPreview)
      .mockImplementationOnce(() => newPreview)
    const { wrapper } = await mountWorkspace(download)

    await wrapper.get('[data-test="preview-contract-file-44"]').trigger('click')
    await nextTick()
    await wrapper.get('[data-test="preview-contract-file-45"]').trigger('click')
    await nextTick()

    resolveNew(new Blob(['new image']))
    await flushPromises()
    expect(wrapper.get('[data-test="contract-image-preview"]').attributes('src')).toBe('blob:contract-image-new')

    resolveOld(new Blob(['old image']))
    await flushPromises()
    expect(wrapper.get('[data-test="contract-image-preview"]').attributes('src')).toBe('blob:contract-image-new')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:contract-image-stale')
    wrapper.unmount()
  })
  it('预览请求失败显示中文错误且不保留临时对象地址', async () => {
    const createObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    const messageError = vi.spyOn(ElMessage, 'error')
    const { wrapper } = await mountWorkspace(vi.fn<DownloadContractFile>().mockRejectedValue(new Error('network failed')))

    await wrapper.get('[data-test="preview-contract-file-44"]').trigger('click')
    await flushPromises()

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="contract-image-preview"]').exists()).toBe(false)
    expect(messageError).toHaveBeenCalledWith('合同附件预览失败，请稍后重试')
  })
})
