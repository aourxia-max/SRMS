import { createHash } from 'crypto';
import { SystemService } from './system.service';

describe('SystemService', () => {
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
