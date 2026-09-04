import {
  IsolatedE2eDependencies,
  IsolatedE2eOptions,
  runIsolatedE2e,
} from './support/isolated-e2e-lifecycle';

const databaseUrl =
  'mysql://user:secret@127.0.0.1:13306/srms_e2e_20260904_ab12';
const options: IsolatedE2eOptions = {
  databaseUrl,
  databaseName: 'srms_e2e_20260904_ab12',
  jestArgs: ['--runInBand'],
};

describe('isolated e2e lifecycle', () => {
  it('runs a disposable database through setup, Jest, cleanup, and shared fingerprint checks', async () => {
    const { dependencies, operations } = createDependencies();

    await expect(runIsolatedE2e(options, dependencies)).resolves.toBe(0);

    expect(operations).toEqual([
      'fingerprint-before',
      'create',
      'migrate',
      'seed',
      'jest',
      'drop',
      'assert-absent',
      'fingerprint-after',
    ]);
  });

  it('cleans up the disposable database when migration fails', async () => {
    const migrationFailure = new Error('migration failed');
    const { dependencies, operations } = createDependencies({
      migrate: async () => {
        operations.push('migrate');
        throw migrationFailure;
      },
    });

    await expect(runIsolatedE2e(options, dependencies)).rejects.toThrow(
      'migration failed',
    );

    expect(operations).toEqual([
      'fingerprint-before',
      'create',
      'migrate',
      'drop',
      'assert-absent',
      'fingerprint-after',
    ]);
  });

  it('preserves a failing Jest exit code after successful cleanup', async () => {
    const { dependencies, operations } = createDependencies({
      jestExitCode: 1,
    });

    await expect(runIsolatedE2e(options, dependencies)).resolves.toBe(1);

    expect(operations).toEqual([
      'fingerprint-before',
      'create',
      'migrate',
      'seed',
      'jest',
      'drop',
      'assert-absent',
      'fingerprint-after',
    ]);
  });

  it('reports the fixed cleanup error when dropping the disposable database fails', async () => {
    const { dependencies } = createDependencies({
      dropDatabase: async () => {
        throw new Error('drop failed');
      },
    });

    await expect(runIsolatedE2e(options, dependencies)).rejects.toThrow(
      'E2E 临时数据库清理失败',
    );
  });

  it('reports the fixed cleanup error when the disposable database remains', async () => {
    const { dependencies } = createDependencies({
      databaseExists: async () => true,
    });

    await expect(runIsolatedE2e(options, dependencies)).rejects.toThrow(
      'E2E 临时数据库清理失败',
    );
  });

  it('returns one when the shared database fingerprint changes without logging configuration', async () => {
    const { dependencies, operations } = createDependencies({
      fingerprints: ['before', 'after'],
    });
    const consoleError = jest.spyOn(console, 'error').mockImplementation();
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    try {
      await expect(runIsolatedE2e(options, dependencies)).resolves.toBe(1);
    } finally {
      consoleError.mockRestore();
      consoleLog.mockRestore();
    }

    expect(operations).toEqual([
      'fingerprint-before',
      'create',
      'migrate',
      'seed',
      'jest',
      'drop',
      'assert-absent',
      'fingerprint-after',
    ]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
  });
});

function createDependencies(
  overrides: {
    databaseExists?: () => Promise<boolean>;
    dropDatabase?: (name: string) => Promise<void>;
    fingerprints?: [string, string];
    migrate?: (databaseUrl: string) => Promise<void>;
    jestExitCode?: number;
  } = {},
): { dependencies: IsolatedE2eDependencies; operations: string[] } {
  const operations: string[] = [];
  const fingerprints = overrides.fingerprints ?? ['same', 'same'];
  let fingerprintIndex = 0;

  return {
    operations,
    dependencies: {
      fingerprintShared: async () => {
        operations.push(
          fingerprintIndex++ === 0 ? 'fingerprint-before' : 'fingerprint-after',
        );
        return fingerprints[fingerprintIndex - 1];
      },
      createDatabase: async () => {
        operations.push('create');
      },
      migrate:
        overrides.migrate ??
        (async () => {
          operations.push('migrate');
        }),
      seedUsers: async () => {
        operations.push('seed');
      },
      runJest: async () => {
        operations.push('jest');
        return overrides.jestExitCode ?? 0;
      },
      dropDatabase:
        overrides.dropDatabase ??
        (async () => {
          operations.push('drop');
        }),
      databaseExists:
        overrides.databaseExists ??
        (async () => {
          operations.push('assert-absent');
          return false;
        }),
    },
  };
}
