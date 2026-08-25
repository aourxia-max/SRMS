export function supportedRoomContractId(
  contract?: { id: number; pricingMode?: string } | null,
) {
  return contract?.pricingMode === 'FIXED' ? contract.id : null
}

export function roomContractRoute(roomId: number, contractId?: number | null) {
  if (contractId) {
    return {
      path: '/contracts',
      query: { tab: 'detail', contractId: String(contractId) },
    }
  }
  return { path: '/contracts', query: { roomId: String(roomId) } }
}
