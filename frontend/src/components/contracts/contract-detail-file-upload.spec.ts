// @vitest-environment happy-dom

import ElementPlus, { ElUpload } from 'element-plus'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ContractDetail } from '../../types/contracts'
import ContractDetailPanel from './ContractDetailPanel.vue'

const contract: ContractDetail = {
  id: 12,
  contractNo: 'HT202608250001 | 1栋101 | 张三01',
  roomId: 11,
  room: { id: 11, fullHouseNo: '1栋101' },
  members: [{ memberRole: 'PRIMARY', tenant: { id: 9, name: '张三01' } }],
  startDate: '2026-08-25',
  endDate: '2027-08-24',
  monthlyRent: '3000.00',
  depositRequired: '10000.00',
  paymentCycleMonths: 1,
  status: 'ACTIVE',
  pricingMode: 'FIXED',
  commissions: [],
}

describe('合同详情附件追加上传', () => {
  it('管理员可上传新附件且游客只能查看', async () => {
    const admin = mount(ContractDetailPanel, {
      props: { contract, role: 'ADMIN' },
      global: { plugins: [ElementPlus] },
    })
    const upload = admin.findComponent(ElUpload)
    expect(upload.exists()).toBe(true)
    const file = new File(['%PDF-1.7'], '补充合同.pdf', { type: 'application/pdf' })
    ;(upload.props('onChange') as (value: { raw: File }) => void)({ raw: file })
    expect(admin.emitted('upload')).toEqual([[file]])

    const visitor = mount(ContractDetailPanel, {
      props: { contract, role: 'VISITOR' },
      global: { plugins: [ElementPlus] },
    })
    expect(visitor.findComponent(ElUpload).exists()).toBe(false)
  })
})
