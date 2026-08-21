// @vitest-environment happy-dom

import ElementPlus, { ElMessageBox } from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../../services/http'
import type { ContractDetail } from '../../types/contracts'
import ContractDetailPanel from './ContractDetailPanel.vue'

vi.mock('../../services/http', () => ({
  http: { post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))

const contract = (commission?: { id: number; recipientName: string; amount: string }): ContractDetail => ({
  id: 8,
  contractNo: 'HT202608210001 | 1栋101 | 张三',
  roomId: 11,
  room: { id: 11, fullHouseNo: '1栋101' },
  members: [{ memberRole: 'PRIMARY', tenant: { id: 9, name: '张三' } }],
  startDate: '2026-08-01',
  endDate: '2027-07-31',
  monthlyRent: '3000.00',
  depositRequired: '3000.00',
  paymentCycleMonths: 1,
  status: 'ACTIVE',
  pricingMode: 'FIXED',
  commissions: commission ? [commission] : [],
})

function mountPanel(role: 'SUPER_ADMIN' | 'ADMIN' | 'VISITOR', value = contract()) {
  return mount(ContractDetailPanel, {
    props: { role, contract: value },
    global: { plugins: [ElementPlus] },
  })
}

describe('合同详情租房提成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(http.post).mockResolvedValue({ data: { code: 200 } })
    vi.mocked(http.patch).mockResolvedValue({ data: { code: 200 } })
    vi.mocked(http.delete).mockResolvedValue({ data: { code: 200 } })
  })

  it('only shows the maintenance entry to a super administrator', () => {
    expect(mountPanel('SUPER_ADMIN').find('[data-test="maintain-commission"]').exists()).toBe(true)
    expect(mountPanel('ADMIN').find('[data-test="maintain-commission"]').exists()).toBe(false)
    expect(mountPanel('VISITOR').find('[data-test="maintain-commission"]').exists()).toBe(false)
  })

  it('creates a zero-value commission through the existing endpoint and requests a refresh', async () => {
    const wrapper = mountPanel('SUPER_ADMIN')
    const vm = wrapper.vm as unknown as {
      commissionForm: { recipientName: string; amount: string }
      saveCommission: () => Promise<void>
    }
    vm.commissionForm.recipientName = '招商主管'
    vm.commissionForm.amount = '0'

    await vm.saveCommission()
    await flushPromises()

    expect(http.post).toHaveBeenCalledWith('/commissions', {
      contractId: 8,
      recipientName: '招商主管',
      amount: '0.00',
    })
    expect(wrapper.emitted('commissionChanged')).toHaveLength(1)
  })

  it('updates and deletes an existing commission by id', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const wrapper = mountPanel('SUPER_ADMIN', contract({ id: 31, recipientName: '招商主管', amount: '600.00' }))
    const vm = wrapper.vm as unknown as {
      commissionForm: { recipientName: string; amount: string }
      openCommission: () => void
      saveCommission: () => Promise<void>
      removeCommission: () => Promise<void>
    }
    vm.openCommission()
    vm.commissionForm.amount = '800'

    await vm.saveCommission()
    await vm.removeCommission()
    await flushPromises()

    expect(http.patch).toHaveBeenCalledWith('/commissions/31', {
      recipientName: '招商主管',
      amount: '800.00',
    })
    expect(http.delete).toHaveBeenCalledWith('/commissions/31')
    expect(wrapper.emitted('commissionChanged')).toHaveLength(2)
  })
})
