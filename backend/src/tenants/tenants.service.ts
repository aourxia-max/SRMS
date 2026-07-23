import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantCryptoService } from './tenant-crypto.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: TenantCryptoService,
  ) {}
  private masked(tenant: Tenant) {
    return {
      ...tenant,
      idNoCiphertext: undefined,
      idNoHash: undefined,
      maskedIdNo: tenant.idNoLast4 ? `****${tenant.idNoLast4}` : null,
    };
  }
  private async idData(idNo: string | undefined, currentId?: number) {
    if (idNo === undefined) return {};
    const hash = this.crypto.hash(idNo);
    const duplicate = await this.prisma.db.tenant.findFirst({
      where: { idNoHash: hash },
    });
    if (duplicate && duplicate.id !== currentId)
      throw new ConflictException('证件号码已存在');
    const normalized = this.crypto.normalize(idNo);
    return {
      idNoCiphertext: this.crypto.encrypt(normalized),
      idNoHash: hash,
      idNoLast4: normalized.slice(-4),
    };
  }
  async list(query: ListTenantsDto) {
    const where: Prisma.TenantWhereInput = {
      tenantType: query.tenantType,
      status: query.status,
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword } },
              { phone: { contains: query.keyword } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.db.$transaction([
      this.prisma.db.tenant.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.db.tenant.count({ where }),
    ]);
    return {
      items: items.map((item) => this.masked(item)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
  async get(id: number) {
    const tenant = await this.prisma.db.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('承租人不存在');
    return this.masked(tenant);
  }
  async create(dto: CreateTenantDto) {
    const { idNo, ...safe } = dto;
    return this.masked(
      await this.prisma.db.tenant.create({
        data: { ...safe, ...(await this.idData(idNo)) },
      }),
    );
  }
  async update(id: number, dto: UpdateTenantDto) {
    await this.get(id);
    const { idNo, ...safe } = dto;
    return this.masked(
      await this.prisma.db.tenant.update({
        where: { id },
        data: { ...safe, ...(await this.idData(idNo, id)) },
      }),
    );
  }
  async sensitive(id: number, user: AuthUser) {
    const tenant = await this.prisma.db.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('承租人不存在');
    const idNo = tenant.idNoCiphertext
      ? this.crypto.decrypt(tenant.idNoCiphertext)
      : null;
    await this.prisma.db.securityAuditLog.create({
      data: {
        eventType: 'TENANT_ID_VIEW',
        entityType: 'TENANT',
        entityId: id,
        operatorId: user.id,
        eventData: { viewed: Boolean(idNo) },
      },
    });
    return { ...this.masked(tenant), idNo };
  }
}
