import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const prismaDirectory = join(process.cwd(), 'prisma');
const schemaPath = join(prismaDirectory, 'schema.prisma');
const migrationPath = join(
  prismaDirectory,
  'migrations',
  '20260805100000_fixed_contract_management_redesign',
  'migration.sql',
);

function modelBlock(schema: string, name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('fixed contract management schema', () => {
  it('supports external contract references and the required contract number lengths', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const contract = modelBlock(schema, 'Contract');
    const rentBill = modelBlock(schema, 'RentBill');

    expect(contract).toMatch(
      /externalContractNo\s+String\?\s+@map\("external_contract_no"\)\s+@db\.VarChar\(80\)/,
    );
    expect(contract).toMatch(
      /contractNo\s+String\s+@unique\s+@map\("contract_no"\)\s+@db\.VarChar\(120\)/,
    );
    expect(rentBill).toMatch(
      /billNo\s+String\s+@unique\s+@map\("bill_no"\)\s+@db\.VarChar\(140\)/,
    );
  });

  it('models drafts and contract files with their required relations', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const user = modelBlock(schema, 'User');
    const room = modelBlock(schema, 'Room');
    const contract = modelBlock(schema, 'Contract');
    const fileAsset = modelBlock(schema, 'FileAsset');
    const draft = modelBlock(schema, 'ContractDraft');
    const file = modelBlock(schema, 'ContractFile');

    expect(draft).toMatch(/id\s+Int\s+@id\s+@default\(autoincrement\(\)\)\s+@db\.UnsignedInt/);
    expect(draft).toMatch(/roomId\s+Int\?\s+@map\("room_id"\)\s+@db\.UnsignedInt/);
    expect(draft).toMatch(/payload\s+Json\s+@map\("payload"\)/);
    expect(draft).toMatch(/status\s+String\s+@default\("DRAFT"\)\s+@db\.VarChar\(20\)/);
    expect(draft).toMatch(/createdBy\s+Int\s+@map\("created_by"\)\s+@db\.UnsignedInt/);
    expect(draft).toMatch(/confirmedAt\s+DateTime\?\s+@map\("confirmed_at"\)\s+@db\.DateTime\(3\)/);
    expect(draft).toMatch(/@@index\(\[createdBy, status, updatedAt\]\)/);
    expect(draft).toMatch(/@@map\("contract_drafts"\)/);
    expect(file).toMatch(/contract\s+Contract\s+@relation\(fields: \[contractId\], references: \[id\], onDelete: Restrict\)/);
    expect(file).toMatch(/fileAsset\s+FileAsset\s+@relation\(fields: \[fileAssetId\], references: \[id\], onDelete: Restrict\)/);
    expect(file).toMatch(/@@id\(\[contractId, fileAssetId\]\)/);
    expect(file).toMatch(/@@map\("contract_files"\)/);
    expect(user).toMatch(/contractDrafts\s+ContractDraft\[\]/);
    expect(room).toMatch(/contractDrafts\s+ContractDraft\[\]/);
    expect(contract).toMatch(/files\s+ContractFile\[\]/);
    expect(fileAsset).toMatch(/contractFiles\s+ContractFile\[\]/);
    expect(schema).not.toMatch(/SUBMITTED/);
  });

  it('migrates schema changes without deleting historical records', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toMatch(/ALTER TABLE `contracts`[\s\S]*`contract_no` VARCHAR\(120\)/);
    expect(migration).toMatch(/ALTER TABLE `contracts`[\s\S]*`external_contract_no` VARCHAR\(80\) NULL/);
    expect(migration).toMatch(/ALTER TABLE `rent_bills`[\s\S]*`bill_no` VARCHAR\(140\)/);
    expect(migration).toMatch(/CREATE TABLE `contract_drafts`/);
    expect(migration).toMatch(/CREATE TABLE `contract_files`/);
    expect(migration).toMatch(/ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/);
    expect(migration).not.toMatch(/^\s*DELETE\s+/im);
  });
});
