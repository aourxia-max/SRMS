import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import type { ContractDraftPayload } from './dto/save-contract-draft.dto';

type DraftRecord = {
  id: number;
  roomId: number | null;
  payload: unknown;
  status: string;
  createdBy: number;
};

@Injectable()
export class ContractDraftsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(payload: ContractDraftPayload, user: AuthUser) {
    this.assertCommissionPermission(payload, user);
    this.assertNonNegativeAmounts(payload);
    return this.prisma.db.contractDraft.create({
      data: {
        roomId: payload.roomId ?? null,
        payload: this.json(payload),
        status: 'DRAFT',
        createdBy: user.id,
      },
    });
  }

  async find(id: number, user: AuthUser) {
    return this.load(id, user);
  }

  async update(id: number, payload: ContractDraftPayload, user: AuthUser) {
    this.assertCommissionPermission(payload, user);
    this.assertNonNegativeAmounts(payload);
    const draft = await this.load(id, user);
    if (draft.status === 'CONFIRMED')
      throw new BadRequestException('草稿已确认');
    const currentPayload = this.record(draft.payload);
    const nextPayload = { ...currentPayload, ...payload };
    return this.prisma.db.contractDraft.update({
      where: { id },
      data: {
        roomId: payload.roomId ?? draft.roomId ?? null,
        payload: this.json(nextPayload),
      },
    });
  }

  private async load(id: number, user: AuthUser): Promise<DraftRecord> {
    const draft = await this.prisma.db.contractDraft.findFirstOrThrow({
      where:
        user.role === UserRole.SUPER_ADMIN
          ? { id }
          : { id, createdBy: user.id },
    });
    if (!draft) throw new NotFoundException('草稿不存在');
    return draft;
  }

  private assertCommissionPermission(
    payload: ContractDraftPayload,
    user: AuthUser,
  ) {
    if (payload.commission && user.role !== UserRole.SUPER_ADMIN)
      throw new ForbiddenException('只有超级管理员可以填写佣金');
  }

  private assertNonNegativeAmounts(payload: ContractDraftPayload) {
    const amounts = [
      payload.monthlyRent,
      payload.depositRequired,
      payload.commission?.amount,
      ...(payload.concessions ?? []).flatMap((item) => [
        item.fixedAmount,
        item.discountRate,
      ]),
    ];
    if (amounts.some((amount) => amount !== undefined && Number(amount) < 0))
      throw new BadRequestException('金额不得为负数');
  }

  private json(value: object): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private record(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null && !Array.isArray(value))
      return value as Record<string, unknown>;
    return {};
  }
}
