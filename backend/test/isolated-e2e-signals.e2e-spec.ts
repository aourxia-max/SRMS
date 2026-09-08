import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import type { ChildCommand } from './run-isolated-e2e';
import type {
  IsolatedE2eDependencies,
  IsolatedE2eOptions,
} from './support/isolated-e2e-lifecycle';
import { runIsolatedE2e } from './support/isolated-e2e-lifecycle';

const options = {
  databaseName: 'srms_e2e_signal_probe',
  databaseUrl: 'mysql://127.0.0.1:13306/srms_e2e_signal_probe',
  jestArgs: [],
};

type SignalRunner = (
  options: IsolatedE2eOptions,
  dependencies: (signal: AbortSignal) => IsolatedE2eDependencies,
  source: EventEmitter,
) => Promise<number>;
type ChildRunner = (
  command: ChildCommand,
  cwd: string,
  url: string,
  stdio: 'ignore',
  signal: AbortSignal,
) => Promise<number>;

function databaseDependencies(operations: string[]): IsolatedE2eDependencies {
  let exists = false;
  return {
    fingerprintShared: () => {
      operations.push('fingerprint');
      return Promise.resolve('same');
    },
    createDatabase: () => {
      exists = true;
      operations.push('create');
      return Promise.resolve();
    },
    migrate: () => {
      operations.push('migrate');
      return Promise.resolve();
    },
    seedUsers: () => {
      operations.push('seed');
      return Promise.resolve();
    },
    runJest: () => {
      operations.push('jest');
      return Promise.resolve(0);
    },
    dropDatabase: (name) => {
      expect(name).toBe('srms_e2e_signal_probe');
      exists = false;
      operations.push('drop');
      return Promise.resolve();
    },
    databaseExists: (name) => {
      expect(name).toBe('srms_e2e_signal_probe');
      operations.push('assert-absent');
      return Promise.resolve(exists);
    },
  };
}

describe('isolated E2E cancellation', () => {
  it('awaits creation then cleans up without starting migration when cancelled during CREATE', async () => {
    const controller = new AbortController();
    const operations: string[] = [];
    const dependencies = databaseDependencies(operations);
    const create = dependencies.createDatabase;
    dependencies.createDatabase = async (name) => {
      await create(name);
      controller.abort(new Error('cancelled'));
    };
    await expect(
      runIsolatedE2e({ ...options, signal: controller.signal }, dependencies),
    ).rejects.toThrow('cancelled');
    expect(operations).toEqual([
      'fingerprint',
      'create',
      'drop',
      'assert-absent',
      'fingerprint',
    ]);
  });

  it.each([
    ['SIGINT', 130, 'migrate'],
    ['SIGTERM', 143, 'migrate'],
    ['SIGINT', 130, 'jest'],
    ['SIGTERM', 143, 'jest'],
  ] as const)(
    'handles %s (exit %s) during %s child execution with one verified cleanup',
    async (signalName, code, stage) => {
      const runner =
        jest.requireActual<Record<string, unknown>>('./run-isolated-e2e');
      expect(runner.runWithTerminationSignals).toEqual(expect.any(Function));
      expect(runner.runChild).toEqual(expect.any(Function));
      if (
        typeof runner.runWithTerminationSignals !== 'function' ||
        typeof runner.runChild !== 'function'
      )
        return;
      const runWithSignals = runner.runWithTerminationSignals as SignalRunner;
      const runChild = runner.runChild as ChildRunner;
      const source = new EventEmitter();
      const operations: string[] = [];
      const result = await runWithSignals(
        options,
        (signal) => {
          const dependencies = databaseDependencies(operations);
          const child = async () => {
            operations.push(`${stage}-start`);
            const completion = runChild(
              {
                command: process.execPath,
                args: ['-e', 'setTimeout(() => {}, 10000)'],
              },
              resolve(__dirname, '..'),
              options.databaseUrl,
              'ignore',
              signal,
            );
            source.emit(signalName);
            source.emit(signalName);
            const exitCode = await completion;
            operations.push(`${stage}-closed`);
            return exitCode;
          };
          if (stage === 'migrate')
            dependencies.migrate = async () => {
              const exitCode = await child();
              if (exitCode !== 0) throw new Error('migration child failed');
            };
          else dependencies.runJest = child;
          return dependencies;
        },
        source,
      );
      expect(result).toBe(code);
      expect(
        operations.filter((operation) => operation === 'drop'),
      ).toHaveLength(1);
      expect(operations.slice(-4)).toEqual([
        `${stage}-closed`,
        'drop',
        'assert-absent',
        'fingerprint',
      ]);
      if (stage === 'migrate') expect(operations).not.toContain('seed');
      expect(source.listenerCount('SIGINT')).toBe(0);
      expect(source.listenerCount('SIGTERM')).toBe(0);
    },
  );
});
