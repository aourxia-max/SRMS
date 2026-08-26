import { ContractStatus, RoomStatus } from '@prisma/client';

export type RoomReconciliationInput = {
  currentStatus: RoomStatus;
  laterContracts: Array<{ status: ContractStatus }>;
};

export type RoomReconciliationResult = {
  action: 'KEEP_CURRENT_STATUS' | 'RECALCULATE';
  targetStatus: RoomStatus;
};

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
    input.laterContracts.some((contract) => contract.status !== 'VOIDED')
  ) {
    return {
      action: 'KEEP_CURRENT_STATUS',
      targetStatus: input.currentStatus,
    };
  }
  return { action: 'RECALCULATE', targetStatus: RoomStatus.EMPTY };
}
