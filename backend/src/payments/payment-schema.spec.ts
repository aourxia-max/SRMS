import {
  BillAdjustmentType,
  CheckoutRentRefundAllocationStatus,
  PaymentAllocationType,
  PaymentMethod,
  Prisma,
  RefundAdjustmentDecision,
} from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('payment workflow Prisma model', () => {
  const model = (name: string) =>
    Prisma.dmmf.datamodel.models.find((item) => item.name === name);

  it('provides an internal automatic payment method and unique source field', () => {
    expect(
      (PaymentMethod as unknown as Record<string, string>).SYSTEM_AUTO,
    ).toBe('SYSTEM_AUTO');

    const paymentModel = model('Payment');
    expect(
      paymentModel?.fields.some((field) => field.name === 'autoSourceKey'),
    ).toBe(true);
  });

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
      'RENT_REFUND',
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

  it('exposes the checkout rent-refund reservation contract', () => {
    expect(Object.values(PaymentAllocationType)).toContain('RENT_REFUND');
    expect(Object.values(BillAdjustmentType)).toContain('CHECKOUT_RENT_REFUND');
    expect(Object.values(CheckoutRentRefundAllocationStatus)).toEqual([
      'RESERVED',
      'RELEASED',
      'APPLIED',
    ]);

    const allocation = model('CheckoutRentRefundAllocation');
    expect(allocation?.dbName).toBe('checkout_rent_refund_allocations');
    expect(
      allocation?.fields
        .filter((field) => field.kind === 'scalar')
        .map((field) => [field.name, field.dbName]),
    ).toEqual(
      expect.arrayContaining([
        ['checkoutSettlementItemId', 'checkout_settlement_item_id'],
        ['paymentAllocationId', 'payment_allocation_id'],
        ['paymentId', 'payment_id'],
        ['rentBillId', 'rent_bill_id'],
        ['reservedAmount', 'reserved_amount'],
        ['depositRefundId', 'deposit_refund_id'],
      ]),
    );
    expect(
      allocation?.fields
        .filter((field) => field.kind === 'object')
        .map((field) => field.name),
    ).toEqual(
      expect.arrayContaining([
        'item',
        'paymentAllocation',
        'payment',
        'rentBill',
        'depositRefund',
      ]),
    );
  });

  it('keeps a lossless historic refund split in the generated schema contract', () => {
    expect(
      model('CheckoutSettlement')?.fields.map((field) => field.name),
    ).toContain('rentRefundableAmount');
    expect(
      model('DepositRefund')
        ?.fields.filter((field) => field.kind === 'scalar')
        .map((field) => [field.name, field.dbName]),
    ).toEqual(
      expect.arrayContaining([
        ['depositRefundAmount', 'deposit_refund_amount'],
        ['prepaymentRefundAmount', 'prepayment_refund_amount'],
        ['rentRefundAmount', 'rent_refund_amount'],
      ]),
    );
  });
  it('backfills historic checkout refunds without changing their total', () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260830090000_checkout_rent_refund/migration.sql',
      ),
      'utf8',
    );
    const backfill = migration
      .split(';')
      .map((statement) => statement.trim().replace(/\s+/g, ' '))
      .find((statement) => statement.startsWith('UPDATE `deposit_refunds`'));
    const assignments = new Map(
      [...(backfill ?? '').matchAll(/dr\.`([^`]+)` = ([^,]+)/g)].map(
        ([, column, source]) => [column, source.trim()],
      ),
    );

    expect({
      preservesTotal: !assignments.has('refund_amount'),
      components: [...assignments.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    }).toEqual({
      preservesTotal: true,
      components: [
        ['deposit_refund_amount', 'cs.`deposit_refundable_amount`'],
        ['prepayment_refund_amount', 'cs.`prepayment_refundable_amount`'],
        ['rent_refund_amount', '0.00'],
      ],
    });
  });
});
