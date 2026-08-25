import { describe, expect, it } from 'vitest'
import { roomContractRoute, supportedRoomContractId } from './room-detail-navigation'

describe('房源详情合同跳转', () => {
  it('有优先合同时直接进入对应合同详情', () => {
    expect(roomContractRoute(11, 27)).toEqual({
      path: '/contracts',
      query: { tab: 'detail', contractId: '27' },
    })
  })

  it('没有合同时进入当前房源的合同列表', () => {
    expect(roomContractRoute(11, null)).toEqual({
      path: '/contracts',
      query: { roomId: '11' },
    })
  })

  it('历史阶梯合同不进入固定月租详情工作区', () => {
    expect(supportedRoomContractId({ id: 27, pricingMode: 'FIXED' })).toBe(27)
    expect(supportedRoomContractId({ id: 28, pricingMode: 'TIERED_RETROACTIVE' })).toBeNull()
    expect(supportedRoomContractId(null)).toBeNull()
  })
})
