import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitVoidRequestDto } from './dto/submit-void-request.dto';

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
    return this.prisma.db.$transaction(async (tx) => {
      const request = await tx.paymentVoidRequest.findUniqueOrThrow({
        where: { id },
        include: {
          payment: {
            include: {
              allocations: { include: { rentBill: true } },
              prepaymentTransactions: true,
            },
          },
        },
      });
      if (request.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待审批作废申请可以确认');
      if (request.payment.status !== 'CONFIRMED')
        throw new BadRequestException('原收款当前不能作废');
      for (const allocation of request.payment.allocations) {
        const amount = new Prisma.Decimal(allocation.allocatedAmount).minus(
          allocation.reversedAmount,
        );
        if (amount.lte(0)) continue;
        await tx.paymentAllocation.update({
          where: { id: allocation.id },
          data: {
            reversedAmount: new Prisma.Decimal(allocation.reversedAmount).plus(
              amount,
            ),
          },
        });
        const bill = allocation.rentBill;
        const receivedAmount = new Prisma.Decimal(bill.receivedAmount)
          .minus(amount)
          .toDecimalPlaces(2);
        await tx.rentBill.update({
          where: { id: bill.id },
          data: {
            receivedAmount,
            outstandingAmount: new Prisma.Decimal(bill.payableAmount)
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
      for (const credit of request.payment.prepaymentTransactions.filter(
        (item) => item.transactionType === 'CREDIT_RECEIPT',
      )) {
        if (balance.lt(credit.amount))
          throw new BadRequestException('预收款余额不足，不能作废该收款');
        balance = balance.minus(credit.amount).toDecimalPlaces(2);
        await tx.prepaymentTransaction.create({
          data: {
            contractId: request.payment.contractId,
            transactionNo: `YSREV${Date.now()}${credit.id}`,
            transactionType: 'REVERSAL',
            amount: credit.amount,
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
