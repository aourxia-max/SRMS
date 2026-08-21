// @vitest-environment happy-dom

import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import ContractsWorkspace from '../views/contracts/ContractsWorkspace.vue'
import { routes } from './index'

const mocks = vi.hoisted(() => ({
  getContract: vi.fn(),
  listContracts: vi.fn(),
}))

vi.mock('../services/http', () => ({
  http: {
    get: vi.fn((url: string) => Promise.resolve({
      data: { data: url === '/properties/rooms' ? [] : { items: [] } },
    })),
  },
}))

vi.mock('../services/payments', () => ({
  listAllPayments: vi.fn().mockResolvedValue([]),
}))

vi.mock('../services/contracts', () => ({
  approveFixedRentRebate: vi.fn(),
  confirmContractDraft: vi.fn(),
  confirmFixedContract: vi.fn(),
  createContractDraft: vi.fn(),
  createLatestRequestGuard: () => {
    let generation = 0
    return { next: () => ++generation, isCurrent: (value: number) => value === generation }
  },
  filterFixedRentRebateContracts: (contracts: typeof contract[], keyword: string) => contracts.filter((item) => item.status === 'ACTIVE' && item.pricingMode === 'FIXED' && `${item.contractNo}|${item.room?.fullHouseNo}|${item.members?.[0]?.tenant.name}`.toLowerCase().includes(keyword.trim().toLowerCase())),
  fixedRentRebateContractLabel: (item: typeof contract) => `${item.contractNo}｜${item.room?.fullHouseNo}｜${item.members?.[0]?.tenant.name}`,
  isFixedRentRebateEligible: (item?: typeof contract | null) => item?.status === 'ACTIVE' && item.pricingMode === 'FIXED',
  downloadContractFile: vi.fn(),
  getContract: mocks.getContract,
  getContractBills: vi.fn().mockResolvedValue([]),
  getContractChanges: vi.fn().mockResolvedValue([]),
  getContractDraft: vi.fn(),
  getContractFiles: vi.fn().mockResolvedValue([]),
  listContracts: mocks.listContracts,
  listFixedRentRebates: vi.fn().mockResolvedValue([]),
  previewFixedContract: vi.fn(),
  rejectFixedRentRebate: vi.fn(),
  submitFixedRentRebate: vi.fn(),
  toContractPayload: vi.fn((value) => value),
  updateContractDraft: vi.fn(),
  uploadContractFile: vi.fn(),
}))

const contract = {
  id: 12,
  contractNo: 'HT202608050012 | 1栋301 | 张三',
  roomId: 8,
  room: { id: 8, fullHouseNo: '1栋301' },
  members: [{ memberRole: 'PRIMARY', tenant: { id: 19, name: '张三' } }],
  startDate: '2026-08-01',
  endDate: '2027-07-31',
  monthlyRent: '2200.00',
  status: 'ACTIVE',
  pricingMode: 'FIXED',
}

function testRouter() {
  return createRouter({ history: createMemoryHistory(), routes })
}

async function mountWorkspace(path: string) {
  const router = testRouter()
  await router.push(path)
  await router.isReady()
  const wrapper = mount(ContractsWorkspace, {
    global: { plugins: [createPinia(), router, ElementPlus] },
  })
  await flushPromises()
  return { router, wrapper }
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mocks.listContracts.mockResolvedValue([contract])
  mocks.getContract.mockResolvedValue(contract)
})

describe('固定合同工作区路由', () => {
  it('旧退差地址落到固定月租退差页签', async () => {
    const router = testRouter()

    await router.push('/pricing-rebates')
    await router.isReady()

    expect(router.currentRoute.value.fullPath).toBe('/contracts?tab=fixed-rebate')
    expect(router.currentRoute.value.name).toBe('contracts')
  })

  it('从查询参数恢复新增合同页签', async () => {
    const { wrapper } = await mountWorkspace('/contracts?tab=create')

    expect(wrapper.get('.contract-top-nav button.active').text()).toBe('新增合同')
  })

  it('从 contractId 恢复已选合同并进入指定页签', async () => {
    const { wrapper } = await mountWorkspace('/contracts?tab=fixed-rebate&contractId=12')

    expect(mocks.getContract).toHaveBeenCalledWith(12)
    expect(wrapper.get('.contract-top-nav button.active').text()).toBe('固定月租退差')
    expect(wrapper.text()).toContain('HT202608050012')
  })

  it('从合同详情发起退差时保留当前合同并写入可恢复地址', async () => {
    const { router, wrapper } = await mountWorkspace('/contracts?tab=detail&contractId=12')
    await wrapper.get('[data-test="open-fixed-rent-rebate"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('.contract-top-nav button.active').text()).toBe('固定月租退差')
    expect(router.currentRoute.value.query).toEqual({ tab: 'fixed-rebate', contractId: '12' })
    expect(wrapper.text()).toContain('HT202608050012')
  })

  it('退差地址中的合同无资格时不载入可提交合同', async () => {
    mocks.listContracts.mockResolvedValue([{ ...contract, status: 'PENDING_START' }])
    const { wrapper } = await mountWorkspace('/contracts?tab=fixed-rebate&contractId=12')

    expect(mocks.getContract).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请选择履行中的固定月租合同')
    expect(wrapper.text()).not.toContain('金额与原因')
  })

  it('切换顶部页签时同步更新可分享地址', async () => {
    const { router, wrapper } = await mountWorkspace('/contracts')

    const button = wrapper.findAll('.contract-top-nav button').find((item) => item.text() === '新增合同')
    await button!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ tab: 'create' })
  })
})
