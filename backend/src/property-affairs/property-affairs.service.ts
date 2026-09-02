import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  PropertyAffairPriority,
  PropertyAffairStatus,
  UserRole,
} from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { SecurityAuditChainService } from '../system/security-audit-chain.service';
import { AppendPropertyAffairProgressDto } from './dto/append-property-affair-progress.dto';
import { CreatePropertyAffairDto } from './dto/create-property-affair.dto';
import { ListPropertyAffairsQueryDto } from './dto/list-property-affairs-query.dto';
import { PropertyAffairRelationsDto } from './dto/property-affair-relations.dto';
import { UpdatePropertyAffairDto } from './dto/update-property-affair.dto';
import { assertPropertyAffairTransition } from './property-affair-policy';
import type { PropertyAffairRequestContext } from './property-affair-request-context';
import {
  presentPropertyAffair,
  propertyAffairInclude,
  PropertyAffairCurrentRelations,
  PropertyAffairLoaded,
} from './property-affair-presenter';

const BUILT_IN_CATEGORIES = ['公共维修', '证件资料', '沟通协调'] as const;
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const STATUS_LABELS: Record<PropertyAffairStatus, string> = {
  PENDING: '待办理',
  IN_PROGRESS: '办理中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

type ResolvedRelation = {
  id: number;
  targetLabel: string;
  currentLabel: string;
  currentStatus: string;
  available: boolean;
};

type ResolvedRelations = {
  buildings: ResolvedRelation[];
  rooms: ResolvedRelation[];
  tenants: ResolvedRelation[];
  contracts: ResolvedRelation[];
};

type RelationChange = {
  removedIds: number[];
  added: ResolvedRelation[];
};

type ResolvedRelationChanges = {
  buildings?: RelationChange;
  rooms?: RelationChange;
  tenants?: RelationChange;
  contracts?: RelationChange;
};

type ResponsibleUser = {
  id: number;
  displayName: string;
  role: UserRole;
};

type RelationReader = Pick<
  Prisma.TransactionClient,
  'building' | 'room' | 'tenant' | 'contract'
>;

@Injectable()
export class PropertyAffairsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditChain?: SecurityAuditChainService,
  ) {}

  async list(query: ListPropertyAffairsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const keyword = query.keyword?.trim();
    const where: Prisma.PropertyAffairWhereInput = {
      deletedAt: null,
      ...(query.category !== undefined ? { category: query.category } : {}),
      ...(query.priority !== undefined ? { priority: query.priority } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.responsibleUserId !== undefined
        ? { responsibleUserId: query.responsibleUserId }
        : {}),
      ...(query.buildingId !== undefined
        ? { buildings: { some: { buildingId: query.buildingId } } }
        : {}),
      ...(query.roomId !== undefined
        ? { rooms: { some: { roomId: query.roomId } } }
        : {}),
      ...(query.tenantId !== undefined
        ? { tenants: { some: { tenantId: query.tenantId } } }
        : {}),
      ...(query.contractId !== undefined
        ? { contracts: { some: { contractId: query.contractId } } }
        : {}),
      ...(keyword
        ? {
            OR: [
              { affairNo: { contains: keyword } },
              { title: { contains: keyword } },
              { content: { contains: keyword } },
              { externalHandlerName: { contains: keyword } },
              { externalPhone: { contains: keyword } },
              { externalContact: { contains: keyword } },
              {
                buildings: {
                  some: { targetLabel: { contains: keyword } },
                },
              },
              { rooms: { some: { targetLabel: { contains: keyword } } } },
              { tenants: { some: { targetLabel: { contains: keyword } } } },
              {
                contracts: {
                  some: { targetLabel: { contains: keyword } },
                },
              },
            ],
          }
        : {}),
    };

    const [total, affairs] = await Promise.all([
      this.prisma.db.propertyAffair.count({ where }),
      this.prisma.db.propertyAffair.findMany({
        where,
        include: propertyAffairInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const current = await this.loadCurrentRelations(affairs, this.prisma.db);
    return {
      items: affairs.map((affair) => presentPropertyAffair(affair, current)),
      total,
      page,
      pageSize,
    };
  }

  async listRecycleBin(query: ListPropertyAffairsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const keyword = query.keyword?.trim();
    const where: Prisma.PropertyAffairWhereInput = {
      deletedAt: { not: null },
      ...(query.category !== undefined ? { category: query.category } : {}),
      ...(query.priority !== undefined ? { priority: query.priority } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.responsibleUserId !== undefined
        ? { responsibleUserId: query.responsibleUserId }
        : {}),
      ...(query.buildingId !== undefined
        ? { buildings: { some: { buildingId: query.buildingId } } }
        : {}),
      ...(query.roomId !== undefined
        ? { rooms: { some: { roomId: query.roomId } } }
        : {}),
      ...(query.tenantId !== undefined
        ? { tenants: { some: { tenantId: query.tenantId } } }
        : {}),
      ...(query.contractId !== undefined
        ? { contracts: { some: { contractId: query.contractId } } }
        : {}),
      ...(keyword
        ? {
            OR: [
              { affairNo: { contains: keyword } },
              { title: { contains: keyword } },
              { content: { contains: keyword } },
              { externalHandlerName: { contains: keyword } },
              { externalPhone: { contains: keyword } },
              { externalContact: { contains: keyword } },
              {
                buildings: {
                  some: { targetLabel: { contains: keyword } },
                },
              },
              { rooms: { some: { targetLabel: { contains: keyword } } } },
              { tenants: { some: { targetLabel: { contains: keyword } } } },
              {
                contracts: {
                  some: { targetLabel: { contains: keyword } },
                },
              },
            ],
          }
        : {}),
    };

    const [total, affairs] = await Promise.all([
      this.prisma.db.propertyAffair.count({ where }),
      this.prisma.db.propertyAffair.findMany({
        where,
        include: propertyAffairInclude,
        orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const current = await this.loadCurrentRelations(affairs, this.prisma.db);
    return {
      items: affairs.map((affair) => presentPropertyAffair(affair, current)),
      total,
      page,
      pageSize,
    };
  }

  async get(id: number, includeDeleted = false) {
    const affair = await this.prisma.db.propertyAffair.findFirst({
      where: includeDeleted ? { id } : { id, deletedAt: null },
      include: propertyAffairInclude,
    });
    if (!affair) throw new NotFoundException('办事事项不存在');
    const current = await this.loadCurrentRelations([affair], this.prisma.db);
    return presentPropertyAffair(affair, current);
  }

  async categories() {
    const rows = await this.prisma.db.propertyAffair.findMany({
      select: { category: true },
      orderBy: { id: 'asc' },
    });
    const result = new Set<string>(BUILT_IN_CATEGORIES);
    for (const row of rows) {
      const category = row.category?.trim();
      if (category) result.add(category);
    }
    return [...result];
  }

  responsibleUsers() {
    return this.prisma.db.user.findMany({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, displayName: true, role: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });
  }

  async dashboardItems(limit: number) {
    const safeLimit = Math.max(0, Math.min(100, Math.trunc(limit)));
    if (safeLimit === 0) return [];
    const rows = await this.prisma.db.$queryRaw<Array<{ id: number | bigint }>>`
      SELECT id FROM property_affairs
      WHERE deleted_at IS NULL
        AND status IN ('PENDING', 'IN_PROGRESS')
      ORDER BY CASE priority
        WHEN 'URGENT' THEN 0
        WHEN 'IMPORTANT' THEN 1
        ELSE 2
      END, updated_at DESC, id DESC
      LIMIT ${safeLimit}
    `;
    const orderedIds = rows.map((row) => Number(row.id));
    if (!orderedIds.length) return [];

    const affairs = await this.prisma.db.propertyAffair.findMany({
      where: {
        id: { in: orderedIds },
        deletedAt: null,
        status: {
          in: [PropertyAffairStatus.PENDING, PropertyAffairStatus.IN_PROGRESS],
        },
      },
      include: propertyAffairInclude,
    });
    const current = await this.loadCurrentRelations(affairs, this.prisma.db);
    const byId = new Map(
      affairs.map((affair) => [
        affair.id,
        presentPropertyAffair(affair, current),
      ]),
    );
    return orderedIds
      .map((id) => byId.get(id))
      .filter((item): item is NonNullable<typeof item> => item !== undefined);
  }

  async create(
    dto: CreatePropertyAffairDto,
    user: AuthUser,
    requestContext: PropertyAffairRequestContext = {},
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      const [relations, responsible] = await Promise.all([
        this.resolveRelations(dto, tx),
        this.resolveResponsible(dto.responsibleUserId, tx),
      ]);
      const affairNo = await this.nextAffairNo(tx);
      const affair = await tx.propertyAffair.create({
        data: {
          affairNo,
          title: dto.title,
          category: dto.category,
          priority: dto.priority ?? PropertyAffairPriority.NORMAL,
          status: PropertyAffairStatus.PENDING,
          content: dto.content,
          responsibleUserId: responsible?.id,
          responsibleSnapshot: responsible?.displayName,
          externalHandlerName: dto.externalHandlerName,
          externalPhone: dto.externalPhone,
          externalContact: dto.externalContact,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });

      await this.createRelations(tx, affair.id, relations);
      await tx.propertyAffairProgress.create({
        data: {
          affairId: affair.id,
          content: '事项已创建',
          statusBefore: null,
          statusAfter: PropertyAffairStatus.PENDING,
          createdBy: user.id,
          createdBySnapshot: user.displayName,
        },
      });

      const afterData = {
        affairNo,
        title: dto.title,
        category: dto.category ?? null,
        priority: dto.priority ?? PropertyAffairPriority.NORMAL,
        status: PropertyAffairStatus.PENDING,
        content: dto.content,
        responsibleUserId: responsible?.id ?? null,
        responsibleSnapshot: responsible?.displayName ?? null,
        externalHandlerName: dto.externalHandlerName ?? null,
        externalPhone: dto.externalPhone ?? null,
        externalContact: dto.externalContact ?? null,
        buildingIds: relations.buildings.map((item) => item.id),
        roomIds: relations.rooms.map((item) => item.id),
        tenantIds: relations.tenants.map((item) => item.id),
        contractIds: relations.contracts.map((item) => item.id),
        version: 1,
      } satisfies Prisma.InputJsonObject;
      await tx.operationLog.create({
        data: {
          module: 'PROPERTY_AFFAIRS',
          action: 'CREATE',
          entityType: 'PROPERTY_AFFAIR',
          entityId: affair.id,
          entityNo: affairNo,
          summary: `创建物业办事 ${affairNo}`,
          afterData,
          operatorId: user.id,
          operatorRole: user.role,
          ...requestContext,
        },
      });

      const loaded = await tx.propertyAffair.findUniqueOrThrow({
        where: { id: affair.id },
        include: propertyAffairInclude,
      });
      return presentPropertyAffair(
        loaded,
        this.currentRelationsFromResolved(relations),
      );
    });
  }

  async update(
    id: number,
    dto: UpdatePropertyAffairDto,
    user: AuthUser,
    requestContext: PropertyAffairRequestContext = {},
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.propertyAffair.findFirst({
        where: { id, deletedAt: null },
        include: propertyAffairInclude,
      });
      if (!current) throw new NotFoundException('办事事项不存在');
      if (current.version !== dto.version) {
        throw new ConflictException('内容已被其他管理员更新，请刷新后重试');
      }

      const nextStatus = dto.status ?? current.status;
      assertPropertyAffairTransition(current.status, nextStatus);
      const [relationChanges, responsible] = await Promise.all([
        this.resolveRelationChanges(dto, current, tx),
        dto.responsibleUserId === null
          ? Promise.resolve(null)
          : dto.responsibleUserId !== undefined
            ? this.resolveResponsible(dto.responsibleUserId, tx)
            : Promise.resolve(undefined),
      ]);
      const statusChanged = nextStatus !== current.status;
      const occurredAt = new Date();
      const data: Prisma.PropertyAffairUpdateManyMutationInput = {
        updatedBy: user.id,
        version: { increment: 1 },
      };
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.category !== undefined) data.category = dto.category;
      if (dto.priority !== undefined) data.priority = dto.priority;
      if (dto.content !== undefined) data.content = dto.content;
      if (dto.responsibleUserId !== undefined) {
        data.responsibleUserId = responsible?.id ?? null;
        data.responsibleSnapshot = responsible?.displayName ?? null;
      }
      if (dto.externalHandlerName !== undefined) {
        data.externalHandlerName = dto.externalHandlerName;
      }
      if (dto.externalPhone !== undefined) {
        data.externalPhone = dto.externalPhone;
      }
      if (dto.externalContact !== undefined) {
        data.externalContact = dto.externalContact;
      }
      if (dto.status !== undefined) data.status = nextStatus;
      if (statusChanged) {
        if (nextStatus === PropertyAffairStatus.COMPLETED) {
          data.completedAt = occurredAt;
          data.cancelledAt = null;
        } else if (nextStatus === PropertyAffairStatus.CANCELLED) {
          data.completedAt = null;
          data.cancelledAt = occurredAt;
        } else {
          data.completedAt = null;
          data.cancelledAt = null;
        }
      }

      const changed = await tx.propertyAffair.updateMany({
        where: { id, version: dto.version, deletedAt: null },
        data,
      });
      if (changed.count !== 1) {
        throw new ConflictException('内容已被其他管理员更新，请刷新后重试');
      }

      await this.applyRelationChanges(tx, id, relationChanges);

      if (statusChanged) {
        await tx.propertyAffairProgress.create({
          data: {
            affairId: id,
            content: `状态由“${STATUS_LABELS[current.status]}”变更为“${STATUS_LABELS[nextStatus]}”`,
            statusBefore: current.status,
            statusAfter: nextStatus,
            createdBy: user.id,
            createdBySnapshot: user.displayName,
          },
        });
      }

      const updated = await tx.propertyAffair.findUniqueOrThrow({
        where: { id },
        include: propertyAffairInclude,
      });
      await tx.operationLog.create({
        data: {
          module: 'PROPERTY_AFFAIRS',
          action: 'UPDATE',
          entityType: 'PROPERTY_AFFAIR',
          entityId: id,
          entityNo: current.affairNo,
          summary: `更新物业办事 ${current.affairNo}`,
          beforeData: this.auditSnapshot(current),
          afterData: this.auditSnapshot(updated),
          operatorId: user.id,
          operatorRole: user.role,
          occurredAt,
          ...requestContext,
        },
      });
      const currentRelations = await this.loadCurrentRelations([updated], tx);
      return presentPropertyAffair(updated, currentRelations);
    });
  }

  async appendProgress(
    id: number,
    dto: AppendPropertyAffairProgressDto,
    user: AuthUser,
    requestContext: PropertyAffairRequestContext = {},
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.propertyAffair.findFirst({
        where: { id, deletedAt: null },
        include: propertyAffairInclude,
      });
      if (!current) throw new NotFoundException('办事事项不存在');
      if (current.version !== dto.version) {
        throw new ConflictException('内容已被其他管理员更新，请刷新后重试');
      }

      const nextStatus = dto.nextStatus ?? current.status;
      assertPropertyAffairTransition(current.status, nextStatus);
      const statusChanged = nextStatus !== current.status;
      const occurredAt = new Date();
      const data: Prisma.PropertyAffairUpdateManyMutationInput = {
        updatedBy: user.id,
        version: { increment: 1 },
      };
      if (statusChanged) {
        data.status = nextStatus;
        if (nextStatus === PropertyAffairStatus.COMPLETED) {
          data.completedAt = occurredAt;
          data.cancelledAt = null;
        } else if (nextStatus === PropertyAffairStatus.CANCELLED) {
          data.completedAt = null;
          data.cancelledAt = occurredAt;
        } else {
          data.completedAt = null;
          data.cancelledAt = null;
        }
      }

      const changed = await tx.propertyAffair.updateMany({
        where: { id, version: dto.version, deletedAt: null },
        data,
      });
      if (changed.count !== 1) {
        throw new ConflictException('内容已被其他管理员更新，请刷新后重试');
      }

      await tx.propertyAffairProgress.create({
        data: {
          affairId: id,
          content: dto.content,
          statusBefore: current.status,
          statusAfter: nextStatus,
          createdBy: user.id,
          createdBySnapshot: user.displayName,
        },
      });
      const updated = await tx.propertyAffair.findUniqueOrThrow({
        where: { id },
        include: propertyAffairInclude,
      });
      const appendedProgress = {
        content: dto.content,
        statusBefore: current.status,
        statusAfter: nextStatus,
        createdBy: user.id,
        createdBySnapshot: user.displayName,
        createdAt: occurredAt.toISOString(),
      } satisfies Prisma.InputJsonObject;
      await tx.operationLog.create({
        data: {
          module: 'PROPERTY_AFFAIRS',
          action: 'APPEND_PROGRESS',
          entityType: 'PROPERTY_AFFAIR',
          entityId: id,
          entityNo: current.affairNo,
          summary: `追加物业办事进度 ${current.affairNo}`,
          beforeData: this.auditSnapshot(current),
          afterData: {
            ...this.auditSnapshot(updated),
            appendedProgress,
          },
          reason: Array.from(dto.content).slice(0, 500).join(''),
          operatorId: user.id,
          operatorRole: user.role,
          occurredAt,
          ...requestContext,
        },
      });
      const relations = await this.loadCurrentRelations([updated], tx);
      return presentPropertyAffair(updated, relations);
    });
  }

  async softDelete(
    id: number,
    version: number,
    user: AuthUser,
    requestContext: PropertyAffairRequestContext = {},
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.propertyAffair.findUnique({
        where: { id },
        include: propertyAffairInclude,
      });
      if (!current) throw new NotFoundException('办事事项不存在');
      if (current.version !== version) {
        throw new ConflictException('内容已被其他管理员更新，请刷新后重试');
      }

      const occurredAt = new Date();
      const changed = await tx.propertyAffair.updateMany({
        where: { id, version, deletedAt: null },
        data: {
          deletedAt: occurredAt,
          deletedBy: user.id,
          updatedBy: user.id,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('内容已被其他管理员更新，请刷新后重试');
      }

      const updated = await tx.propertyAffair.findUniqueOrThrow({
        where: { id },
        include: propertyAffairInclude,
      });
      await tx.operationLog.create({
        data: {
          module: 'PROPERTY_AFFAIRS',
          action: 'SOFT_DELETE',
          entityType: 'PROPERTY_AFFAIR',
          entityId: id,
          entityNo: current.affairNo,
          summary: `删除物业办事至回收站 ${current.affairNo}`,
          beforeData: this.auditSnapshot(current),
          afterData: this.auditSnapshot(updated),
          operatorId: user.id,
          operatorRole: user.role,
          occurredAt,
          ...requestContext,
        },
      });
      const relations = await this.loadCurrentRelations([updated], tx);
      return presentPropertyAffair(updated, relations);
    });
  }

  async restore(
    id: number,
    version: number,
    user: AuthUser,
    requestContext: PropertyAffairRequestContext = {},
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.propertyAffair.findUnique({
        where: { id },
        include: propertyAffairInclude,
      });
      if (!current) throw new NotFoundException('办事事项不存在');
      if (current.version !== version) {
        throw new ConflictException('内容已被其他管理员更新，请刷新后重试');
      }

      const occurredAt = new Date();
      const changed = await tx.propertyAffair.updateMany({
        where: { id, version, deletedAt: { not: null } },
        data: {
          deletedAt: null,
          deletedBy: null,
          updatedBy: user.id,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException('内容已被其他管理员更新，请刷新后重试');
      }

      const updated = await tx.propertyAffair.findUniqueOrThrow({
        where: { id },
        include: propertyAffairInclude,
      });
      await tx.operationLog.create({
        data: {
          module: 'PROPERTY_AFFAIRS',
          action: 'RESTORE',
          entityType: 'PROPERTY_AFFAIR',
          entityId: id,
          entityNo: current.affairNo,
          summary: `从回收站恢复物业办事 ${current.affairNo}`,
          beforeData: this.auditSnapshot(current),
          afterData: this.auditSnapshot(updated),
          operatorId: user.id,
          operatorRole: user.role,
          occurredAt,
          ...requestContext,
        },
      });
      const relations = await this.loadCurrentRelations([updated], tx);
      return presentPropertyAffair(updated, relations);
    });
  }

  async permanentDelete(
    id: number,
    version: number,
    user: AuthUser,
    requestContext: PropertyAffairRequestContext = {},
  ) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('无权操作物业办事事项');
    }
    const auditChain = this.auditChain;
    if (!auditChain) throw new Error('安全审计服务未配置');

    return this.prisma.db.$transaction(async (tx) => {
      const current = await tx.propertyAffair.findUnique({
        where: { id },
        include: propertyAffairInclude,
      });
      if (!current) throw new NotFoundException('办事事项不存在');
      if (current.version !== version) {
        throw new ConflictException('内容已被其他管理员更新，请刷新后重试');
      }
      if (!current.deletedAt) {
        throw new BadRequestException('只有回收站中的事项可以永久删除');
      }

      const guarded = await tx.propertyAffair.updateMany({
        where: { id, version, deletedAt: { not: null } },
        data: { version: { increment: 1 } },
      });
      if (guarded.count !== 1) {
        throw new ConflictException('内容已被其他管理员更新，请刷新后重试');
      }

      const occurredAt = new Date();
      const releasedFileAssetIds = [
        ...new Set(current.files.map((link) => link.fileAssetId)),
      ];
      const preDeleteSnapshot = {
        ...this.auditSnapshot(current),
        fileAssetIds: releasedFileAssetIds,
        progressCount: current.progresses.length,
        buildings: current.buildings.map((link) => ({
          buildingId: link.buildingId,
          targetLabel: link.targetLabel,
        })),
        rooms: current.rooms.map((link) => ({
          roomId: link.roomId,
          targetLabel: link.targetLabel,
        })),
        tenants: current.tenants.map((link) => ({
          tenantId: link.tenantId,
          targetLabel: link.targetLabel,
        })),
        contracts: current.contracts.map((link) => ({
          contractId: link.contractId,
          targetLabel: link.targetLabel,
        })),
        progresses: current.progresses.map((progress) => ({
          id: progress.id,
          content: progress.content,
          statusBefore: progress.statusBefore,
          statusAfter: progress.statusAfter,
          createdBy: progress.createdBy,
          createdBySnapshot: progress.createdBySnapshot,
          createdAt: progress.createdAt.toISOString(),
        })),
        files: current.files.map((link) => ({
          fileAssetId: link.fileAssetId,
          createdBy: link.createdBy,
          createdAt: link.createdAt.toISOString(),
          fileAsset: {
            id: link.fileAsset.id,
            storageKey: link.fileAsset.storageKey,
            originalName: link.fileAsset.originalName,
            storedName: link.fileAsset.storedName,
            mimeType: link.fileAsset.mimeType,
            extension: link.fileAsset.extension,
            sizeBytes: link.fileAsset.sizeBytes.toString(),
            sha256: link.fileAsset.sha256,
            category: link.fileAsset.category,
            uploadedBy: link.fileAsset.uploadedBy,
            uploadedAt: link.fileAsset.uploadedAt.toISOString(),
            lockedAt: link.fileAsset.lockedAt?.toISOString() ?? null,
          },
        })),
      } satisfies Prisma.InputJsonObject;
      await auditChain.appendInTransaction(tx, {
        eventType: 'PROPERTY_AFFAIR_PERMANENT_DELETE',
        entityType: 'PROPERTY_AFFAIR',
        entityId: id,
        operatorId: user.id,
        occurredAt,
        eventData: {
          affairNo: current.affairNo,
          preDeleteSnapshot,
        },
      });
      await tx.operationLog.create({
        data: {
          module: 'PROPERTY_AFFAIRS',
          action: 'PERMANENT_DELETE',
          entityType: 'PROPERTY_AFFAIR',
          entityId: id,
          entityNo: current.affairNo,
          summary: `永久删除物业办事 ${current.affairNo}`,
          beforeData: preDeleteSnapshot,
          afterData: {
            permanentlyDeleted: true,
            releasedFileAssetIds,
          },
          operatorId: user.id,
          operatorRole: user.role,
          occurredAt,
          ...requestContext,
        },
      });

      await tx.propertyAffairFile.deleteMany({ where: { affairId: id } });
      await tx.propertyAffairProgress.deleteMany({ where: { affairId: id } });
      await tx.propertyAffairBuilding.deleteMany({ where: { affairId: id } });
      await tx.propertyAffairRoom.deleteMany({ where: { affairId: id } });
      await tx.propertyAffairTenant.deleteMany({ where: { affairId: id } });
      await tx.propertyAffairContract.deleteMany({ where: { affairId: id } });
      await tx.propertyAffair.delete({ where: { id } });
      return releasedFileAssetIds;
    });
  }

  private async nextAffairNo(tx: Prisma.TransactionClient) {
    const parts = Object.fromEntries(
      SHANGHAI_DATE_FORMATTER.formatToParts(new Date()).map((part) => [
        part.type,
        part.value,
      ]),
    );
    const dateKey = `${parts.year}${parts.month}${parts.day}`;
    await tx.$executeRaw`INSERT INTO property_affair_daily_sequences (date_key, current_value)
      VALUES (${dateKey}, 1)
      ON DUPLICATE KEY UPDATE current_value = current_value + 1`;
    const [row] = await tx.$queryRaw<Array<{ currentValue: number }>>`
      SELECT current_value AS currentValue
      FROM property_affair_daily_sequences WHERE date_key = ${dateKey} FOR UPDATE`;
    if (!row || !Number.isInteger(row.currentValue) || row.currentValue < 1) {
      throw new Error('事项编号生成失败');
    }
    if (row.currentValue > 9999) {
      throw new ConflictException('当日物业办事事项已达到上限，请次日再试');
    }
    return `WY${dateKey}${String(row.currentValue).padStart(4, '0')}`;
  }

  private async resolveResponsible(
    responsibleUserId: number | undefined,
    tx: Prisma.TransactionClient,
  ): Promise<ResponsibleUser | null> {
    if (responsibleUserId === undefined) return null;
    const responsible = await tx.user.findFirst({
      where: {
        id: responsibleUserId,
        role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, displayName: true, role: true },
    });
    if (!responsible) {
      throw new BadRequestException(
        `负责人 ${responsibleUserId} 不存在或不可选`,
      );
    }
    return responsible;
  }

  private async resolveRelations(
    dto: PropertyAffairRelationsDto,
    tx: Prisma.TransactionClient,
  ): Promise<ResolvedRelations> {
    return {
      buildings: await this.lockRelationTargets(
        tx,
        '楼栋',
        'buildings',
        dto.buildingIds,
      ),
      rooms: await this.lockRelationTargets(tx, '房源', 'rooms', dto.roomIds),
      tenants: await this.lockRelationTargets(
        tx,
        '承租人',
        'tenants',
        dto.tenantIds,
      ),
      contracts: await this.lockRelationTargets(
        tx,
        '合同',
        'contracts',
        dto.contractIds,
      ),
    };
  }

  private async resolveRelationChanges(
    dto: UpdatePropertyAffairDto,
    current: PropertyAffairLoaded,
    tx: Prisma.TransactionClient,
  ): Promise<ResolvedRelationChanges> {
    const changes: ResolvedRelationChanges = {};

    if (dto.buildingIds !== undefined) {
      const currentIds = current.buildings.map((item) => item.buildingId);
      const currentSet = new Set(currentIds);
      const requestedSet = new Set(dto.buildingIds);
      const addedIds = dto.buildingIds.filter((id) => !currentSet.has(id));
      changes.buildings = {
        removedIds: currentIds.filter((id) => !requestedSet.has(id)),
        added: await this.lockRelationTargets(
          tx,
          '楼栋',
          'buildings',
          addedIds,
        ),
      };
    }

    if (dto.roomIds !== undefined) {
      const currentIds = current.rooms.map((item) => item.roomId);
      const currentSet = new Set(currentIds);
      const requestedSet = new Set(dto.roomIds);
      const addedIds = dto.roomIds.filter((id) => !currentSet.has(id));
      changes.rooms = {
        removedIds: currentIds.filter((id) => !requestedSet.has(id)),
        added: await this.lockRelationTargets(tx, '房源', 'rooms', addedIds),
      };
    }

    if (dto.tenantIds !== undefined) {
      const currentIds = current.tenants.map((item) => item.tenantId);
      const currentSet = new Set(currentIds);
      const requestedSet = new Set(dto.tenantIds);
      const addedIds = dto.tenantIds.filter((id) => !currentSet.has(id));
      changes.tenants = {
        removedIds: currentIds.filter((id) => !requestedSet.has(id)),
        added: await this.lockRelationTargets(
          tx,
          '承租人',
          'tenants',
          addedIds,
        ),
      };
    }

    if (dto.contractIds !== undefined) {
      const currentIds = current.contracts.map((item) => item.contractId);
      const currentSet = new Set(currentIds);
      const requestedSet = new Set(dto.contractIds);
      const addedIds = dto.contractIds.filter((id) => !currentSet.has(id));
      changes.contracts = {
        removedIds: currentIds.filter((id) => !requestedSet.has(id)),
        added: await this.lockRelationTargets(
          tx,
          '合同',
          'contracts',
          addedIds,
        ),
      };
    }

    return changes;
  }

  private async lockRelationTargets(
    tx: Prisma.TransactionClient,
    label: string,
    table: 'buildings' | 'rooms' | 'tenants' | 'contracts',
    ids: number[],
  ): Promise<ResolvedRelation[]> {
    const sortedIds = [...ids].sort((left, right) => left - right);
    if (!sortedIds.length) return [];

    switch (table) {
      case 'buildings': {
        const rows = await tx.$queryRaw<
          Array<{
            id: number | bigint;
            buildingNo: string;
            buildingName: string | null;
            status: string;
          }>
        >`
          SELECT id, building_no AS buildingNo,
                 building_name AS buildingName, status
          FROM buildings
          WHERE id IN (${Prisma.join(sortedIds)})
          ORDER BY id FOR UPDATE
        `;
        this.assertAllFound(
          label,
          sortedIds,
          rows.map((row) => ({ id: Number(row.id) })),
        );
        return rows.map((row) => {
          const id = Number(row.id);
          const targetLabel = this.buildingLabel(row);
          return {
            id,
            targetLabel,
            currentLabel: targetLabel,
            currentStatus: row.status,
            available: this.isBuildingAvailable(row.status),
          };
        });
      }
      case 'rooms': {
        const rows = await tx.$queryRaw<
          Array<{
            id: number | bigint;
            fullHouseNo: string;
            roomStatus: string;
            deletedAt: Date | null;
          }>
        >`
          SELECT id, full_house_no AS fullHouseNo,
                 room_status AS roomStatus, deleted_at AS deletedAt
          FROM rooms
          WHERE id IN (${Prisma.join(sortedIds)})
          ORDER BY id FOR UPDATE
        `;
        this.assertAllFound(
          label,
          sortedIds,
          rows.map((row) => ({ id: Number(row.id) })),
        );
        return rows.map((row) => ({
          id: Number(row.id),
          targetLabel: row.fullHouseNo,
          currentLabel: row.fullHouseNo,
          currentStatus: row.roomStatus,
          available: this.isRoomAvailable(row.roomStatus, row.deletedAt),
        }));
      }
      case 'tenants': {
        const rows = await tx.$queryRaw<
          Array<{
            id: number | bigint;
            name: string;
            status: string;
          }>
        >`
          SELECT id, name, status FROM tenants
          WHERE id IN (${Prisma.join(sortedIds)})
          ORDER BY id FOR UPDATE
        `;
        this.assertAllFound(
          label,
          sortedIds,
          rows.map((row) => ({ id: Number(row.id) })),
        );
        return rows.map((row) => ({
          id: Number(row.id),
          targetLabel: row.name,
          currentLabel: row.name,
          currentStatus: row.status,
          available: this.isTenantAvailable(row.status),
        }));
      }
      case 'contracts': {
        const rows = await tx.$queryRaw<
          Array<{
            id: number | bigint;
            contractNo: string;
            status: string;
          }>
        >`
          SELECT id, contract_no AS contractNo, status FROM contracts
          WHERE id IN (${Prisma.join(sortedIds)})
          ORDER BY id FOR UPDATE
        `;
        this.assertAllFound(
          label,
          sortedIds,
          rows.map((row) => ({ id: Number(row.id) })),
        );
        return rows.map((row) => ({
          id: Number(row.id),
          targetLabel: row.contractNo,
          currentLabel: row.contractNo,
          currentStatus: row.status,
          available: this.isContractAvailable(row.status),
        }));
      }
    }
  }

  private async applyRelationChanges(
    tx: Prisma.TransactionClient,
    affairId: number,
    changes: ResolvedRelationChanges,
  ) {
    if (changes.buildings) {
      if (changes.buildings.removedIds.length) {
        await tx.propertyAffairBuilding.deleteMany({
          where: {
            affairId,
            buildingId: { in: changes.buildings.removedIds },
          },
        });
      }
      if (changes.buildings.added.length) {
        await tx.propertyAffairBuilding.createMany({
          data: changes.buildings.added.map((item) => ({
            affairId,
            buildingId: item.id,
            targetLabel: item.targetLabel,
          })),
        });
      }
    }
    if (changes.rooms) {
      if (changes.rooms.removedIds.length) {
        await tx.propertyAffairRoom.deleteMany({
          where: { affairId, roomId: { in: changes.rooms.removedIds } },
        });
      }
      if (changes.rooms.added.length) {
        await tx.propertyAffairRoom.createMany({
          data: changes.rooms.added.map((item) => ({
            affairId,
            roomId: item.id,
            targetLabel: item.targetLabel,
          })),
        });
      }
    }
    if (changes.tenants) {
      if (changes.tenants.removedIds.length) {
        await tx.propertyAffairTenant.deleteMany({
          where: { affairId, tenantId: { in: changes.tenants.removedIds } },
        });
      }
      if (changes.tenants.added.length) {
        await tx.propertyAffairTenant.createMany({
          data: changes.tenants.added.map((item) => ({
            affairId,
            tenantId: item.id,
            targetLabel: item.targetLabel,
          })),
        });
      }
    }
    if (changes.contracts) {
      if (changes.contracts.removedIds.length) {
        await tx.propertyAffairContract.deleteMany({
          where: {
            affairId,
            contractId: { in: changes.contracts.removedIds },
          },
        });
      }
      if (changes.contracts.added.length) {
        await tx.propertyAffairContract.createMany({
          data: changes.contracts.added.map((item) => ({
            affairId,
            contractId: item.id,
            targetLabel: item.targetLabel,
          })),
        });
      }
    }
  }

  private assertAllFound(
    label: string,
    requestedIds: number[],
    foundRows: Array<{ id: number }>,
  ) {
    const foundIds = new Set(foundRows.map((row) => row.id));
    const missingId = requestedIds.find((id) => !foundIds.has(id));
    if (missingId !== undefined) {
      throw new BadRequestException(`${label} ${missingId} 不存在`);
    }
  }

  private async createRelations(
    tx: Prisma.TransactionClient,
    affairId: number,
    relations: ResolvedRelations,
  ) {
    await Promise.all([
      relations.buildings.length
        ? tx.propertyAffairBuilding.createMany({
            data: relations.buildings.map((item) => ({
              affairId,
              buildingId: item.id,
              targetLabel: item.targetLabel,
            })),
          })
        : Promise.resolve(),
      relations.rooms.length
        ? tx.propertyAffairRoom.createMany({
            data: relations.rooms.map((item) => ({
              affairId,
              roomId: item.id,
              targetLabel: item.targetLabel,
            })),
          })
        : Promise.resolve(),
      relations.tenants.length
        ? tx.propertyAffairTenant.createMany({
            data: relations.tenants.map((item) => ({
              affairId,
              tenantId: item.id,
              targetLabel: item.targetLabel,
            })),
          })
        : Promise.resolve(),
      relations.contracts.length
        ? tx.propertyAffairContract.createMany({
            data: relations.contracts.map((item) => ({
              affairId,
              contractId: item.id,
              targetLabel: item.targetLabel,
            })),
          })
        : Promise.resolve(),
    ]);
  }

  private auditSnapshot(affair: PropertyAffairLoaded): Prisma.InputJsonObject {
    return {
      id: affair.id,
      affairNo: affair.affairNo,
      title: affair.title,
      category: affair.category,
      priority: affair.priority,
      status: affair.status,
      content: affair.content,
      responsibleUserId: affair.responsibleUserId,
      responsibleSnapshot: affair.responsibleSnapshot,
      externalHandlerName: affair.externalHandlerName,
      externalPhone: affair.externalPhone,
      externalContact: affair.externalContact,
      completedAt: affair.completedAt?.toISOString() ?? null,
      cancelledAt: affair.cancelledAt?.toISOString() ?? null,
      createdBy: affair.createdBy,
      updatedBy: affair.updatedBy,
      deletedAt: affair.deletedAt?.toISOString() ?? null,
      deletedBy: affair.deletedBy,
      createdAt: affair.createdAt.toISOString(),
      updatedAt: affair.updatedAt.toISOString(),
      buildingIds: affair.buildings.map((link) => link.buildingId),
      roomIds: affair.rooms.map((link) => link.roomId),
      tenantIds: affair.tenants.map((link) => link.tenantId),
      contractIds: affair.contracts.map((link) => link.contractId),
      version: Number(affair.version),
    };
  }

  private async loadCurrentRelations(
    affairs: PropertyAffairLoaded[],
    db: RelationReader,
  ): Promise<PropertyAffairCurrentRelations> {
    const buildingIds = [
      ...new Set(
        affairs.flatMap((affair) =>
          affair.buildings.map((link) => link.buildingId),
        ),
      ),
    ];
    const roomIds = [
      ...new Set(
        affairs.flatMap((affair) => affair.rooms.map((link) => link.roomId)),
      ),
    ];
    const tenantIds = [
      ...new Set(
        affairs.flatMap((affair) =>
          affair.tenants.map((link) => link.tenantId),
        ),
      ),
    ];
    const contractIds = [
      ...new Set(
        affairs.flatMap((affair) =>
          affair.contracts.map((link) => link.contractId),
        ),
      ),
    ];
    const [buildings, rooms, tenants, contracts] = await Promise.all([
      db.building.findMany({
        where: { id: { in: buildingIds } },
        select: {
          id: true,
          buildingNo: true,
          buildingName: true,
          status: true,
        },
      }),
      db.room.findMany({
        where: { id: { in: roomIds } },
        select: {
          id: true,
          fullHouseNo: true,
          roomStatus: true,
          deletedAt: true,
        },
      }),
      db.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true, status: true },
      }),
      db.contract.findMany({
        where: { id: { in: contractIds } },
        select: { id: true, contractNo: true, status: true },
      }),
    ]);
    return {
      buildings: new Map(
        buildings.map((item) => [
          item.id,
          {
            label: this.buildingLabel(item),
            status: item.status,
            available: this.isBuildingAvailable(item.status),
          },
        ]),
      ),
      rooms: new Map(
        rooms.map((item) => [
          item.id,
          {
            label: item.fullHouseNo,
            status: item.roomStatus,
            available: this.isRoomAvailable(item.roomStatus, item.deletedAt),
          },
        ]),
      ),
      tenants: new Map(
        tenants.map((item) => [
          item.id,
          {
            label: item.name,
            status: item.status,
            available: this.isTenantAvailable(item.status),
          },
        ]),
      ),
      contracts: new Map(
        contracts.map((item) => [
          item.id,
          {
            label: item.contractNo,
            status: item.status,
            available: this.isContractAvailable(item.status),
          },
        ]),
      ),
    };
  }

  private currentRelationsFromResolved(
    relations: ResolvedRelations,
  ): PropertyAffairCurrentRelations {
    const asMap = (items: ResolvedRelation[]) =>
      new Map(
        items.map((item) => [
          item.id,
          {
            label: item.currentLabel,
            status: item.currentStatus,
            available: item.available,
          },
        ]),
      );
    return {
      buildings: asMap(relations.buildings),
      rooms: asMap(relations.rooms),
      tenants: asMap(relations.tenants),
      contracts: asMap(relations.contracts),
    };
  }

  private buildingLabel(item: {
    buildingNo: string;
    buildingName: string | null;
  }) {
    return item.buildingName
      ? `${item.buildingNo}（${item.buildingName}）`
      : item.buildingNo;
  }

  private isBuildingAvailable(status: string) {
    return status === 'ACTIVE';
  }

  private isRoomAvailable(status: string, deletedAt: Date | null | undefined) {
    return !deletedAt && status !== 'DISABLED';
  }

  private isTenantAvailable(status: string) {
    return status === 'ACTIVE';
  }

  private isContractAvailable(status: string) {
    return status !== 'ENDED' && status !== 'VOIDED';
  }
}
