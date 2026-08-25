// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ContractListItem } from '../../types/contracts'
import ContractListPanel from './ContractListPanel.vue'

function contract(id: number, roomId: number, room: string): ContractListItem {
  return {
    id,
    contractNo: `HT${id}`,
    roomId,
    room: { id: roomId, fullHouseNo: room },
    members: [],
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    monthlyRent: '3000.00',
    status: 'ACTIVE',
    pricingMode: 'FIXED',
  }
}

describe('合同列表房源上下文', () => {
  it('从房源详情进入时只展示该房源合同', async () => {
    const wrapper = mount(ContractListPanel, {
      props: { contracts: [contract(1, 11, '1栋101'), contract(2, 12, '1栋102')], initialRoomId: 11 },
      global: { plugins: [ElementPlus] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('HT1')
    expect(wrapper.text()).not.toContain('HT2')
  })
})
