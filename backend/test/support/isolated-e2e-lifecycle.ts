import { assertDisposableE2eDatabaseUrl } from './isolated-e2e-database';

const DISPOSABLE_DATABASE_ERROR =
  'E2E 只能运行在本机 13306 端口的一次性 srms_e2e 数据库';
const CLEANUP_ERROR = 'E2E 临时数据库清理失败';

export type IsolatedE2eOptions = {
  databaseUrl: string;
  databaseName: string;
  jestArgs: string[];
};

export type IsolatedE2eDependencies = {
  fingerprintShared(): Promise<string>;
  createDatabase(name: string): Promise<void>;
  migrate(databaseUrl: string): Promise<void>;
  seedUsers(databaseUrl: string): Promise<void>;
  runJest(databaseUrl: string, args: string[]): Promise<number>;
  dropDatabase(name: string): Promise<void>;
  databaseExists(name: string): Promise<boolean>;
};

export async function runIsolatedE2e(
  options: IsolatedE2eOptions,
  dependencies: IsolatedE2eDependencies,
): Promise<number> {
  let fingerprintBefore = '';
  let jestExitCode = 1;
  let lifecycleFailure: unknown;

  try {
    assertDisposableOptions(options);
    fingerprintBefore = await dependencies.fingerprintShared();

    assertDisposableOptions(options);
    await dependencies.createDatabase(options.databaseName);
    await dependencies.migrate(options.databaseUrl);
    await dependencies.seedUsers(options.databaseUrl);
    jestExitCode = await dependencies.runJest(
      options.databaseUrl,
      options.jestArgs,
    );
  } catch (error) {
    lifecycleFailure = error;
  } finally {
    assertDisposableOptions(options);
    await cleanupDatabase(options, dependencies);
  }

  const fingerprintAfter = await dependencies.fingerprintShared();

  if (lifecycleFailure) {
    throw lifecycleFailure;
  }

  return fingerprintBefore !== fingerprintAfter && jestExitCode === 0
    ? 1
    : jestExitCode;
}

function assertDisposableOptions(options: IsolatedE2eOptions): void {
  const databaseUrl = assertDisposableE2eDatabaseUrl(options.databaseUrl);
  const databaseName = decodeURIComponent(
    databaseUrl.pathname.replace(/^\/+/, ''),
  );

  if (databaseName !== options.databaseName) {
    throw new Error(DISPOSABLE_DATABASE_ERROR);
  }
}

async function cleanupDatabase(
  options: IsolatedE2eOptions,
  dependencies: IsolatedE2eDependencies,
): Promise<void> {
  let cleanupFailed = false;

  try {
    await dependencies.dropDatabase(options.databaseName);
  } catch {
    cleanupFailed = true;
  }

  try {
    if (await dependencies.databaseExists(options.databaseName)) {
      cleanupFailed = true;
    }
  } catch {
    cleanupFailed = true;
  }

  if (cleanupFailed) {
    throw new Error(CLEANUP_ERROR);
  }
}
