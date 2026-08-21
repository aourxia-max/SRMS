// @vitest-environment happy-dom

import ElementPlus, { ElMessage, ElSelect } from 'element-plus'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { paymentApi } from '../../services/payments'
import type { RentBill } from '../../types/payments'
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

function bill(id: number, outstandingAmount: string): RentBill {
  return {
    id,
    billNo: `ZD-${id}`,
    periodSeq: 1,
    periodStart: '2026-08-01',
    periodEnd: '2026-08-31',
    dueDate: '2026-08-01',
    payableAmount: outstandingAmount,
    receivedAmount: '0.00',
    outstandingAmount,
    status: 'PENDING',
  }
}

async function mountView() {
  vi.spyOn(paymentApi, 'contracts').mockResolvedValue(contracts)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/payments/collect', component: PaymentCollectView },
      { path: '/payments/detail', component: { template: '<div />' } },
      { path: '/payments/reviews', component: { template: '<div />' } },
    ],
  })
  await router.push('/payments/collect')
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

async function selectContract(contractSelect: ReturnType<typeof mount>['vm'], contractId: number) {
  contractSelect.$emit('update:modelValue', contractId)
  contractSelect.$emit('change', contractId)
  await nextTick()
}

function amountValue(wrapper: ReturnType<typeof mount>) {
  return (wrapper.get('input[placeholder="0.00"]').element as HTMLInputElement).value
}

afterEach(() => vi.restoreAllMocks())

describe('收款登记合同切换', () => {
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
})
