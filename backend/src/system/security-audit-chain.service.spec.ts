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
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ latestRecordHash: previousHash }]),
      securityAuditLog: {
        create,
      },
      securityAuditChainHead: { update: jest.fn().mockResolvedValue({}) },
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
    const lock = tx.$queryRaw.mock.calls[0][0] as { strings: string[] };
    expect(lock.strings.join('?')).toContain('security_audit_chain_heads');
    expect(lock.strings.join('?')).toContain('FOR UPDATE');
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
    expect(tx.securityAuditChainHead.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { latestRecordHash: expectedHash },
    });
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.securityAuditChainHead.update.mock.invocationCallOrder[0],
    );
  });
  it('starts from a null previous hash on an initialized empty tail', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ latestRecordHash: null }]),
      securityAuditLog: {
        create: jest.fn(({ data }) => Promise.resolve({ id: 1, ...data })),
      },
      securityAuditChainHead: {
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const result = await new SecurityAuditChainService().append(tx as never, {
      eventType: 'EMPTY_TAIL',
      entityType: 'SYSTEM',
      entityId: null,
      operatorId: 1,
      eventData: {},
      occurredAt: new Date('2026-08-26T00:00:00.000Z'),
    });

    expect(result.previousHash).toBeNull();
    expect(tx.securityAuditChainHead.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { latestRecordHash: result.recordHash },
    });
  });

  it('serializes concurrent appenders onto one audit-chain successor path', async () => {
    let latestRecordHash: string | null = null;
    let id = 0;
    let lockTail = Promise.resolve();

    const makeTx = () => {
      let releaseLock: (() => void) | undefined;
      return {
        $queryRaw: jest.fn(async () => {
          const previousLock = lockTail;
          lockTail = new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
          await previousLock;
          return [{ latestRecordHash }];
        }),
        securityAuditLog: {
          create: jest.fn(({ data }) =>
            Promise.resolve({ id: (id += 1), ...data }),
          ),
        },
        securityAuditChainHead: {
          update: jest.fn(({ data }) => {
            latestRecordHash = data.latestRecordHash;
            releaseLock?.();
            return Promise.resolve({});
          }),
        },
      };
    };
    const leftTx = makeTx();
    const rightTx = makeTx();
    const service = new SecurityAuditChainService();

    const [left, right] = await Promise.all([
      service.append(leftTx as never, {
        eventType: 'LEFT',
        entityType: 'SYSTEM',
        entityId: null,
        operatorId: 1,
        eventData: {},
        occurredAt: new Date('2026-08-26T00:00:00.000Z'),
      }),
      service.append(rightTx as never, {
        eventType: 'RIGHT',
        entityType: 'SYSTEM',
        entityId: null,
        operatorId: 1,
        eventData: {},
        occurredAt: new Date('2026-08-26T00:00:01.000Z'),
      }),
    ]);

    expect(left.previousHash).toBeNull();
    expect(right.previousHash).toBe(left.recordHash);
    expect(new Set([left.recordHash, right.recordHash]).size).toBe(2);
  });
});
