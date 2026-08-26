import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type SecurityAuditLog } from '@prisma/client';

type JsonObject = { [key: string]: JsonLike };
type JsonLike = null | boolean | number | string | JsonLike[] | JsonObject;

export type SecurityAuditChainEvent = {
  eventType: string;
  entityType: string;
  entityId: number | null;
  operatorId: number;
  eventData: Prisma.InputJsonValue;
  reason?: string | null;
  occurredAt?: Date;
};

type SecurityAuditHashInput = {
  eventType: string;
  entityType: string;
  entityId: number | null;
  operatorId: number;
  eventData: Prisma.JsonValue | Prisma.InputJsonValue;
  reason: string | null;
  occurredAt: Date;
  previousHash: string | null;
};

function stableJson(value: JsonLike): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashSecurityAuditRecord(input: SecurityAuditHashInput) {
  const payload = stableJson({
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    operatorId: input.operatorId,
    eventData: input.eventData,
    reason: input.reason,
    occurredAt: input.occurredAt.toISOString(),
    previousHash: input.previousHash,
  } as JsonLike);
  return createHash('sha256').update(payload).digest('hex');
}

@Injectable()
export class SecurityAuditChainService {
  async append(
    tx: Prisma.TransactionClient,
    event: SecurityAuditChainEvent,
  ): Promise<SecurityAuditLog> {
    const heads = await tx.$queryRaw<
      Array<{ latestRecordHash: string | null }>
    >(
      Prisma.sql`SELECT latest_record_hash AS latestRecordHash FROM security_audit_chain_heads WHERE id = 1 FOR UPDATE`,
    );
    if (heads.length !== 1) {
      throw new Error('安全审计链头不存在，请先完成数据库迁移');
    }
    const occurredAt = event.occurredAt ?? new Date();
    const previousHash = heads[0].latestRecordHash;
    const reason = event.reason ?? null;
    const recordHash = hashSecurityAuditRecord({
      ...event,
      reason,
      occurredAt,
      previousHash,
    });
    const created = await tx.securityAuditLog.create({
      data: {
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        operatorId: event.operatorId,
        eventData: event.eventData,
        reason,
        occurredAt,
        previousHash,
        recordHash,
      },
    });
    await tx.securityAuditChainHead.update({
      where: { id: 1 },
      data: { latestRecordHash: recordHash },
    });
    return created;
  }
}
