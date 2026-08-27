import { Prisma } from '@prisma/client';

export async function lockContractVoidContract(
  tx: Prisma.TransactionClient,
  contractId: number,
) {
  return tx.$queryRaw<Array<{ id: number | bigint; status: string }>>(
    Prisma.sql`SELECT id, status FROM contracts WHERE id = ${contractId} FOR UPDATE`,
  );
}

export async function lockContractVoidRelatedRows(
  tx: Prisma.TransactionClient,
  contractId: number,
) {
  // The contract root is locked separately before the request row. Everything
  // below then follows the same deterministic parent-before-child order for
  // refresh and approval.
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM rooms WHERE id = (SELECT room_id FROM contracts WHERE id = ${contractId}) FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT related.id FROM contracts related JOIN contracts source ON source.room_id = related.room_id WHERE source.id = ${contractId} ORDER BY related.id FOR UPDATE`,
  );
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM contract_members WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
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
