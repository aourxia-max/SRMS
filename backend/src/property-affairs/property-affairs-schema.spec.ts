import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';

const prismaDirectory = join(process.cwd(), 'prisma');
const schemaPath = join(prismaDirectory, 'schema.prisma');
const migrationPath = join(
  prismaDirectory,
  'migrations',
  '20260902110000_property_affairs',
  'migration.sql',
);

function modelBlock(schema: string, name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('property-affairs schema', () => {
  it('declares normalized property-affair storage without mutating business tables', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toContain('enum PropertyAffairStatus');
    expect(schema).toContain('enum PropertyAffairPriority');
    expect(schema).toContain('PROPERTY_AFFAIR');
    for (const name of [
      'PropertyAffair',
      'PropertyAffairDailySequence',
      'PropertyAffairBuilding',
      'PropertyAffairRoom',
      'PropertyAffairTenant',
      'PropertyAffairContract',
      'PropertyAffairProgress',
      'PropertyAffairFile',
    ]) {
      expect(modelBlock(schema, name)).not.toBe('');
    }
    const migration = readFileSync(migrationPath, 'utf8');
    expect(migration).toMatch(/CREATE TABLE `property_affairs`/);
    expect(migration).toMatch(/CREATE TABLE `property_affair_progresses`/);
    expect(migration).toMatch(/`created_by` INT UNSIGNED NOT NULL/);
    for (const table of [
      'buildings',
      'rooms',
      'tenants',
      'contracts',
      'contract_members',
      'rent_bills',
      'payments',
      'payment_allocations',
      'payment_refunds',
      'prepayment_transactions',
      'deposit_transactions',
      'checkout_settlements',
      'checkout_settlement_items',
      'bill_adjustments',
      'pricing_rebates',
    ]) {
      expect(migration).not.toMatch(
        new RegExp(
          `^\\s*(?:UPDATE|DELETE(?:\\s+FROM)?|TRUNCATE(?:\\s+TABLE)?)\\s+\\x60?${table}\\x60?\\b`,
          'im',
        ),
      );
    }
  });

  it('exposes attachment actor mappings and relations in generated Prisma metadata', () => {
    const affairFile = Prisma.dmmf.datamodel.models.find(
      (model) => model.name === 'PropertyAffairFile',
    );
    const createdBy = affairFile?.fields.find(
      (field) => field.name === 'createdBy',
    );
    const affairId = affairFile?.fields.find(
      (field) => field.name === 'affairId',
    );
    const fileAssetId = affairFile?.fields.find(
      (field) => field.name === 'fileAssetId',
    );
    const affair = affairFile?.fields.find((field) => field.name === 'affair');
    const fileAsset = affairFile?.fields.find(
      (field) => field.name === 'fileAsset',
    );

    expect(affairFile).toMatchObject({ dbName: 'property_affair_files' });
    expect(createdBy).toMatchObject({
      dbName: 'created_by',
      kind: 'scalar',
      type: 'Int',
    });
    expect(affairId).toMatchObject({ dbName: 'affair_id' });
    expect(fileAssetId).toMatchObject({ dbName: 'file_asset_id' });
    expect(affair).toMatchObject({
      kind: 'object',
      type: 'PropertyAffair',
    });
    expect(fileAsset).toMatchObject({
      kind: 'object',
      type: 'FileAsset',
    });
  });
});
