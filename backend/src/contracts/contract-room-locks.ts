import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type RawContractRoomIdentity = {
  id: number | bigint;
  roomId: number | bigint;
};

export type LockedContractRoomIdentity = {
  id: number;
  roomId: number;
};

export async function resolveContractRoomId(
  tx: Prisma.TransactionClient,
  contractId: number,
  missingRoomMessage = '合同未关联房源',
) {
  const identity = await tx.contract.findUnique({
    where: { id: contractId },
    select: { id: true, roomId: true },
  });
  if (!identity) throw new NotFoundException('合同不存在');
  if (identity.roomId === null || identity.roomId === undefined) {
    throw new ConflictException(missingRoomMessage);
  }
  return identity.roomId;
}

export async function lockRoomById(
  tx: Prisma.TransactionClient,
  roomId: number,
) {
  const rooms = await tx.$queryRaw<Array<{ id: number | bigint }>>(
    Prisma.sql`SELECT id FROM rooms WHERE id = ${roomId} FOR UPDATE`,
  );
  if (rooms.length !== 1) throw new NotFoundException('合同关联房源不存在');
}

export async function lockTargetContractInRoom(
  tx: Prisma.TransactionClient,
  contractId: number,
  roomId: number,
): Promise<LockedContractRoomIdentity> {
  const contracts = await tx.$queryRaw<RawContractRoomIdentity[]>(
    Prisma.sql`SELECT id, room_id AS roomId FROM contracts WHERE id = ${contractId} FOR UPDATE`,
  );
  const target = contracts[0];
  if (
    contracts.length !== 1 ||
    Number(target.id) !== contractId ||
    Number(target.roomId) !== roomId
  ) {
    throw new ConflictException('合同所属房源已变化，请刷新后重试');
  }
  return { id: Number(target.id), roomId: Number(target.roomId) };
}

export async function lockRoomAndTargetContract(
  tx: Prisma.TransactionClient,
  contractId: number,
  missingRoomMessage?: string,
): Promise<LockedContractRoomIdentity> {
  const roomId = await resolveContractRoomId(
    tx,
    contractId,
    missingRoomMessage,
  );
  await lockRoomById(tx, roomId);
  return lockTargetContractInRoom(tx, contractId, roomId);
}
