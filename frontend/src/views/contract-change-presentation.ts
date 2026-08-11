const changeTypeLabels: Record<string, string> = {
  RENT: '租金变更',
  TERM: '租期变更',
  PRIMARY_TENANT: '主承租人变更',
  CONCESSION: '优惠变更',
}

const changeStatusLabels: Record<string, string> = {
  PENDING: '待审批',
  APPROVED: '已确认',
  REJECTED: '已驳回',
}

export function contractChangeTypeLabel(value: string): string {
  return changeTypeLabels[value] ?? value
}

export function contractChangeStatusLabel(value: string): string {
  return changeStatusLabels[value] ?? value
}