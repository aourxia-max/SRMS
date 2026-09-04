import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { argon2id, hash } from 'argon2';
import { createPool, type Pool } from 'mariadb';
import {
  assertDisposableE2eDatabaseUrl,
  buildDisposableDatabaseName,
  readLocalTestMySqlConfig,
  type LocalTestMySqlConfig,
} from './support/isolated-e2e-database';
import { runIsolatedE2e } from './support/isolated-e2e-lifecycle';

const DISPOSABLE_DATABASE_NAME = /^srms_e2e_[a-z0-9_]+$/;
const SQL_IDENTIFIER = /^[a-z][a-z0-9_]*$/;

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
    ],
  };
}

export function buildJestCommand(
  backendRoot: string,
  jestArgs: string[],
): ChildCommand {
  return {
    command: process.execPath,
    args: [
      commandPath(backendRoot, 'node_modules/jest/bin/jest.js'),
      '--config',
      commandPath(backendRoot, 'test/jest-e2e.json'),
      ...jestArgs,
    ],
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
      'e2e_super_admin',
      passwordHash,
      'E2E 超级管理员',
      'SUPER_ADMIN',
      'ACTIVE',
      'e2e_admin',
      passwordHash,
      'E2E 管理员',
      'ADMIN',
      'ACTIVE',
    ],
  );
}

async function main(): Promise<number> {
  const backendRoot = resolve(__dirname, '..');
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
    return await runIsolatedE2e(
      { databaseUrl, databaseName, jestArgs: process.argv.slice(2) },
      {
        fingerprintShared: () =>
          fingerprintShared(rootPool, config.sourceDatabase),
        createDatabase: (name) => createDatabase(rootPool, name),
        migrate: (url) => migrateDatabase(backendRoot, url),
        seedUsers: (url) => seedUsers(url),
        runJest: (url, args) => runJest(backendRoot, url, args),
        dropDatabase: (name) => dropDatabase(rootPool, name),
        databaseExists: (name) => databaseExists(rootPool, name),
      },
    );
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
): Promise<void> {
  assertDisposableE2eDatabaseUrl(databaseUrl);
  const exitCode = await runChild(
    buildMigrationCommand(backendRoot),
    backendRoot,
    databaseUrl,
    'ignore',
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
): Promise<number> {
  assertDisposableE2eDatabaseUrl(databaseUrl);
  return runChild(
    buildJestCommand(backendRoot, jestArgs),
    backendRoot,
    databaseUrl,
    'inherit',
  );
}

function runChild(
  childCommand: ChildCommand,
  cwd: string,
  databaseUrl: string,
  stdio: 'ignore' | 'inherit',
): Promise<number> {
  return new Promise((resolveExitCode, reject) => {
    const child = spawn(childCommand.command, childCommand.args, {
      cwd,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      shell: false,
      stdio,
    });
    child.once('error', reject);
    child.once('close', (code) => resolveExitCode(code ?? 1));
  });
}

function commandPath(backendRoot: string, relativePath: string): string {
  return `${backendRoot.replace(/[\\/]+$/, '').replace(/\\/g, '/')}/${relativePath}`;
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
      process.exitCode = 1;
    });
}
