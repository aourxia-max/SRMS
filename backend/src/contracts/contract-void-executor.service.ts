import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContractVoidReversalCategory, Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityAuditChainService } from '../system/security-audit-chain.service';
import {
  assertBalancedContractVoidImpact,
  computeContractVoidImpact,
  hashContractVoidImpact,
} from './contract-void-impact';
import {
  lockContractVoidContract,
  lockContractVoidRelatedRows,
} from './contract-void-locks';
import { resolveRoomStatusAfterContractVoid } from './contract-room-reconciliation';
import { ContractVoidPreviewService } from './contract-void-preview.service';
import {
  ContractVoidReversalWriter,
  type ContractVoidExecutionImpact,
} from './contract-void-reversal-writer';

export type ContractVoidResult = {
  requestId: number;
  requestNo: string;
  status: 'COMPLETED';
  contractId: number;
  contractNo: string;
  contractStatus: 'VOIDED';
  impactHash: string;
  executionBatchNo: string;
  reversalCount: number;
  categoryTotals: Partial<Record<ContractVoidReversalCategory, string>>;
  roomAction: 'KEEP_CURRENT_STATUS' | 'RECALCULATE';
  roomStatusBefore: string;
  roomStatusAfter: string;
};

type LockedRequest = {
  id: number;
  requestNo: string;
  contractId: number;
  status: string;
  impactHash: string;
  executionBatchNo: string | null;
  executionIdempotencyKey: string | null;
  resultSnapshot: Prisma.JsonValue | null;
};

type RawLockedRequest = Omit<
  LockedRequest,
  'id' | 'contractId' | 'resultSnapshot'
> & {
  id: number | bigint;
  contractId: number | bigint;
  resultSnapshot: Prisma.JsonValue | string | null;
};

function isCompletedResult(
  value: Prisma.JsonValue | null,
): value is Prisma.JsonObject {
  return (
    value !== null &&
    !Array.isArray(value) &&
    typeof value === 'object' &&
    value.status === 'COMPLETED'
  );
}

function normalizeLockedRequest(request: RawLockedRequest): LockedRequest {
  let resultSnapshot = request.resultSnapshot;
  if (typeof resultSnapshot === 'string') {
    try {
      resultSnapshot = JSON.parse(resultSnapshot) as Prisma.JsonValue;
    } catch {
      // A JSON string is itself a valid Prisma JsonValue.
    }
  }
  return {
    ...request,
    id: Number(request.id),
    contractId: Number(request.contractId),
    resultSnapshot,
  };
}

function uniqueTargets(error: unknown): string[] {
  const target = (error as { meta?: { target?: unknown } })?.meta?.target;
  if (typeof target === 'string') return [target];
  if (Array.isArray(target)) {
    return target.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function targetsField(targets: string[], field: string) {
  const normalizedField = field.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return targets.some((target) =>
    target
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase()
      .includes(normalizedField),
  );
}
@Injectable()
export class ContractVoidExecutorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly previews: ContractVoidPreviewService,
    private readonly reversalWriter: ContractVoidReversalWriter,
    private readonly auditChain: SecurityAuditChainService,
  ) {}

  async execute(
    requestId: number,
    previewHash: string,
    confirmation: string,
    idempotencyKey: string,
    user: AuthUser,
  ): Promise<ContractVoidResult> {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('只有超级管理员可以确认合同作废');
    }
    if (confirmation !== '确认作废合同') {
      throw new BadRequestException('请输入“确认作废合同”以继续');
    }
    if (!/^[0-9a-f]{64}$/.test(previewHash)) {
      throw new BadRequestException('影响摘要哈希格式无效');
    }
    if (idempotencyKey.length < 16 || idempotencyKey.length > 100) {
      throw new BadRequestException('执行幂等键长度必须为16至100个字符');
    }

    try {
      return await this.prisma.db.$transaction(
        async (tx) => {
          const reference = await tx.contractVoidRequest.findUnique({
            where: { id: requestId },
            select: { contractId: true },
          });
          if (!reference) {
            throw new NotFoundException('合同作废申请不存在');
          }
          await lockContractVoidContract(tx, reference.contractId);

          const requests = await tx.$queryRaw<RawLockedRequest[]>(
            Prisma.sql`SELECT id, request_no AS requestNo, contract_id AS contractId, status, impact_hash AS impactHash, execution_batch_no AS executionBatchNo, execution_idempotency_key AS executionIdempotencyKey, result_snapshot AS resultSnapshot FROM contract_void_requests WHERE id = ${requestId} FOR UPDATE`,
          );
          if (requests.length !== 1) {
            throw new NotFoundException('合同作废申请不存在');
          }
          const request = normalizeLockedRequest(requests[0]);

          if (request.status === 'COMPLETED') {
            if (request.executionIdempotencyKey !== idempotencyKey) {
              throw new ConflictException('合同已作废，不能重复冲销');
            }
            return this.storedResult(request);
          }
          if (request.status !== 'PENDING') {
            throw new BadRequestException('只有待确认的作废申请可以确认');
          }
          if (previewHash !== request.impactHash) {
            throw new BadRequestException('合同关联数据已变化，请重新预览');
          }

          await lockContractVoidRelatedRows(tx, request.contractId);
          const contract = await tx.contract.findUnique({
            where: { id: request.contractId },
            select: { contractNo: true, status: true },
          });
          if (!contract) throw new NotFoundException('合同不存在');

          const input = await this.previews.loadInput(tx, request.contractId);
          const computed = computeContractVoidImpact(input);
          const impact: ContractVoidExecutionImpact = {
            ...computed,
            sourceSnapshot: input.sourceSnapshot,
          };
          const currentHash = hashContractVoidImpact(impact);
          if (
            currentHash !== request.impactHash ||
            currentHash !== previewHash
          ) {
            throw new BadRequestException('合同关联数据已变化，请重新预览');
          }
          assertBalancedContractVoidImpact(impact);

          const now = new Date();
          const executionBatchNo =
            request.executionBatchNo ?? `HTZFZX-${request.id}`;
          const reversals = await this.reversalWriter.write(
            tx,
            {
              id: request.id,
              requestNo: request.requestNo,
              contractId: request.contractId,
              operatorId: user.id,
            },
            impact,
            now,
          );
          await tx.contract.update({
            where: { id: request.contractId },
            data: { status: 'VOIDED' },
          });
          const room = await tx.room.findUniqueOrThrow({
            where: { id: impact.contract.roomId },
            select: { id: true, roomStatus: true },
          });
          const laterContracts = await tx.contract.findMany({
            where: {
              roomId: room.id,
              id: { not: request.contractId },
              status: {
                in: ['PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT'],
              },
            },
            select: { status: true },
          });
          const roomResolution = resolveRoomStatusAfterContractVoid({
            currentStatus: room.roomStatus,
            laterContracts,
          });
          if (roomResolution.targetStatus !== room.roomStatus) {
            await tx.room.update({
              where: { id: room.id },
              data: {
                roomStatus: roomResolution.targetStatus,
                statusChangedAt: now,
              },
            });
            await tx.roomStatusHistory.create({
              data: {
                roomId: room.id,
                fromStatus: room.roomStatus,
                toStatus: roomResolution.targetStatus,
                changeReason: '合同作废纠错后重算房态',
                businessType: 'CONTRACT_VOID',
                businessId: request.id,
                changedBy: user.id,
                changedAt: now,
              },
            });
          }

          const categoryTotals = this.categoryTotals(reversals);
          const result: ContractVoidResult = {
            requestId: request.id,
            requestNo: request.requestNo,
            status: 'COMPLETED',
            contractId: request.contractId,
            contractNo: contract.contractNo,
            contractStatus: 'VOIDED',
            impactHash: currentHash,
            executionBatchNo,
            reversalCount: reversals.length,
            categoryTotals,
            roomAction: roomResolution.action,
            roomStatusBefore: room.roomStatus,
            roomStatusAfter: roomResolution.targetStatus,
          };

          await tx.contractVoidRequest.update({
            where: { id: request.id },
            data: {
              status: 'COMPLETED',
              activeContractKey: null,
              completedContractKey: `contract:${request.contractId}`,
              executionBatchNo,
              executionIdempotencyKey: idempotencyKey,
              resultSnapshot: result,
              completedBy: user.id,
              completedAt: now,
            },
          });
          await tx.operationLog.create({
            data: {
              module: 'CONTRACT',
              action: 'VOID_CORRECTION',
              entityType: 'CONTRACT_VOID_REQUEST',
              entityId: request.id,
              entityNo: request.requestNo,
              summary: `完成合同作废纠错 ${request.requestNo}`,
              beforeData: {
                requestStatus: 'PENDING',
                contractStatus: contract.status,
              },
              afterData: result,
              reason: `合同纠错单 ${request.requestNo}`,
              operatorId: user.id,
              operatorRole: user.role,
              occurredAt: now,
            },
          });
          await this.auditChain.append(tx, {
            eventType: 'CONTRACT_VOID_COMPLETED',
            entityType: 'CONTRACT_VOID_REQUEST',
            entityId: request.id,
            operatorId: user.id,
            occurredAt: now,
            eventData: {
              requestNo: request.requestNo,
              contractNo: contract.contractNo,
              impactHash: currentHash,
              executionBatchNo,
              categoryTotals,
              roomAction: roomResolution.action,
              roomStatusBefore: room.roomStatus,
              roomStatusAfter: roomResolution.targetStatus,
              beforeStatus: contract.status,
              afterStatus: 'VOIDED',
            },
          });
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );
    } catch (error) {
      if ((error as { code?: unknown })?.code !== 'P2002') throw error;
      const targets = uniqueTargets(error);
      if (targetsField(targets, 'executionIdempotencyKey')) {
        const completed = await this.prisma.db.contractVoidRequest.findUnique({
          where: { executionIdempotencyKey: idempotencyKey },
        });
        if (completed?.id === requestId && completed.status === 'COMPLETED') {
          return this.storedResult(completed);
        }
        throw new ConflictException('执行幂等键已用于其他合同作废申请');
      }
      if (targetsField(targets, 'completedContractKey')) {
        throw new ConflictException('合同已作废，不能重复冲销');
      }
      if (targetsField(targets, 'executionBatchNo')) {
        throw new ConflictException('合同作废执行批次号冲突，请重试');
      }
      if (targetsField(targets, 'transactionNo')) {
        throw new ConflictException('合同作废冲销编号冲突，请联系系统管理员');
      }
      throw new ConflictException('合同作废执行遇到唯一性冲突，请重试');
    }
  }

  private categoryTotals(
    reversals: Array<{
      category: ContractVoidReversalCategory;
      amount: Prisma.Decimal.Value;
    }>,
  ) {
    const totals = new Map<ContractVoidReversalCategory, Prisma.Decimal>();
    for (const reversal of reversals) {
      totals.set(
        reversal.category,
        (totals.get(reversal.category) ?? new Prisma.Decimal(0)).plus(
          reversal.amount,
        ),
      );
    }
    return Object.fromEntries(
      [...totals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([category, total]) => [category, total.toFixed(2)]),
    ) as Partial<Record<ContractVoidReversalCategory, string>>;
  }

  private storedResult(request: LockedRequest): ContractVoidResult {
    if (!isCompletedResult(request.resultSnapshot)) {
      throw new ConflictException(
        '已完成作废申请缺少执行结果，请联系系统管理员',
      );
    }
    return request.resultSnapshot as unknown as ContractVoidResult;
  }
}
