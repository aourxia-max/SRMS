import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitVoidRequestDto } from './dto/submit-void-request.dto';
import { calculateAdjustedBill } from './adjustment-calculator';
import { reopenCheckoutSupplementalBalance } from './checkout-supplemental-balance';

@Injectable()
export class VoidRequestsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(paymentId?: number) {
    return this.prisma.db.paymentVoidRequest.findMany({
      where: paymentId ? { paymentId } : undefined,
      orderBy: { id: 'desc' },
    });
  }
  async submit(dto: SubmitVoidRequestDto, user: AuthUser) {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('当前角色不能提交作废申请');
    const payment = await this.prisma.db.payment.findUniqueOrThrow({
      where: { id: dto.paymentId },
    });
    if (payment.status !== 'CONFIRMED')
      throw new BadRequestException('只有未退款的已确认收款可以申请作废');
    const pending = await this.prisma.db.paymentVoidRequest.findFirst({
      where: { paymentId: dto.paymentId, approvalStatus: 'PENDING' },
    });
    if (pending) throw new ConflictException('该收款已有待审批作废申请');
    return this.prisma.db.paymentVoidRequest.create({
      data: {
        requestNo: `ZF${Date.now()}${payment.id}`,
        paymentId: payment.id,
        reason: dto.reason,
        submittedBy: user.id,
      },
    });
  }
  async approve(id: number, user: AuthUser) {
    if (user.role !== UserRole.SUPER_ADMIN)
      throw new ForbiddenException('只有超级管理员可以确认作废');
    return this.prisma.db.$transaction(async (tx) => {
      const identity = await tx.paymentVoidRequest.findUniqueOrThrow({
        where: { id },
        select: { paymentId: true, payment: { select: { contractId: true } } },
      });
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${identity.payment.contractId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM payments WHERE id = ${identity.paymentId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM payment_void_requests WHERE id = ${id} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM payment_allocations WHERE payment_id = ${identity.paymentId} ORDER BY id FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rent_bills WHERE contract_id = ${identity.payment.contractId} ORDER BY id FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM prepayment_transactions WHERE contract_id = ${identity.payment.contractId} ORDER BY id FOR UPDATE`,
      );
      const request = await tx.paymentVoidRequest.findUniqueOrThrow({
        where: { id },
        include: {
          payment: {
            include: {
              allocations: { include: { rentBill: true } },
              prepaymentTransactions: true,
              adjustments: true,
            },
          },
        },
      });
      if (request.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待审批作废申请可以确认');
      if (request.payment.status !== 'CONFIRMED')
        throw new BadRequestException('原收款当前不能作废');

      const billStates = new Map(
        request.payment.allocations.map((allocation) => {
          const bill = allocation.rentBill;
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
      let reversedPaymentAmount = new Prisma.Decimal(0);
      for (const adjustment of request.payment.adjustments.filter(
        (item) =>
          ['PENDING', 'APPROVED'].includes(item.approvalStatus) &&
          !item.reversedByAdjustmentId,
      )) {
        if (adjustment.approvalStatus === 'PENDING') {
          await tx.billAdjustment.update({
            where: { id: adjustment.id },
            data: { approvalStatus: 'CANCELLED' },
          });
          continue;
        }
        const bill = billStates.get(adjustment.rentBillId);
        if (!bill) continue;
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
            reason: `作废收款 ${request.payment.receiptNo} 撤销优惠 ${adjustment.id}`,
            sourcePaymentId: request.paymentId,
            approvalStatus: 'APPROVED',
            submittedBy: user.id,
            approvedBy: user.id,
            approvedAt: new Date(),
          },
        });
        bill.adjustmentAmount = next.adjustmentAmount;
        bill.payableAmount = next.payableAmount;
        bill.outstandingAmount = next.outstandingAmount;
        await tx.billAdjustment.update({
          where: { id: adjustment.id },
          data: { reversedByAdjustmentId: reversal.id },
        });
      }
      for (const allocation of request.payment.allocations) {
        const amount = new Prisma.Decimal(allocation.allocatedAmount).minus(
          allocation.reversedAmount,
        );
        if (amount.lte(0)) continue;
        reversedPaymentAmount = reversedPaymentAmount.plus(amount);
        await tx.paymentAllocation.update({
          where: { id: allocation.id },
          data: {
            reversedAmount: new Prisma.Decimal(allocation.reversedAmount).plus(
              amount,
            ),
          },
        });
        const bill = billStates.get(allocation.rentBill.id)!;
        const receivedAmount = bill.receivedAmount
          .minus(amount)
          .toDecimalPlaces(2);
        await tx.rentBill.update({
          where: { id: bill.id },
          data: {
            adjustmentAmount: bill.adjustmentAmount,
            payableAmount: bill.payableAmount,
            receivedAmount,
            outstandingAmount: bill.payableAmount
              .minus(receivedAmount)
              .toDecimalPlaces(2),
            status: receivedAmount.gt(0) ? 'PARTIAL' : 'PENDING',
          },
        });
      }
      const latest = await tx.prepaymentTransaction.findFirst({
        where: { contractId: request.payment.contractId },
        orderBy: { id: 'desc' },
      });
      let balance = new Prisma.Decimal(latest?.balanceAfter ?? 0);
      const activePrepayment = request.payment.prepaymentTransactions.reduce(
        (sum, item) =>
          item.transactionType === 'CREDIT_RECEIPT'
            ? sum.plus(item.amount)
            : item.transactionType === 'REVERSAL'
              ? sum.minus(item.amount)
              : sum,
        new Prisma.Decimal(0),
      );
      if (activePrepayment.gt(0)) {
        if (balance.lt(activePrepayment))
          throw new BadRequestException('预收款余额不足，不能作废该收款');
        balance = balance.minus(activePrepayment).toDecimalPlaces(2);
        await tx.prepaymentTransaction.create({
          data: {
            contractId: request.payment.contractId,
            transactionNo: `YSREV${Date.now()}${request.payment.id}`,
            transactionType: 'REVERSAL',
            amount: activePrepayment,
            balanceAfter: balance,
            paymentId: request.paymentId,
            reason: `作废收款 ${request.payment.receiptNo} 的预收款入账`,
          },
        });
      }
      await tx.payment.update({
        where: { id: request.paymentId },
        data: {
          status: 'VOIDED',
          voidReason: request.reason,
          voidedBy: user.id,
          voidedAt: new Date(),
        },
      });
      await reopenCheckoutSupplementalBalance(
        tx,
        request.payment.contractId,
        request.payment.paymentCategory,
        reversedPaymentAmount,
      );
      await tx.securityAuditLog.create({
        data: {
          eventType: 'PAYMENT_VOID_APPROVED',
          entityType: 'PAYMENT_VOID_REQUEST',
          entityId: request.id,
          operatorId: user.id,
          reason: request.reason,
          eventData: {
            paymentId: request.paymentId,
            receiptNo: request.payment.receiptNo,
          },
        },
      });
      await this.refreshContractPaymentSnapshot(tx, request.payment.contractId);
      return tx.paymentVoidRequest.update({
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
      throw new ForbiddenException('只有超级管理员可以驳回作废申请');
    const request = await this.prisma.db.paymentVoidRequest.findUniqueOrThrow({
      where: { id },
    });
    if (request.approvalStatus !== 'PENDING')
      throw new BadRequestException('只有待审批作废申请可以驳回');
    return this.prisma.db.paymentVoidRequest.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        rejectedReason: reason,
        approvedBy: user.id,
        approvedAt: new Date(),
      },
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
