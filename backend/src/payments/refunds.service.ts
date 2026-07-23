import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitRefundDto } from './dto/submit-refund.dto';

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
    const payment = await this.prisma.db.payment.findUniqueOrThrow({
      where: { id: dto.paymentId },
      include: { allocations: true },
    });
    if (!['CONFIRMED', 'PARTIALLY_REFUNDED'].includes(payment.status))
      throw new BadRequestException('该收款当前不能退款');
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
    return this.prisma.db.paymentRefund.create({
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
  }
  async approve(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      const refund = await tx.paymentRefund.findUniqueOrThrow({
        where: { id },
        include: {
          allocations: {
            include: { paymentAllocation: { include: { rentBill: true } } },
          },
          payment: true,
        },
      });
      if (refund.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待审批退款可以确认');
      if (!['CONFIRMED', 'PARTIALLY_REFUNDED'].includes(refund.payment.status))
        throw new BadRequestException('原收款当前不能退款');
      for (const item of refund.allocations) {
        const allocation = item.paymentAllocation;
        const remaining = new Prisma.Decimal(allocation.allocatedAmount).minus(
          allocation.reversedAmount,
        );
        if (item.reversedAmount.gt(remaining))
          throw new BadRequestException('退款金额超过当前可回退余额');
        await tx.paymentAllocation.update({
          where: { id: allocation.id },
          data: {
            reversedAmount: new Prisma.Decimal(allocation.reversedAmount).plus(
              item.reversedAmount,
            ),
          },
        });
        const bill = allocation.rentBill;
        const receivedAmount = new Prisma.Decimal(bill.receivedAmount)
          .minus(item.reversedAmount)
          .toDecimalPlaces(2);
        const outstandingAmount = new Prisma.Decimal(bill.payableAmount)
          .minus(receivedAmount)
          .toDecimalPlaces(2);
        await tx.rentBill.update({
          where: { id: bill.id },
          data: {
            receivedAmount,
            outstandingAmount,
            status: receivedAmount.gt(0) ? 'PARTIAL' : 'PENDING',
          },
        });
      }
      const previous = await tx.paymentRefund.aggregate({
        where: { paymentId: refund.paymentId, approvalStatus: 'APPROVED' },
        _sum: { refundAmount: true },
      });
      const refunded = new Prisma.Decimal(previous._sum.refundAmount ?? 0).plus(
        refund.refundAmount,
      );
      await tx.payment.update({
        where: { id: refund.paymentId },
        data: {
          status: refunded.gte(refund.payment.amount)
            ? 'FULLY_REFUNDED'
            : 'PARTIALLY_REFUNDED',
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
    const refund = await this.prisma.db.paymentRefund.findUniqueOrThrow({
      where: { id },
    });
    if (refund.approvalStatus !== 'PENDING')
      throw new BadRequestException('只有待审批退款可以驳回');
    return this.prisma.db.paymentRefund.update({
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
    await tx.contract.update({
      where: { id: contractId },
      data: { paidThroughDate, nextDueDate },
    });
  }
}
