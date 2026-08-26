import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const prismaDirectory = join(process.cwd(), 'prisma');
const schemaPath = join(prismaDirectory, 'schema.prisma');
const migrationPath = join(
  prismaDirectory,
  'migrations',
  '20260826090000_contract_void_correction',
  'migration.sql',
);

function modelBlock(schema: string, name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('contract void correction schema', () => {
  it('declares append-only contract void request and reversal storage', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const contract = modelBlock(schema, 'Contract');
    const fileAsset = modelBlock(schema, 'FileAsset');
    const request = modelBlock(schema, 'ContractVoidRequest');
    const reversal = modelBlock(schema, 'ContractVoidReversal');
    const file = modelBlock(schema, 'ContractVoidRequestFile');

    expect(schema).toContain('enum ContractVoidRequestStatus');
    expect(schema).toContain('enum ContractVoidReversalCategory');
    expect(schema).toContain('CONTRACT_VOID_PROOF');
    expect(request).toMatch(
      /activeContractKey\s+String\?\s+@unique\s+@map\("active_contract_key"\)\s+@db\.VarChar\(80\)/,
    );
    expect(request).toMatch(
      /completedContractKey\s+String\?\s+@unique\s+@map\("completed_contract_key"\)\s+@db\.VarChar\(80\)/,
    );
    expect(request).toMatch(
      /executionBatchNo\s+String\?\s+@unique\s+@map\("execution_batch_no"\)\s+@db\.VarChar\(40\)/,
    );
    expect(request).toMatch(
      /executionIdempotencyKey\s+String\?\s+@unique\s+@map\("execution_idempotency_key"\)\s+@db\.VarChar\(100\)/,
    );
    expect(request).toMatch(
      /contract\s+Contract\s+@relation\(fields: \[contractId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(reversal).toMatch(
      /idempotencyKey\s+String\s+@unique\s+@map\("idempotency_key"\)\s+@db\.VarChar\(160\)/,
    );
    expect(reversal).toMatch(
      /request\s+ContractVoidRequest\s+@relation\(fields: \[contractVoidRequestId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(file).toMatch(/@@id\(\[contractVoidRequestId, fileAssetId\]\)/);
    expect(file).toMatch(
      /request\s+ContractVoidRequest\s+@relation\(fields: \[contractVoidRequestId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(file).toMatch(
      /fileAsset\s+FileAsset\s+@relation\(fields: \[fileAssetId\], references: \[id\], onDelete: Restrict\)/,
    );
    expect(contract).toMatch(/voidRequests\s+ContractVoidRequest\[\]/);
    expect(fileAsset).toMatch(
      /contractVoidRequestFiles\s+ContractVoidRequestFile\[\]/,
    );
  });

  it('migrates append-only contract void correction storage without updating contracts', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, 'utf8');
    const identifiers = [
      ...migration.matchAll(/(?:KEY|CONSTRAINT) `([^`]+)`/g),
    ].map((match) => match[1]);

    expect(identifiers.filter((name) => name.length > 64)).toEqual([]);


    expect(migration).toMatch(/CREATE TABLE `contract_void_requests`/);
    expect(migration).toMatch(/CREATE TABLE `contract_void_reversals`/);
    expect(migration).toMatch(/CREATE TABLE `contract_void_request_files`/);
    expect(migration).toMatch(
      /UNIQUE KEY `contract_void_requests_execution_idempotency_key_key` \(`execution_idempotency_key`\)/,
    );
    expect(migration).toMatch(
      /UNIQUE KEY `contract_void_reversals_idempotency_key_key` \(`idempotency_key`\)/,
    );
    expect(migration).toMatch(
      /CONSTRAINT `contract_void_requests_contract_id_fkey`\s+FOREIGN KEY \(`contract_id`\) REFERENCES `contracts`\(`id`\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /CONSTRAINT `contract_void_reversals_contract_void_request_id_fkey`\s+FOREIGN KEY \(`contract_void_request_id`\) REFERENCES `contract_void_requests`\(`id`\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /CONSTRAINT `contract_void_request_files_contract_void_request_id_fkey`\s+FOREIGN KEY \(`contract_void_request_id`\) REFERENCES `contract_void_requests`\(`id`\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /CONSTRAINT `contract_void_request_files_file_asset_id_fkey`\s+FOREIGN KEY \(`file_asset_id`\) REFERENCES `file_assets`\(`id`\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE)\s+`?contracts`?/im);
  });
});
