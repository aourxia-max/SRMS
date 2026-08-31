import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContractVoidRequestStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  billAmount,
  buildBillingPeriods,
  fixedDiscountForPeriod,
  payableAmount,
  percentageDiscountAmount,
  rentFreeAmount,
  tierForPeriod,
} from './billing-calculator';
import { PricingTierDto } from './dto/pricing-tier.dto';
import { ConcessionDto } from './dto/concession.dto';
import { SubmitContractChangeDto } from './dto/submit-contract-change.dto';
import { UpdateContractRemarkDto } from './dto/update-contract-remark.dto';
import type { AuthUser } from '../auth/auth-user.type';
import {
  assertContractRoomStatus,
  assertContractDates,
  assertConcessions,
  assertPricingTiers,
  assertPrimaryTenant,
} from './contract-validation';
import {
  buildBillNumber,
  buildContractNumber,
  buildTemporaryContractNumber,
} from './contract-number';
import { contractBusinessDay } from './contract-business-day';
import { ContractDepositService } from './contract-deposit.service';
import { assertContractNotVoided } from './contract-operability';

type FixedContractInput = {
  externalContractNo?: string;
  roomId: number;
  startDate: Date;
  endDate: Date;
  plannedMoveInDate?: Date;
  monthlyRent: Prisma.Decimal.Value;
  paymentCycleMonths: number;
  depositRequired: Prisma.Decimal.Value;
  primaryTenantId: number;
  secondaryTenantIds?: number[];
  concessions?: ConcessionDto[];
  fileAssetIds?: number[];
  remark?: string;
  commission?: { recipientName: string; amount: Prisma.Decimal.Value };
};

type FixedContractPreview = {
  billCount: number;
  totalBaseRent: string;
  totalDiscount: string;
  totalPayable: string;
  bills: Array<{
    sequence: number;
    startDate: string;
    endDate: string;
    payableAmount: string;
  }>;
};

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ContractDepositService)
    private readonly contractDeposit = new ContractDepositService(),
  ) {}

  async list(user: AuthUser) {
    return this.prisma.db.contract.findMany({
      include: {
        room: true,
        members: {
          where: { memberRole: 'PRIMARY', isCurrent: true },
          include: { tenant: true },
        },
        ...(user.role === UserRole.SUPER_ADMIN
          ? { commissions: { where: { deletedAt: null } } }
          : {}),
      },
      orderBy: { id: 'desc' },
    });
  }
  async bills(contractId: number, collectible = false) {
    return this.prisma.db.rentBill.findMany({
      where: {
        contractId,
        billCategory: 'RENT',
        ...(collectible
          ? {
              NOT: {
                checkoutSettlementItems: {
                  some: {
                    itemType: 'RENT_ARREARS',
                    settlement: {
                      status: { in: ['APPROVED', 'COMPLETED'] },
                      supplementalRequired: true,
                    },
                  },
                },
              },
            }
          : {}),
      },
      orderBy: { periodSeq: 'asc' },
    });
  }

  async detail(contractId: number, user: AuthUser) {
    const { voidRequests = [], ...contract } =
      await this.prisma.db.contract.findUniqueOrThrow({
        where: { id: contractId },
        include: {
          members: { where: { isCurrent: true }, include: { tenant: true } },
          concessions: { where: { status: 'ACTIVE' } },
          voidRequests: {
            where: { status: { in: ['PENDING', 'COMPLETED'] } },
            select: {
              id: true,
              requestNo: true,
              status: true,
              completedAt: true,
            },
            orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
          },
          ...(user.role === UserRole.SUPER_ADMIN
            ? { commissions: { where: { deletedAt: null } } }
            : {}),
        },
      });
    const priority: Record<ContractVoidRequestStatus, number> = {
      COMPLETED: 0,
      PENDING: 1,
      REJECTED: 2,
      CANCELLED: 2,
    };
    const selected = voidRequests
      .filter(
        (item) => item.status === 'COMPLETED' || item.status === 'PENDING',
      )
      .sort((left, right) => {
        const byStatus = priority[left.status] - priority[right.status];
        if (byStatus !== 0) return byStatus;
        const byCompletion =
          (right.completedAt?.getTime() ?? 0) -
          (left.completedAt?.getTime() ?? 0);
        return byCompletion || right.id - left.id;
      })[0];
    return {
      ...contract,
      ...(selected
        ? {
            voidRequest: {
              id: selected.id,
              requestNo: selected.requestNo,
              status: selected.status,
              completedAt: selected.completedAt,
            },
          }
        : {}),
    };
  }

  async updateRemark(
    contractId: number,
    dto: UpdateContractRemarkDto,
    user: AuthUser,
  ) {
    const remark = dto.remark?.trim() || null;
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`,
      );
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: contractId },
        select: { id: true, contractNo: true, status: true, remark: true },
      });
      assertContractNotVoided(contract.status, '修改备注');
      const updatedAt = new Date();
      const updated = await tx.contract.update({
        where: { id: contractId },
        data: { remark },
        select: { id: true, remark: true },
      });
      await tx.operationLog.create({
        data: {
          module: 'CONTRACT',
          action: 'UPDATE_CONTRACT_REMARK',
          entityType: 'CONTRACT',
          entityId: contract.id,
          entityNo: contract.contractNo,
          summary: `修改合同备注 ${contract.contractNo}`,
          beforeData: { remark: contract.remark },
          afterData: { remark },
          operatorId: user.id,
          operatorRole: user.role,
          occurredAt: updatedAt,
        },
      });
      return { ...updated, updatedAt };
    });
  }

  async changes(contractId: number) {
    const changes = await this.prisma.db.contractChange.findMany({
      where: { contractId },
      orderBy: { id: 'desc' },
    });
    const tenantIds = new Set<number>();
    for (const change of changes) {
      const before = change.beforeSnapshot as Record<string, unknown>;
      const after = change.afterSnapshot as Record<string, unknown>;
      const members = Array.isArray(before.members) ? before.members : [];
      for (const raw of members) {
        const member = raw as Record<string, unknown>;
        if (member.memberRole === 'PRIMARY' && Number(member.tenantId) > 0) {
          tenantIds.add(Number(member.tenantId));
        }
      }
      if (Number(after.primaryTenantId) > 0) {
        tenantIds.add(Number(after.primaryTenantId));
      }
    }
    const tenants = tenantIds.size
      ? await this.prisma.db.tenant.findMany({
          where: { id: { in: [...tenantIds] } },
          select: { id: true, name: true },
        })
      : [];
    const tenantNames = Object.fromEntries(
      tenants.map((tenant) => [String(tenant.id), tenant.name]),
    );
    return changes.map((change) => ({ ...change, tenantNames }));
  }

  async submitChange(
    contractId: number,
    dto: SubmitContractChangeDto,
    user: AuthUser,
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${contractId} FOR UPDATE`,
      );
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: contractId },
        include: {
          members: { where: { isCurrent: true } },
          concessions: { where: { status: 'ACTIVE' } },
        },
      });
      this.validateChange(contract, dto);
      assertContractNotVoided(contract.status, '提交合同变更');
      return tx.contractChange.create({
        data: {
          contractId,
          changeNo: `BG${Date.now()}${contractId}`,
          changeType: dto.changeType,
          effectiveDate: new Date(dto.effectiveDate),
          beforeSnapshot: JSON.parse(
            JSON.stringify(contract),
          ) as Prisma.InputJsonValue,
          afterSnapshot: JSON.parse(
            JSON.stringify(dto.afterSnapshot),
          ) as Prisma.InputJsonValue,
          reason: dto.reason,
          approvalStatus: 'PENDING',
          submittedBy: user.id,
          submittedAt: new Date(),
        },
      });
    });
  }

  async approveChange(changeId: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT contract_id FROM contract_changes WHERE id = ${changeId}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contract_changes WHERE id = ${changeId} FOR UPDATE`,
      );
      const change = await tx.contractChange.findUniqueOrThrow({
        where: { id: changeId },
        include: {
          contract: {
            include: {
              members: { where: { isCurrent: true } },
              concessions: { where: { status: 'ACTIVE' } },
              pricingTiers: true,
              bills: { orderBy: { periodSeq: 'asc' } },
            },
          },
        },
      });
      if (change.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待审批变更可以确认');
      assertContractNotVoided(change.contract.status, '确认合同变更');
      const dto: SubmitContractChangeDto = {
        changeType: change.changeType as SubmitContractChangeDto['changeType'],
        effectiveDate: change.effectiveDate.toISOString().slice(0, 10),
        afterSnapshot: change.afterSnapshot as Record<string, unknown>,
        reason: change.reason,
      };
      this.validateChange(change.contract, dto);
      const effectiveDate = new Date(dto.effectiveDate);
      const periods = buildBillingPeriods(
        change.contract.startDate,
        dto.changeType === 'TERM'
          ? new Date(String(dto.afterSnapshot.endDate))
          : change.contract.endDate,
      );
      if (
        !periods.some(
          (period) => period.start.getTime() === effectiveDate.getTime(),
        )
      )
        throw new BadRequestException('变更生效日期必须为一个账期开始日');
      const lockedBills = change.contract.bills.filter(
        (bill) =>
          bill.periodStart >= effectiveDate &&
          new Prisma.Decimal(bill.receivedAmount).gt(0),
      );
      if (lockedBills.length)
        throw new ConflictException(
          '生效日后的账单已有收款，金额已锁定，不能确认变更',
        );

      const after = dto.afterSnapshot;
      let monthlyRent: Prisma.Decimal.Value = change.contract.monthlyRent;
      let endDate = change.contract.endDate;
      let concessions: Array<{
        concessionType: string;
        applyMode: string;
        startDate: Date | null;
        endDate: Date | null;
        fixedAmount?: Prisma.Decimal.Value | null;
        discountRate?: Prisma.Decimal.Value | null;
        billingPeriodCount?: number | null;
      }> = change.contract.concessions;
      if (dto.changeType === 'RENT') {
        monthlyRent = new Prisma.Decimal(String(after.monthlyRent));
        await tx.contract.update({
          where: { id: change.contractId },
          data: { monthlyRent },
        });
      }
      if (dto.changeType === 'TERM') {
        endDate = new Date(String(after.endDate));
        await tx.contract.update({
          where: { id: change.contractId },
          data: { endDate },
        });
      }
      if (dto.changeType === 'PRIMARY_TENANT') {
        const tenantId = Number(after.primaryTenantId);
        await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
        await tx.contractMember.updateMany({
          where: {
            contractId: change.contractId,
            isCurrent: true,
            memberRole: 'PRIMARY',
          },
          data: { memberRole: 'SECONDARY' },
        });
        const member = change.contract.members.find(
          (item) => item.tenantId === tenantId,
        );
        if (member)
          await tx.contractMember.update({
            where: { id: member.id },
            data: { memberRole: 'PRIMARY' },
          });
        else
          await tx.contractMember.create({
            data: {
              contractId: change.contractId,
              tenantId,
              memberRole: 'PRIMARY',
            },
          });
      }
      if (dto.changeType === 'CONCESSION') {
        const next = after.concessions as ConcessionDto[];
        assertConcessions(next);
        await tx.contractConcession.updateMany({
          where: { contractId: change.contractId, status: 'ACTIVE' },
          data: { status: 'CANCELLED' },
        });
        if (next.length) {
          await tx.contractConcession.createMany({
            data: next.map((item) => ({
              contractId: change.contractId,
              concessionType: item.concessionType,
              applyMode: item.applyMode,
              startDate: item.startDate ? new Date(item.startDate) : null,
              endDate: item.endDate ? new Date(item.endDate) : null,
              fixedAmount: item.fixedAmount ?? null,
              discountRate: item.discountRate ?? null,
              billingPeriodCount: item.billingPeriodCount ?? null,
              reason: item.reason,
            })),
          });
          concessions = next.map((item) => ({
            ...item,
            startDate: item.startDate ? new Date(item.startDate) : null,
            endDate: item.endDate ? new Date(item.endDate) : null,
            status: 'ACTIVE' as const,
          }));
        } else concessions = [];
      }
      if (dto.changeType !== 'PRIMARY_TENANT') {
        await this.rebuildOpenBills(
          tx,
          change.contract,
          periods,
          effectiveDate,
          monthlyRent,
          endDate,
          concessions,
        );
      }
      return tx.contractChange.update({
        where: { id: changeId },
        data: {
          approvalStatus: 'APPROVED',
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });
    });
  }

  private validateChange(
    contract: { startDate: Date; endDate: Date; pricingMode: string },
    dto: SubmitContractChangeDto,
  ) {
    const after = dto.afterSnapshot;
    const effective = new Date(dto.effectiveDate);
    if (
      Number.isNaN(effective.getTime()) ||
      effective < contract.startDate ||
      effective > contract.endDate
    )
      throw new BadRequestException('变更生效日期必须在当前合同租期内');
    if (dto.changeType === 'RENT') {
      if (
        contract.pricingMode !== 'FIXED' ||
        !Number.isFinite(Number(after.monthlyRent)) ||
        Number(after.monthlyRent) < 0
      )
        throw new BadRequestException('固定月租合同必须提供非负的新月租');
    }
    if (dto.changeType === 'TERM') {
      const endDate = new Date(String(after.endDate));
      if (Number.isNaN(endDate.getTime()) || endDate < effective)
        throw new BadRequestException('新合同结束日期不得早于变更生效日期');
    }
    if (
      dto.changeType === 'PRIMARY_TENANT' &&
      (!Number.isInteger(Number(after.primaryTenantId)) ||
        Number(after.primaryTenantId) < 1)
    )
      throw new BadRequestException('必须提供新的主承租人');
    if (dto.changeType === 'CONCESSION') {
      if (!Array.isArray(after.concessions))
        throw new BadRequestException('必须提供完整的优惠规则列表');
      assertConcessions(after.concessions as ConcessionDto[]);
    }
  }

  private async rebuildOpenBills(
    tx: Prisma.TransactionClient,
    contract: {
      id: number;
      contractNo: string;
      pricingMode: string;
      bills: Array<{
        id: number;
        periodSeq: number;
        periodStart: Date;
        receivedAmount: Prisma.Decimal;
      }>;
      pricingTiers: Array<{
        id: number;
        thresholdMonths: number;
        monthlyRent: Prisma.Decimal;
      }>;
    },
    periods: ReturnType<typeof buildBillingPeriods>,
    effectiveDate: Date,
    monthlyRent: Prisma.Decimal.Value,
    _endDate: Date,
    concessions: Array<{
      concessionType: string;
      applyMode: string;
      startDate: Date | null;
      endDate: Date | null;
      fixedAmount?: Prisma.Decimal.Value | null;
      discountRate?: Prisma.Decimal.Value | null;
      billingPeriodCount?: number | null;
    }>,
  ) {
    const existing = new Map(
      contract.bills.map((bill) => [bill.periodSeq, bill]),
    );
    for (const bill of contract.bills) {
      if (
        bill.periodStart >= effectiveDate &&
        !periods.some((period) => period.sequence === bill.periodSeq)
      ) {
        await tx.rentBill.update({
          where: { id: bill.id },
          data: { status: 'VOIDED' },
        });
      }
    }
    for (const period of periods.filter(
      (item) => item.start >= effectiveDate,
    )) {
      const existingBill = existing.get(period.sequence);
      const tier =
        contract.pricingMode === 'TIERED_RETROACTIVE'
          ? tierForPeriod(contract.pricingTiers, period.sequence)
          : undefined;
      const rate = tier?.monthlyRent ?? monthlyRent;
      const baseRentAmount = billAmount(rate, period);
      const rentFreeAmountValue = concessions
        .filter(
          (item) =>
            item.concessionType === 'RENT_FREE' &&
            item.applyMode === 'DATE_RANGE' &&
            item.startDate &&
            item.endDate,
        )
        .reduce(
          (sum, item) =>
            sum.plus(
              rentFreeAmount(rate, period, item.startDate!, item.endDate!),
            ),
          new Prisma.Decimal(0),
        );
      const discountAmount = concessions.reduce((sum, item) => {
        if (
          item.concessionType === 'PERCENTAGE' &&
          item.applyMode === 'BILLING_PERIODS' &&
          item.discountRate &&
          item.billingPeriodCount
        )
          return period.sequence <= item.billingPeriodCount
            ? sum.plus(
                percentageDiscountAmount(baseRentAmount, item.discountRate),
              )
            : sum;
        if (
          item.concessionType === 'FIXED_AMOUNT' &&
          item.applyMode === 'BILLING_PERIODS' &&
          item.fixedAmount &&
          item.billingPeriodCount
        )
          return sum.plus(
            fixedDiscountForPeriod(
              item.fixedAmount,
              period.sequence,
              item.billingPeriodCount,
            ),
          );
        return sum;
      }, new Prisma.Decimal(0));
      const data = {
        periodEnd: period.end,
        dueDate: period.start,
        unitMonthlyRent: rate,
        baseRentAmount,
        rentFreeAmount: rentFreeAmountValue,
        discountAmount,
        payableAmount: payableAmount(
          baseRentAmount,
          rentFreeAmountValue,
          discountAmount,
        ),
        outstandingAmount: payableAmount(
          baseRentAmount,
          rentFreeAmountValue,
          discountAmount,
        ),
        status: 'PENDING' as const,
        contractPricingTierId: tier?.id ?? null,
      };
      if (existingBill)
        await tx.rentBill.update({ where: { id: existingBill.id }, data });
      else
        await tx.rentBill.create({
          data: {
            ...data,
            billNo: buildBillNumber(contract.contractNo, period.sequence),
            contractId: contract.id,
            periodSeq: period.sequence,
            periodStart: period.start,
          },
        });
    }
  }

  async rejectChange(changeId: number, reason: string, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT contract_id FROM contract_changes WHERE id = ${changeId}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contract_changes WHERE id = ${changeId} FOR UPDATE`,
      );
      const change = await tx.contractChange.findUniqueOrThrow({
        where: { id: changeId },
        include: { contract: true },
      });
      if (change.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待审批变更可以驳回');
      assertContractNotVoided(change.contract.status, '驳回合同变更');
      return tx.contractChange.update({
        where: { id: changeId },
        data: {
          approvalStatus: 'REJECTED',
          rejectedReason: reason,
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });
    });
  }

  previewTieredBills(
    monthlyRent: Prisma.Decimal.Value,
    startDate: Date,
    endDate: Date,
    tiers: PricingTierDto[],
  ) {
    assertPricingTiers(tiers);
    return buildBillingPeriods(startDate, endDate).map((period) => {
      const tier = tierForPeriod(tiers, period.sequence);
      const rate = tier?.monthlyRent ?? monthlyRent;
      return { period, tier, amount: billAmount(rate, period) };
    });
  }

  async saveTierSnapshots(contractId: number, tiers: PricingTierDto[]) {
    assertPricingTiers(tiers);
    return this.prisma.db.contractPricingTier.createMany({
      data: [...tiers]
        .sort((a, b) => a.thresholdMonths - b.thresholdMonths)
        .map((tier, sortOrder) => ({
          contractId,
          tierName: tier.tierName,
          thresholdMonths: tier.thresholdMonths,
          monthlyRent: tier.monthlyRent,
          sortOrder,
          requiresFullyPaid: tier.requiresFullyPaid,
        })),
    });
  }

  async saveConcessions(contractId: number, concessions: ConcessionDto[]) {
    if (!concessions.length) return;
    assertConcessions(concessions);
    await this.prisma.db.contractConcession.createMany({
      data: concessions.map((item) => ({
        contractId,
        concessionType: item.concessionType,
        applyMode: item.applyMode,
        startDate: item.startDate ? new Date(item.startDate) : null,
        endDate: item.endDate ? new Date(item.endDate) : null,
        fixedAmount: item.fixedAmount ?? null,
        discountRate: item.discountRate ?? null,
        billingPeriodCount: item.billingPeriodCount ?? null,
        reason: item.reason,
      })),
    });
  }

  previewFixedContract(input: {
    startDate: Date;
    endDate: Date;
    monthlyRent: Prisma.Decimal.Value;
    concessions?: ConcessionDto[];
  }): FixedContractPreview {
    this.validateFixedPreview(input);
    const bills = this.calculateFixedBills(input);
    const totalBaseRent = bills.reduce(
      (sum, bill) => sum.plus(bill.baseRentAmount),
      new Prisma.Decimal(0),
    );
    const totalDiscount = bills.reduce(
      (sum, bill) => sum.plus(bill.rentFreeAmount).plus(bill.discountAmount),
      new Prisma.Decimal(0),
    );
    const totalPayable = bills.reduce(
      (sum, bill) => sum.plus(bill.payableAmount),
      new Prisma.Decimal(0),
    );
    return {
      billCount: bills.length,
      totalBaseRent: totalBaseRent.toFixed(2),
      totalDiscount: totalDiscount.toFixed(2),
      totalPayable: totalPayable.toFixed(2),
      bills: bills.map((bill) => ({
        sequence: bill.period.sequence,
        startDate: this.dateText(bill.period.start),
        endDate: this.dateText(bill.period.end),
        payableAmount: bill.payableAmount.toFixed(2),
      })),
    };
  }

  async createFixedContract(input: FixedContractInput, user: AuthUser) {
    return this.confirmFixedContract(input, user);
  }

  async confirmFixedContractDraft(draftId: number, user: AuthUser) {
    return this.confirmFixedContract(undefined, user, draftId);
  }

  private async confirmFixedContract(
    directInput: FixedContractInput | undefined,
    user: AuthUser,
    draftId?: number,
  ) {
    const confirm = async (tx: Prisma.TransactionClient) => {
      let input = directInput;
      if (draftId !== undefined) {
        const draft = await tx.contractDraft.findFirst({
          where:
            user.role === UserRole.SUPER_ADMIN
              ? { id: draftId }
              : { id: draftId, createdBy: user.id },
        });
        if (!draft) throw new NotFoundException('草稿不存在');
        if (draft.status === 'CONFIRMED')
          throw new BadRequestException('草稿已确认');
        input = this.fixedInputFromDraft(draft.payload);
      }
      if (!input) throw new BadRequestException('合同确认信息不完整');

      this.validateFixedConfirmation(input, user);
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rooms WHERE id = ${input.roomId} FOR UPDATE`,
      );
      const confirmedAt = new Date();
      const startsImmediately =
        input.startDate <= contractBusinessDay(confirmedAt);
      const initialContractStatus = startsImmediately
        ? ('ACTIVE' as const)
        : ('PENDING_START' as const);
      const initialRoomStatus = startsImmediately
        ? ('RENTED' as const)
        : ('PENDING_MOVE_IN' as const);
      const room = await tx.room.findFirstOrThrow({
        where: { id: input.roomId, deletedAt: null },
      });
      assertContractRoomStatus(room.roomStatus);
      const conflict = await tx.contract.findFirst({
        where: {
          roomId: input.roomId,
          status: { in: ['PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT'] },
          startDate: { lte: input.endDate },
          endDate: { gte: input.startDate },
        },
      });
      if (conflict)
        throw new ConflictException('该房源在合同租期内已有有效合同');

      const primaryTenant = await tx.tenant.findUniqueOrThrow({
        where: { id: input.primaryTenantId },
        select: { name: true },
      });
      const fileAssetIds = [...new Set(input.fileAssetIds ?? [])];
      if (fileAssetIds.length) {
        const files = await tx.fileAsset.findMany({
          where: {
            id: { in: fileAssetIds },
            category: 'CONTRACT',
            ...(user.role === UserRole.SUPER_ADMIN
              ? {}
              : { uploadedBy: user.id }),
          },
          select: { id: true },
        });
        if (files.length !== fileAssetIds.length)
          throw new BadRequestException('合同附件不存在或无权使用');
      }

      const contract = await tx.contract.create({
        data: {
          contractNo: buildTemporaryContractNumber(),
          externalContractNo: input.externalContractNo ?? null,
          roomId: input.roomId,
          startDate: input.startDate,
          endDate: input.endDate,
          plannedMoveInDate: input.plannedMoveInDate ?? null,
          monthlyRent: input.monthlyRent,
          pricingMode: 'FIXED',
          paymentCycleMonths: input.paymentCycleMonths,
          depositRequired: input.depositRequired,
          status: initialContractStatus,
          activatedAt: startsImmediately ? confirmedAt : null,
          billingGeneratedAt: confirmedAt,
          remark: input.remark ?? null,
          members: {
            create: [
              { tenantId: input.primaryTenantId, memberRole: 'PRIMARY' },
              ...(input.secondaryTenantIds ?? []).map((tenantId) => ({
                tenantId,
                memberRole: 'SECONDARY' as const,
              })),
            ],
          },
          concessions: input.concessions?.length
            ? {
                create: input.concessions.map((item) => ({
                  concessionType: item.concessionType,
                  applyMode: item.applyMode,
                  startDate: item.startDate ? new Date(item.startDate) : null,
                  endDate: item.endDate ? new Date(item.endDate) : null,
                  fixedAmount: item.fixedAmount ?? null,
                  discountRate: item.discountRate ?? null,
                  billingPeriodCount: item.billingPeriodCount ?? null,
                  reason: item.reason,
                })),
              }
            : undefined,
          files: fileAssetIds.length
            ? {
                create: fileAssetIds.map((fileAssetId) => ({ fileAssetId })),
              }
            : undefined,
          commissions: input.commission
            ? {
                create: {
                  recipientName: input.commission.recipientName,
                  amount: input.commission.amount,
                  createdBy: user.id,
                  updatedBy: user.id,
                },
              }
            : undefined,
        },
      });
      const contractNo = buildContractNumber(
        contract.id,
        input.startDate,
        room.fullHouseNo,
        primaryTenant.name,
      );
      const finalizedContract = await tx.contract.update({
        where: { id: contract.id },
        data: { contractNo },
      });
      await this.contractDeposit.recordInitialDeposit(tx, {
        contractId: finalizedContract.id,
        amount: input.depositRequired,
        operatorId: user.id,
        occurredAt: confirmedAt,
      });

      const bills = this.calculateFixedBills(input).map((bill) => ({
        billNo: buildBillNumber(contractNo, bill.period.sequence),
        contractId: contract.id,
        periodSeq: bill.period.sequence,
        periodStart: bill.period.start,
        periodEnd: bill.period.end,
        dueDate: bill.period.start,
        unitMonthlyRent: input.monthlyRent,
        baseRentAmount: bill.baseRentAmount,
        rentFreeAmount: bill.rentFreeAmount,
        discountAmount: bill.discountAmount,
        payableAmount: bill.payableAmount,
        outstandingAmount: bill.payableAmount,
      }));
      await tx.rentBill.createMany({ data: bills });
      await tx.room.update({
        where: { id: room.id },
        data: {
          roomStatus: initialRoomStatus,
          statusChangedAt: confirmedAt,
        },
      });
      await tx.roomStatusHistory.create({
        data: {
          roomId: room.id,
          fromStatus: room.roomStatus,
          toStatus: initialRoomStatus,
          changeReason: `合同确认：${contractNo}`,
          businessType: 'CONTRACT',
          businessId: contract.id,
        },
      });
      if (draftId !== undefined) {
        const confirmed = await tx.contractDraft.updateMany({
          where: { id: draftId, status: 'DRAFT' },
          data: { status: 'CONFIRMED', confirmedAt: new Date() },
        });
        if (!confirmed.count) throw new BadRequestException('草稿已确认');
      }
      return finalizedContract;
    };
    return this.prisma.db.$transaction(confirm, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }

  private validateFixedPreview(input: {
    startDate: Date;
    endDate: Date;
    monthlyRent: Prisma.Decimal.Value;
    concessions?: ConcessionDto[];
  }) {
    if (
      Number.isNaN(input.startDate.getTime()) ||
      Number.isNaN(input.endDate.getTime()) ||
      input.endDate < input.startDate
    )
      throw new BadRequestException('合同日期无效');
    if (
      !Number.isFinite(Number(input.monthlyRent)) ||
      Number(input.monthlyRent) < 0
    )
      throw new BadRequestException('月租金不得为负数');
    assertConcessions(input.concessions ?? []);
  }

  private validateFixedConfirmation(input: FixedContractInput, user: AuthUser) {
    this.validateFixedPreview(input);
    assertContractDates(
      input.startDate,
      input.endDate,
      input.paymentCycleMonths,
    );
    assertPrimaryTenant(
      [input.primaryTenantId, ...(input.secondaryTenantIds ?? [])],
      input.primaryTenantId,
    );
    if (!Number.isInteger(input.roomId) || input.roomId < 1)
      throw new BadRequestException('房源信息不完整');
    if (!Number.isInteger(input.primaryTenantId) || input.primaryTenantId < 1)
      throw new BadRequestException('主承租人信息不完整');
    if (
      !Number.isFinite(Number(input.depositRequired)) ||
      Number(input.depositRequired) < 0
    )
      throw new BadRequestException('押金不得为负数');
    if (
      input.plannedMoveInDate &&
      (Number.isNaN(input.plannedMoveInDate.getTime()) ||
        input.plannedMoveInDate < input.startDate ||
        input.plannedMoveInDate > input.endDate)
    )
      throw new BadRequestException('计划入住日期必须在合同租期内');
    if (input.commission && user.role !== UserRole.SUPER_ADMIN)
      throw new ForbiddenException('只有超级管理员可以填写佣金');
    if (
      input.commission &&
      (!Number.isFinite(Number(input.commission.amount)) ||
        Number(input.commission.amount) < 0)
    )
      throw new BadRequestException('佣金不得为负数');
  }

  private fixedInputFromDraft(payload: unknown): FixedContractInput {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    )
      throw new BadRequestException('合同草稿内容不完整');
    const value = payload as Record<string, unknown>;
    return {
      externalContractNo: value.externalContractNo as string | undefined,
      roomId: Number(value.roomId),
      startDate: new Date(this.draftText(value.startDate)),
      endDate: new Date(this.draftText(value.endDate)),
      plannedMoveInDate:
        typeof value.plannedMoveInDate === 'string'
          ? new Date(value.plannedMoveInDate)
          : undefined,
      monthlyRent: this.draftText(value.monthlyRent),
      paymentCycleMonths: Number(value.paymentCycleMonths),
      depositRequired: this.draftText(value.depositRequired),
      primaryTenantId: Number(value.primaryTenantId),
      secondaryTenantIds: value.secondaryTenantIds as number[] | undefined,
      concessions: value.concessions as ConcessionDto[] | undefined,
      fileAssetIds: value.fileAssetIds as number[] | undefined,
      remark: value.remark as string | undefined,
      commission: value.commission as FixedContractInput['commission'],
    };
  }

  private calculateFixedBills(input: {
    startDate: Date;
    endDate: Date;
    monthlyRent: Prisma.Decimal.Value;
    concessions?: ConcessionDto[];
  }) {
    return buildBillingPeriods(input.startDate, input.endDate).map((period) => {
      const baseRentAmount = billAmount(input.monthlyRent, period);
      const rentFreeAmountValue = (input.concessions ?? [])
        .filter(
          (item) =>
            item.concessionType === 'RENT_FREE' &&
            item.applyMode === 'DATE_RANGE' &&
            item.startDate &&
            item.endDate,
        )
        .reduce(
          (sum, item) =>
            sum.plus(
              rentFreeAmount(
                input.monthlyRent,
                period,
                new Date(item.startDate!),
                new Date(item.endDate!),
              ),
            ),
          new Prisma.Decimal(0),
        );
      const discountAmount = (input.concessions ?? []).reduce((sum, item) => {
        if (
          item.concessionType === 'PERCENTAGE' &&
          item.applyMode === 'BILLING_PERIODS' &&
          item.discountRate &&
          item.billingPeriodCount &&
          period.sequence <= item.billingPeriodCount
        )
          return sum.plus(
            percentageDiscountAmount(baseRentAmount, item.discountRate),
          );
        if (
          item.concessionType === 'FIXED_AMOUNT' &&
          item.fixedAmount &&
          item.applyMode === 'BILLING_PERIODS' &&
          item.billingPeriodCount
        )
          return sum.plus(
            fixedDiscountForPeriod(
              item.fixedAmount,
              period.sequence,
              item.billingPeriodCount,
            ),
          );
        return sum;
      }, new Prisma.Decimal(0));
      return {
        period,
        baseRentAmount,
        rentFreeAmount: rentFreeAmountValue,
        discountAmount,
        payableAmount: payableAmount(
          baseRentAmount,
          rentFreeAmountValue,
          discountAmount,
        ),
      };
    });
  }

  private dateText(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private draftText(value: unknown) {
    return typeof value === 'string' ? value : '';
  }

  async createTieredContract(input: {
    roomId: number;
    startDate: Date;
    endDate: Date;
    monthlyRent: Prisma.Decimal.Value;
    paymentCycleMonths: number;
    depositRequired: Prisma.Decimal.Value;
    primaryTenantId: number;
    secondaryTenantIds?: number[];
    tiers: PricingTierDto[];
    concessions?: ConcessionDto[];
  }) {
    void input;
    throw new GoneException('阶梯合同功能已停用');

    assertPricingTiers(input.tiers);
    assertConcessions(input.concessions ?? []);
    assertPrimaryTenant(
      [input.primaryTenantId, ...(input.secondaryTenantIds ?? [])],
      input.primaryTenantId,
    );
    return this.prisma.db.$transaction(async (tx) => {
      const room = await tx.room.findFirstOrThrow({
        where: { id: input.roomId, deletedAt: null },
      });
      assertContractRoomStatus(room.roomStatus);
      const conflict = await tx.contract.findFirst({
        where: {
          roomId: input.roomId,
          status: { in: ['PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT'] },
          startDate: { lte: input.endDate },
          endDate: { gte: input.startDate },
        },
      });
      if (conflict)
        throw new ConflictException('该房源在合同租期内已有有效合同');
      const primaryTenant = await tx.tenant.findUniqueOrThrow({
        where: { id: input.primaryTenantId },
        select: { name: true },
      });
      const contract = await tx.contract.create({
        data: {
          contractNo: buildTemporaryContractNumber(),
          roomId: input.roomId,
          startDate: input.startDate,
          endDate: input.endDate,
          monthlyRent: input.monthlyRent,
          pricingMode: 'TIERED_RETROACTIVE',
          paymentCycleMonths: input.paymentCycleMonths,
          depositRequired: input.depositRequired,
          status: 'PENDING_START',
          billingGeneratedAt: new Date(),
          members: {
            create: [
              { tenantId: input.primaryTenantId, memberRole: 'PRIMARY' },
              ...(input.secondaryTenantIds ?? []).map((tenantId) => ({
                tenantId,
                memberRole: 'SECONDARY' as const,
              })),
            ],
          },
          concessions: input.concessions?.length
            ? {
                create: input.concessions.map((item) => ({
                  concessionType: item.concessionType,
                  applyMode: item.applyMode,
                  startDate: item.startDate ? new Date(item.startDate) : null,
                  endDate: item.endDate ? new Date(item.endDate) : null,
                  fixedAmount: item.fixedAmount ?? null,
                  discountRate: item.discountRate ?? null,
                  billingPeriodCount: item.billingPeriodCount ?? null,
                  reason: item.reason,
                })),
              }
            : undefined,
        },
      });
      const contractNo = buildContractNumber(
        contract.id,
        input.startDate,
        room.fullHouseNo,
        primaryTenant.name,
      );
      const finalizedContract = await tx.contract.update({
        where: { id: contract.id },
        data: { contractNo },
      });
      const snapshots = await Promise.all(
        [...input.tiers]
          .sort((a, b) => a.thresholdMonths - b.thresholdMonths)
          .map((tier, sortOrder) =>
            tx.contractPricingTier.create({
              data: {
                contractId: contract.id,
                tierName: tier.tierName,
                thresholdMonths: tier.thresholdMonths,
                monthlyRent: tier.monthlyRent,
                sortOrder,
                requiresFullyPaid: tier.requiresFullyPaid,
              },
            }),
          ),
      );
      const bills = buildBillingPeriods(input.startDate, input.endDate).map(
        (period) => {
          const tier = tierForPeriod(snapshots, period.sequence);
          const rate = tier?.monthlyRent ?? input.monthlyRent;
          const amount = billAmount(rate, period);
          const rentFree = (input.concessions ?? [])
            .filter(
              (item) =>
                item.concessionType === 'RENT_FREE' &&
                item.applyMode === 'DATE_RANGE' &&
                item.startDate &&
                item.endDate,
            )
            .reduce(
              (sum, item) =>
                sum.plus(
                  rentFreeAmount(
                    rate,
                    period,
                    new Date(item.startDate!),
                    new Date(item.endDate!),
                  ),
                ),
              new Prisma.Decimal(0),
            );
          const discount = (input.concessions ?? []).reduce((sum, item) => {
            if (
              item.concessionType === 'PERCENTAGE' &&
              item.applyMode === 'BILLING_PERIODS' &&
              item.discountRate &&
              item.billingPeriodCount &&
              period.sequence <= item.billingPeriodCount
            )
              return sum.plus(
                percentageDiscountAmount(amount, item.discountRate),
              );
            if (
              item.concessionType === 'FIXED_AMOUNT' &&
              item.fixedAmount &&
              item.applyMode === 'BILLING_PERIODS' &&
              item.billingPeriodCount
            )
              return sum.plus(
                fixedDiscountForPeriod(
                  item.fixedAmount,
                  period.sequence,
                  item.billingPeriodCount,
                ),
              );
            return sum;
          }, new Prisma.Decimal(0));
          const payable = payableAmount(amount, rentFree, discount);
          return {
            billNo: buildBillNumber(contractNo, period.sequence),
            contractId: contract.id,
            periodSeq: period.sequence,
            periodStart: period.start,
            periodEnd: period.end,
            dueDate: period.start,
            contractPricingTierId: tier?.id,
            unitMonthlyRent: rate,
            baseRentAmount: amount,
            rentFreeAmount: rentFree,
            discountAmount: discount,
            payableAmount: payable,
            outstandingAmount: payable,
          };
        },
      );
      await tx.rentBill.createMany({ data: bills });
      await tx.room.update({
        where: { id: room.id },
        data: { roomStatus: 'PENDING_MOVE_IN', statusChangedAt: new Date() },
      });
      await tx.roomStatusHistory.create({
        data: {
          roomId: room.id,
          fromStatus: room.roomStatus,
          toStatus: 'PENDING_MOVE_IN',
          changeReason: `合同确认：${contractNo}`,
          businessType: 'CONTRACT',
          businessId: contract.id,
        },
      });
      return finalizedContract;
    });
  }
}
