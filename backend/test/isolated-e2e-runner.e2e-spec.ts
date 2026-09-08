import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildChildEnvironment,
  formatRunnerFailure,
  buildJestCommand,
  buildMigrationCommand,
  seedE2eUsers,
} from './run-isolated-e2e';

const SERIAL_ARGUMENT_ERROR = 'E2E 必须串行运行，不能设置工作进程参数';

function readActualJestGlobalConfig(jestArgs: string[]): {
  runInBand: unknown;
  maxWorkers: unknown;
} {
  const backendRoot = resolve(__dirname, '..');
  const command = buildJestCommand(backendRoot, [...jestArgs, '--showConfig']);
  const child = spawnSync(command.command, command.args, {
    cwd: backendRoot,
    encoding: 'utf8',
    shell: false,
    env: buildChildEnvironment(
      'mysql://127.0.0.1:13306/srms_e2e_show_config_probe',
    ),
  });
  expect(child.status).toBe(0);
  const config = JSON.parse(child.stdout) as {
    globalConfig: { runInBand: unknown; maxWorkers: unknown };
  };
  return config.globalConfig;
}

describe('isolated E2E runner dependencies', () => {
  it('includes only a validated disposable name in failure diagnostics', () => {
    expect(formatRunnerFailure('srms_e2e_diagnostic_probe')).toBe(
      'E2E 执行失败，临时数据库：srms_e2e_diagnostic_probe',
    );
    expect(formatRunnerFailure('untrusted\nconfiguration')).toBe(
      'E2E 执行失败，请检查本地测试配置与测试结果',
    );
  });
  it('reports a fixed Chinese diagnostic for a public CLI failure without leaking environment values', () => {
    const backendRoot = resolve(__dirname, '..');
    const child = spawnSync(
      process.execPath,
      [
        join(backendRoot, 'node_modules/ts-node/dist/bin.js'),
        '--project',
        join(backendRoot, 'tsconfig.json'),
        join(backendRoot, 'test/run-isolated-e2e.ts'),
        '--maxWorkers=2',
      ],
      { cwd: backendRoot, encoding: 'utf8', shell: false },
    );
    expect(child.status).toBe(1);
    expect(child.stderr.trim()).toBe(
      'E2E 执行失败，请检查本地测试配置与测试结果',
    );
    expect(child.stdout.trim()).toBe('');
  });
  it.each([true, false])(
    'loads only the validated datasource with hostile dotenv controls (safe=%s)',
    (safe) => {
      const directory = mkdtempSync(join(tmpdir(), 'srms-e2e-dotenv-'));
      const hostilePath = join(directory, '.env');
      const backendRoot = resolve(__dirname, '..');
      const disposableUrl = 'mysql://127.0.0.1:13306/srms_e2e_config_probe';
      const unsafeUrl = 'mysql://127.0.0.1:13306/srms_docker';
      writeFileSync(hostilePath, `DATABASE_URL=${unsafeUrl}\n`);
      const command = buildMigrationCommand(backendRoot);
      const configIndex = command.args.indexOf('--config');
      const configPath =
        configIndex < 0
          ? join(backendRoot, 'prisma.config.ts')
          : command.args[configIndex + 1];
      try {
        const child = spawnSync(
          process.execPath,
          [
            '-e',
            `
        const { loadConfigFromFile } = require('@prisma/config');
        loadConfigFromFile({ configFile: process.argv[1] }).then(result => {
          if (result.error) {
            const message = result.error.error?.message ?? '';
            console.log(JSON.stringify({ rejected: message.includes('E2E 只能运行在本机 13306') }));
          } else {
            console.log(JSON.stringify({ unchanged: result.config.datasource.url === process.argv[2] }));
          }
        }).catch(() => console.log(JSON.stringify({ unexpected: true })));
      `,
            configPath,
            disposableUrl,
          ],
          {
            cwd: backendRoot,
            encoding: 'utf8',
            shell: false,
            env: {
              ...buildChildEnvironment(disposableUrl),
              DATABASE_URL: safe ? disposableUrl : unsafeUrl,
              DOTENV_CONFIG_OVERRIDE: 'true',
              DOTENV_CONFIG_PATH: hostilePath,
            },
          },
        );
        expect(child.status).toBe(0);
        expect(JSON.parse(child.stdout.trim()) as unknown).toEqual(
          safe ? { unchanged: true } : { rejected: true },
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
  it('builds the Prisma migration command as an executable and argument array', () => {
    expect(buildMigrationCommand('C:/repo/backend')).toEqual({
      command: process.execPath,
      args: [
        'C:/repo/backend/node_modules/prisma/build/index.js',
        'migrate',
        'deploy',
        '--config',
        'C:/repo/backend/test/prisma-e2e.config.ts',
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

  it('removes inherited dotenv controls before child processes start', () => {
    const environment = buildChildEnvironment(
      'mysql://127.0.0.1:13306/srms_e2e_20260904_ab12',
      {
        DOTENV_CONFIG_OVERRIDE: 'true',
        DOTENV_CONFIG_PATH: 'hostile.env',
        DOTENV_CONFIG_DEBUG: 'true',
        dotenv_config_encoding: 'latin1',
        PATH: 'test-path',
      },
    );
    expect(
      Object.keys(environment).filter((key) => /^dotenv_config_/i.test(key)),
    ).toEqual([]);
    expect(environment.PATH).toBe('test-path');
  });

  it('forces serial execution when the public command receives no arguments', () => {
    expect(buildJestCommand('C:/repo/backend', []).args).toContain(
      '--runInBand',
    );
  });

  it.each([
    ['--runInBand'],
    ['--run-in-band'],
    ['-i'],
    ['--runInBand=true'],
    ['--run-in-band=true'],
    ['-i=true'],
    ['--runInBand', 'true'],
    ['--run-in-band', 'true'],
    ['-i', 'true'],
    ['--runInBand', '--run-in-band', '-i'],
  ])(
    'normalizes positive serial aliases to one final canonical flag %j',
    (...args) => {
      const commandArgs = buildJestCommand('C:/repo/backend', args).args;

      expect(commandArgs.at(-1)).toBe('--runInBand');
      expect(
        commandArgs.filter((arg) =>
          ['--runInBand', '--run-in-band', '-i'].includes(arg),
        ),
      ).toEqual(['--runInBand']);
    },
  );

  it('preserves harmless user arguments before the final canonical flag', () => {
    expect(
      buildJestCommand('C:/repo/backend', [
        '--passWithNoTests',
        '--testNamePattern=probe',
      ]).args.slice(-3),
    ).toEqual(['--passWithNoTests', '--testNamePattern=probe', '--runInBand']);
  });

  it.each([[[]], [['--passWithNoTests']]])(
    'resolves actual Jest showConfig to serial execution without loading E2E suites %j',
    (args: string[]) => {
      expect(readActualJestGlobalConfig(args)).toEqual(
        expect.objectContaining({ runInBand: true, maxWorkers: 1 }),
      );
    },
  );

  it.each([
    ['--no-runInBand'],
    ['--no-run-in-band'],
    ['--no-runInBand=true'],
    ['--no-run-in-band=true'],
    ['--no-runInBand=false'],
    ['--no-run-in-band=false'],
    ['--runInBand=false'],
    ['--run-in-band=false'],
    ['-i=false'],
    ['--runInBand=FALSE'],
    ['--run-in-band=0'],
    ['-i=0'],
    ['--runInBand='],
    ['--run-in-band='],
    ['-i='],
    ['--runInBand', 'false'],
    ['--run-in-band', 'false'],
    ['-i', 'false'],
    ['--'],
  ])('rejects serial mode override arguments %j', (...args) => {
    expect(() => buildJestCommand('C:/repo/backend', args)).toThrow(
      SERIAL_ARGUMENT_ERROR,
    );
  });

  it.each([
    ['--maxWorkers', '2'],
    ['--maxWorkers=2'],
    ['--max-workers', '2'],
    ['--max-workers=2'],
    ['-w', '2'],
    ['-w2'],
    ['-w=2'],
  ])('rejects conflicting worker arguments %j', (...args) => {
    expect(() => buildJestCommand('C:/repo/backend', args)).toThrow(
      SERIAL_ARGUMENT_ERROR,
    );
  });
});
