// @vitest-environment happy-dom

import ElementPlus, { ElInput, ElMessage } from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateContractRemark } from '../../services/contracts'
import type { ContractDetail } from '../../types/contracts'
import ContractDetailPanel from './ContractDetailPanel.vue'

vi.mock('../../services/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/contracts')>()),
  updateContractRemark: vi.fn(),
}))

const contract = (status: ContractDetail['status'] = 'ACTIVE'): ContractDetail => ({
  id: 7,
  contractNo: 'HT202608050001 | 2栋301 | 李四',
  roomId: 21,
  room: { id: 21, fullHouseNo: '2栋301' },
  members: [{ memberRole: 'PRIMARY', tenant: { id: 9, name: '李四' } }],
  startDate: '2026-08-05',
  endDate: '2027-08-04',
  monthlyRent: '3000.00',
  depositRequired: '3000.00',
  paymentCycleMonths: 1,
  status,
  pricingMode: 'FIXED',
  remark: '原合同备注',
  commissions: [],
})

function mountPanel(role: 'SUPER_ADMIN' | 'ADMIN' | 'VISITOR', value = contract()) {
  return mount(ContractDetailPanel, {
    props: { role, contract: value },
    global: { plugins: [ElementPlus], stubs: { teleport: true } },
  })
}

describe('合同详情备注维护', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateContractRemark).mockResolvedValue({
      id: 7,
      remark: '补充说明',
      updatedAt: '2026-09-01T01:00:00.000Z',
    })
  })

  it('仅管理员可编辑非作废合同，已结束合同仍可编辑', () => {
    expect(mountPanel('SUPER_ADMIN').find('[data-test="edit-contract-remark"]').exists()).toBe(true)
    expect(mountPanel('ADMIN', contract('ENDED')).find('[data-test="edit-contract-remark"]').exists()).toBe(true)
    expect(mountPanel('VISITOR').find('[data-test="edit-contract-remark"]').exists()).toBe(false)
    expect(mountPanel('ADMIN', contract('VOIDED')).find('[data-test="edit-contract-remark"]').exists()).toBe(false)
  })

  it('打开弹窗回填现有备注并限制为500字', async () => {
    const wrapper = mountPanel('ADMIN')

    await wrapper.get('[data-test="edit-contract-remark"]').trigger('click')
    await flushPromises()

    const input = wrapper
      .findAllComponents(ElInput)
      .find((item) => String(item.props('placeholder')).includes('可补充合同相关说明'))
    expect(input?.props('modelValue')).toBe('原合同备注')
    expect(Number(input?.props('maxlength'))).toBe(500)
    expect(input?.props('showWordLimit')).toBe(true)
  })

  it('去除首尾空白后保存并通知父页面刷新详情', async () => {
    const wrapper = mountPanel('ADMIN')
    const vm = wrapper.vm as unknown as {
      remarkForm: string
      openRemark: () => void
      saveRemark: () => Promise<void>
    }
    vm.openRemark()
    vm.remarkForm = '  补充说明  '

    await vm.saveRemark()

    expect(updateContractRemark).toHaveBeenCalledWith(7, '补充说明')
    expect(wrapper.emitted('remarkChanged')).toHaveLength(1)
  })

  it('清空备注时发送null', async () => {
    const wrapper = mountPanel('SUPER_ADMIN')
    const vm = wrapper.vm as unknown as {
      remarkForm: string
      saveRemark: () => Promise<void>
    }
    vm.remarkForm = '   '

    await vm.saveRemark()

    expect(updateContractRemark).toHaveBeenCalledWith(7, null)
    expect(wrapper.emitted('remarkChanged')).toHaveLength(1)
  })

  it('保存失败时展示后端中文提示且不通知刷新', async () => {
    vi.mocked(updateContractRemark).mockRejectedValueOnce({
      response: { data: { message: '已作废合同不能修改备注' } },
    })
    const error = vi.spyOn(ElMessage, 'error').mockImplementation(() => undefined as never)
    const wrapper = mountPanel('ADMIN')
    const vm = wrapper.vm as unknown as { saveRemark: () => Promise<void> }

    await vm.saveRemark()

    expect(error).toHaveBeenCalledWith('已作废合同不能修改备注')
    expect(wrapper.emitted('remarkChanged')).toBeUndefined()
  })
})
