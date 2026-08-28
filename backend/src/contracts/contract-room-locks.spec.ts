import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  lockRoomAndTargetContract,
  resolveContractRoomId,
} from './contract-room-locks';

function statements(queryRaw: jest.Mock) {
  return queryRaw.mock.calls.map(([query]) =>
    (query as { strings: readonly string[] }).strings.join('?'),
  );
}

describe('contract room locks', () => {
  it('resolves room without a lock, then locks room before only the target contract', async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, roomId: 3 }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: BigInt(3) }])
        .mockResolvedValueOnce([{ id: BigInt(7), roomId: BigInt(3) }]),
    };

    await expect(lockRoomAndTargetContract(tx as never, 7)).resolves.toEqual({
      id: 7,
      roomId: 3,
    });

    expect(tx.contract.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { id: true, roomId: true },
    });
    const sql = statements(tx.$queryRaw);
    const roomIndex = sql.findIndex(
      (statement) =>
        statement.includes('FROM rooms') && statement.includes('FOR UPDATE'),
    );
    const contractIndex = sql.findIndex(
      (statement) =>
        statement.includes('FROM contracts') &&
        statement.includes('WHERE id = ?') &&
        statement.includes('FOR UPDATE'),
    );
    expect(roomIndex).toBeGreaterThanOrEqual(0);
    expect(contractIndex).toBeGreaterThan(roomIndex);
    expect(sql[contractIndex]).not.toContain('WHERE room_id');
  });

  it('rejects a contract that moved after its non-locking identity read', async () => {
    const tx = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, roomId: 3 }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: BigInt(3) }])
        .mockResolvedValueOnce([{ id: BigInt(7), roomId: BigInt(4) }]),
    };

    await expect(lockRoomAndTargetContract(tx as never, 7)).rejects.toThrow(
      '合同所属房源已变化，请刷新后重试',
    );
  });

  it('fails before any locking query when contract or room identity is missing', async () => {
    const missingContract = {
      contract: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn(),
    };
    const missingRoom = {
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: 7, roomId: null }),
      },
      $queryRaw: jest.fn(),
    };

    await expect(
      resolveContractRoomId(missingContract as never, 7),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      resolveContractRoomId(missingRoom as never, 7),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(missingContract.$queryRaw).not.toHaveBeenCalled();
    expect(missingRoom.$queryRaw).not.toHaveBeenCalled();
  });
});
