import { describe, expect, it } from 'vitest'
import type { ContractListItem } from '../types/contracts'
import { contractChangeOptionLabel } from './contract-change-contract-option'

const contract: ContractListItem = {
  id: 12,
  contractNo: 'HT202608050001',
  roomId: 21,
  room: { id: 21, fullHouseNo: '2栋301' },
  members: [{ memberRole: 'PRIMARY', tenant: { id: 9, name: '李四' } }],
  startDate: '2026-08-05',
  endDate: '2027-08-04',
  monthlyRent: '3000.00',
  status: 'ACTIVE',
  pricingMode: 'FIXED',
}

describe('合同变更合同选项', () => {
  it('组合合同编号、完整房号和当前主承租人姓名', () => {
    expect(contractChangeOptionLabel(contract)).toBe('HT202608050001｜2栋301｜李四')
  })

  it('缺少当前主承租人时显示直观占位', () => {
    expect(contractChangeOptionLabel({ ...contract, members: [] })).toBe(
      'HT202608050001｜2栋301｜未记录承租人',
    )
  })

  it('合同编号已含房号和姓名时不重复追加', () => {
    expect(
      contractChangeOptionLabel({
        ...contract,
        contractNo: 'HT202608050001 | 2栋301 | 李四',
      }),
    ).toBe('HT202608050001 | 2栋301 | 李四')
  })
})
