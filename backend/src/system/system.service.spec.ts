import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { SystemService } from './system.service';

jest.mock('fs/promises', () => ({ readFile: jest.fn() }));

describe('SystemService', () => {
  it('rehydrates restored backup metadata from controlled backup files', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    jest
      .mocked(readFile)
      .mockResolvedValueOnce(Buffer.from('database backup'))
      .mockResolvedValueOnce(Buffer.from('attachment backup'))
      .mockResolvedValueOnce(Buffer.from('{"backupNo":"BK-1"}'));
    const service = new SystemService(
      { db: { backupRecord: { upsert } } } as never,
      {
        getOrThrow: jest.fn().mockReturnValue('D:/controlled-backups'),
      } as never,
    );

    await service.rehydrateBackupMetadata({
      backupNo: 'BK-1',
      backupType: 'MANUAL',
      retentionUntil: new Date('2026-08-27T00:00:00.000Z'),
      createdBy: 1,
      startedAt: new Date('2026-07-28T00:00:00.000Z'),
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { backupNo: 'BK-1' },
        update: expect.objectContaining({ status: 'SUCCESS' }),
      }),
    );
  });

  it('re-registers a pre-restore backup after database restoration', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const service = new SystemService(
      { db: { backupRecord: { upsert } } } as never,
      {} as never,
    );

    await service.persistPreRestoreBackup({
      backupNo: 'BK-PRE-1',
      status: 'SUCCESS',
      databasePath: 'D:/backups/BK-PRE-1.sql',
      manifestPath: 'D:/backups/BK-PRE-1.manifest.json',
      sizeBytes: '1024',
      checksum: 'a'.repeat(64),
      retentionUntil: new Date('2026-08-27T00:00:00.000Z'),
      createdBy: 1,
      startedAt: new Date('2026-07-28T00:00:00.000Z'),
      completedAt: new Date('2026-07-28T00:01:00.000Z'),
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { backupNo: 'BK-PRE-1' },
        create: expect.objectContaining({
          backupType: 'PRE_RESTORE',
          sizeBytes: 1024n,
        }),
      }),
    );
  });

  it('serializes backup sizes for JSON responses', async () => {
    const service = new SystemService(
      {
        db: {
          backupRecord: {
            findMany: jest
              .fn()
              .mockResolvedValue([{ id: 1, sizeBytes: 1024n }]),
          },
        },
      } as never,
      {} as never,
    );

    const result = await service.listBackups();

    expect(result[0].sizeBytes).toBe('1024');
  });

  it('verifies an audit record when database JSON key order differs', async () => {
    const occurredAt = new Date('2026-07-27T15:47:08.377Z');
    const payload = JSON.stringify({
      eventType: 'FINANCE_REPORT_EXPORTED',
      entityType: 'FINANCE_REPORT',
      entityId: null,
      operatorId: 1,
      eventData: {
        report: 'CASH_FLOW_XLSX',
        filters: { from: '2026-07-01', to: '2026-07-31' },
      },
      reason: null,
      occurredAt: occurredAt.toISOString(),
      previousHash: null,
    });
    const recordHash = createHash('sha256').update(payload).digest('hex');
    const service = new SystemService(
      {
        db: {
          securityAuditLog: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 1,
                eventType: 'FINANCE_REPORT_EXPORTED',
                entityType: 'FINANCE_REPORT',
                entityId: null,
                operatorId: 1,
                eventData: {
                  report: 'CASH_FLOW_XLSX',
                  filters: { to: '2026-07-31', from: '2026-07-01' },
                },
                reason: null,
                occurredAt,
                previousHash: null,
                recordHash,
              },
            ]),
          },
        },
      } as never,
      {} as never,
    );

    await expect(service.verifyAudits()).resolves.toEqual({
      valid: true,
      invalidIds: [],
      legacyIds: [1],
      total: 1,
    });
  });
});
