import {
  collectPropertyAffairCleanupTargets,
  createIsolatedSecurityAuditChain,
  runBestEffortCleanup,
} from '../../test/property-affairs.e2e-support';

describe('property affairs E2E test support', () => {
  it('returns an audit result without reading or mutating the persistent audit chain', async () => {
    const tx = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('must not query')),
      securityAuditLog: {
        create: jest.fn().mockRejectedValue(new Error('must not create')),
      },
      securityAuditChainHead: {
        update: jest.fn().mockRejectedValue(new Error('must not update')),
      },
    };
    const occurredAt = new Date('2026-09-02T08:00:00.000Z');

    const result = await createIsolatedSecurityAuditChain().appendInTransaction(
      tx as never,
      {
        eventType: 'PERMANENT_DELETE',
        entityType: 'PROPERTY_AFFAIR',
        entityId: 41,
        operatorId: 7,
        eventData: { title: '已删除事项' },
        occurredAt,
      },
    );

    expect(result).toEqual({
      id: 1,
      eventType: 'PERMANENT_DELETE',
      entityType: 'PROPERTY_AFFAIR',
      entityId: 41,
      operatorId: 7,
      eventData: { title: '已删除事项' },
      reason: null,
      occurredAt,
      previousHash: null,
      recordHash: null,
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.securityAuditLog.create).not.toHaveBeenCalled();
    expect(tx.securityAuditChainHead.update).not.toHaveBeenCalled();
  });

  it('keeps registered ids even when prefix and remaining-link discovery miss them', () => {
    expect(
      collectPropertyAffairCleanupTargets({
        createdAffairIds: [41, 42],
        prefixedAffairIds: [42, 43],
        createdFileIds: [91, 92],
        remainingLinkedFileIds: [92, 93],
      }),
    ).toEqual({
      affairIds: [41, 42, 43],
      fileIds: [91, 92, 93],
    });
  });

  it('continues cleanup after a phase fails and reports only cleanup labels', async () => {
    const executed: string[] = [];

    const failures = await runBestEffortCleanup([
      {
        label: '反查事项',
        run: () => {
          executed.push('反查事项');
          return Promise.reject(
            new Error('database details must not replace a test failure'),
          );
        },
      },
      {
        label: '关闭应用',
        run: () => {
          executed.push('关闭应用');
          return Promise.resolve();
        },
      },
    ]);

    expect(executed).toEqual(['反查事项', '关闭应用']);
    expect(failures).toEqual(['反查事项']);
  });
});
