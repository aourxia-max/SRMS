import {
  PaymentAllocationType,
  Prisma,
  RefundAdjustmentDecision,
} from '@prisma/client';

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
});
