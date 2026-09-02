import { describe, expect, it } from 'vitest'
import { resolveRouteAccess } from './router'

describe('通用路由角色访问控制', () => {
  const protectedMeta = { requiresAuth: true, roles: ['SUPER_ADMIN', 'ADMIN'] }

  it('未登录访问受保护元路由时保留完整登录跳转地址', () => {
    expect(resolveRouteAccess(
      { fullPath: '/synthetic?tab=all', name: 'synthetic', meta: protectedMeta },
      { isAuthenticated: false, user: null },
    )).toEqual({ name: 'login', query: { redirect: '/synthetic?tab=all' } })
  })

  it.each(['SUPER_ADMIN', 'ADMIN'])('允许已登录的 %s 访问角色匹配路由', (role) => {
    expect(resolveRouteAccess(
      { fullPath: '/synthetic', name: 'synthetic', meta: protectedMeta },
      { isAuthenticated: true, user: { role } },
    )).toBe(true)
  })

  it('将已登录但角色不匹配的用户带回会话页', () => {
    expect(resolveRouteAccess(
      { fullPath: '/synthetic', name: 'synthetic', meta: protectedMeta },
      { isAuthenticated: true, user: { role: 'VISITOR' } },
    )).toEqual({ name: 'session' })
  })

  it('保持已有的登录页跳转行为', () => {
    expect(resolveRouteAccess(
      { fullPath: '/login', name: 'login', meta: {} },
      { isAuthenticated: true, user: { role: 'ADMIN' } },
    )).toEqual({ name: 'session' })
  })
})
