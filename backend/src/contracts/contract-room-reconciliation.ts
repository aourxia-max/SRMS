import { ContractStatus, RoomStatus } from '@prisma/client';

export type RoomReconciliationInput = {
  currentStatus: RoomStatus;
  laterContracts: Array<{ status: ContractStatus }>;
};

export type RoomReconciliationResult = {
  action: 'KEEP_CURRENT_STATUS' | 'RECALCULATE';
  targetStatus: RoomStatus;
};

export const EFFECTIVE_ROOM_OCCUPANCY_CONTRACT_STATUSES: ContractStatus[] = [
  ContractStatus.PENDING_START,
  ContractStatus.ACTIVE,
  ContractStatus.PENDING_CHECKOUT,
];

export function isEffectiveRoomOccupancyContract(status: ContractStatus) {
  return EFFECTIVE_ROOM_OCCUPANCY_CONTRACT_STATUSES.includes(status);
}

const PRESERVED_ROOM_STATUSES = new Set<RoomStatus>([
  RoomStatus.MAINTENANCE,
  RoomStatus.FOR_SALE,
  RoomStatus.SOLD,
  RoomStatus.DISABLED,
]);

export function resolveRoomStatusAfterContractVoid(
  input: RoomReconciliationInput,
): RoomReconciliationResult {
  if (
    PRESERVED_ROOM_STATUSES.has(input.currentStatus) ||
    input.laterContracts.some((contract) =>
      isEffectiveRoomOccupancyContract(contract.status),
    )
  ) {
    return {
      action: 'KEEP_CURRENT_STATUS',
      targetStatus: input.currentStatus,
    };
  }
  return { action: 'RECALCULATE', targetStatus: RoomStatus.EMPTY };
}
