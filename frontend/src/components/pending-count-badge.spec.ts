import { mount } from '@vue/test-utils'
import PendingCountBadge from './PendingCountBadge.vue'

function mountBadge(count: number) {
  return mount(PendingCountBadge, { props: { count } })
}

describe('PendingCountBadge', () => {
  it('数量为零或无效时不显示', () => {
    expect(mountBadge(0).find('[data-test="pending-count-badge"]').exists()).toBe(false)
    expect(mountBadge(-1).find('[data-test="pending-count-badge"]').exists()).toBe(false)
    expect(mountBadge(Number.NaN).find('[data-test="pending-count-badge"]').exists()).toBe(false)
  })

  it('一到九十九显示实际数量并提供中文无障碍说明', () => {
    const wrapper = mountBadge(27)
    const badge = wrapper.get('[data-test="pending-count-badge"]')

    expect(badge.text()).toBe('27')
    expect(badge.attributes('aria-label')).toBe('待处理 27 项')
  })

  it('一百及以上统一显示为99+', () => {
    expect(mountBadge(100).text()).toBe('99+')
    expect(mountBadge(135).attributes('aria-label')).toBe('待处理 135 项')
  })
})
