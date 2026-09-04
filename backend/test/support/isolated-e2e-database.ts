import { readFileSync } from 'node:fs';

const DISPOSABLE_DATABASE_NAME = /^srms_e2e_[a-z0-9_]+$/;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DISPOSABLE_DATABASE_ERROR =
  'E2E 只能运行在本机 13306 端口的一次性 srms_e2e 数据库';

export type LocalTestMySqlConfig = {
  host: '127.0.0.1';
  port: 13306;
  sourceDatabase: 'srms_docker';
  user: string;
  password: string;
  rootPassword: string;
};

export function assertDisposableE2eDatabaseUrl(databaseUrl: string): URL {
  let url: URL;
  let databaseName: string;

  try {
    url = new URL(databaseUrl);
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    throw new Error(DISPOSABLE_DATABASE_ERROR);
  }

  if (
    url.protocol !== 'mysql:' ||
    !LOCAL_HOSTS.has(url.hostname.toLowerCase()) ||
    url.port !== '13306' ||
    !DISPOSABLE_DATABASE_NAME.test(databaseName)
  ) {
    throw new Error(DISPOSABLE_DATABASE_ERROR);
  }

  return url;
}

export function readLocalTestMySqlConfig(envPath: string): LocalTestMySqlConfig {
  const values = parseEnvFile(readFileSync(envPath, 'utf8'));
  const requiredVariableNames = [
    'MYSQL_USER',
    'MYSQL_PASSWORD',
    'MYSQL_ROOT_PASSWORD',
    'MYSQL_DATABASE',
    'MYSQL_PORT',
  ] as const;

  for (const variableName of requiredVariableNames) {
    if (!values[variableName]) {
      throw new Error(`本地测试 MySQL 配置缺少必填变量：${variableName}`);
    }
  }

  if (Number(values.MYSQL_PORT) !== 13306) {
    throw new Error('本地测试 MySQL 端口必须为 13306');
  }
  if (values.MYSQL_DATABASE !== 'srms_docker') {
    throw new Error('本地测试 MySQL 配置来源库必须为 srms_docker');
  }

  return {
    host: '127.0.0.1',
    port: 13306,
    sourceDatabase: 'srms_docker',
    user: values.MYSQL_USER,
    password: values.MYSQL_PASSWORD,
    rootPassword: values.MYSQL_ROOT_PASSWORD,
  };
}

export function buildDisposableDatabaseName(now: Date, suffix: string): string {
  const databaseName = `srms_e2e_${formatDate(now)}_${suffix}`;

  if (!DISPOSABLE_DATABASE_NAME.test(databaseName)) {
    throw new Error(DISPOSABLE_DATABASE_ERROR);
  }

  return databaseName;
}

function parseEnvFile(contents: string): Record<string, string> {
  return contents.split(/\r?\n/).reduce<Record<string, string>>((values, line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) return values;

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) return values;

    const name = trimmedLine.slice(0, separatorIndex).trim();
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim();
    values[name] = unquote(rawValue);
    return values;
  }, {});
}

function unquote(value: string): string {
  const isQuoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"));
  return isQuoted ? value.slice(1, -1) : value;
}

function formatDate(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
