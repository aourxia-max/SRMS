// @vitest-environment happy-dom

import ElementPlus, { ElMessage, ElSelect, ElSwitch } from 'element-plus'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { paymentApi } from '../../services/payments'
import { checkoutApi } from '../../services/checkout'
import type { ContractSummary, RentBill } from '../../types/payments'
import PaymentCollectView from './PaymentCollectView.vue'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const contracts = [
  { id: 1, contractNo: 'HT-001', room: { id: 11, fullHouseNo: '1栋101' } },
  { id: 2, contractNo: 'HT-002', room: { id: 12, fullHouseNo: '1栋102' } },
]

function bill(id: number, outstandingAmount: string, periodSeq = 1): RentBill {
  return {
    id,
    billCategory: 'RENT',
    billNo: `ZD-${id}`,
    periodSeq,
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    dueDate: '2026-08-01',
    payableAmount: outstandingAmount,
    receivedAmount: '0.00',
    outstandingAmount,
    status: 'PENDING',
  }
}

async function mountView(path = '/payments/collect', contractRows: ContractSummary[] = contracts) {
  vi.spyOn(paymentApi, 'contracts').mockResolvedValue(contractRows)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/payments/collect', component: PaymentCollectView },
      { path: '/payments/detail', component: { template: '<div />' } },
      { path: '/payments/reviews', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(PaymentCollectView, {
    global: { plugins: [createPinia(), router, ElementPlus] },
  })
  await flushPromises()
  const contractSelect = wrapper.findAllComponents(ElSelect)
    .find((select) => select.props('placeholder') === '合同编号 / 房号')
  if (!contractSelect) throw new Error('contract select not found')
  return { wrapper, contractSelect }
}

async function selectContract(
  contractSelect: ReturnType<typeof mount>['vm'],
  contractId: number | undefined,
) {
  contractSelect.$emit('update:modelValue', contractId)
  contractSelect.$emit('change', contractId)
  await nextTick()
}

function amountValue(wrapper: ReturnType<typeof mount>) {
  return (wrapper.get('input[placeholder="0.00"]').element as HTMLInputElement).value
}

function adjustmentControls(wrapper: ReturnType<typeof mount>) {
  const toggle = wrapper.findComponent(ElSwitch)
  const rentBillSelect = wrapper.findAllComponents(ElSelect)
    .find((select) => select.props('placeholder') === '归属账期')
  const adjustmentTypeSelect = wrapper.findAllComponents(ElSelect)
    .find((select) => ['DISCOUNT', 'WAIVER'].includes(String(select.props('modelValue'))))
  if (!toggle.exists() || !rentBillSelect || !adjustmentTypeSelect) {
    throw new Error('adjustment controls not found')
  }
  return {
    toggle,
    rentBillSelect,
    adjustmentTypeSelect,
    amountInput: wrapper.get('input[placeholder="金额"]'),
    reasonInput: wrapper.get('input[placeholder="原因（必填）"]'),
  }
}

async function populateAdjustment(wrapper: ReturnType<typeof mount>) {
  const toggle = wrapper.findComponent(ElSwitch)
  toggle.vm.$emit('update:modelValue', true)
  await nextTick()
  const controls = adjustmentControls(wrapper)
  controls.rentBillSelect.vm.$emit('update:modelValue', 101)
  controls.adjustmentTypeSelect.vm.$emit('update:modelValue', 'WAIVER')
  await controls.amountInput.setValue('25.00')
  await controls.reasonInput.setValue('跨合同不应保留')
  await nextTick()
  expect(controls.toggle.props('modelValue')).toBe(true)
  expect(controls.rentBillSelect.props('modelValue')).toBe(101)
  expect(controls.adjustmentTypeSelect.props('modelValue')).toBe('WAIVER')
  expect((controls.amountInput.element as HTMLInputElement).value).toBe('25.00')
  expect((controls.reasonInput.element as HTMLInputElement).value).toBe('跨合同不应保留')
}

async function expectNeutralAdjustment(wrapper: ReturnType<typeof mount>) {
  const toggle = wrapper.findComponent(ElSwitch)
  expect(toggle.props('modelValue')).toBe(false)
  toggle.vm.$emit('update:modelValue', true)
  await nextTick()
  const controls = adjustmentControls(wrapper)
  expect(controls.rentBillSelect.props('modelValue')).toBeUndefined()
  expect(controls.adjustmentTypeSelect.props('modelValue')).toBe('DISCOUNT')
  expect((controls.amountInput.element as HTMLInputElement).value).toBe('')
  expect((controls.reasonInput.element as HTMLInputElement).value).toBe('')
  controls.toggle.vm.$emit('update:modelValue', false)
  await nextTick()
}

afterEach(() => vi.restoreAllMocks())

describe('收款登记合同切换', () => {
  it('切换合同时在新请求返回前重置全部调整字段且旧响应或失败不能恢复', async () => {
    const staleBills = deferred<RentBill[]>()
    const stalePrepayments = deferred<{ balance: string; items: Record<string, unknown>[] }>()
    const failedBills = deferred<RentBill[]>()
    const failedPrepayments = deferred<{ balance: string; items: Record<string, unknown>[] }>()
    let contractOneBillCalls = 0
    let contractOnePrepaymentCalls = 0
    vi.spyOn(paymentApi, 'bills').mockImplementation((contractId) => {
      if (contractId === 2) return staleBills.promise
      contractOneBillCalls += 1
      return contractOneBillCalls === 1
        ? Promise.resolve([bill(101, '111.00')])
        : failedBills.promise
    })
    vi.spyOn(paymentApi, 'prepayments').mockImplementation((contractId) => {
      if (contractId === 2) return stalePrepayments.promise
      contractOnePrepaymentCalls += 1
      return contractOnePrepaymentCalls === 1
        ? Promise.resolve({ balance: '11.00', items: [] })
        : failedPrepayments.promise
    })
    vi.spyOn(ElMessage, 'error')
    const { wrapper, contractSelect } = await mountView()

    await selectContract(contractSelect.vm, 1)
    await flushPromises()
    await populateAdjustment(wrapper)

    await selectContract(contractSelect.vm, 2)
    await expectNeutralAdjustment(wrapper)

    await selectContract(contractSelect.vm, 1)
    staleBills.resolve([bill(202, '222.00')])
    stalePrepayments.resolve({ balance: '22.00', items: [] })
    failedBills.reject(new Error('network failed'))
    failedPrepayments.resolve({ balance: '99.00', items: [] })
    await flushPromises()
    await expectNeutralAdjustment(wrapper)
    wrapper.unmount()
  })

  it('清空合同选择时重置全部调整字段', async () => {
    vi.spyOn(paymentApi, 'bills').mockResolvedValue([bill(101, '111.00')])
    vi.spyOn(paymentApi, 'prepayments').mockResolvedValue({ balance: '11.00', items: [] })
    const { wrapper, contractSelect } = await mountView()

    await selectContract(contractSelect.vm, 1)
    await flushPromises()
    await populateAdjustment(wrapper)

    await selectContract(contractSelect.vm, undefined)
    await expectNeutralAdjustment(wrapper)
    wrapper.unmount()
  })
  it('切换合同时立即清空旧状态且只允许最新请求写回', async () => {
    const firstBills = deferred<RentBill[]>()
    const firstPrepayments = deferred<{ balance: string; items: Record<string, unknown>[] }>()
    const secondBills = deferred<RentBill[]>()
    const secondPrepayments = deferred<{ balance: string; items: Record<string, unknown>[] }>()
    vi.spyOn(paymentApi, 'bills').mockImplementation((contractId) => (
      contractId === 1 ? firstBills.promise : secondBills.promise
    ))
    vi.spyOn(paymentApi, 'prepayments').mockImplementation((contractId) => (
      contractId === 1 ? firstPrepayments.promise : secondPrepayments.promise
    ))
    const { wrapper, contractSelect } = await mountView()

    await selectContract(contractSelect.vm, 1)
    await selectContract(contractSelect.vm, 2)
    expect(amountValue(wrapper)).toBe('')
    expect(wrapper.text()).not.toContain('¥111.00')

    secondBills.resolve([bill(202, '222.00')])
    secondPrepayments.resolve({ balance: '22.00', items: [] })
    await flushPromises()
    expect(amountValue(wrapper)).toBe('222.00')
    expect(wrapper.text()).toContain('¥22.00')

    firstBills.resolve([bill(101, '111.00')])
    firstPrepayments.resolve({ balance: '11.00', items: [] })
    await flushPromises()
    expect(amountValue(wrapper)).toBe('222.00')
    expect(wrapper.text()).toContain('¥22.00')
    expect(wrapper.text()).not.toContain('¥11.00')
    wrapper.unmount()
  })

  it('路由指向已作废合同时不自动选中或提交收款', async () => {
    const bills = vi.spyOn(paymentApi, 'bills').mockResolvedValue([])
    const prepayments = vi.spyOn(paymentApi, 'prepayments').mockResolvedValue({ balance: '0.00', items: [] })
    const record = vi.spyOn(paymentApi, 'record')
    const { wrapper, contractSelect } = await mountView('/payments/collect?contractId=2', [
      { ...contracts[0], status: 'ACTIVE' },
      { ...contracts[1], status: 'VOIDED' },
    ])

    expect(contractSelect.props('modelValue')).toBeUndefined()
    expect(bills).not.toHaveBeenCalled()
    expect(prepayments).not.toHaveBeenCalled()
    const submit = wrapper.findAll('button').find((button) => button.text().includes('确认收款并生成票据'))
    if (!submit) throw new Error('submit button not found')
    await submit.trigger('click')
    expect(record).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('从租金账单入口自动带入合同并连续选择到目标账期', async () => {
    vi.spyOn(paymentApi, 'bills').mockResolvedValue([
      bill(101, '100.00', 1),
      bill(102, '200.00', 2),
      bill(103, '300.00', 3),
    ])
    vi.spyOn(paymentApi, 'prepayments').mockResolvedValue({ balance: '0.00', items: [] })

    const { wrapper, contractSelect } = await mountView('/payments/collect?contractId=1&rentBillId=102')
    await flushPromises()

    expect(contractSelect.props('modelValue')).toBe(1)
    expect(amountValue(wrapper)).toBe('300.00')
    wrapper.unmount()
  })

  it('新合同加载失败时不在新合同编号下保留旧账单、预收款或建议金额', async () => {
    const failedBills = deferred<RentBill[]>()
    const failedPrepayments = deferred<{ balance: string; items: Record<string, unknown>[] }>()
    vi.spyOn(paymentApi, 'bills').mockImplementation((contractId) => (
      contractId === 1 ? Promise.resolve([bill(101, '111.00')]) : failedBills.promise
    ))
    vi.spyOn(paymentApi, 'prepayments').mockImplementation((contractId) => (
      contractId === 1
        ? Promise.resolve({ balance: '11.00', items: [] })
        : failedPrepayments.promise
    ))
    const messageError = vi.spyOn(ElMessage, 'error')
    const { wrapper, contractSelect } = await mountView()

    await selectContract(contractSelect.vm, 1)
    await flushPromises()
    expect(amountValue(wrapper)).toBe('111.00')
    expect(wrapper.text()).toContain('¥11.00')

    await selectContract(contractSelect.vm, 2)
    expect(amountValue(wrapper)).toBe('')
    expect(wrapper.text()).not.toContain('¥11.00')

    failedBills.reject(new Error('network failed'))
    failedPrepayments.resolve({ balance: '99.00', items: [] })
    await flushPromises()
    expect(amountValue(wrapper)).toBe('')
    expect(wrapper.text()).not.toContain('¥99.00')
    expect(messageError).toHaveBeenCalledWith('合同账单加载失败，请稍后重试')
    wrapper.unmount()
  })
  it('从退租补收入口自动带入合同和实时未收金额', async () => {
    vi.spyOn(paymentApi, 'bills').mockResolvedValue([bill(101, '999.00')])
    vi.spyOn(paymentApi, 'prepayments').mockResolvedValue({ balance: '0.00', items: [] })
    vi.spyOn(checkoutApi, 'detail').mockResolvedValue({
      id: 8,
      settlementNo: 'TZ202608220008',
      status: 'APPROVED',
      contractId: 1,
      depositRefundableAmount: '0.00',
      prepaymentRefundableAmount: '0.00',
      finalReceivable: '150.00',
      supplementalRequired: true,
      supplementalArrearsAmount: '50.00',
      supplementalInspectionAmount: '100.00',
      supplementalReceivedAmount: '75.00',
      supplementalOutstandingAmount: '75.00',
    })

    const { wrapper, contractSelect } = await mountView('/payments/collect?contractId=1&checkoutSettlementId=8')
    await flushPromises()

    expect(contractSelect.props('modelValue')).toBe(1)
    expect(amountValue(wrapper)).toBe('75.00')
    expect(wrapper.text()).toContain('退租补收')
    expect(wrapper.text()).not.toContain('本次同时提交优惠/减免申请')
    expect(contractSelect.props('disabled')).toBe(true)
    expect(wrapper.text()).not.toContain('预计转入预收款')
    expect(wrapper.text()).not.toContain('普通管理员必须从最早未结账期连续选择')
    expect(wrapper.text()).toContain('欠租补收')
    expect(wrapper.text()).toContain('验房扣款')
    wrapper.unmount()
  })
})
