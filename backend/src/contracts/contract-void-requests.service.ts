import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { ContractVoidPreviewService } from './contract-void-preview.service';
import { ContractVoidExecutorService } from './contract-void-executor.service';
import {
  ApproveContractVoidRequestDto,
  ListContractVoidRequestsDto,
  SubmitContractVoidRequestDto,
} from './dto/contract-void.dto';

const requestInclude = {
  files: {
    include: {
      fileAsset: {
        select: {
          id: true,
          originalName: true,
          mimeType: true,
          uploadedAt: true,
        },
      },
    },
  },
  contract: {
    include: {
      room: true,
      members: {
        where: { memberRole: 'PRIMARY' as const, isCurrent: true },
        include: {
          tenant: {
            select: { id: true, name: true, phone: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ContractVoidRequestInclude;

const requestDetailInclude = {
  ...requestInclude,
  reversals: {
    orderBy: [{ correctionOccurredAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ContractVoidRequestInclude;

type IdempotentRequest = {
  contractId: number;
  reason: string;
  impactHash: string;
  files: Array<{ fileAssetId: number }>;
};

@Injectable()
export class ContractVoidRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly previews: ContractVoidPreviewService,
    private readonly executor?: ContractVoidExecutorService,
  ) {}

  async list(query: ListContractVoidRequestsDto, user: AuthUser) {
    this.assertCanView(user);
    return this.prisma.db.contractVoidRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.contractId ? { contractId: query.contractId } : {}),
        ...(query.contractNo || query.roomKeyword || query.tenantKeyword
          ? {
              contract: {
                ...(query.contractNo
                  ? { contractNo: { contains: query.contractNo } }
                  : {}),
                ...(query.roomKeyword
                  ? { room: { fullHouseNo: { contains: query.roomKeyword } } }
                  : {}),
                ...(query.tenantKeyword
                  ? {
                      members: {
                        some: {
                          isCurrent: true,
                          tenant: { name: { contains: query.tenantKeyword } },
                        },
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
      include: requestInclude,
      orderBy: [{ status: 'asc' }, { submittedAt: 'desc' }],
    });
  }

  async detail(id: number, user: AuthUser) {
    this.assertCanView(user);
    const request = await this.prisma.db.contractVoidRequest.findUnique({
      where: { id },
      include: requestDetailInclude,
    });
    if (!request) throw new NotFoundException('合同作废申请不存在');
    return request;
  }

  async submit(dto: SubmitContractVoidRequestDto, user: AuthUser) {
    this.assertCanSubmit(user);
    const existing = await this.findBySubmissionKey(dto.idempotencyKey);
    if (existing) return this.resolveIdempotentRetry(existing, dto);

    const latest = await this.previews.preview(dto.contractId, user);
    if (latest.impactHash !== dto.impactHash)
      throw new BadRequestException('合同关联数据已变化，请重新预览');
    const { impactHash, ...impactSnapshot } = latest;
    const fileAssetIds = [...(dto.fileAssetIds ?? [])].sort(
      (left, right) => left - right,
    );

    try {
      return await this.prisma.db.$transaction(async (tx) => {
        if (fileAssetIds.length) {
          const claimWhere = {
            id: { in: fileAssetIds },
            category: 'CONTRACT_VOID_PROOF' as const,
            uploadedBy: user.id,
            lockedAt: null,
          };
          const files = await tx.fileAsset.findMany({
            where: claimWhere,
            select: { id: true },
          });
          if (files.length !== fileAssetIds.length)
            throw new BadRequestException('证明附件不存在、已被使用或无权使用');
          const claimed = await tx.fileAsset.updateMany({
            where: claimWhere,
            data: { lockedAt: new Date() },
          });
          if (claimed.count !== fileAssetIds.length)
            throw new ConflictException('证明附件已被使用，请重新上传');
        }

        const request = await tx.contractVoidRequest.create({
          data: {
            requestNo: this.buildRequestNo(),
            contractId: dto.contractId,
            reason: dto.reason,
            impactSnapshot: impactSnapshot as unknown as Prisma.InputJsonValue,
            impactHash,
            activeContractKey: `contract:${dto.contractId}`,
            submissionIdempotencyKey: dto.idempotencyKey,
            submittedBy: user.id,
            files: fileAssetIds.length
              ? {
                  create: fileAssetIds.map((fileAssetId) => ({ fileAssetId })),
                }
              : undefined,
          },
          include: requestInclude,
        });
        await tx.operationLog.create({
          data: {
            module: 'CONTRACT',
            action: 'SUBMIT',
            entityType: 'CONTRACT_VOID_REQUEST',
            entityId: request.id,
            entityNo: request.requestNo,
            summary: `提交合同作废申请 ${request.requestNo}`,
            afterData: {
              status: 'PENDING',
              contractId: dto.contractId,
              impactHash,
            },
            reason: dto.reason,
            operatorId: user.id,
            operatorRole: user.role,
          },
        });
        return request;
      });
    } catch (error) {
      if ((error as { code?: unknown })?.code !== 'P2002') throw error;
      const target = this.uniqueTarget(error);
      if (target.includes('submissionidempotencykey')) {
        const retry = await this.findBySubmissionKey(dto.idempotencyKey);
        if (retry) return this.resolveIdempotentRetry(retry, dto);
        throw new ConflictException('提交幂等键冲突，请重试');
      }
      if (target.includes('activecontractkey'))
        throw new ConflictException('该合同已有待确认的作废申请');
      if (target.includes('requestno'))
        throw new ConflictException('作废申请编号冲突，请重试');
      throw new ConflictException('合同作废申请唯一键冲突，请重试');
    }
  }

  async approve(
    id: number,
    dto: ApproveContractVoidRequestDto,
    user: AuthUser,
  ) {
    if (!this.executor) {
      throw new ConflictException('合同作废执行服务不可用');
    }
    return this.executor.execute(
      id,
      dto.previewHash,
      dto.confirmation,
      dto.idempotencyKey,
      user,
    );
  }

  async cancel(id: number, user: AuthUser) {
    this.assertCanSubmit(user);
    return this.prisma.db.$transaction(async (tx) => {
      const request = await tx.contractVoidRequest.findUnique({
        where: { id },
      });
      if (!request) throw new NotFoundException('合同作废申请不存在');
      if (request.status !== 'PENDING')
        throw new BadRequestException('只有待确认的作废申请可以取消');
      if (user.role !== UserRole.SUPER_ADMIN && request.submittedBy !== user.id)
        throw new ForbiddenException('只能取消本人提交的作废申请');
      const cancelledAt = new Date();
      const changed = await tx.contractVoidRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'CANCELLED',
          activeContractKey: null,
          cancelledBy: user.id,
          cancelledAt,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('申请状态已变化，请刷新后重试');
      await tx.operationLog.create({
        data: {
          module: 'CONTRACT',
          action: 'CANCEL',
          entityType: 'CONTRACT_VOID_REQUEST',
          entityId: request.id,
          entityNo: request.requestNo,
          summary: `取消合同作废申请 ${request.requestNo}`,
          beforeData: { status: 'PENDING' },
          afterData: { status: 'CANCELLED' },
          operatorId: user.id,
          operatorRole: user.role,
        },
      });
      return {
        ...request,
        status: 'CANCELLED' as const,
        activeContractKey: null,
        cancelledBy: user.id,
        cancelledAt,
      };
    });
  }

  async reject(id: number, reason: string, user: AuthUser) {
    if (user.role !== UserRole.SUPER_ADMIN)
      throw new ForbiddenException('只有超级管理员可以驳回合同作废申请');
    if (!reason.trim()) throw new BadRequestException('请填写驳回原因');
    return this.prisma.db.$transaction(async (tx) => {
      const request = await tx.contractVoidRequest.findUnique({
        where: { id },
      });
      if (!request) throw new NotFoundException('合同作废申请不存在');
      if (request.status !== 'PENDING')
        throw new BadRequestException('只有待确认的作废申请可以驳回');
      const rejectedAt = new Date();
      const changed = await tx.contractVoidRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          activeContractKey: null,
          rejectedBy: user.id,
          rejectedAt,
          rejectedReason: reason,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException('申请状态已变化，请刷新后重试');
      await tx.operationLog.create({
        data: {
          module: 'CONTRACT',
          action: 'REJECT',
          entityType: 'CONTRACT_VOID_REQUEST',
          entityId: request.id,
          entityNo: request.requestNo,
          summary: `驳回合同作废申请 ${request.requestNo}`,
          beforeData: { status: 'PENDING' },
          afterData: { status: 'REJECTED' },
          reason,
          operatorId: user.id,
          operatorRole: user.role,
        },
      });
      return {
        ...request,
        status: 'REJECTED' as const,
        activeContractKey: null,
        rejectedBy: user.id,
        rejectedAt,
        rejectedReason: reason,
      };
    });
  }

  private assertCanView(user: AuthUser) {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('当前角色不能查看合同作废申请');
  }

  private assertCanSubmit(user: AuthUser) {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('当前角色不能提交合同作废申请');
  }

  private findBySubmissionKey(key: string) {
    return this.prisma.db.contractVoidRequest.findUnique({
      where: { submissionIdempotencyKey: key },
      include: requestInclude,
    });
  }

  private resolveIdempotentRetry(
    existing: IdempotentRequest,
    dto: SubmitContractVoidRequestDto,
  ) {
    const existingFileIds = existing.files
      .map((file) => file.fileAssetId)
      .sort((left, right) => left - right);
    const submittedFileIds = [...(dto.fileAssetIds ?? [])].sort(
      (left, right) => left - right,
    );
    const samePayload =
      existing.contractId === dto.contractId &&
      existing.reason === dto.reason &&
      existing.impactHash === dto.impactHash &&
      existingFileIds.length === submittedFileIds.length &&
      existingFileIds.every((id, index) => id === submittedFileIds[index]);
    if (!samePayload)
      throw new ConflictException('幂等键已用于其他合同作废申请');
    return existing;
  }

  private uniqueTarget(error: unknown) {
    const value = (error as { meta?: { target?: unknown } })?.meta?.target;
    const targets = Array.isArray(value) ? value : [value];
    return targets
      .filter((item): item is string => typeof item === 'string')
      .join(',')
      .replaceAll('_', '')
      .toLowerCase();
  }

  private buildRequestNo() {
    return `HTZF${Date.now()}${randomUUID().slice(0, 8)}`;
  }
}
