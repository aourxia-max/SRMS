import type { PropertyAffairPriority, PropertyAffairRelationType, PropertyAffairStatus } from '../types/property-affairs'

const statusLabels: Record<PropertyAffairStatus, string> = { PENDING: '待办理', IN_PROGRESS: '办理中', COMPLETED: '已完成', CANCELLED: '已取消' }
const priorityLabels: Record<PropertyAffairPriority, string> = { NORMAL: '普通', IMPORTANT: '重要', URGENT: '紧急' }
const relationTypeLabels: Record<PropertyAffairRelationType, string> = { building: '楼栋', room: '房源', tenant: '承租人', contract: '合同' }

export function propertyAffairStatusLabel(value?: string | null) {
  return value && value in statusLabels ? statusLabels[value as PropertyAffairStatus] : '未知状态'
}

export function propertyAffairPriorityLabel(value?: string | null) {
  return value && value in priorityLabels ? priorityLabels[value as PropertyAffairPriority] : '未知优先级'
}

export function propertyAffairRelationTypeLabel(value?: string | null) {
  return value && value in relationTypeLabels ? relationTypeLabels[value as PropertyAffairRelationType] : '未知关联'
}

export function propertyAffairAvailabilityLabel(available?: boolean | null) {
  return available ? '可用' : '不可用'
}
