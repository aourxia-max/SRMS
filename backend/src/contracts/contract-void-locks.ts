import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type LockedContract = {
  id: number;
  roomId: number;
  status: string;
  contractNo: string;
};

type RawLockedContract = {
  id: number | bigint;
  roomId: number | bigint;
  status: string;
  contractNo: string;
};

export async function lockContractVoidExclusiveScope(
  tx: Prisma.TransactionClient,
  contractId: number,
) {
  const identity = await tx.contract.findUnique({
    where: { id: contractId },
    select: { id: true, roomId: true },
  });
  if (!identity) throw new NotFoundException('合同不存在');
  if (identity.roomId === null || identity.roomId === undefined) {
    throw new ConflictException('合同未关联房源，不能执行作废纠错');
  }

  const rooms = await tx.$queryRaw<Array<{ id: number | bigint }>>(
    Prisma.sql`SELECT id FROM rooms WHERE id = ${identity.roomId} FOR UPDATE`,
  );
  if (rooms.length !== 1) throw new NotFoundException('合同关联房源不存在');

  const rawContracts = await tx.$queryRaw<RawLockedContract[]>(
    Prisma.sql`SELECT id, room_id AS roomId, status, contract_no AS contractNo FROM contracts WHERE room_id = ${identity.roomId} ORDER BY id FOR UPDATE`,
  );
  const contracts: LockedContract[] = rawContracts.map((contract) => ({
    ...contract,
    id: Number(contract.id),
    roomId: Number(contract.roomId),
  }));
  const target = contracts.find((contract) => contract.id === contractId);
  if (!target || target.roomId !== identity.roomId) {
    throw new ConflictException('合同所属房源已变化，请刷新后重试');
  }
  return { roomId: identity.roomId, target, contracts };
}

export async function lockContractVoidRelatedRows(
  tx: Prisma.TransactionClient,
  contractId: number,
) {
  // The exclusive correction scope has already locked room -> all contracts
  // in ascending id order. Child rows now follow one deterministic order.
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM contract_members WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM contract_concessions WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM rent_bills WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM payments WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM contract_changes WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT ba.id FROM bill_adjustments ba JOIN rent_bills rb ON rb.id = ba.rent_bill_id WHERE rb.contract_id = ${contractId} ORDER BY ba.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT pa.id FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE p.contract_id = ${contractId} ORDER BY pa.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM payment_refunds WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT pvr.id FROM payment_void_requests pvr JOIN payments p ON p.id = pvr.payment_id WHERE p.contract_id = ${contractId} ORDER BY pvr.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM prepayment_transactions WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM pricing_rebates WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM checkout_settlements WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM deposit_refunds WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM deposit_transactions WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM contract_commissions WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
  );
}
