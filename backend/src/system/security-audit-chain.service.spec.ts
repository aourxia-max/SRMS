import { createHash } from 'crypto';
import { SecurityAuditChainService } from './security-audit-chain.service';

describe('SecurityAuditChainService', () => {
  it('appends the exact canonical payload to the existing hash chain', async () => {
    const occurredAt = new Date('2026-08-26T10:11:12.345Z');
    const previousHash = 'a'.repeat(64);
    const create = jest.fn(
      ({
        data,
      }: {
        data: Record<string, unknown>;
      }): Record<string, unknown> => ({
        id: 8,
        ...data,
      }),
    );
    const tx = {
      securityAuditLog: {
        findFirst: jest.fn().mockResolvedValue({ recordHash: previousHash }),
        create,
      },
    };
    const canonicalPayload =
      '{"entityId":9,"entityType":"CONTRACT_VOID_REQUEST","eventData":{"impactHash":"bbb","nested":{"a":1,"z":2}},"eventType":"CONTRACT_VOID_COMPLETED","occurredAt":"2026-08-26T10:11:12.345Z","operatorId":1,"previousHash":"' +
      previousHash +
      '","reason":null}';
    const expectedHash = createHash('sha256')
      .update(canonicalPayload)
      .digest('hex');

    const result = await new SecurityAuditChainService().append(tx as never, {
      eventType: 'CONTRACT_VOID_COMPLETED',
      entityType: 'CONTRACT_VOID_REQUEST',
      entityId: 9,
      operatorId: 1,
      eventData: {
        nested: { z: 2, a: 1 },
        impactHash: 'bbb',
      },
      occurredAt,
    });

    expect(result).toEqual(
      expect.objectContaining({ id: 8, recordHash: expectedHash }),
    );
    expect(tx.securityAuditLog.findFirst).toHaveBeenCalledWith({
      where: { recordHash: { not: null } },
      orderBy: { id: 'desc' },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        eventType: 'CONTRACT_VOID_COMPLETED',
        entityType: 'CONTRACT_VOID_REQUEST',
        entityId: 9,
        operatorId: 1,
        eventData: {
          nested: { z: 2, a: 1 },
          impactHash: 'bbb',
        },
        reason: null,
        occurredAt,
        previousHash,
        recordHash: expectedHash,
      },
    });
  });
});
