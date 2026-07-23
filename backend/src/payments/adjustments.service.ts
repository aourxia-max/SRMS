import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { calculateAdjustedBill } from './adjustment-calculator';
import { SubmitAdjustmentDto } from './dto/submit-adjustment.dto';

@Injectable()
export class AdjustmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(rentBillId?: number) {
    return this.prisma.db.billAdjustment.findMany({
      where: rentBillId ? { rentBillId } : undefined,
      include: { rentBill: true },
      orderBy: { id: 'desc' },
    });
  }

  async submit(dto: SubmitAdjustmentDto, user: AuthUser) {
    const amount = new Prisma.Decimal(dto.amount);
    if (!amount.isFinite() || amount.lte(0))
      throw new BadRequestException('调整金额必须大于零');
    const bill = await this.prisma.db.rentBill.findUniqueOrThrow({
      where: { id: dto.rentBillId },
    });
    if (bill.status === 'VOIDED')
      throw new BadRequestException('已作废账单不能提交调整');
    const preview = calculateAdjustedBill({
      ...bill,
      currentAdjustmentAmount: bill.adjustmentAmount,
      direction: dto.direction,
      amount,
    });
    return this.prisma.db.billAdjustment.create({
      data: {
        adjustmentNo: `TZ${Date.now()}${dto.rentBillId}`,
        rentBillId: dto.rentBillId,
        adjustmentType: dto.adjustmentType,
        direction: dto.direction,
        amount,
        beforeAmount: bill.payableAmount,
        afterAmount: preview.payableAmount,
        reason: dto.reason,
        sourcePaymentId: dto.sourcePaymentId,
        submittedBy: user.id,
      },
    });
  }

  async approve(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      const adjustment = await tx.billAdjustment.findUniqueOrThrow({
        where: { id },
        include: { rentBill: true },
      });
      if (adjustment.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待审批调整可以确认');
      if (adjustment.rentBill.status === 'VOIDED')
        throw new BadRequestException('已作废账单不能确认调整');
      const next = calculateAdjustedBill({
        ...adjustment.rentBill,
        currentAdjustmentAmount: adjustment.rentBill.adjustmentAmount,
        direction: adjustment.direction,
        amount: adjustment.amount,
      });
      await tx.rentBill.update({
        where: { id: adjustment.rentBillId },
        data: next,
      });
      const result = await tx.billAdjustment.update({
        where: { id },
        data: {
          approvalStatus: 'APPROVED',
          approvedBy: user.id,
          approvedAt: new Date(),
          beforeAmount: adjustment.rentBill.payableAmount,
          afterAmount: next.payableAmount,
        },
      });
      await this.refreshContractPaymentSnapshot(
        tx,
        adjustment.rentBill.contractId,
      );
      return result;
    });
  }

  async reject(id: number, reason: string, user: AuthUser) {
    const adjustment = await this.prisma.db.billAdjustment.findUniqueOrThrow({
      where: { id },
    });
    if (adjustment.approvalStatus !== 'PENDING')
      throw new BadRequestException('只有待审批调整可以驳回');
    return this.prisma.db.billAdjustment.update({
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
