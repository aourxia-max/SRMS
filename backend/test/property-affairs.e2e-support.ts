import type { Prisma, SecurityAuditLog } from '@prisma/client';
import type {
  SecurityAuditChainEvent,
  SecurityAuditChainService,
} from '../src/system/security-audit-chain.service';

type CleanupTargetsInput = {
  createdAffairIds: Iterable<number>;
  prefixedAffairIds: Iterable<number>;
  createdFileIds: Iterable<number>;
  remainingLinkedFileIds: Iterable<number>;
};

type CleanupStep = {
  label: string;
  run: () => Promise<void>;
};

export function createIsolatedSecurityAuditChain(): Pick<
  SecurityAuditChainService,
  'appendInTransaction'
> {
  let nextId = 1;
  return {
    appendInTransaction(
      _tx: Prisma.TransactionClient,
      event: SecurityAuditChainEvent,
    ): Promise<SecurityAuditLog> {
      return Promise.resolve({
        id: nextId++,
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        operatorId: event.operatorId,
        eventData: event.eventData as Prisma.JsonValue,
        reason: event.reason ?? null,
        occurredAt: event.occurredAt ?? new Date(),
        previousHash: null,
        recordHash: null,
      });
    },
  };
}

export function collectPropertyAffairCleanupTargets(
  input: CleanupTargetsInput,
) {
  return {
    affairIds: [
      ...new Set([...input.createdAffairIds, ...input.prefixedAffairIds]),
    ],
    fileIds: [
      ...new Set([...input.createdFileIds, ...input.remainingLinkedFileIds]),
    ],
  };
}

export async function runBestEffortCleanup(steps: CleanupStep[]) {
  const failedLabels: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch {
      failedLabels.push(step.label);
    }
  }
  return failedLabels;
}
