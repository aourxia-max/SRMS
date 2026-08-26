import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { calculateAdjustedBill } from './adjustment-calculator';
import { assertRentBillNotProtectedByCheckout } from './checkout-supplemental-balance';
import { SubmitAdjustmentDto } from './dto/submit-adjustment.dto';
import { assertContractNotVoided } from '../contracts/contract-operability';

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
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT contract_id FROM rent_bills WHERE id = ${dto.rentBillId}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rent_bills WHERE id = ${dto.rentBillId} FOR UPDATE`,
      );
      const bill = await tx.rentBill.findUniqueOrThrow({
        where: { id: dto.rentBillId },
        include: { contract: true },
      });
      if (bill.billCategory === 'CHECKOUT_SUPPLEMENTAL')
        throw new BadRequestException('退租补收账单不能优惠、减免或调整');
      await assertRentBillNotProtectedByCheckout(tx, bill.id);
      if (bill.status === 'VOIDED')
        throw new BadRequestException('已作废账单不能提交调整');
      assertContractNotVoided(bill.contract.status, '提交账单调整');
      const preview = calculateAdjustedBill({
        ...bill,
        currentAdjustmentAmount: bill.adjustmentAmount,
        direction: dto.direction,
        amount,
      });
      return tx.billAdjustment.create({
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
    });
  }

  async approve(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT rb.contract_id FROM rent_bills rb JOIN bill_adjustments ba ON ba.rent_bill_id = rb.id WHERE ba.id = ${id}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rent_bills WHERE id = (SELECT rent_bill_id FROM bill_adjustments WHERE id = ${id}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM bill_adjustments WHERE id = ${id} FOR UPDATE`,
      );
      const adjustment = await tx.billAdjustment.findUniqueOrThrow({
        where: { id },
        include: { rentBill: { include: { contract: true } } },
      });
      if (adjustment.rentBill.billCategory === 'CHECKOUT_SUPPLEMENTAL')
        throw new BadRequestException('退租补收账单不能优惠、减免或调整');
      await assertRentBillNotProtectedByCheckout(tx, adjustment.rentBillId);
      if (adjustment.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待审批调整可以确认');
      if (adjustment.rentBill.status === 'VOIDED')
        throw new BadRequestException('已作废账单不能确认调整');
      assertContractNotVoided(
        adjustment.rentBill.contract.status,
        '确认账单调整',
      );
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
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT rb.contract_id FROM rent_bills rb JOIN bill_adjustments ba ON ba.rent_bill_id = rb.id WHERE ba.id = ${id}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rent_bills WHERE id = (SELECT rent_bill_id FROM bill_adjustments WHERE id = ${id}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM bill_adjustments WHERE id = ${id} FOR UPDATE`,
      );
      const adjustment = await tx.billAdjustment.findUniqueOrThrow({
        where: { id },
        include: { rentBill: { include: { contract: true } } },
      });
      if (adjustment.approvalStatus !== 'PENDING')
        throw new BadRequestException('只有待审批调整可以驳回');
      assertContractNotVoided(
        adjustment.rentBill.contract.status,
        '驳回账单调整',
      );
      return tx.billAdjustment.update({
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
      if (bill.billCategory === 'CHECKOUT_SUPPLEMENTAL')
        throw new BadRequestException('退租补收账单不能优惠、减免或调整');
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
