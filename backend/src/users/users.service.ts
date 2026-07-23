import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth-user.type';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const users = await this.prisma.db.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((user) => this.publicUser(user));
  }
  async create(dto: CreateUserDto, operator: AuthUser) {
    try {
      const user = await this.prisma.db.user.create({
        data: {
          username: dto.username,
          displayName: dto.displayName,
          phone: dto.phone,
          role: dto.role,
          passwordHash: await argon2.hash(dto.password, {
            type: argon2.argon2id,
          }),
          createdBy: operator.id,
          updatedBy: operator.id,
        },
      });
      await this.audit('USER_CREATED', user.id, operator, {
        username: user.username,
        role: user.role,
      });
      return this.publicUser(user);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new BadRequestException('登录名已存在');
      throw error;
    }
  }
  async update(id: number, dto: UpdateUserDto, operator: AuthUser) {
    const target = await this.getUser(id);
    const changesRole = dto.role && dto.role !== target.role;
    const disabling = dto.status && dto.status !== UserStatus.ACTIVE;
    if (
      (changesRole || disabling) &&
      target.role === UserRole.SUPER_ADMIN &&
      target.status === UserStatus.ACTIVE
    )
      await this.ensureAnotherActiveSuperAdmin(id);
    if (id === operator.id && disabling)
      throw new BadRequestException('不能停用当前正在使用的自己');
    const user = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { ...dto, updatedBy: operator.id },
      });
      if (changesRole || disabling)
        await tx.authRefreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await tx.securityAuditLog.create({
        data: {
          eventType: changesRole
            ? 'USER_ROLE_CHANGED'
            : disabling
              ? 'USER_STATUS_CHANGED'
              : 'USER_UPDATED',
          entityType: 'USER',
          entityId: id,
          operatorId: operator.id,
          eventData: {
            before: this.publicUser(target),
            after: this.publicUser(updated),
          },
        },
      });
      return updated;
    });
    return this.publicUser(user);
  }
  async resetPassword(id: number, password: string, operator: AuthUser) {
    await this.getUser(id);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
          updatedBy: operator.id,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.authRefreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.securityAuditLog.create({
        data: {
          eventType: 'USER_PASSWORD_RESET',
          entityType: 'USER',
          entityId: id,
          operatorId: operator.id,
          eventData: {},
        },
      });
    });
  }
  private async getUser(id: number) {
    const user = await this.prisma.db.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }
  private async ensureAnotherActiveSuperAdmin(id: number) {
    const count = await this.prisma.db.user.count({
      where: {
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        deletedAt: null,
        id: { not: id },
      },
    });
    if (!count)
      throw new BadRequestException('系统必须保留至少一名启用状态的超级管理员');
  }
  private async audit(
    eventType: string,
    entityId: number,
    operator: AuthUser,
    eventData: Prisma.InputJsonValue,
  ) {
    await this.prisma.db.securityAuditLog.create({
      data: {
        eventType,
        entityType: 'USER',
        entityId,
        operatorId: operator.id,
        eventData,
      },
    });
  }
  private publicUser(user: {
    id: number;
    username: string;
    displayName: string;
    role: UserRole;
    phone: string | null;
    status: UserStatus;
    lastLoginAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      phone: user.phone,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }
}
