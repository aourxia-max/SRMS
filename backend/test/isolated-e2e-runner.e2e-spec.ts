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
        '--experimental-vm-modules',
        'C:/repo/backend/node_modules/jest/bin/jest.js',
        '--config',
        'C:/repo/backend/test/jest-e2e.json',
        '--runInBand',
      ],
    });
  });

  it('builds a deterministic isolated child environment for file-writing suites', () => {
    const runnerModule =
      jest.requireActual<Record<string, unknown>>('./run-isolated-e2e');
    const buildChildEnvironment = runnerModule.buildChildEnvironment;
    const databaseUrl = [
      'mysql:',
      '//127.0.0.1:13306',
      '/srms_e2e_20260904_ab12',
    ].join('');

    expect(buildChildEnvironment).toEqual(expect.any(Function));
    if (typeof buildChildEnvironment !== 'function') return;

    expect(
      buildChildEnvironment(databaseUrl, {
        PATH: 'test-path',
        TENANT_FILE_MAX_SIZE_BYTES: '1',
      }),
    ).toEqual({
      PATH: 'test-path',
      DATABASE_URL: databaseUrl,
      TENANT_FILE_MAX_SIZE_BYTES: '10485760',
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
      'srms-e2e-super-admin',
      opaquePasswordHash,
      'E2E 超级管理员',
      'SUPER_ADMIN',
      'ACTIVE',
      'srms-e2e-admin',
      opaquePasswordHash,
      'E2E 管理员',
      'ADMIN',
      'ACTIVE',
    ]);
  });
});
