import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma, SecurityAuditLog } from '@prisma/client';

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
    const last = await tx.securityAuditLog.findFirst({
      where: { recordHash: { not: null } },
      orderBy: { id: 'desc' },
    });
    const occurredAt = event.occurredAt ?? new Date();
    const previousHash = last?.recordHash ?? null;
    const reason = event.reason ?? null;
    const recordHash = hashSecurityAuditRecord({
      ...event,
      reason,
      occurredAt,
      previousHash,
    });
    return tx.securityAuditLog.create({
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
  }
}
