import { describe, expect, it } from 'vitest'
import { presentContractChange } from './contract-change-presentation'

describe('合同变更记录展示', () => {
  it('把租金代码和快照转换为普通人可读的金额变化', () => {
    expect(presentContractChange({
      changeType: 'RENT',
      approvalStatus: 'APPROVED',
      beforeSnapshot: { monthlyRent: '3000.00' },
      afterSnapshot: { monthlyRent: '3200.00' },
    })).toMatchObject({
      typeLabel: '租金变更',
      statusLabel: '已确认',
      items: [{ label: '固定月租', before: '¥3,000.00', after: '¥3,200.00' }],
    })
  })

  it('主承租人变更优先展示后端提供的姓名而不是数据库编号', () => {
    const result = presentContractChange({
      changeType: 'PRIMARY_TENANT',
      approvalStatus: 'PENDING',
      beforeSnapshot: { members: [{ memberRole: 'PRIMARY', tenantId: 9 }] },
      afterSnapshot: { primaryTenantId: 18 },
      tenantNames: { '9': '张三01', '18': '张三02' },
    })

    expect(result.items).toEqual([
      { label: '主承租人', before: '张三01', after: '张三02' },
    ])
    expect(JSON.stringify(result)).not.toContain('primaryTenantId')
  })
})
