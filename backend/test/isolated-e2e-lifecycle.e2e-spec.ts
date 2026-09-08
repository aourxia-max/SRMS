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

  it('reports the disposable name, cleanup, and unchanged shared fingerprint without credentials', async () => {
    const { dependencies } = createDependencies();
    const consoleLog = jest.spyOn(console, 'log').mockImplementation();

    try {
      await expect(runIsolatedE2e(options, dependencies)).resolves.toBe(0);

      expect(consoleLog.mock.calls).toEqual([
        ['E2E 临时数据库：srms_e2e_20260904_ab12'],
        ['E2E 临时数据库已删除'],
        ['共享测试库指纹未变化'],
      ]);
      expect(consoleLog.mock.calls.flat().join('\n')).not.toContain(
        databaseUrl,
      );
    } finally {
      consoleLog.mockRestore();
    }
  });

  it('cleans up the disposable database when migration fails', async () => {
    const migrationFailure = new Error('migration failed');
    const { dependencies, operations } = createDependencies({
      migrate: () => {
        operations.push('migrate');
        return Promise.reject(migrationFailure);
      },
    });

    await expect(runIsolatedE2e(options, dependencies)).rejects.toBe(
      migrationFailure,
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

  it('normalizes a non-Error lifecycle failure without exposing its value', async () => {
    const nonErrorFailure: unknown = 'mysql://user:secret@database.example';
    const rejectWithUnknown = Promise.reject.bind(Promise);
    const { dependencies } = createDependencies({
      migrate: () => rejectWithUnknown(nonErrorFailure),
    });

    await expect(runIsolatedE2e(options, dependencies)).rejects.toEqual(
      new Error('E2E 生命周期执行失败'),
    );
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

  it('preserves a non-one Jest exit code when the shared fingerprint changes', async () => {
    const { dependencies } = createDependencies({
      fingerprints: ['before', 'after'],
      jestExitCode: 2,
    });

    await expect(runIsolatedE2e(options, dependencies)).resolves.toBe(2);
  });

  it('reports the fixed cleanup error when dropping the disposable database fails', async () => {
    const { dependencies, operations } = createDependencies({
      dropDatabase: () => {
        operations.push('drop');
        return Promise.reject(new Error('drop failed'));
      },
    });

    await expect(runIsolatedE2e(options, dependencies)).rejects.toThrow(
      'E2E 临时数据库清理失败',
    );

    expect(operations).toEqual([
      'fingerprint-before',
      'create',
      'migrate',
      'seed',
      'jest',
      'drop',
      'assert-absent',
    ]);
  });

  it('reports the fixed cleanup error when the disposable database remains', async () => {
    const { dependencies } = createDependencies({
      databaseExists: () => Promise.resolve(true),
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
    expect(consoleLog.mock.calls.flat().join('\n')).not.toContain(databaseUrl);
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
      fingerprintShared: () => {
        operations.push(
          fingerprintIndex++ === 0 ? 'fingerprint-before' : 'fingerprint-after',
        );
        return Promise.resolve(fingerprints[fingerprintIndex - 1]);
      },
      createDatabase: () => {
        operations.push('create');
        return Promise.resolve();
      },
      migrate:
        overrides.migrate ??
        (() => {
          operations.push('migrate');
          return Promise.resolve();
        }),
      seedUsers: () => {
        operations.push('seed');
        return Promise.resolve();
      },
      runJest: () => {
        operations.push('jest');
        return Promise.resolve(overrides.jestExitCode ?? 0);
      },
      dropDatabase:
        overrides.dropDatabase ??
        (() => {
          operations.push('drop');
          return Promise.resolve();
        }),
      databaseExists:
        overrides.databaseExists ??
        (() => {
          operations.push('assert-absent');
          return Promise.resolve(false);
        }),
    },
  };
}
