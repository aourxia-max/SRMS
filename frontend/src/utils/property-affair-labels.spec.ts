import { describe, expect, it } from 'vitest'
import {
  propertyAffairAvailabilityLabel,
  propertyAffairPriorityLabel,
  propertyAffairRelationTypeLabel,
  propertyAffairRelationStatusLabel,
  propertyAffairStatusLabel,
} from './property-affair-labels'

describe('物业办事标签', () => {
  it.each([
    ['PENDING', '待办理'],
    ['IN_PROGRESS', '办理中'],
    ['COMPLETED', '已完成'],
    ['CANCELLED', '已取消'],
  ])('将状态 %s 显示为中文 %s', (status, label) => {
    expect(propertyAffairStatusLabel(status)).toBe(label)
  })

  it.each([
    ['NORMAL', '普通'],
    ['IMPORTANT', '重要'],
    ['URGENT', '紧急'],
  ])('将优先级 %s 显示为中文 %s', (priority, label) => {
    expect(propertyAffairPriorityLabel(priority)).toBe(label)
  })

  it('不会将未知状态或优先级的原始枚举值泄露给界面', () => {
    expect(propertyAffairStatusLabel('UNRECOGNIZED')).toBe('未知状态')
    expect(propertyAffairStatusLabel(null)).toBe('未知状态')
    expect(propertyAffairPriorityLabel('UNRECOGNIZED')).toBe('未知优先级')
    expect(propertyAffairPriorityLabel(undefined)).toBe('未知优先级')
  })

  it('集中提供关联类型和可用性中文标签', () => {
    expect(propertyAffairRelationTypeLabel('building')).toBe('楼栋')
    expect(propertyAffairRelationTypeLabel('room')).toBe('房源')
    expect(propertyAffairRelationTypeLabel('tenant')).toBe('承租人')
    expect(propertyAffairRelationTypeLabel('contract')).toBe('合同')
    expect(propertyAffairAvailabilityLabel(true)).toBe('可用')
    expect(propertyAffairAvailabilityLabel(false)).toBe('不可用')
  })

  it.each([
    ['building', 'DISABLED', '已停用'],
    ['room', 'PENDING_CHECKOUT', '待退租'],
    ['tenant', 'INACTIVE', '已停用'],
    ['contract', 'ENDED', '已结束'],
    ['contract', null, '对象已不存在'],
  ])('将%s当前状态%s集中显示为中文%s', (type, status, expected) => {
    expect(propertyAffairRelationStatusLabel(type, status)).toBe(expected)
  })

  it('将原型状态键视为未知状态并始终返回中文字符串', () => {
    expect(propertyAffairStatusLabel('toString')).toBe('未知状态')
    expect(typeof propertyAffairStatusLabel('constructor')).toBe('string')
  })

  it('将原型优先级键视为未知优先级并始终返回中文字符串', () => {
    expect(propertyAffairPriorityLabel('toString')).toBe('未知优先级')
    expect(typeof propertyAffairPriorityLabel('constructor')).toBe('string')
  })

  it('将原型关联类型键视为未知关联并始终返回中文字符串', () => {
    expect(propertyAffairRelationTypeLabel('toString')).toBe('未知关联')
    expect(typeof propertyAffairRelationTypeLabel('constructor')).toBe('string')
  })
})
