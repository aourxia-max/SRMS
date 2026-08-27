type ContractVoidKeyKind = 'submit' | 'execute'
type ContractVoidKeyFactory = (kind: ContractVoidKeyKind) => string

const storageRoot = 'srms:contract-void:idempotency:'

const defaultKeyFactory: ContractVoidKeyFactory = (kind) => {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `contract-void-${kind}-${token}`
}

function defaultStorage() {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}

export function createContractVoidActionSession(userId: number, factory: ContractVoidKeyFactory = defaultKeyFactory, storage: Storage | undefined = defaultStorage()) {
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('合同作废幂等会话缺少有效用户')
  const storagePrefix = storageRoot + 'user:' + userId + ':'
  let submissionLocator = ''
  const memory = new Map<string, string>()

  function read(locator: string) {
    return storage?.getItem(locator) ?? memory.get(locator) ?? null
  }

  function write(locator: string, value: string) {
    memory.set(locator, value)
    storage?.setItem(locator, value)
  }

  function remove(locator: string) {
    memory.delete(locator)
    storage?.removeItem(locator)
  }

  function submissionStorageKey(fingerprint: string) {
    return `${storagePrefix}submit:${fingerprint || 'empty'}`
  }

  function executionStorageKey(requestId: number) {
    return `${storagePrefix}execute:${requestId}`
  }

  function submissionLocatorsForKey(key: string) {
    const locators = [...memory.entries()]
      .filter(([locator, value]) => locator.startsWith(`${storagePrefix}submit:`) && value === key)
      .map(([locator]) => locator)
    if (storage) {
      for (let index = 0; index < storage.length; index += 1) {
        const locator = storage.key(index)
        if (locator?.startsWith(`${storagePrefix}submit:`) && storage.getItem(locator) === key && !locators.includes(locator)) locators.push(locator)
      }
    }
    return locators
  }
  return {
    submissionKey(fingerprint = '') {
      const locator = submissionStorageKey(fingerprint)
      if (submissionLocator && submissionLocator !== locator) remove(submissionLocator)
      submissionLocator = locator
      const existing = read(locator)
      if (existing) return existing
      const created = factory('submit')
      write(locator, created)
      return created
    },
    hasSubmissionKey(key: string) {
      return submissionLocatorsForKey(key).length > 0
    },
    executionKey(requestId: number) {
      const locator = executionStorageKey(requestId)
      const existing = read(locator)
      if (existing) return existing
      const created = factory('execute')
      write(locator, created)
      return created
    },
    beginNewForm() {
      if (submissionLocator) remove(submissionLocator)
      submissionLocator = ''
    },
    markTerminal(requestId: number, submissionKey?: string) {
      remove(executionStorageKey(requestId))
      if (submissionKey) submissionLocatorsForKey(submissionKey).forEach(remove)
    },
  }
}