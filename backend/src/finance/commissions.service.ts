import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommissionDto, UpdateCommissionDto } from './dto/commission.dto';
import { assertContractNotVoided } from '../contracts/contract-operability';
@Injectable()
export class CommissionsService {
  constructor(private readonly prisma: PrismaService) {}
  async list() {
    return this.prisma.db.contractCommission.findMany({
      where: {
        deletedAt: null,
        contract: { status: { not: 'VOIDED' } },
      },
      include: { contract: { include: { room: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
  }
  async create(dto: CreateCommissionDto, user: AuthUser) {
    const amount = new Prisma.Decimal(dto.amount);
    if (!amount.isFinite() || amount.lt(0))
      throw new BadRequestException('提成金额不能小于零');
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${dto.contractId} FOR UPDATE`,
      );
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: dto.contractId },
      });
      assertContractNotVoided(contract.status, '新增租房提成');
      const existing = await tx.contractCommission.findUnique({
        where: {
          contractId_recipientName: {
            contractId: dto.contractId,
            recipientName: dto.recipientName,
          },
        },
      });
      const item = existing?.deletedAt
        ? await tx.contractCommission.update({
            where: { id: existing.id },
            data: {
              amount,
              deletedAt: null,
              deletedBy: null,
              updatedBy: user.id,
            },
          })
        : await tx.contractCommission.create({
            data: {
              contractId: dto.contractId,
              recipientName: dto.recipientName,
              amount,
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
      await this.audit(tx, 'CREATE_COMMISSION', item.id, user, null, item);
      return item;
    });
  }
  async update(id: number, dto: UpdateCommissionDto, user: AuthUser) {
    const amount = new Prisma.Decimal(dto.amount);
    if (!amount.isFinite() || amount.lt(0))
      throw new BadRequestException('提成金额不能小于零');
    return this.prisma.db.$transaction(async (tx) => {
      const identity = await tx.contractCommission.findFirstOrThrow({
        where: { id, deletedAt: null },
        select: { contractId: true },
      });
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${identity.contractId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contract_commissions WHERE id = ${id} FOR UPDATE`,
      );
      const before = await tx.contractCommission.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: { contract: { select: { status: true } } },
      });
      assertContractNotVoided(before.contract.status, '修改租房提成');
      const item = await tx.contractCommission.update({
        where: { id },
        data: { recipientName: dto.recipientName, amount, updatedBy: user.id },
      });
      await this.audit(tx, 'UPDATE_COMMISSION', id, user, before, item);
      return item;
    });
  }
  async remove(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      const identity = await tx.contractCommission.findFirstOrThrow({
        where: { id, deletedAt: null },
        select: { contractId: true },
      });
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${identity.contractId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contract_commissions WHERE id = ${id} FOR UPDATE`,
      );
      const before = await tx.contractCommission.findFirstOrThrow({
        where: { id, deletedAt: null },
        include: { contract: { select: { status: true } } },
      });
      assertContractNotVoided(before.contract.status, '删除租房提成');
      const item = await tx.contractCommission.update({
        where: { id },
        data: { deletedAt: new Date(), deletedBy: user.id, updatedBy: user.id },
      });
      await this.audit(tx, 'DELETE_COMMISSION', id, user, before, item);
      return item;
    });
  }
  private async audit(
    tx: Prisma.TransactionClient,
    eventType: string,
    entityId: number,
    user: AuthUser,
    before: unknown,
    after: unknown,
  ) {
    await tx.securityAuditLog.create({
      data: {
        eventType,
        entityType: 'CONTRACT_COMMISSION',
        entityId,
        operatorId: user.id,
        eventData: { before, after } as Prisma.InputJsonValue,
      },
    });
  }
}
