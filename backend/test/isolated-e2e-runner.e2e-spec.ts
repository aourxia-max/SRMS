import {
  buildJestCommand,
  buildMigrationCommand,
  seedE2eUsers,
} from './run-isolated-e2e';

describe('isolated E2E runner dependencies', () => {
  it('builds the Prisma migration command as an executable and argument array', () => {
    expect(buildMigrationCommand('C:/repo/backend')).toEqual({
      command: process.execPath,
      args: [
        'C:/repo/backend/node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
      ],
    });
  });

  it('builds the Jest command as an executable and argument array', () => {
    expect(buildJestCommand('C:/repo/backend', ['--runInBand'])).toEqual({
      command: process.execPath,
      args: [
        'C:/repo/backend/node_modules/jest/bin/jest.js',
        '--config',
        'C:/repo/backend/test/jest-e2e.json',
        '--runInBand',
      ],
    });
  });

  it('seeds exactly one active SUPER_ADMIN and one active ADMIN with parameters', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const queryable = {
      query: (sql: string, values: unknown[]) => {
        calls.push({ sql, values });
        return Promise.resolve({ affectedRows: 2 });
      },
    };
    const opaquePasswordHash = 'opaque-test-value';

    const result = await seedE2eUsers(queryable, opaquePasswordHash);

    expect(result).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toContain(opaquePasswordHash);
    expect(calls[0].sql.match(/\?/g)).toHaveLength(10);
    expect(calls[0].values).toEqual([
      'e2e_super_admin',
      opaquePasswordHash,
      'E2E 超级管理员',
      'SUPER_ADMIN',
      'ACTIVE',
      'e2e_admin',
      opaquePasswordHash,
      'E2E 管理员',
      'ADMIN',
      'ACTIVE',
    ]);
  });
});
