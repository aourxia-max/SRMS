import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitDepositRefundDto } from './dto/submit-deposit-refund.dto';
@Injectable()
export class DepositRefundsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(contractId?: number) {
    return this.prisma.db.depositRefund.findMany({
      where: contractId ? { contractId } : undefined,
      include: {
        files: { include: { fileAsset: true } },
        checkoutSettlement: true,
      },
      orderBy: { id: 'desc' },
    });
  }
  async submit(dto: SubmitDepositRefundDto, user: AuthUser) {
    const amount = new Prisma.Decimal(dto.refundAmount);
    if (
      !amount.isFinite() ||
      amount.lte(0) ||
      !dto.proofFileIds.length ||
      new Set(dto.proofFileIds).size !== dto.proofFileIds.length
    )
      throw new BadRequestException('押金退款金额必须大于零且必须关联有效凭证');
    const settlement =
      await this.prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id: dto.checkoutSettlementId },
        include: { contract: true },
      });
    if (
      settlement.status !== 'APPROVED' ||
      settlement.contract.status !== 'PENDING_CHECKOUT' ||
      !settlement.handoverDate ||
      !new Prisma.Decimal(settlement.finalReceivable).isZero() ||
      !new Prisma.Decimal(settlement.prepaymentBalance).isZero()
    )
      throw new BadRequestException('当前不满足登记押金退款的条件');
    if (!amount.equals(settlement.depositRefundableAmount))
      throw new BadRequestException('退款金额必须等于结算单锁定的应退押金');
    const files = await this.prisma.db.fileAsset.findMany({
      where: {
        id: { in: dto.proofFileIds },
        category: 'DEPOSIT_REFUND_PROOF',
        lockedAt: null,
      },
    });
    if (files.length !== dto.proofFileIds.length)
      throw new BadRequestException('押金退款凭证不存在、类型不正确或已锁定');
    return this.prisma.db.depositRefund.create({
      data: {
        refundNo: `YJTK${Date.now()}${settlement.contractId}`,
        contractId: settlement.contractId,
        checkoutSettlementId: settlement.id,
        refundAmount: amount,
        refundDate: new Date(dto.refundDate),
        refundMethod: dto.refundMethod,
        remark: dto.remark,
        submittedBy: user.id,
        files: { create: files.map((file) => ({ fileAssetId: file.id })) },
      },
    });
  }
  async approve(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      const refund = await tx.depositRefund.findUniqueOrThrow({
        where: { id },
        include: {
          files: true,
          checkoutSettlement: {
            include: { contract: { include: { room: true } } },
          },
        },
      });
      const settlement = refund.checkoutSettlement;
      if (
        refund.approvalStatus !== 'PENDING' ||
        settlement.status !== 'APPROVED' ||
        settlement.contract.status !== 'PENDING_CHECKOUT' ||
        !settlement.handoverDate ||
        !new Prisma.Decimal(settlement.finalReceivable).isZero() ||
        !new Prisma.Decimal(settlement.prepaymentBalance).isZero() ||
        !new Prisma.Decimal(refund.refundAmount).equals(
          settlement.depositRefundableAmount,
        ) ||
        !refund.files.length
      )
        throw new BadRequestException('当前不满足确认押金退款并结束合同的条件');
      const latest = await tx.depositTransaction.findFirst({
        where: { contractId: refund.contractId },
        orderBy: { id: 'desc' },
      });
      if (
        !new Prisma.Decimal(latest?.balanceAfter ?? 0).equals(
          refund.refundAmount,
        )
      )
        throw new BadRequestException('当前押金余额与退款金额不一致');
      await tx.depositTransaction.create({
        data: {
          contractId: refund.contractId,
          transactionNo: `YJTK${Date.now()}${refund.id}`,
          transactionType: 'REFUND',
          amount: refund.refundAmount,
          balanceAfter: 0,
          checkoutSettlementId: settlement.id,
          depositRefundId: refund.id,
          reason: '退租结算押金退款',
        },
      });
      await tx.fileAsset.updateMany({
        where: { id: { in: refund.files.map((file) => file.fileAssetId) } },
        data: { lockedAt: new Date() },
      });
      await tx.depositRefund.update({
        where: { id },
        data: {
          approvalStatus: 'APPROVED',
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });
      await tx.checkoutSettlement.update({
        where: { id: settlement.id },
        data: { status: 'COMPLETED' },
      });
      await tx.contract.update({
        where: { id: refund.contractId },
        data: { status: 'ENDED' },
      });
      await tx.room.update({
        where: { id: settlement.contract.roomId },
        data: {
          roomStatus: settlement.targetRoomStatus,
          statusChangedAt: new Date(),
        },
      });
      await tx.roomStatusHistory.create({
        data: {
          roomId: settlement.contract.roomId,
          fromStatus: settlement.contract.room.roomStatus,
          toStatus: settlement.targetRoomStatus,
          changeReason: '确认押金退款并结束合同',
          businessType: 'DEPOSIT_REFUND',
          businessId: refund.id,
          changedBy: user.id,
        },
      });
      return refund;
    });
  }
}
