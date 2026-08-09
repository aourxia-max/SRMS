import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLEANUP_CONFIRMATION,
  CLEANUP_FINAL_AUTHORIZATION,
  TieredContractCleanupService,
} from './tiered-contract-cleanup.service';

describe('TieredContractCleanupService backup integrity gate', () => {
  let temporaryFolder: string;

  beforeEach(async () => {
    temporaryFolder = await mkdtemp(join(tmpdir(), 'srms-tiered-cleanup-'));
    jest.useFakeTimers().setSystemTime(new Date('2026-08-09T00:00:00.000Z'));
  });

  afterEach(async () => {
    jest.useRealTimers();
    await rm(temporaryFolder, { recursive: true, force: true });
  });

  function serviceForBackup(databasePath: string, checksum: string) {
    const transaction = jest.fn();
    const backupRecord = {
      findUnique: jest.fn().mockResolvedValue({
        backupNo: 'BK-TEST-1',
        status: 'SUCCESS',
        checksum,
        databasePath,
        retentionUntil: new Date('2026-09-01T00:00:00.000Z'),
      }),
    };
    const service = new TieredContractCleanupService(
      {
        db: { backupRecord, $transaction: transaction },
      } as unknown as PrismaService,
      {
        get: jest.fn((key: string) =>
          key === 'NODE_ENV' ? 'test' : undefined,
        ),
      } as unknown as ConfigService,
    );
    return { service, transaction };
  }

  function authorization() {
    return {
      environment: 'test' as const,
      backupNo: 'BK-TEST-1',
      confirmation: CLEANUP_CONFIRMATION,
      finalAuthorization: CLEANUP_FINAL_AUTHORIZATION,
      preflightFingerprint: '0'.repeat(64),
    };
  }

  it('备份数据库文件不存在或不可读时在事务前阻断', async () => {
    const missingPath = join(temporaryFolder, 'missing.sql');
    const { service, transaction } = serviceForBackup(
      missingPath,
      createHash('sha256').update('original').digest('hex'),
    );

    await expect(service.execute(authorization())).rejects.toThrow(
      '备份文件不可读取',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('备份文件内容被替换且 SHA-256 不再匹配时在事务前阻断', async () => {
    const databasePath = join(temporaryFolder, 'BK-TEST-1.sql');
    await writeFile(databasePath, 'tampered database backup');
    const { service, transaction } = serviceForBackup(
      databasePath,
      createHash('sha256').update('original database backup').digest('hex'),
    );

    await expect(service.execute(authorization())).rejects.toThrow(
      '备份校验失败',
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
