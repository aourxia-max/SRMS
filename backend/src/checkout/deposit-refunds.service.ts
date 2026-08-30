import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { assertNoPendingCheckoutSupplementalReversal } from '../payments/checkout-supplemental-balance';
import { SubmitDepositRefundDto } from './dto/submit-deposit-refund.dto';
import { assertContractNotVoided } from '../contracts/contract-operability';
import { lockRoomAndTargetContract } from '../contracts/contract-room-locks';
import { assertCheckoutRentRefundReservationMatches } from './checkout-rent-refund-reservations';
import { applyCheckoutRentRefund } from './checkout-rent-refund-writer';

@Injectable()
export class DepositRefundsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(contractId?: number) {
    const refunds = await this.prisma.db.depositRefund.findMany({
      where: contractId ? { contractId } : undefined,
      include: {
        files: { include: { fileAsset: true } },
        checkoutSettlement: true,
      },
      orderBy: { id: 'desc' },
    });
    return refunds.map((refund) => this.serializeFiles(refund));
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
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT contract_id FROM checkout_settlements WHERE id = ${dto.checkoutSettlementId}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM checkout_settlements WHERE id = ${dto.checkoutSettlementId} FOR UPDATE`,
      );
      const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
        where: { id: dto.checkoutSettlementId },
        include: { contract: true },
      });
      assertContractNotVoided(settlement.contract.status, '登记押金退款');
      if (
        settlement.status !== 'APPROVED' ||
        settlement.contract.status !== 'PENDING_CHECKOUT' ||
        !settlement.handoverDate ||
        !this.isSupplementalCleared(settlement)
      )
        throw new BadRequestException('当前不满足登记押金退款的条件');
      const depositRefundAmount = new Prisma.Decimal(
        settlement.depositRefundableAmount,
      ).toDecimalPlaces(2);
      const prepaymentRefundAmount = new Prisma.Decimal(
        settlement.prepaymentRefundableAmount,
      ).toDecimalPlaces(2);
      const rentRefundAmount = new Prisma.Decimal(
        settlement.rentRefundableAmount ?? 0,
      ).toDecimalPlaces(2);
      const expectedRefund = depositRefundAmount
        .plus(prepaymentRefundAmount)
        .plus(rentRefundAmount)
        .toDecimalPlaces(2);
      if (!amount.equals(expectedRefund))
        throw new BadRequestException(
          '退款金额必须等于结算单锁定的三类合计应退金额',
        );
      if (rentRefundAmount.gt(0))
        await assertCheckoutRentRefundReservationMatches(
          tx,
          settlement.id,
          rentRefundAmount,
        );
      const files = await tx.fileAsset.findMany({
        where: {
          id: { in: dto.proofFileIds },
          category: 'DEPOSIT_REFUND_PROOF',
          lockedAt: null,
        },
      });
      if (files.length !== dto.proofFileIds.length)
        throw new BadRequestException('押金退款凭证不存在、类型不正确或已锁定');
      return tx.depositRefund.create({
        data: {
          refundNo: `YJTK${Date.now()}${settlement.contractId}`,
          contractId: settlement.contractId,
          checkoutSettlementId: settlement.id,
          refundAmount: amount,
          depositRefundAmount,
          prepaymentRefundAmount,
          rentRefundAmount,
          refundDate: new Date(dto.refundDate),
          refundMethod: dto.refundMethod,
          remark: dto.remark,
          submittedBy: user.id,
          files: { create: files.map((file) => ({ fileAssetId: file.id })) },
        },
      });
    });
  }
  async approve(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(
      async (tx) => {
        const identity = await tx.depositRefund.findUniqueOrThrow({
          where: { id },
          select: { contractId: true },
        });
        await lockRoomAndTargetContract(tx, identity.contractId);
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM checkout_settlements WHERE id = (SELECT checkout_settlement_id FROM deposit_refunds WHERE id = ${id}) FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM deposit_refunds WHERE id = ${id} FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM rent_bills WHERE contract_id = (SELECT contract_id FROM deposit_refunds WHERE id = ${id}) ORDER BY id FOR UPDATE`,
        );
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
        if (refund.approvalStatus !== 'PENDING')
          throw new BadRequestException(
            '当前不满足确认押金退款并结束合同的条件',
          );
        assertContractNotVoided(settlement.contract.status, '确认押金退款');
        if (
          settlement.status !== 'APPROVED' ||
          settlement.contract.status !== 'PENDING_CHECKOUT' ||
          !settlement.handoverDate ||
          !this.isSupplementalCleared(settlement) ||
          !refund.files.length
        )
          throw new BadRequestException(
            '当前不满足确认押金退款并结束合同的条件',
          );
        const depositRefundableAmount = new Prisma.Decimal(
          settlement.depositRefundableAmount,
        ).toDecimalPlaces(2);
        const prepaymentRefundableAmount = new Prisma.Decimal(
          settlement.prepaymentRefundableAmount,
        ).toDecimalPlaces(2);
        const rentRefundableAmount = new Prisma.Decimal(
          settlement.rentRefundableAmount ?? 0,
        ).toDecimalPlaces(2);
        const storedDepositRefundAmount = new Prisma.Decimal(
          refund.depositRefundAmount,
        ).toDecimalPlaces(2);
        const storedPrepaymentRefundAmount = new Prisma.Decimal(
          refund.prepaymentRefundAmount,
        ).toDecimalPlaces(2);
        const storedRentRefundAmount = new Prisma.Decimal(
          refund.rentRefundAmount,
        ).toDecimalPlaces(2);
        const storedTotal = storedDepositRefundAmount
          .plus(storedPrepaymentRefundAmount)
          .plus(storedRentRefundAmount)
          .toDecimalPlaces(2);
        if (
          !new Prisma.Decimal(refund.refundAmount)
            .toDecimalPlaces(2)
            .equals(storedTotal) ||
          !storedDepositRefundAmount.equals(depositRefundableAmount) ||
          !storedPrepaymentRefundAmount.equals(prepaymentRefundableAmount) ||
          !storedRentRefundAmount.equals(rentRefundableAmount)
        )
          throw new BadRequestException('退款申请的三类锁定金额与结算单不一致');
        if (rentRefundableAmount.gt(0))
          await assertCheckoutRentRefundReservationMatches(
            tx,
            settlement.id,
            rentRefundableAmount,
          );
        const latestDeposit = await tx.depositTransaction.findFirst({
          where: { contractId: refund.contractId },
          orderBy: { id: 'desc' },
        });
        const latestPrepayment = await tx.prepaymentTransaction.findFirst({
          where: { contractId: refund.contractId },
          orderBy: { id: 'desc' },
        });
        if (
          !new Prisma.Decimal(latestDeposit?.balanceAfter ?? 0).equals(
            depositRefundableAmount,
          ) ||
          !new Prisma.Decimal(latestPrepayment?.balanceAfter ?? 0).equals(
            prepaymentRefundableAmount,
          )
        )
          throw new BadRequestException(
            '当前资金余额与结算单锁定退款金额不一致',
          );
        if (settlement.supplementalRequired)
          await assertNoPendingCheckoutSupplementalReversal(
            tx,
            settlement.contractId,
          );
        const occurredAt = new Date();
        const claimedRefund = await tx.depositRefund.updateMany({
          where: { id, approvalStatus: 'PENDING' },
          data: {
            approvalStatus: 'APPROVED',
            approvedBy: user.id,
            approvedAt: occurredAt,
          },
        });
        if (claimedRefund.count !== 1)
          throw new ConflictException('退款申请已被处理，请刷新后重试');
        if (rentRefundableAmount.gt(0))
          await applyCheckoutRentRefund(tx, {
            settlementId: settlement.id,
            depositRefundId: refund.id,
            approvedBy: user.id,
            occurredAt,
          });
        if (depositRefundableAmount.gt(0)) {
          await tx.depositTransaction.create({
            data: {
              contractId: refund.contractId,
              transactionNo: `YJTK${occurredAt.getTime()}${refund.id}`,
              transactionType: 'REFUND',
              amount: depositRefundableAmount,
              balanceAfter: 0,
              checkoutSettlementId: settlement.id,
              depositRefundId: refund.id,
              reason: '退租结算押金退款',
            },
          });
        }
        if (prepaymentRefundableAmount.gt(0)) {
          await tx.prepaymentTransaction.create({
            data: {
              contractId: refund.contractId,
              transactionNo: `YSKTH${occurredAt.getTime()}${refund.id}`,
              transactionType: 'REFUND',
              amount: prepaymentRefundableAmount,
              balanceAfter: 0,
              reason: '退租结算预收款退款',
            },
          });
        }
        await tx.fileAsset.updateMany({
          where: { id: { in: refund.files.map((file) => file.fileAssetId) } },
          data: { lockedAt: occurredAt },
        });
        const claimedSettlement = await tx.checkoutSettlement.updateMany({
          where: { id: settlement.id, status: 'APPROVED' },
          data: { status: 'COMPLETED' },
        });
        if (claimedSettlement.count !== 1)
          throw new ConflictException('结算单已被最终确认，请刷新后重试');
        await tx.contract.update({
          where: { id: refund.contractId },
          data: { status: 'ENDED' },
        });
        await tx.room.update({
          where: { id: settlement.contract.roomId },
          data: {
            roomStatus: settlement.targetRoomStatus,
            statusChangedAt: occurredAt,
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
        await tx.securityAuditLog.create({
          data: {
            eventType: 'CHECKOUT_REFUND_APPROVED',
            entityType: 'DEPOSIT_REFUND',
            entityId: refund.id,
            operatorId: user.id,
            eventData: {
              checkoutSettlementId: settlement.id,
              refundAmount: new Prisma.Decimal(refund.refundAmount).toFixed(2),
              depositRefundAmount: storedDepositRefundAmount.toFixed(2),
              prepaymentRefundAmount: storedPrepaymentRefundAmount.toFixed(2),
              rentRefundAmount: storedRentRefundAmount.toFixed(2),
            },
          },
        });
        return refund;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
  private isSupplementalCleared(settlement: {
    finalReceivable: Prisma.Decimal.Value;
    supplementalRequired?: boolean;
    supplementalOutstandingAmount?: Prisma.Decimal.Value;
  }) {
    const outstanding = settlement.supplementalRequired
      ? (settlement.supplementalOutstandingAmount ?? settlement.finalReceivable)
      : settlement.finalReceivable;
    return new Prisma.Decimal(outstanding).isZero();
  }

  private serializeFiles<
    T extends { files: Array<{ fileAsset: { sizeBytes: bigint } }> },
  >(refund: T) {
    return {
      ...refund,
      files: refund.files.map((file) => ({
        ...file,
        fileAsset: {
          ...file.fileAsset,
          sizeBytes: file.fileAsset.sizeBytes.toString(),
        },
      })),
    };
  }
}
