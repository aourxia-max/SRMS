// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http } from '../services/http'
import { useApprovalTasksStore } from '../stores/approval-tasks'
import { useSessionStore } from '../stores/session'
import ContractChangesView from './ContractChangesView.vue'

vi.mock('../services/http', () => ({
  http: { get: vi.fn(), post: vi.fn() },
}))

function piniaFor(role: 'SUPER_ADMIN' | 'ADMIN') {
  const pinia = createPinia()
  const session = useSessionStore(pinia)
  session.user = { id: 1, username: 'tester', displayName: '测试员', role }
  session.accessToken = 'test-token'
  const approvals = useApprovalTasksStore(pinia)
  approvals.items = [
    {
      id: 1,
      type: 'CONTRACT_CHANGE',
      label: '合同变更',
      businessNo: 'BG001',
      contractId: 8,
      contractNo: 'HT202609010001 | 1栋101 | 张三',
      roomId: 11,
      fullHouseNo: '1栋101',
      submittedAt: '2026-09-01T01:00:00.000Z',
    },
    {
      id: 2,
      type: 'PAYMENT_VOID_REQUEST',
      label: '收款作废',
      businessNo: 'ZF002',
      contractId: 9,
      contractNo: 'HT002',
      roomId: 12,
      fullHouseNo: '1栋102',
      submittedAt: '2026-09-01T02:00:00.000Z',
    },
  ]
  return pinia
}

describe('合同变更全局待审批列表', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(http.get).mockImplementation(async (url) => {
      if (url === '/contracts') {
        return {
          data: {
            data: [
              {
                id: 8,
                contractNo: 'HT202609010001 | 1栋101 | 张三',
                room: { fullHouseNo: '1栋101' },
                members: [],
              },
            ],
          },
        }
      }
      if (url === '/contracts/8') {
        return { data: { data: { id: 8, concessions: [] } } }
      }
      if (url === '/contracts/8/changes') {
        return {
          data: {
            data: [
              {
                id: 1,
                changeNo: 'BG001',
                changeType: 'TERM',
                effectiveDate: '2026-09-01',
                reason: '调整租期',
                approvalStatus: 'PENDING',
              },
            ],
          },
        }
      }
      return { data: { data: [] } }
    })
  })

  it('超级管理员无需先选择合同即可看到待审批合同变更并定位处理', async () => {
    const wrapper = mount(ContractChangesView, {
      global: { plugins: [piniaFor('SUPER_ADMIN'), ElementPlus] },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('待审批变更')
    expect(wrapper.text()).toContain('BG001')
    expect(wrapper.text()).toContain('1栋101')
    expect(wrapper.text()).not.toContain('ZF002')

    await wrapper.get('[data-test="locate-pending-change-1"]').trigger('click')
    await flushPromises()
    expect(http.get).toHaveBeenCalledWith('/contracts/8')
    expect(http.get).toHaveBeenCalledWith('/contracts/8/changes')
    wrapper.unmount()
  })

  it('普通管理员不显示全局待审批列表', async () => {
    const wrapper = mount(ContractChangesView, {
      global: { plugins: [piniaFor('ADMIN'), ElementPlus] },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('待审批变更')
    wrapper.unmount()
  })
})
