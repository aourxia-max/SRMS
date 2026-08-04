import {
  PaymentAllocationType,
  Prisma,
  RefundAdjustmentDecision,
} from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('payment workflow Prisma model', () => {
  const model = (name: string) =>
    Prisma.dmmf.datamodel.models.find((item) => item.name === name);

  it('exposes payment proof and refund adjustment decision relations', () => {
    expect(model('PaymentFile')).toBeDefined();
    expect(model('PaymentRefundAdjustmentDecision')).toBeDefined();
    expect(
      model('PaymentFile')
        ?.fields.filter((field) => field.kind === 'scalar')
        .map((field) => field.name),
    ).not.toContain('contractId');
  });

  it('persists a stable allocation order and allocation origin', () => {
    const fields = model('PaymentAllocation')?.fields.map(
      (field) => field.name,
    );

    expect(fields).toEqual(
      expect.arrayContaining(['allocationOrder', 'allocationType']),
    );
  });

  it('exports the allocation and refund decision enums', () => {
    expect(Object.values(PaymentAllocationType)).toEqual([
      'AUTO_OLDEST_FIRST',
      'MANUAL_SUPER_ADMIN',
      'PREPAYMENT_AUTO',
    ]);
    expect(Object.values(RefundAdjustmentDecision)).toEqual([
      'REVERSE',
      'KEEP',
    ]);
  });

  it('keeps explicit MySQL index and constraint names within 64 characters', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260804233000_payment_management_redesign/migration.sql',
      ),
      'utf8',
    );
    const identifiers = [
      ...migration.matchAll(/(?:KEY|CONSTRAINT)\s+`([^`]+)`/g),
    ].map((match) => match[1]);

    expect(identifiers.filter((name) => name.length > 64)).toEqual([]);
  });
});
