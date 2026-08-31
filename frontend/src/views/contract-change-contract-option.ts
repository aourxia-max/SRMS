import type { ContractListItem } from '../types/contracts'

export function contractChangeOptionLabel(contract: ContractListItem) {
  const room = contract.room?.fullHouseNo || `房源${contract.roomId}`
  const tenant =
    contract.members?.find((member) => member.memberRole === 'PRIMARY')?.tenant
      .name || '未记录承租人'
  const missingDetails = [room, tenant].filter(
    (detail) => !contract.contractNo.includes(detail),
  )
  return [contract.contractNo, ...missingDetails].join('｜')
}
