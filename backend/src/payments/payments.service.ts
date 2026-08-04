import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, RentBillStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { resolveAllocationPlan } from './payment-policy';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(contractId?: number) {
    return this.prisma.db.payment.findMany({
      where: contractId ? { contractId } : undefined,
      include: { allocations: { include: { rentBill: true } }, contract: true },
      orderBy: { id: 'desc' },
    });
  }

  async prepayments(contractId: number) {
    const items = await this.prisma.db.prepaymentTransaction.findMany({
      where: { contractId },
      orderBy: { id: 'desc' },
    });
    return { balance: items[0]?.balanceAfter ?? new Prisma.Decimal(0), items };
  }

  async record(dto: RecordPaymentDto, user: AuthUser) {
    const amount = new Prisma.Decimal(dto.amount);
    if (!amount.isFinite() || amount.lte(0))
      throw new BadRequestException('收款金额必须大于零');
    if (
      dto.proofFileIds &&
      new Set(dto.proofFileIds).size !== dto.proofFileIds.length
    )
      throw new BadRequestException('收款凭证不能重复');
    return this.prisma.db.$transaction(async (tx) => {
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: dto.contractId },
      });
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${contract.id} FOR UPDATE`,
      );
      const eligibleBills = await tx.rentBill.findMany({
        where: {
          contractId: dto.contractId,
          status: { notIn: ['VOIDED', 'REFUNDED'] },
          outstandingAmount: { gt: 0 },
        },
        orderBy: [{ dueDate: 'asc' }, { periodSeq: 'asc' }],
      });
      const plan = resolveAllocationPlan(
        eligibleBills,
        amount.toFixed(2),
        dto.selectedBillIds,
        user.role,
        dto.manualAllocationReason,
      );

      const proofFileIds = dto.proofFileIds ?? [];
      if (proofFileIds.length) {
        const proofFiles = await tx.fileAsset.findMany({
          where: {
            id: { in: proofFileIds },
            category: 'PAYMENT_PROOF',
            uploadedBy: user.id,
            lockedAt: null,
          },
        });
        if (proofFiles.length !== proofFileIds.length)
          throw new BadRequestException(
            '收款凭证不存在、已被使用或不属于当前操作人',
          );
      }

      const selectedBillIds = new Set(
        plan.allocations.map((item) => item.rentBillId),
      );
      const allocatedByBill = new Map(
        plan.allocations.map((item) => [item.rentBillId, item.amount]),
      );
      for (const adjustment of dto.adjustments ?? []) {
        const bill = eligibleBills.find(
          (item) => item.id === adjustment.rentBillId,
        );
        if (!bill || !selectedBillIds.has(adjustment.rentBillId))
          throw new BadRequestException('优惠必须归属于本次覆盖的账单');
        const adjustmentAmount = new Prisma.Decimal(adjustment.amount);
        const remainingAfterPayment = new Prisma.Decimal(
          bill.outstandingAmount,
        ).minus(allocatedByBill.get(bill.id) ?? 0);
        if (
          !adjustmentAmount.isFinite() ||
          adjustmentAmount.lte(0) ||
          adjustmentAmount.gt(remainingAfterPayment)
        )
          throw new BadRequestException(
            '优惠金额不能超过该账单本次收款后的未收金额',
          );
      }

      const payment = await tx.payment.create({
        data: {
          receiptNo: await this.receiptNo(tx),
          contractId: contract.id,
          paymentCategory: 'RENT',
          paymentDate: new Date(dto.paymentDate),
          amount,
          method: dto.method,
          externalReference: dto.externalReference,
          remark: dto.remark,
          operatorId: user.id,
        },
      });
      if (plan.allocations.length) {
        await tx.paymentAllocation.createMany({
          data: plan.allocations.map((item) => ({
            paymentId: payment.id,
            rentBillId: item.rentBillId,
            allocatedAmount: item.amount,
            allocationOrder: item.allocationOrder,
            allocationType: item.allocationType,
          })),
        });
        for (const allocation of plan.allocations) {
          const bill = eligibleBills.find(
            (item) => item.id === allocation.rentBillId,
          )!;
          const receivedAmount = new Prisma.Decimal(bill.receivedAmount)
            .plus(allocation.amount)
            .toDecimalPlaces(2);
          const outstandingAmount = new Prisma.Decimal(bill.payableAmount)
            .minus(receivedAmount)
            .toDecimalPlaces(2);
          const status: RentBillStatus = outstandingAmount.isZero()
            ? 'PAID'
            : 'PARTIAL';
          await tx.rentBill.update({
            where: { id: bill.id },
            data: { receivedAmount, outstandingAmount, status },
          });
        }
      }
      if (plan.prepaymentAmount.gt(0)) {
        const latest = await tx.prepaymentTransaction.findFirst({
          where: { contractId: contract.id },
          orderBy: { id: 'desc' },
        });
        const balanceAfter = new Prisma.Decimal(latest?.balanceAfter ?? 0)
          .plus(plan.prepaymentAmount)
          .toDecimalPlaces(2);
        await tx.prepaymentTransaction.create({
          data: {
            contractId: contract.id,
            transactionNo: `YS${Date.now()}${payment.id}`,
            transactionType: 'CREDIT_RECEIPT',
            amount: plan.prepaymentAmount,
            balanceAfter,
            paymentId: payment.id,
            reason: '租金收款超出选定账单应收，转入预收款',
          },
        });
      }

      const adjustmentIds: number[] = [];
      for (const adjustment of dto.adjustments ?? []) {
        const bill = eligibleBills.find(
          (item) => item.id === adjustment.rentBillId,
        )!;
        const created = await tx.billAdjustment.create({
          data: {
            adjustmentNo: `TZ${Date.now()}${adjustment.rentBillId}`,
            rentBillId: adjustment.rentBillId,
            adjustmentType: adjustment.adjustmentType,
            direction: 'DECREASE',
            amount: new Prisma.Decimal(adjustment.amount),
            beforeAmount: bill.payableAmount,
            afterAmount: Prisma.Decimal.max(
              0,
              new Prisma.Decimal(bill.payableAmount).minus(adjustment.amount),
            ).toDecimalPlaces(2),
            reason: adjustment.reason,
            sourcePaymentId: payment.id,
            approvalStatus: 'PENDING',
            submittedBy: user.id,
          },
        });
        adjustmentIds.push(created.id);
      }

      if (proofFileIds.length) {
        const lockedAt = new Date();
        await tx.paymentFile.createMany({
          data: proofFileIds.map((fileAssetId) => ({
            paymentId: payment.id,
            fileAssetId,
            purpose: 'PAYMENT_PROOF',
            uploadedBy: user.id,
            lockedAt,
          })),
        });
        await tx.fileAsset.updateMany({
          where: { id: { in: proofFileIds }, lockedAt: null },
          data: { lockedAt },
        });
      }

      if (plan.manualOverride) {
        await tx.securityAuditLog.create({
          data: {
            eventType: 'PAYMENT_ALLOCATION_OVERRIDDEN',
            entityType: 'PAYMENT',
            entityId: payment.id,
            operatorId: user.id,
            reason: dto.manualAllocationReason,
            eventData: {
              automaticBillIds: eligibleBills
                .slice(0, dto.selectedBillIds?.length ?? eligibleBills.length)
                .map((bill) => bill.id),
              selectedBillIds: dto.selectedBillIds ?? [],
            },
          },
        });
      }

      await tx.operationLog.create({
        data: {
          module: 'PAYMENTS',
          action: 'PAYMENT_RECORDED',
          entityType: 'PAYMENT',
          entityId: payment.id,
          entityNo: payment.receiptNo,
          summary: `登记收款 ${payment.receiptNo}`,
          afterData: {
            amount: amount.toFixed(2),
            billIds: plan.allocations.map((item) => item.rentBillId),
            adjustmentIds,
            proofFileIds,
          },
          operatorId: user.id,
          operatorRole: user.role,
        },
      });
      await this.refreshContractPaymentSnapshot(tx, contract.id);
      return {
        id: payment.id,
        receiptNo: payment.receiptNo,
        receiptType: adjustmentIds.length ? 'PROVISIONAL' : 'FORMAL',
        adjustmentIds,
      } as const;
    });
  }

  private async refreshContractPaymentSnapshot(
    tx: Prisma.TransactionClient,
    contractId: number,
  ) {
    const bills = await tx.rentBill.findMany({
      where: { contractId },
      orderBy: { periodSeq: 'asc' },
    });
    let paidThroughDate: Date | null = null;
    let nextDueDate: Date | null = null;
    for (const bill of bills) {
      if (bill.status === 'VOIDED') continue;
      if (new Prisma.Decimal(bill.outstandingAmount).isZero())
        paidThroughDate = bill.periodEnd;
      else {
        nextDueDate = bill.dueDate;
        break;
      }
    }
    const contract = await tx.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: { pricingTiers: { orderBy: { thresholdMonths: 'asc' } } },
    });
    const now = new Date();
    let qualifiedMonths =
      (now.getUTCFullYear() - contract.startDate.getUTCFullYear()) * 12 +
      now.getUTCMonth() -
      contract.startDate.getUTCMonth();
    if (now.getUTCDate() < contract.startDate.getUTCDate())
      qualifiedMonths -= 1;
    qualifiedMonths = Math.max(0, qualifiedMonths);
    const tierIsQualified = (tier: (typeof contract.pricingTiers)[number]) => {
      if (qualifiedMonths < tier.thresholdMonths) return false;
      if (!tier.requiresFullyPaid) return true;
      const cutoff = new Date(contract.startDate);
      cutoff.setUTCMonth(cutoff.getUTCMonth() + tier.thresholdMonths);
      return bills
        .filter(
          (bill) =>
            bill.periodEnd < cutoff &&
            !['VOIDED', 'REFUNDED'].includes(bill.status),
        )
        .every((bill) => bill.status === 'PAID');
    };
    const currentTier = contract.pricingTiers.filter(tierIsQualified).at(-1);
    const nextTier = contract.pricingTiers.find(
      (tier) => !tierIsQualified(tier),
    );
    await tx.contract.update({
      where: { id: contractId },
      data: {
        paidThroughDate,
        nextDueDate,
        qualifiedMonths,
        currentPricingTierId: currentTier?.id ?? null,
        nextTierDate: nextTier
          ? new Date(
              Date.UTC(
                contract.startDate.getUTCFullYear(),
                contract.startDate.getUTCMonth() + nextTier.thresholdMonths,
                contract.startDate.getUTCDate(),
              ),
            )
          : null,
      },
    });
  }

  private async receiptNo(tx: Prisma.TransactionClient) {
    const setting = await tx.systemSetting.findUnique({
      where: { settingKey: 'receiptPrefix' },
    });
    const configuredPrefix =
      setting && typeof setting.settingValue === 'string'
        ? setting.settingValue.trim()
        : '';
    const prefix = configuredPrefix || 'SK';
    return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;
  }
}
