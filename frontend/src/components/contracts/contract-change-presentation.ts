export type ContractChangeRecord = {
  id?: number
  changeNo?: string
  changeType?: string
  effectiveDate?: string
  reason?: string
  approvalStatus?: string
  submittedAt?: string
  approvedAt?: string | null
  rejectedReason?: string | null
  beforeSnapshot?: Record<string, unknown>
  afterSnapshot?: Record<string, unknown>
  tenantNames?: Record<string, string>
}

export type ContractChangePresentation = {
  typeLabel: string
  statusLabel: string
  items: Array<{ label: string; before: string; after: string }>
}

const typeLabels: Record<string, string> = {
  RENT: '租金变更',
  TERM: '租期变更',
  PRIMARY_TENANT: '主承租人变更',
  CONCESSION: '优惠方案变更',
}

const statusLabels: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待确认',
  APPROVED: '已确认',
  REJECTED: '已驳回',
}

function money(value: unknown) {
  const amount = Number(value)
  return Number.isFinite(amount)
    ? `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '未记录'
}

function date(value: unknown) {
  return value ? String(value).slice(0, 10) : '未记录'
}

function primaryTenantId(snapshot: Record<string, unknown>) {
  if (snapshot.primaryTenantId) return Number(snapshot.primaryTenantId)
  const members = Array.isArray(snapshot.members) ? snapshot.members : []
  const primary = members.find((item) => {
    const member = item as Record<string, unknown>
    return member.memberRole === 'PRIMARY' && member.isCurrent !== false
  }) as Record<string, unknown> | undefined
  return primary?.tenantId ? Number(primary.tenantId) : null
}

function tenantName(id: number | null, names: Record<string, string>) {
  return id ? names[String(id)] || '姓名未记录' : '未记录'
}

function concessionText(value: unknown) {
  if (!Array.isArray(value) || !value.length) return '无优惠'
  return value.map((raw) => {
    const item = raw as Record<string, unknown>
    const periods = Number(item.billingPeriodCount || 0)
    const scope = item.applyMode === 'DATE_RANGE'
      ? `${date(item.startDate)} 至 ${date(item.endDate)}`
      : `前${periods || 1}个账期`
    if (item.concessionType === 'RENT_FREE') return `免租（${scope}）`
    if (item.concessionType === 'FIXED_AMOUNT') return `固定优惠 ${money(item.fixedAmount)}（${scope}）`
    if (item.concessionType === 'PERCENTAGE') {
      const rate = Number(item.discountRate)
      const discount = Number.isFinite(rate) ? `${(10 - rate * 10).toFixed(1).replace(/\.0$/, '')}折` : '比例未记录'
      return `比例优惠 ${discount}（${scope}）`
    }
    return `其他优惠（${scope}）`
  }).join('；')
}

export function presentContractChange(change: ContractChangeRecord): ContractChangePresentation {
  const before = change.beforeSnapshot ?? {}
  const after = change.afterSnapshot ?? {}
  const items: ContractChangePresentation['items'] = []
  if (change.changeType === 'RENT') {
    items.push({ label: '固定月租', before: money(before.monthlyRent), after: money(after.monthlyRent) })
  } else if (change.changeType === 'TERM') {
    items.push({ label: '合同结束日期', before: date(before.endDate), after: date(after.endDate) })
  } else if (change.changeType === 'PRIMARY_TENANT') {
    const names = change.tenantNames ?? {}
    items.push({
      label: '主承租人',
      before: tenantName(primaryTenantId(before), names),
      after: tenantName(primaryTenantId(after), names),
    })
  } else if (change.changeType === 'CONCESSION') {
    items.push({ label: '优惠方案', before: concessionText(before.concessions), after: concessionText(after.concessions) })
  }
  return {
    typeLabel: typeLabels[change.changeType ?? ''] ?? '合同变更',
    statusLabel: statusLabels[change.approvalStatus ?? ''] ?? '状态未记录',
    items,
  }
}
