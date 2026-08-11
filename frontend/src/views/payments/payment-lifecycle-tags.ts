export type PaymentLifecycleTag = {
  text: string
  type: 'success' | 'warning' | 'info' | 'danger'
}

export function paymentLifecycleTags(input: {
  receiptType: string
  status: string
  editReason?: string | null
}): PaymentLifecycleTag[] {
  const tags: PaymentLifecycleTag[] = [{
    text: input.receiptType === 'FORMAL' ? '正式票据' : '临时票据',
    type: input.receiptType === 'FORMAL' ? 'success' : 'warning',
  }]

  if (input.editReason?.trim()) tags.push({ text: '已更正', type: 'info' })
  if (input.status === 'PARTIALLY_REFUNDED') tags.push({ text: '部分退款', type: 'warning' })
  if (input.status === 'FULLY_REFUNDED') tags.push({ text: '已退款', type: 'danger' })
  if (input.status === 'VOIDED') tags.push({ text: '已作废', type: 'danger' })

  return tags
}