import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitRefundDto } from './dto/submit-refund.dto';
import { ApproveRefundDto } from './dto/approve-refund.dto';
import { calculateAdjustedBill } from './adjustment-calculator';
import {
  assertPaymentIsNotContractAutomaticDeposit,
  assertPaymentReversalRequestAllowed,
  assertPaymentDoesNotTouchProtectedCheckoutArrears,
  reopenCheckoutSupplementalBalance,
} from './checkout-supplemental-balance';
import { assertContractNotVoided } from '../contracts/contract-operability';
import { assertNoCheckoutRentRefundReservation } from '../checkout/checkout-rent-refund-reservations';
import { calculatePaymentRefundStatus } from './payment-refund-status';

@Injectable()
export class RefundsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(paymentId?: number) {
    return this.prisma.db.paymentRefund.findMany({
      where: paymentId ? { paymentId } : undefined,
      include: {
        allocations: {
          include: { paymentAllocation: { include: { rentBill: true } } },
        },
      },
      orderBy: { id: 'desc' },
    });
  }
  async submit(dto: SubmitRefundDto, user: AuthUser) {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('当前角色不能提交退款');
    const refundAmount = new Prisma.Decimal(dto.refundAmount);
    if (
      !refundAmount.isFinite() ||
      refundAmount.lte(0) ||
      !dto.allocations.length
    )
      throw new BadRequestException('退款金额和退款账单明细必填');
    if (
      new Set(dto.allocations.map((item) => item.paymentAllocationId)).size !==
      dto.allocations.length
    )
      throw new BadRequestException('退款账单明细不能重复');
    const total = dto.allocations.reduce(
      (sum, item) => sum.plus(item.amount),
      new Prisma.Decimal(0),
    );
    if (!total.equals(refundAmount))
      throw new BadRequestException('退款明细合计必须等于退款金额');
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT contract_id FROM payments WHERE id = ${dto.paymentId}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM payments WHERE id = ${dto.paymentId} FOR UPDATE`,
      );
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: dto.paymentId },
        include: {
          allocations: true,
          contract: { select: { status: true } },
        },
      });
      if (!['CONFIRMED', 'PARTIALLY_REFUNDED'].includes(payment.status))
        throw new BadRequestException('该收款当前不能退款');
      assertPaymentIsNotContractAutomaticDeposit(payment);
      assertContractNotVoided(payment.contract.status, '发起退款');
      await assertNoCheckoutRentRefundReservation(tx, payment.id);
      await assertPaymentReversalRequestAllowed(tx, payment);
      const original = new Map(
        payment.allocations.map((item) => [item.id, item]),
      );
      for (const item of dto.allocations) {
        const allocation = original.get(item.paymentAllocationId);
        const amount = new Prisma.Decimal(item.amount);
        if (
          !allocation ||
          amount.lte(0) ||
          amount.gt(
            new Prisma.Decimal(allocation.allocatedAmount).minus(
              allocation.reversedAmount,
            ),
          )
        )
          throw new BadRequestException('退款金额超过原账单分配余额');
      }
      return tx.paymentRefund.create({
        data: {
          refundNo: `TK${Date.now()}${payment.id}`,
          paymentId: payment.id,
          contractId: payment.contractId,
          refundAmount,
          refundDate: new Date(dto.refundDate),
          refundMethod: dto.refundMethod,
          reason: dto.reason,
          submittedBy: user.id,
          allocations: {
            create: dto.allocations.map((item) => ({
              paymentAllocationId: item.paymentAllocationId,
              reversedAmount: item.amount,
            })),
          },
        },
        include: { allocations: true },
      });
    });
  }
  async approve(id: number, dto: ApproveRefundDto, user: AuthUser) {
    if (user.role !== UserRole.SUPER_ADMIN)
      throw new ForbiddenException('只有超级管理员可以确认退款');
    return this.prisma.db.$transaction(async (tx) => {
      const identity = await tx.paymentRefund.findUniqueOrThrow({
        where: { id },
        select: { paymentId: true, contractId: true },
      });
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${identity.contractId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM payments WHERE id = ${identity.paymentId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM payment_refunds WHERE id = ${id} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM payment_allocations WHERE payment_id = ${identity.paymentId} ORDER BY id FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rent_bills WHERE contract_id = ${identity.contractId} ORDER BY id FOR UPDATE`,
      );
      const refund = await tx.paymentRefund.findUniqueOrThrow({
        where: { id },
        include: {
          allocations: {
            include: { paymentAllocation: { include: { rentBill: true } } },
          },
          payment: { include: { adjustments: true } },
          contract: { select: { status: true } },
        },
      });
      if (refund.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待审批退款可以确认');
      if (!['CONFIRMED', 'PARTIALLY_REFUNDED'].includes(refund.payment.status))
        throw new BadRequestException('原收款当前不能退款');
      if (refund.payment.paymentCategory !== 'CHECKOUT_SUPPLEMENTAL')
        await assertPaymentDoesNotTouchProtectedCheckoutArrears(
          tx,
          refund.paymentId,
        );
      assertContractNotVoided(refund.contract.status, '确认退款');

      const affectedBillIds = new Set(
        refund.allocations.map((item) => item.paymentAllocation.rentBill.id),
      );
      const affectedAdjustments = refund.payment.adjustments.filter(
        (item) =>
          affectedBillIds.has(item.rentBillId) &&
          ['PENDING', 'APPROVED'].includes(item.approvalStatus) &&
          !item.reversedByAdjustmentId,
      );
      const decisions = new Map(
        dto.adjustmentDecisions.map((item) => [item.billAdjustmentId, item]),
      );
      if (
        decisions.size !== dto.adjustmentDecisions.length ||
        decisions.size !== affectedAdjustments.length ||
        affectedAdjustments.some((item) => !decisions.has(item.id))
      )
        throw new BadRequestException('必须逐条确认受退款影响的优惠处理方式');
      if (
        dto.adjustmentDecisions.some(
          (item) => item.decision === 'KEEP' && !item.keepReason?.trim(),
        )
      )
        throw new BadRequestException('保留优惠时必须填写原因');

      const billStates = new Map(
        refund.allocations.map((item) => {
          const bill = item.paymentAllocation.rentBill;
          return [
            bill.id,
            {
              ...bill,
              adjustmentAmount: new Prisma.Decimal(bill.adjustmentAmount),
              payableAmount: new Prisma.Decimal(bill.payableAmount),
              receivedAmount: new Prisma.Decimal(bill.receivedAmount),
              outstandingAmount: new Prisma.Decimal(bill.outstandingAmount),
            },
          ];
        }),
      );

      for (const adjustment of affectedAdjustments) {
        const decision = decisions.get(adjustment.id)!;
        let reversalAdjustmentId: number | null = null;
        if (decision.decision === 'REVERSE') {
          if (adjustment.approvalStatus === 'PENDING') {
            await tx.billAdjustment.update({
              where: { id: adjustment.id },
              data: { approvalStatus: 'CANCELLED' },
            });
          } else {
            const bill = billStates.get(adjustment.rentBillId)!;
            const next = calculateAdjustedBill({
              ...bill,
              currentAdjustmentAmount: bill.adjustmentAmount,
              direction: 'INCREASE',
              amount: adjustment.amount,
            });
            const reversal = await tx.billAdjustment.create({
              data: {
                adjustmentNo: `TZREV${Date.now()}${adjustment.id}`,
                rentBillId: adjustment.rentBillId,
                adjustmentType: 'CORRECTION',
                direction: 'INCREASE',
                amount: adjustment.amount,
                beforeAmount: bill.payableAmount,
                afterAmount: next.payableAmount,
                reason: `退款 ${refund.id} 撤销优惠 ${adjustment.id}`,
                sourcePaymentId: refund.paymentId,
                approvalStatus: 'APPROVED',
                submittedBy: user.id,
                approvedBy: user.id,
                approvedAt: new Date(),
              },
            });
            reversalAdjustmentId = reversal.id;
            bill.adjustmentAmount = next.adjustmentAmount;
            bill.payableAmount = next.payableAmount;
            bill.outstandingAmount = next.outstandingAmount;
            await tx.billAdjustment.update({
              where: { id: adjustment.id },
              data: { reversedByAdjustmentId: reversal.id },
            });
          }
        }
        await tx.paymentRefundAdjustmentDecision.create({
          data: {
            paymentRefundId: refund.id,
            billAdjustmentId: adjustment.id,
            decision: decision.decision,
            keepReason: decision.keepReason,
            reversalAdjustmentId,
            decidedBy: user.id,
          },
        });
      }

      for (const item of refund.allocations) {
        const allocation = item.paymentAllocation;
        const remaining = new Prisma.Decimal(allocation.allocatedAmount).minus(
          allocation.reversedAmount,
        );
        const reversedAmount = new Prisma.Decimal(item.reversedAmount);
        if (reversedAmount.gt(remaining))
          throw new BadRequestException('退款金额超过当前可回退余额');
        await tx.paymentAllocation.update({
          where: { id: allocation.id },
          data: {
            reversedAmount: new Prisma.Decimal(allocation.reversedAmount).plus(
              reversedAmount,
            ),
          },
        });
        const bill = billStates.get(allocation.rentBill.id)!;
        const receivedAmount = bill.receivedAmount
          .minus(reversedAmount)
          .toDecimalPlaces(2);
        const outstandingAmount = bill.payableAmount
          .minus(receivedAmount)
          .toDecimalPlaces(2);
        await tx.rentBill.update({
          where: { id: bill.id },
          data: {
            adjustmentAmount: bill.adjustmentAmount,
            payableAmount: bill.payableAmount,
            receivedAmount,
            outstandingAmount,
            status: receivedAmount.gt(0) ? 'PARTIAL' : 'PENDING',
          },
        });
      }
      const paymentRefundStatus = await calculatePaymentRefundStatus(tx, {
        paymentId: refund.paymentId,
        current: { paymentRefundId: refund.id },
      });
      await tx.payment.update({
        where: { id: refund.paymentId },
        data: { status: paymentRefundStatus.status },
      });
      await reopenCheckoutSupplementalBalance(
        tx,
        refund.contractId,
        refund.payment.paymentCategory,
        refund.refundAmount,
      );
      await tx.securityAuditLog.create({
        data: {
          eventType: 'PAYMENT_REFUND_APPROVED',
          entityType: 'PAYMENT_REFUND',
          entityId: refund.id,
          operatorId: user.id,
          eventData: {
            paymentId: refund.paymentId,
            refundAmount: new Prisma.Decimal(refund.refundAmount).toFixed(2),
            adjustmentDecisions: dto.adjustmentDecisions.map((item) => ({
              billAdjustmentId: item.billAdjustmentId,
              decision: item.decision,
              keepReason: item.keepReason ?? null,
            })),
          },
        },
      });
      await this.refreshContractPaymentSnapshot(tx, refund.contractId);
      return tx.paymentRefund.update({
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
    if (user.role !== UserRole.SUPER_ADMIN)
      throw new ForbiddenException('只有超级管理员可以驳回退款');
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT contract_id FROM payment_refunds WHERE id = ${id}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM payment_refunds WHERE id = ${id} FOR UPDATE`,
      );
      const refund = await tx.paymentRefund.findUniqueOrThrow({
        where: { id },
        include: { contract: { select: { status: true } } },
      });
      if (refund.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待审批退款可以驳回');
      assertContractNotVoided(refund.contract.status, '驳回退款');
      return tx.paymentRefund.update({
        where: { id },
        data: {
          approvalStatus: 'REJECTED',
          rejectedReason: reason,
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });
    });
  }
  private async refreshContractPaymentSnapshot(
    tx: Prisma.TransactionClient,
    contractId: number,
  ) {
    const bills = await tx.rentBill.findMany({
      where: { contractId, billCategory: 'RENT' },
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
    await tx.contract.update({
      where: { id: contractId },
      data: { paidThroughDate, nextDueDate },
    });
  }
}
