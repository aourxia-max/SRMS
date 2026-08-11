type ApiError = {
  response?: {
    data?: {
      message?: unknown
    }
  }
}

export function contractChangeSubmitErrorMessage(
  error: unknown,
  fallback = '合同变更提交失败，请检查填写内容后重试',
): string {
  const message = (error as ApiError | undefined)?.response?.data?.message
  if (typeof message === 'string' && message.trim()) return message
  if (Array.isArray(message)) {
    const firstMessage = message.find(
      (item): item is string => typeof item === 'string' && item.trim().length > 0,
    )
    if (firstMessage) return firstMessage
  }
  return fallback
}