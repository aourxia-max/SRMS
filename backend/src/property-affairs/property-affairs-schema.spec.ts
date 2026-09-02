import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    expect(migration).not.toMatch(
      /^\s*(?:UPDATE|DELETE)\s+`?(?:rooms|contracts|tenants|rent_bills|payments)`?/im,
    );
  });
});
