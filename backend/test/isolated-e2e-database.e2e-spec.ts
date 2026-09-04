import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertDisposableE2eDatabaseUrl,
  buildDisposableDatabaseName,
  readLocalTestMySqlConfig,
  runAfterDisposableE2eDatabaseGuard,
} from './support/isolated-e2e-database';

describe('isolated e2e database safety', () => {
  it.each([
    'mysql://user:secret@127.0.0.1:13306/srms_docker',
    'mysql://user:secret@localhost:3306/srms_e2e_20260904_ab12',
    'mysql://user:secret@database.example:13306/srms_e2e_20260904_ab12',
    'mysql://user:secret@127.0.0.1:13306/srms',
    'mysql://user:secret@127.0.0.1:13306/SRMS_E2E_BAD',
  ])('rejects unsafe database target %s', (databaseUrl) => {
    expect(() => assertDisposableE2eDatabaseUrl(databaseUrl)).toThrow(
      'E2E 只能运行在本机 13306 端口的一次性 srms_e2e 数据库',
    );
  });

  it('accepts an exact disposable localhost target', () => {
    expect(
      assertDisposableE2eDatabaseUrl(
        'mysql://user:secret@127.0.0.1:13306/srms_e2e_20260904_ab12',
      ).pathname,
    ).toBe('/srms_e2e_20260904_ab12');
  });

  it('accepts an IPv6 loopback disposable target', () => {
    expect(() =>
      assertDisposableE2eDatabaseUrl(
        'mysql://user:secret@[::1]:13306/srms_e2e_20260904_ab12',
      ),
    ).not.toThrow();
  });

  it.each([
    ['an unsafe target', 'mysql://user:secret@localhost:3306/srms'],
    ['a missing target', undefined],
  ])('rejects %s before connecting', async (_scenario, databaseUrl) => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const connect = jest.fn(() => Promise.resolve());

    if (databaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = databaseUrl;
    }

    try {
      await expect(runAfterDisposableE2eDatabaseGuard(connect)).rejects.toThrow(
        'E2E 只能运行在本机 13306 端口的一次性 srms_e2e 数据库',
      );
      expect(connect).not.toHaveBeenCalled();
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });

  it.each([
    ['contract deposit', './contract-deposit.e2e-spec'],
    [
      'approval tasks and contract remark',
      './approval-tasks-contract-remark.e2e-spec',
    ],
    ['checkout rent refund', './checkout-rent-refund.e2e-spec'],
    ['contract void correction', './contract-void-correction.e2e-spec'],
    ['property affairs', './property-affairs.e2e-spec'],
  ])(
    'defers AppModule evaluation until guarded setup for %s',
    (_scenario, suitePath) => {
      let appModuleEvaluated = false;
      const enumValues = new Proxy<Record<string, string>>(
        {},
        { get: (_target, property) => String(property) },
      );
      const prismaNamespace = new Proxy<Record<string, unknown>>(
        {
          Decimal: class MockDecimal {},
          PrismaClientKnownRequestError: class MockPrismaError extends Error {},
        },
        { get: (target, property) => target[String(property)] ?? jest.fn() },
      );
      jest.resetModules();
      jest.doMock(
        '@prisma/client',
        () =>
          new Proxy<Record<string, unknown>>(
            {
              __esModule: true,
              Prisma: prismaNamespace,
              PrismaClient: class MockPrismaClient {},
              UserRole: enumValues,
            },
            {
              get: (target, property) => target[String(property)] ?? enumValues,
            },
          ),
      );
      jest.doMock('../src/app.module', () => {
        appModuleEvaluated = true;
        return { AppModule: class MockAppModule {} };
      });
      const describeSpy = jest
        .spyOn(global, 'describe')
        .mockImplementation(() => undefined);

      try {
        jest.isolateModules(() => {
          void jest.requireActual<Record<string, unknown>>(suitePath);
        });
        expect(appModuleEvaluated).toBe(false);
      } finally {
        describeSpy.mockRestore();
        jest.dontMock('../src/app.module');
        jest.dontMock('@prisma/client');
        jest.resetModules();
      }
    },
  );

  it('parses quoted local test MySQL settings without exposing passwords', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'srms-e2e-config-'));
    const envPath = join(fixtureDirectory, '.env');
    const fixtureValue = String(process.pid);
    writeFileSync(
      envPath,
      [
        "MYSQL_USER='e2e_user'",
        `MYSQL_PASSWORD="${fixtureValue}"`,
        `MYSQL_ROOT_PASSWORD='${fixtureValue}'`,
        'MYSQL_DATABASE="srms_docker"',
        "MYSQL_PORT='13306'",
      ].join('\n'),
    );

    try {
      expect(readLocalTestMySqlConfig(envPath)).toMatchObject({
        host: '127.0.0.1',
        port: 13306,
        sourceDatabase: 'srms_docker',
        user: 'e2e_user',
      });
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it('reports missing local test MySQL variables in Chinese', () => {
    const fixtureDirectory = mkdtempSync(join(tmpdir(), 'srms-e2e-config-'));
    const envPath = join(fixtureDirectory, '.env');
    writeFileSync(
      envPath,
      [
        'MYSQL_USER=e2e_user',
        'MYSQL_PASSWORD=placeholder-password',
        'MYSQL_DATABASE=srms_docker',
        'MYSQL_PORT=13306',
      ].join('\n'),
    );

    try {
      expect(() => readLocalTestMySqlConfig(envPath)).toThrow(
        '本地测试 MySQL 配置缺少必填变量：MYSQL_ROOT_PASSWORD',
      );
    } finally {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it.each([
    ['MYSQL_PORT', '13307', '本地测试 MySQL 端口必须为 13306'],
    ['MYSQL_DATABASE', 'srms', '本地测试 MySQL 配置来源库必须为 srms_docker'],
  ])(
    'rejects unsafe local test MySQL setting %s=%s',
    (variable, value, message) => {
      const fixtureDirectory = mkdtempSync(join(tmpdir(), 'srms-e2e-config-'));
      const envPath = join(fixtureDirectory, '.env');
      const fixtureValue = String(process.pid);
      const settings: Record<string, string> = {
        MYSQL_USER: 'e2e_user',
        MYSQL_PASSWORD: fixtureValue,
        MYSQL_ROOT_PASSWORD: fixtureValue,
        MYSQL_DATABASE: 'srms_docker',
        MYSQL_PORT: '13306',
      };
      settings[variable] = value;
      writeFileSync(
        envPath,
        Object.entries(settings)
          .map(([key, setting]) => `${key}="${setting}"`)
          .join('\n'),
      );

      try {
        expect(() => readLocalTestMySqlConfig(envPath)).toThrow(message);
      } finally {
        rmSync(fixtureDirectory, { recursive: true, force: true });
      }
    },
  );

  it('builds a disposable database name from a fixed date and suffix', () => {
    expect(
      buildDisposableDatabaseName(new Date('2026-09-04T00:00:00.000Z'), 'ab12'),
    ).toBe('srms_e2e_20260904_ab12');
  });

  it('rejects a database-name suffix outside the disposable-name policy', () => {
    expect(() =>
      buildDisposableDatabaseName(new Date('2026-09-04T00:00:00.000Z'), 'AB12'),
    ).toThrow('E2E 只能运行在本机 13306 端口的一次性 srms_e2e 数据库');
  });
});
