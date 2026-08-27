type ContractVoidKeyKind = 'submit' | 'execute'
type ContractVoidKeyFactory = (kind: ContractVoidKeyKind) => string

const defaultKeyFactory: ContractVoidKeyFactory = (kind) => {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `contract-void-${kind}-${token}`
}

export function createContractVoidActionSession(factory: ContractVoidKeyFactory = defaultKeyFactory) {
  let currentSubmissionKey = factory('submit')
  let submissionFingerprint = ''
  let hasSubmissionFingerprint = false
  const executionKeys = new Map<number, string>()

  return {
    submissionKey(fingerprint = '') {
      if (hasSubmissionFingerprint && fingerprint !== submissionFingerprint) {
        currentSubmissionKey = factory('submit')
      }
      submissionFingerprint = fingerprint
      hasSubmissionFingerprint = true
      return currentSubmissionKey
    },
    executionKey(requestId: number) {
      const existing = executionKeys.get(requestId)
      if (existing) return existing
      const created = factory('execute')
      executionKeys.set(requestId, created)
      return created
    },
    beginNewForm() {
      currentSubmissionKey = factory('submit')
      submissionFingerprint = ''
      hasSubmissionFingerprint = false
    },
    markTerminal(requestId: number) {
      executionKeys.delete(requestId)
    },
  }
}
