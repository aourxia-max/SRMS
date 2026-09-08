import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { argon2id, hash } from 'argon2';
import { createPool, type Pool } from 'mariadb';
import {
  assertDisposableE2eDatabaseUrl,
  buildDisposableDatabaseName,
  readLocalTestMySqlConfig,
  type LocalTestMySqlConfig,
} from './support/isolated-e2e-database';
import {
  runIsolatedE2e,
  type IsolatedE2eDependencies,
  type IsolatedE2eOptions,
} from './support/isolated-e2e-lifecycle';

const DISPOSABLE_DATABASE_NAME = /^srms_e2e_[a-z0-9_]+$/;
const SQL_IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const SERIAL_ARGUMENT_ERROR = 'E2E 必须串行运行，不能设置工作进程参数';
const POSITIVE_SERIAL_ARGUMENTS = new Set([
  '--runInBand',
  '--run-in-band',
  '-i',
]);
const SERIAL_ASSIGNMENT = /^(?:--runInBand|--run-in-band|-i)=(.*)$/;
const NEGATIVE_SERIAL_ARGUMENT = /^--no-(?:runInBand|run-in-band)(?:=.*)?$/;
const WORKER_ARGUMENT = /^(?:--maxWorkers|--max-workers)(?:=|$)|^-w/;

const FINGERPRINT_TABLES = [
  { table: 'buildings', monetaryColumns: [] },
  { table: 'rooms', monetaryColumns: [] },
  { table: 'tenants', monetaryColumns: [] },
  { table: 'contracts', monetaryColumns: ['monthly_rent', 'deposit_required'] },
  {
    table: 'rent_bills',
    monetaryColumns: [
      'unit_monthly_rent',
      'base_rent_amount',
      'rent_free_amount',
      'discount_amount',
      'adjustment_amount',
      'payable_amount',
      'received_amount',
      'outstanding_amount',
    ],
  },
  { table: 'payments', monetaryColumns: ['amount'] },
  {
    table: 'deposit_transactions',
    monetaryColumns: ['amount', 'balance_after'],
  },
  {
    table: 'prepayment_transactions',
    monetaryColumns: ['amount', 'balance_after'],
  },
  {
    table: 'checkout_settlements',
    monetaryColumns: [
      'rent_receivable',
      'rent_received',
      'rent_outstanding',
      'prepayment_balance',
      'deposit_balance',
      'deposit_offset_amount',
      'other_deduction_amount',
      'deposit_refundable_amount',
      'prepayment_refundable_amount',
      'rent_refundable_amount',
      'final_receivable',
      'supplemental_arrears_amount',
      'supplemental_inspection_amount',
      'supplemental_received_amount',
      'supplemental_outstanding_amount',
    ],
  },
  {
    table: 'deposit_refunds',
    monetaryColumns: [
      'refund_amount',
      'deposit_refund_amount',
      'prepayment_refund_amount',
      'rent_refund_amount',
    ],
  },
] as const;

export type ChildCommand = { command: string; args: string[] };
export type SeedQueryable = {
  query(sql: string, values: unknown[]): Promise<unknown>;
};

export function buildMigrationCommand(backendRoot: string): ChildCommand {
  return {
    command: process.execPath,
    args: [
      commandPath(backendRoot, 'node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--config',
      commandPath(backendRoot, 'test/prisma-e2e.config.ts'),
    ],
  };
}

export function buildJestCommand(
  backendRoot: string,
  jestArgs: string[],
): ChildCommand {
  const normalizedJestArgs = normalizeJestArgs(jestArgs);
  return {
    command: process.execPath,
    args: [
      '--experimental-vm-modules',
      commandPath(backendRoot, 'node_modules/jest/bin/jest.js'),
      '--config',
      commandPath(backendRoot, 'test/jest-e2e.json'),
      ...normalizedJestArgs,
      '--runInBand',
    ],
  };
}

function normalizeJestArgs(jestArgs: string[]): string[] {
  const normalizedArgs: string[] = [];

  for (let index = 0; index < jestArgs.length; index += 1) {
    const argument = jestArgs[index];
    if (
      argument === '--' ||
      WORKER_ARGUMENT.test(argument) ||
      NEGATIVE_SERIAL_ARGUMENT.test(argument)
    ) {
      throw new Error(SERIAL_ARGUMENT_ERROR);
    }

    const assignment = SERIAL_ASSIGNMENT.exec(argument);
    if (assignment) {
      if (assignment[1].toLowerCase() !== 'true') {
        throw new Error(SERIAL_ARGUMENT_ERROR);
      }
      continue;
    }

    if (POSITIVE_SERIAL_ARGUMENTS.has(argument)) {
      const separatedValue = jestArgs[index + 1]?.toLowerCase();
      if (separatedValue === 'false') {
        throw new Error(SERIAL_ARGUMENT_ERROR);
      }
      if (separatedValue === 'true') index += 1;
      continue;
    }

    normalizedArgs.push(argument);
  }

  return normalizedArgs;
}

export function buildChildEnvironment(
  databaseUrl: string,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  assertDisposableE2eDatabaseUrl(databaseUrl);
  return {
    ...Object.fromEntries(
      Object.entries(environment).filter(
        ([key]) => !/^dotenv_config_/i.test(key),
      ),
    ),
    DATABASE_URL: databaseUrl,
    TENANT_FILE_MAX_SIZE_BYTES: '10485760',
  };
}

export async function seedE2eUsers(
  queryable: SeedQueryable,
  passwordHash: string,
): Promise<void> {
  await queryable.query(
    `INSERT INTO users
      (username, password_hash, display_name, role, status, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3)),
            (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [
      'srms-e2e-super-admin',
      passwordHash,
      'E2E 超级管理员',
      'SUPER_ADMIN',
      'ACTIVE',
      'srms-e2e-admin',
      passwordHash,
      'E2E 管理员',
      'ADMIN',
      'ACTIVE',
    ],
  );
}

async function main(): Promise<number> {
  const backendRoot = resolve(__dirname, '..');
  buildJestCommand(backendRoot, process.argv.slice(2));
  const envPath = resolve(backendRoot, '..', 'deploy', '.env.test');
  const config = readLocalTestMySqlConfig(envPath);
  const now = new Date();
  const time = [now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join('');
  const milliseconds = String(now.getUTCMilliseconds()).padStart(3, '0');
  const randomSuffix = randomBytes(3).toString('hex');
  const databaseName = buildDisposableDatabaseName(
    now,
    `${time}${milliseconds}_${randomSuffix}`,
  );
  const databaseUrl = buildRootDatabaseUrl(config, databaseName);
  const rootPool = createRootPool(config);

  try {
    return await runWithTerminationSignals(
      { databaseUrl, databaseName, jestArgs: process.argv.slice(2) },
      (signal) => ({
        fingerprintShared: () =>
          fingerprintShared(rootPool, config.sourceDatabase),
        createDatabase: (name) => createDatabase(rootPool, name),
        migrate: (url) => migrateDatabase(backendRoot, url, signal),
        seedUsers: (url) => seedUsers(url),
        runJest: (url, args) => runJest(backendRoot, url, args, signal),
        dropDatabase: (name) => dropDatabase(rootPool, name),
        databaseExists: (name) => databaseExists(rootPool, name),
      }),
    );
  } catch {
    console.error(formatRunnerFailure(databaseName));
    return 1;
  } finally {
    await rootPool.end();
  }
}

function createRootPool(config: LocalTestMySqlConfig): Pool {
  return createPool({
    host: config.host,
    port: config.port,
    user: 'root',
    password: config.rootPassword,
    connectionLimit: 1,
    allowPublicKeyRetrieval: true,
  });
}

function buildRootDatabaseUrl(
  config: LocalTestMySqlConfig,
  databaseName: string,
): string {
  const url = new URL(`mysql://${config.host}:${config.port}`);
  url.username = 'root';
  url.password = config.rootPassword;
  url.pathname = `/${databaseName}`;
  url.searchParams.set('allowPublicKeyRetrieval', 'true');
  const databaseUrl = url.toString();
  assertDisposableE2eDatabaseUrl(databaseUrl);
  return databaseUrl;
}

async function fingerprintShared(
  pool: Pool,
  sourceDatabase: string,
): Promise<string> {
  const database = quoteSourceDatabaseIdentifier(sourceDatabase);
  const fingerprint: Array<{
    table: string;
    count: string;
    sums: Record<string, string>;
  }> = [];

  for (const definition of FINGERPRINT_TABLES) {
    const table = quoteStaticIdentifier(definition.table);
    const projections = [
      'CAST(COUNT(*) AS CHAR) AS row_count',
      ...definition.monetaryColumns.map((column) => {
        const identifier = quoteStaticIdentifier(column);
        const alias = quoteStaticIdentifier(`sum_${column}`);
        return `CAST(COALESCE(SUM(${identifier}), 0) AS CHAR) AS ${alias}`;
      }),
    ];
    const rows = await pool.query<Array<Record<string, unknown>>>(
      `SELECT ${projections.join(', ')} FROM ${database}.${table} WHERE ? = ?`,
      [sourceDatabase, 'srms_docker'],
    );
    const row = rows[0];
    if (!row) throw new Error('无法读取共享测试库指纹');

    fingerprint.push({
      table: definition.table,
      count: String(row.row_count),
      sums: Object.fromEntries(
        definition.monetaryColumns.map((column) => [
          column,
          String(row[`sum_${column}`]),
        ]),
      ),
    });
  }

  return JSON.stringify(fingerprint);
}

async function createDatabase(pool: Pool, databaseName: string): Promise<void> {
  const database = quoteDisposableDatabaseIdentifier(databaseName);
  await pool.query(
    `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    [],
  );
}

async function dropDatabase(pool: Pool, databaseName: string): Promise<void> {
  const database = quoteDisposableDatabaseIdentifier(databaseName);
  await pool.query(`DROP DATABASE IF EXISTS ${database}`, []);
}

async function databaseExists(
  pool: Pool,
  databaseName: string,
): Promise<boolean> {
  quoteDisposableDatabaseIdentifier(databaseName);
  const rows = await pool.query<Array<{ database_count: number | bigint }>>(
    `SELECT COUNT(*) AS database_count
       FROM information_schema.schemata
      WHERE schema_name = ?`,
    [databaseName],
  );
  return Number(rows[0]?.database_count ?? 0) !== 0;
}

async function migrateDatabase(
  backendRoot: string,
  databaseUrl: string,
  signal: AbortSignal,
): Promise<void> {
  assertDisposableE2eDatabaseUrl(databaseUrl);
  const exitCode = await runChild(
    buildMigrationCommand(backendRoot),
    backendRoot,
    databaseUrl,
    'ignore',
    signal,
  );
  if (exitCode !== 0) {
    throw new Error(`Prisma migration failed with exit code ${exitCode}`);
  }
}

async function seedUsers(databaseUrl: string): Promise<void> {
  const url = assertDisposableE2eDatabaseUrl(databaseUrl);
  const pool = createPool({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
    connectionLimit: 1,
    allowPublicKeyRetrieval: true,
  });

  try {
    const passwordHash = await hash(randomBytes(32), { type: argon2id });
    await seedE2eUsers(
      { query: (sql, values) => pool.query(sql, values) },
      passwordHash,
    );
  } finally {
    await pool.end();
  }
}

function runJest(
  backendRoot: string,
  databaseUrl: string,
  jestArgs: string[],
  signal: AbortSignal,
): Promise<number> {
  assertDisposableE2eDatabaseUrl(databaseUrl);
  return runChild(
    buildJestCommand(backendRoot, jestArgs),
    backendRoot,
    databaseUrl,
    'inherit',
    signal,
  );
}

export function runChild(
  childCommand: ChildCommand,
  cwd: string,
  databaseUrl: string,
  stdio: 'ignore' | 'inherit',
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  return new Promise((resolveExitCode, reject) => {
    const child = spawn(childCommand.command, childCommand.args, {
      cwd,
      env: buildChildEnvironment(databaseUrl),
      shell: false,
      stdio,
      windowsHide: true,
    });
    let childError: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    const cancel = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    child.once('error', (error) => {
      childError = error;
    });
    child.once('close', (code) => {
      signal?.removeEventListener('abort', cancel);
      if (killTimer) clearTimeout(killTimer);
      if (childError) reject(childError);
      else resolveExitCode(code ?? 1);
    });
  });
}

export async function runWithTerminationSignals(
  options: IsolatedE2eOptions,
  dependencies: (signal: AbortSignal) => IsolatedE2eDependencies,
  signalSource: Pick<EventEmitter, 'on' | 'removeListener'> = process,
): Promise<number> {
  const controller = new AbortController();
  let signalExitCode: number | undefined;
  const cancel = (code: number) => {
    if (signalExitCode !== undefined) return;
    signalExitCode = code;
    controller.abort(new Error('E2E 已收到终止信号'));
  };
  const onInterrupt = () => cancel(130);
  const onTerminate = () => cancel(143);
  signalSource.on('SIGINT', onInterrupt);
  signalSource.on('SIGTERM', onTerminate);
  try {
    const exitCode = await runIsolatedE2e(
      { ...options, signal: controller.signal },
      dependencies(controller.signal),
    );
    return signalExitCode ?? exitCode;
  } catch (error) {
    if (signalExitCode !== undefined && error === controller.signal.reason)
      return signalExitCode;
    throw error;
  } finally {
    signalSource.removeListener('SIGINT', onInterrupt);
    signalSource.removeListener('SIGTERM', onTerminate);
  }
}

function commandPath(backendRoot: string, relativePath: string): string {
  return `${backendRoot.replace(/[\\/]+$/, '').replace(/\\/g, '/')}/${relativePath}`;
}

export function formatRunnerFailure(databaseName?: string): string {
  return databaseName && DISPOSABLE_DATABASE_NAME.test(databaseName)
    ? `E2E 执行失败，临时数据库：${databaseName}`
    : 'E2E 执行失败，请检查本地测试配置与测试结果';
}

function quoteDisposableDatabaseIdentifier(databaseName: string): string {
  if (!DISPOSABLE_DATABASE_NAME.test(databaseName)) {
    throw new Error('拒绝操作非一次性 E2E 数据库');
  }
  return `\`${databaseName}\``;
}

function quoteSourceDatabaseIdentifier(databaseName: string): string {
  if (databaseName !== 'srms_docker') {
    throw new Error('共享测试库必须为 srms_docker');
  }
  return `\`${databaseName}\``;
}

function quoteStaticIdentifier(identifier: string): string {
  if (!SQL_IDENTIFIER.test(identifier)) {
    throw new Error('无效的固定 SQL 标识符');
  }
  return `\`${identifier}\``;
}

if (require.main === module) {
  void main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      console.error(formatRunnerFailure());
      process.exitCode = 1;
    });
}
