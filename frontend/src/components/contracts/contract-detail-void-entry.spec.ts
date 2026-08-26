// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ContractDetail, ContractRole } from '../../types/contracts'
import ContractDetailPanel from './ContractDetailPanel.vue'

const contract = (status = 'ACTIVE'): ContractDetail => ({
  id: 86,
  contractNo: 'HT202608260086 | 8栋1203 | 陈晨',
  roomId: 803,
  room: { id: 803, fullHouseNo: '8栋1203' },
  members: [{ memberRole: 'PRIMARY', tenant: { id: 305, name: '陈晨' } }],
  startDate: '2026-08-01',
  endDate: '2027-07-31',
  monthlyRent: '4680.00',
  depositRequired: '9360.00',
  paymentCycleMonths: 1,
  status,
  pricingMode: 'FIXED',
  commissions: [],
})

function mountPanel(role: ContractRole, status = 'ACTIVE') {
  return mount(ContractDetailPanel, {
    props: { role, contract: contract(status) },
    global: { plugins: [ElementPlus] },
  })
}

describe('合同详情作废纠错入口', () => {
  it.each(['ADMIN', 'SUPER_ADMIN'] as const)('%s 可从非作废合同进入并发送合同编号', async (role) => {
    const wrapper = mountPanel(role)
    const entry = wrapper.get('[data-test="open-contract-void-correction"]')

    await entry.trigger('click')

    expect(wrapper.emitted('void-correction')).toEqual([[86]])
  })

  it('游客和已作废合同均不显示再次作废入口', () => {
    expect(mountPanel('VISITOR').find('[data-test="open-contract-void-correction"]').exists()).toBe(false)
    expect(mountPanel('ADMIN', 'VOIDED').find('[data-test="open-contract-void-correction"]').exists()).toBe(false)
    expect(mountPanel('SUPER_ADMIN', 'VOIDED').find('[data-test="open-contract-void-correction"]').exists()).toBe(false)
  })

  it('已作废详情显示红色标签并保留附件、历史和只读提成', async () => {
    const voided = {
      ...contract('VOIDED'),
      commissions: [{ id: 19, recipientName: '招商主管', amount: '680.00' }],
    }
    const file = { id: 501, originalName: '原合同.png', mimeType: 'image/png', sizeBytes: '4096' }
    const change = {
      id: 41,
      changeNo: 'HTBG202608260041',
      changeType: 'RENT_CHANGE',
      effectiveDate: '2026-08-20',
      reason: '租金录入纠错',
      approvalStatus: 'APPROVED',
      beforeSnapshot: { monthlyRent: '4500.00' },
      afterSnapshot: { monthlyRent: '4680.00' },
    }
    const wrapper = mount(ContractDetailPanel, {
      props: { role: 'SUPER_ADMIN', contract: voided, files: [file], changes: [change] },
      global: { plugins: [ElementPlus] },
    })

    expect(wrapper.get('[data-test="contract-status-tag"]').text()).toBe('已作废')
    expect(wrapper.get('[data-test="contract-status-tag"]').classes()).toContain('el-tag--danger')
    expect(wrapper.find('[data-test="open-payment-collect"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="open-checkout"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="open-fixed-rent-rebate"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="maintain-commission"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('招商主管')
    expect(wrapper.text()).toContain('¥680.00')

    await wrapper.findAll('[role="tab"]').find((item) => item.text().includes('附件'))!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="append-contract-file"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="preview-contract-file-501"]').text()).toBe('预览')
    expect(wrapper.get('[data-test="download-contract-file-501"]').text()).toBe('下载')

    await wrapper.findAll('[role="tab"]').find((item) => item.text().includes('变更记录'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('HTBG202608260041')
    expect(wrapper.text()).toContain('租金录入纠错')
  })
})
