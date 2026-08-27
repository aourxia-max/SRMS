import { describe, expect, it, vi } from 'vitest'
import { createContractVoidActionSession } from './contract-void-action-session'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}
describe('合同作废动作幂等会话', () => {
  it('页面重新挂载后从 sessionStorage 恢复同一 submission key 且不保存敏感表单内容', () => {
    const storage = memoryStorage()
    const factory = vi.fn().mockReturnValue('submit-session-000001')
    const first = createContractVoidActionSession(factory, storage)
    expect(first.submissionKey('digest-contract-86-v1')).toBe('submit-session-000001')

    const second = createContractVoidActionSession(factory, storage)
    expect(second.submissionKey('digest-contract-86-v1')).toBe('submit-session-000001')
    expect(factory).toHaveBeenCalledTimes(1)
    expect([...Array(storage.length)].map((_, index) => `${storage.key(index)}=${storage.getItem(storage.key(index)!)}`).join('|')).not.toContain('录入错误')
  })
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

  it('execution key 按申请跨页面恢复且终态后同时清除 execution 与 submission key', () => {
    const storage = memoryStorage()
    const factory = vi.fn().mockReturnValueOnce('submit-request-901-01').mockReturnValueOnce('execute-request-901-01').mockReturnValueOnce('execute-request-901-02')
    const first = createContractVoidActionSession(factory, storage)
    expect(first.submissionKey('digest-request-901')).toBe('submit-request-901-01')
    expect(first.executionKey(901)).toBe('execute-request-901-01')

    const second = createContractVoidActionSession(factory, storage)
    expect(second.executionKey(901)).toBe('execute-request-901-01')
    expect(second.hasSubmissionKey('submit-request-901-01')).toBe(true)
    second.markTerminal(901, 'submit-request-901-01')

    const third = createContractVoidActionSession(factory, storage)
    expect(third.hasSubmissionKey('submit-request-901-01')).toBe(false)
    expect(third.executionKey(901)).toBe('execute-request-901-02')
  })
  it('每个待确认申请的 execution key 在失败重试间稳定，明确终态后才清除', () => {
    const factory = vi.fn().mockReturnValueOnce('execute-request-901-01').mockReturnValueOnce('execute-request-902-01').mockReturnValueOnce('execute-request-901-02')
    const session = createContractVoidActionSession(factory)

    expect(session.executionKey(901)).toBe('execute-request-901-01')
    expect(session.executionKey(901)).toBe('execute-request-901-01')
    expect(session.executionKey(902)).toBe('execute-request-902-01')

    session.markTerminal(901)

    expect(session.executionKey(901)).toBe('execute-request-901-02')
  })
})
