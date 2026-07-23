import { ConflictException, Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
import type { AuthUser } from '../auth/auth-user.type';
import {
  assertContractRoomStatus,
  assertConcessions,
  assertPricingTiers,
  assertPrimaryTenant,
} from './contract-validation';

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.db.contract.findMany({
      include: {
        room: true,
        members: {
          where: { memberRole: 'PRIMARY', isCurrent: true },
          include: { tenant: true },
        },
      },
      orderBy: { id: 'desc' },
    });
  }
  async bills(contractId: number) {
    return this.prisma.db.rentBill.findMany({
      where: { contractId },
      orderBy: { periodSeq: 'asc' },
    });
  }

  async detail(contractId: number) {
    return this.prisma.db.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: {
        members: { where: { isCurrent: true }, include: { tenant: true } },
        concessions: { where: { status: 'ACTIVE' } },
      },
    });
  }

  async changes(contractId: number) {
    return this.prisma.db.contractChange.findMany({
      where: { contractId },
      orderBy: { id: 'desc' },
    });
  }

  async submitChange(
    contractId: number,
    dto: SubmitContractChangeDto,
    user: AuthUser,
  ) {
    const contract = await this.prisma.db.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: { members: { where: { isCurrent: true } }, concessions: true },
    });
    this.validateChange(contract, dto);
    return this.prisma.db.contractChange.create({
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
  }

  async approveChange(changeId: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
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
            billNo: `${contract.contractNo}-B${String(period.sequence).padStart(3, '0')}`,
            contractId: contract.id,
            periodSeq: period.sequence,
            periodStart: period.start,
          },
        });
    }
  }

  async rejectChange(changeId: number, reason: string, user: AuthUser) {
    const change = await this.prisma.db.contractChange.findUniqueOrThrow({
      where: { id: changeId },
    });
    if (change.approvalStatus !== 'PENDING')
      throw new BadRequestException('只有待审批变更可以驳回');
    return this.prisma.db.contractChange.update({
      where: { id: changeId },
      data: {
        approvalStatus: 'REJECTED',
        rejectedReason: reason,
        approvedBy: user.id,
        approvedAt: new Date(),
      },
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

  async createFixedContract(input: {
    contractNo: string;
    roomId: number;
    startDate: Date;
    endDate: Date;
    monthlyRent: Prisma.Decimal.Value;
    paymentCycleMonths: number;
    depositRequired: Prisma.Decimal.Value;
    primaryTenantId: number;
    secondaryTenantIds?: number[];
    concessions?: ConcessionDto[];
  }) {
    assertConcessions(input.concessions ?? []);
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
      const contract = await tx.contract.create({
        data: {
          contractNo: input.contractNo,
          roomId: input.roomId,
          startDate: input.startDate,
          endDate: input.endDate,
          monthlyRent: input.monthlyRent,
          pricingMode: 'FIXED',
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
      const bills = buildBillingPeriods(input.startDate, input.endDate).map(
        (period) => {
          const amount = billAmount(input.monthlyRent, period);
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
                    input.monthlyRent,
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
            billNo: `${input.contractNo}-B${String(period.sequence).padStart(3, '0')}`,
            contractId: contract.id,
            periodSeq: period.sequence,
            periodStart: period.start,
            periodEnd: period.end,
            dueDate: period.start,
            unitMonthlyRent: input.monthlyRent,
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
          changeReason: `合同确认：${input.contractNo}`,
          businessType: 'CONTRACT',
          businessId: contract.id,
        },
      });
      return contract;
    });
  }

  async createTieredContract(input: {
    contractNo: string;
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
      const contract = await tx.contract.create({
        data: {
          contractNo: input.contractNo,
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
            billNo: `${input.contractNo}-B${String(period.sequence).padStart(3, '0')}`,
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
          changeReason: `合同确认：${input.contractNo}`,
          businessType: 'CONTRACT',
          businessId: contract.id,
        },
      });
      return contract;
    });
  }
}
