import type { PropertyAffairPriority, PropertyAffairRelationType, PropertyAffairStatus } from '../types/property-affairs'

const statusLabels: Record<PropertyAffairStatus, string> = { PENDING: '待办理', IN_PROGRESS: '办理中', COMPLETED: '已完成', CANCELLED: '已取消' }
const priorityLabels: Record<PropertyAffairPriority, string> = { NORMAL: '普通', IMPORTANT: '重要', URGENT: '紧急' }
const relationTypeLabels: Record<PropertyAffairRelationType, string> = { building: '楼栋', room: '房源', tenant: '承租人', contract: '合同' }
const relationStatusLabels: Record<PropertyAffairRelationType, Record<string, string>> = {
  building: { ACTIVE: '启用', DISABLED: '已停用' },
  room: { EMPTY: '空置', PENDING_MOVE_IN: '待入住', RENTED: '已出租', PENDING_CHECKOUT: '待退租', MAINTENANCE: '维修中', FOR_SALE: '待售', SOLD: '已售', DISABLED: '已停用', OTHER: '其他' },
  tenant: { ACTIVE: '有效', INACTIVE: '已停用' },
  contract: { DRAFT: '草稿', PENDING_START: '待开始', ACTIVE: '履行中', PENDING_CHECKOUT: '待退租', ENDED: '已结束', VOIDED: '已作废' },
}

export function propertyAffairStatusLabel(value?: string | null) {
  return value && Object.hasOwn(statusLabels, value) ? statusLabels[value as PropertyAffairStatus] : '未知状态'
}

export function propertyAffairPriorityLabel(value?: string | null) {
  return value && Object.hasOwn(priorityLabels, value) ? priorityLabels[value as PropertyAffairPriority] : '未知优先级'
}

export function propertyAffairRelationTypeLabel(value?: string | null) {
  return value && Object.hasOwn(relationTypeLabels, value) ? relationTypeLabels[value as PropertyAffairRelationType] : '未知关联'
}

export function propertyAffairAvailabilityLabel(available?: boolean | null) {
  return available ? '可用' : '不可用'
}

export function propertyAffairRelationStatusLabel(type?: string | null, status?: string | null) {
  if (!status) return '对象已不存在'
  if (!type || !Object.hasOwn(relationStatusLabels, type)) return '未知状态'
  const labels = relationStatusLabels[type as PropertyAffairRelationType]
  return Object.hasOwn(labels, status) ? labels[status] : '未知状态'
}
