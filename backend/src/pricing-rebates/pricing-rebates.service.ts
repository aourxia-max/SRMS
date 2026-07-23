import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitPricingRebateDto } from './dto/submit-pricing-rebate.dto';

const addMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
};

@Injectable()
export class PricingRebatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(contractId?: number) {
    return this.prisma.db.pricingRebate.findMany({
      where: contractId ? { contractId } : undefined,
      include: {
        pricingTier: true,
        rentBill: true,
        files: { include: { fileAsset: true } },
        supplements: true,
      },
      orderBy: { id: 'desc' },
    });
  }

  async preview(contractId: number) {
    const contract = await this.loadContract(contractId);
    return this.qualification(contract);
  }

  async submit(dto: SubmitPricingRebateDto, user: AuthUser) {
    const actualAmount = new Prisma.Decimal(dto.actualAmount);
    if (!actualAmount.isFinite() || actualAmount.lt(0))
      throw new BadRequestException('实际退差金额必须为非负数');
    if (new Date(dto.periodStart) > new Date(dto.periodEnd))
      throw new BadRequestException('退差期间开始日期不能晚于结束日期');
    if (
      dto.proofFileIds &&
      new Set(dto.proofFileIds).size !== dto.proofFileIds.length
    )
      throw new BadRequestException('退款凭证不能重复');
    const contract = await this.loadContract(dto.contractId);
    if (contract.status !== 'ACTIVE')
      throw new BadRequestException('仅生效中的合同可以提交退差');
    if (
      dto.settlementMethod === 'ACTUAL_REFUND' &&
      (!dto.refundDate || !dto.refundMethod || !dto.proofFileIds?.length)
    )
      throw new BadRequestException(
        '实际退款必须填写退款日期、退款方式并上传退款凭证',
      );
    if (
      dto.settlementMethod === 'PREPAYMENT_CREDIT' &&
      (dto.refundDate || dto.refundMethod || dto.proofFileIds?.length)
    )
      throw new BadRequestException(
        '转预收款不应填写退款日期、退款方式或退款凭证',
      );

    let referenceAmount: Prisma.Decimal | null = null;
    let grossBilledAmount = new Prisma.Decimal(0);
    let targetNetRentAmount: Prisma.Decimal | null = null;
    let previousRebateAmount = new Prisma.Decimal(0);
    let qualificationDate: Date | null = null;
    let thresholdMonths: number | null = null;
    let pricingTierId: number | null = dto.pricingTierId ?? null;
    const rentBillId: number | null = dto.rentBillId ?? null;

    if (dto.sourceType === 'TIER_MILESTONE') {
      if (contract.pricingMode !== 'TIERED_RETROACTIVE' || !pricingTierId)
        throw new BadRequestException('阶梯退差必须关联阶梯定价合同及其达档');
      const qualification = this.qualification(contract);
      const reached = qualification.tiers.find(
        (item) => item.id === pricingTierId && item.qualified,
      );
      if (!reached)
        throw new BadRequestException('所选档位尚未达标或未满足已付清条件');
      thresholdMonths = reached.thresholdMonths;
      qualificationDate = reached.qualificationDate;
      grossBilledAmount = reached.grossBilledAmount;
      targetNetRentAmount = reached.targetNetRentAmount;
      previousRebateAmount = reached.previousRebateAmount;
      referenceAmount = reached.referenceAmount;
      if (dto.rebateType === 'SUPPLEMENT' && !dto.parentRebateId)
        throw new BadRequestException('补充退差必须关联原退差单');
    } else {
      if (contract.pricingMode !== 'FIXED' || !rentBillId)
        throw new BadRequestException('固定租金手工退差必须关联有效租金账单');
      const bill = contract.bills.find((item) => item.id === rentBillId);
      if (!bill || ['VOIDED', 'REFUNDED'].includes(bill.status))
        throw new BadRequestException('关联的租金账单无效');
      pricingTierId = null;
      if (dto.rebateType === 'MILESTONE')
        throw new BadRequestException('固定租金合同不能提交达档退差');
    }
    if (
      referenceAmount &&
      !actualAmount.equals(referenceAmount) &&
      !dto.differenceReason
    )
      throw new BadRequestException(
        '实际退差金额与系统参考额不一致时必须填写原因',
      );
    const validRentReceipts = await this.validRentReceipts(contract.id);
    const approvedRebates = await this.prisma.db.pricingRebate.aggregate({
      where: { contractId: contract.id, approvalStatus: 'APPROVED' },
      _sum: { actualAmount: true },
    });
    const remainingReceipts = validRentReceipts.minus(
      approvedRebates._sum.actualAmount ?? 0,
    );
    if (actualAmount.gt(remainingReceipts))
      throw new BadRequestException('实际退差金额不得超过合同累计有效实收租金');
    const files = dto.proofFileIds?.length
      ? await this.prisma.db.fileAsset.findMany({
          where: {
            id: { in: dto.proofFileIds },
            category: 'PRICING_REBATE_PROOF',
            lockedAt: null,
          },
        })
      : [];
    if (files.length !== (dto.proofFileIds?.length ?? 0))
      throw new BadRequestException('退款凭证不存在、类型不正确或已锁定');
    if (dto.parentRebateId) {
      const parent = await this.prisma.db.pricingRebate.findFirst({
        where: {
          id: dto.parentRebateId,
          contractId: contract.id,
          approvalStatus: 'APPROVED',
        },
      });
      if (!parent)
        throw new BadRequestException('补充退差必须关联本合同已确认的原退差单');
    }
    return this.prisma.db.pricingRebate.create({
      data: {
        rebateNo: `TC${Date.now()}${contract.id}`,
        contractId: contract.id,
        sourceType: dto.sourceType,
        rebateType: dto.rebateType,
        pricingTierId,
        rentBillId,
        parentRebateId: dto.parentRebateId,
        thresholdMonths,
        qualificationDate,
        periodStart: new Date(dto.periodStart),
        periodEnd: new Date(dto.periodEnd),
        grossBilledAmount,
        targetNetRentAmount,
        previousRebateAmount,
        referenceAmount,
        actualAmount,
        differenceAmount: referenceAmount
          ? actualAmount.minus(referenceAmount)
          : null,
        differenceReason: dto.differenceReason,
        settlementMethod: dto.settlementMethod,
        refundDate: dto.refundDate ? new Date(dto.refundDate) : null,
        refundMethod: dto.refundMethod,
        remark: dto.remark,
        approvalStatus: 'PENDING',
        submittedBy: user.id,
        submittedAt: new Date(),
        files: files.length
          ? { create: files.map((file) => ({ fileAssetId: file.id })) }
          : undefined,
      },
      include: {
        pricingTier: true,
        rentBill: true,
        files: { include: { fileAsset: true } },
      },
    });
  }

  async approve(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      const rebate = await tx.pricingRebate.findUniqueOrThrow({
        where: { id },
        include: { files: true },
      });
      if (rebate.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待确认退差单可以确认');
      if (rebate.settlementMethod === 'PREPAYMENT_CREDIT') {
        const latest = await tx.prepaymentTransaction.findFirst({
          where: { contractId: rebate.contractId },
          orderBy: { id: 'desc' },
        });
        const balanceAfter = new Prisma.Decimal(latest?.balanceAfter ?? 0)
          .plus(rebate.actualAmount)
          .toDecimalPlaces(2);
        await tx.prepaymentTransaction.create({
          data: {
            contractId: rebate.contractId,
            transactionNo: `TCYS${Date.now()}${rebate.id}`,
            transactionType: 'ADJUSTMENT',
            amount: rebate.actualAmount,
            balanceAfter,
            reason: `退差单 ${rebate.rebateNo} 转入预收款`,
          },
        });
      } else {
        await tx.fileAsset.updateMany({
          where: { id: { in: rebate.files.map((item) => item.fileAssetId) } },
          data: { lockedAt: new Date() },
        });
      }
      return tx.pricingRebate.update({
        where: { id },
        data: {
          approvalStatus: 'APPROVED',
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });
    });
  }

  async reject(id: number, reason: string, user: AuthUser) {
    const rebate = await this.prisma.db.pricingRebate.findUniqueOrThrow({
      where: { id },
    });
    if (rebate.approvalStatus !== 'PENDING')
      throw new BadRequestException('只有待确认退差单可以驳回');
    return this.prisma.db.pricingRebate.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectedReason: reason,
        approvedBy: user.id,
        approvedAt: new Date(),
      },
    });
  }

  private async validRentReceipts(contractId: number) {
    const payments = await this.prisma.db.payment.aggregate({
      where: {
        contractId,
        paymentCategory: 'RENT',
        status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED'] },
      },
      _sum: { amount: true },
    });
    const refunds = await this.prisma.db.paymentRefund.aggregate({
      where: { contractId, approvalStatus: 'APPROVED' },
      _sum: { refundAmount: true },
    });
    return new Prisma.Decimal(payments._sum.amount ?? 0).minus(
      refunds._sum.refundAmount ?? 0,
    );
  }

  private async loadContract(contractId: number) {
    return this.prisma.db.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: {
        pricingTiers: { orderBy: { thresholdMonths: 'asc' } },
        bills: { orderBy: { periodSeq: 'asc' } },
        pricingRebates: { where: { approvalStatus: 'APPROVED' } },
      },
    });
  }

  private qualification(
    contract: Awaited<ReturnType<PricingRebatesService['loadContract']>>,
  ) {
    const now = new Date();
    let completeMonths =
      (now.getUTCFullYear() - contract.startDate.getUTCFullYear()) * 12 +
      now.getUTCMonth() -
      contract.startDate.getUTCMonth();
    if (now.getUTCDate() < contract.startDate.getUTCDate()) completeMonths -= 1;
    completeMonths = Math.max(0, completeMonths);
    const tiers = contract.pricingTiers.map((tier) => {
      const qualificationDate = addMonths(
        contract.startDate,
        tier.thresholdMonths,
      );
      const stageBills = contract.bills.filter(
        (bill) =>
          bill.periodEnd < qualificationDate &&
          bill.periodEnd <= now &&
          !['VOIDED', 'REFUNDED'].includes(bill.status),
      );
      const fullyPaid =
        !tier.requiresFullyPaid ||
        stageBills.every((bill) => bill.status === 'PAID');
      const qualified = completeMonths >= tier.thresholdMonths && fullyPaid;
      const grossBilledAmount = stageBills.reduce(
        (sum, bill) => sum.plus(bill.baseRentAmount),
        new Prisma.Decimal(0),
      );
      const targetNetRentAmount = new Prisma.Decimal(tier.monthlyRent)
        .mul(tier.thresholdMonths)
        .toDecimalPlaces(2);
      const previousRebateAmount = contract.pricingRebates
        .filter((rebate) => rebate.pricingTierId === tier.id)
        .reduce(
          (sum, rebate) => sum.plus(rebate.actualAmount),
          new Prisma.Decimal(0),
        );
      return {
        id: tier.id,
        tierName: tier.tierName,
        thresholdMonths: tier.thresholdMonths,
        requiresFullyPaid: tier.requiresFullyPaid,
        qualified,
        qualificationDate: qualified ? qualificationDate : null,
        grossBilledAmount,
        targetNetRentAmount,
        previousRebateAmount,
        referenceAmount: grossBilledAmount
          .minus(targetNetRentAmount)
          .minus(previousRebateAmount)
          .toDecimalPlaces(2),
      };
    });
    return { contractId: contract.id, completeMonths, tiers };
  }
}
