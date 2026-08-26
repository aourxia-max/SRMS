import { resolveRoomStatusAfterContractVoid } from './contract-room-reconciliation';

describe('resolveRoomStatusAfterContractVoid', () => {
  it('releases a rented room to the existing available status without another contract', () => {
    expect(
      resolveRoomStatusAfterContractVoid({
        currentStatus: 'RENTED',
        laterContracts: [],
      }),
    ).toEqual({ action: 'RECALCULATE', targetStatus: 'EMPTY' });
  });

  it.each(['PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT'] as const)(
    'keeps the current room status for a %s successor',
    (status) => {
      expect(
        resolveRoomStatusAfterContractVoid({
          currentStatus: 'RENTED',
          laterContracts: [{ status }],
        }),
      ).toEqual({
        action: 'KEEP_CURRENT_STATUS',
        targetStatus: 'RENTED',
      });
    },
  );

  it('ignores a voided same-room contract', () => {
    expect(
      resolveRoomStatusAfterContractVoid({
        currentStatus: 'RENTED',
        laterContracts: [{ status: 'VOIDED' }],
      }),
    ).toEqual({ action: 'RECALCULATE', targetStatus: 'EMPTY' });
  });

  it.each(['MAINTENANCE', 'FOR_SALE', 'SOLD', 'DISABLED'] as const)(
    'preserves the high-priority %s room status',
    (currentStatus) => {
      expect(
        resolveRoomStatusAfterContractVoid({
          currentStatus,
          laterContracts: [],
        }),
      ).toEqual({
        action: 'KEEP_CURRENT_STATUS',
        targetStatus: currentStatus,
      });
    },
  );
});
