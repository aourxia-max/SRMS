import { describe, expect, it, vi } from 'vitest'
import { createContractVoidActionSession } from './contract-void-action-session'

describe('合同作废动作幂等会话', () => {
  it('表单提交响应丢失时复用 submission key，只有开始全新表单才轮换', () => {
    const factory = vi.fn().mockReturnValueOnce('submit-session-000001').mockReturnValueOnce('submit-session-000002')
    const session = createContractVoidActionSession(factory)

    expect(session.submissionKey()).toBe('submit-session-000001')
    expect(session.submissionKey()).toBe('submit-session-000001')
    expect(factory).toHaveBeenCalledTimes(1)

    session.beginNewForm()

    expect(session.submissionKey()).toBe('submit-session-000002')
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('表单内容变化时轮换 submission key，相同内容网络重试仍复用', () => {
    const factory = vi.fn().mockReturnValueOnce('submit-session-000001').mockReturnValueOnce('submit-session-000002').mockReturnValueOnce('submit-session-000003')
    const session = createContractVoidActionSession(factory)

    expect(session.submissionKey('contract=86&reason=录入错误')).toBe('submit-session-000001')
    expect(session.submissionKey('contract=86&reason=录入错误')).toBe('submit-session-000001')
    expect(session.submissionKey('contract=86&reason=租户错误')).toBe('submit-session-000002')
    expect(session.submissionKey('contract=86&reason=租户错误')).toBe('submit-session-000002')

    session.beginNewForm()

    expect(session.submissionKey('contract=86&reason=租户错误')).toBe('submit-session-000003')
    expect(factory).toHaveBeenCalledTimes(3)
  })

  it('每个待确认申请的 execution key 在失败重试间稳定，明确终态后才清除', () => {
    const factory = vi.fn().mockReturnValueOnce('submit-session-000001').mockReturnValueOnce('execute-request-901-01').mockReturnValueOnce('execute-request-902-01').mockReturnValueOnce('execute-request-901-02')
    const session = createContractVoidActionSession(factory)

    expect(session.executionKey(901)).toBe('execute-request-901-01')
    expect(session.executionKey(901)).toBe('execute-request-901-01')
    expect(session.executionKey(902)).toBe('execute-request-902-01')

    session.markTerminal(901)

    expect(session.executionKey(901)).toBe('execute-request-901-02')
  })
})
