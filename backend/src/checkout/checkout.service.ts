import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { InitiateCheckoutDto } from './dto/initiate-checkout.dto';
import { SubmitCheckoutSettlementDto } from './dto/submit-checkout-settlement.dto';

@Injectable()
export class CheckoutService {
  constructor(private readonly prisma: PrismaService) {}
  async list() {
    return this.prisma.db.checkoutSettlement.findMany({
      include: { contract: { include: { room: true } }, items: true },
      orderBy: { id: 'desc' },
    });
  }
  async initiate(contractId: number, dto: InitiateCheckoutDto, user: AuthUser) {
    if (!['EMPTY', 'MAINTENANCE', 'DISABLED'].includes(dto.targetRoomStatus))
      throw new BadRequestException('退房后目标房态只能为空置、维修中或停用');
    return this.prisma.db.$transaction(async (tx) => {
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: contractId },
        include: { room: true },
      });
      if (contract.status !== 'ACTIVE')
        throw new BadRequestException('只有履行中的合同可以发起退租');
      const existing = await tx.checkoutSettlement.findFirst({
        where: { contractId, status: { in: ['DRAFT', 'PENDING', 'APPROVED'] } },
      });
      if (existing) throw new ConflictException('该合同已有未完成的退租结算');
      const settlement = await tx.checkoutSettlement.create({
        data: {
          settlementNo: `TZ${Date.now()}${contractId}`,
          contractId,
          checkoutType: dto.checkoutType,
          plannedCheckoutDate: new Date(dto.plannedCheckoutDate),
          handoverDate: new Date(dto.handoverDate),
          inspectionAt: new Date(dto.inspectionAt),
          checkoutReason: dto.checkoutReason,
          targetRoomStatus: dto.targetRoomStatus,
          submittedBy: user.id,
        },
      });
      await tx.contract.update({
        where: { id: contractId },
        data: { status: 'PENDING_CHECKOUT' },
      });
      await tx.room.update({
        where: { id: contract.roomId },
        data: { roomStatus: 'PENDING_CHECKOUT', statusChangedAt: new Date() },
      });
      await tx.roomStatusHistory.create({
        data: {
          roomId: contract.roomId,
          fromStatus: contract.room.roomStatus,
          toStatus: 'PENDING_CHECKOUT',
          changeReason: '发起退租',
          businessType: 'CHECKOUT',
          businessId: settlement.id,
          changedBy: user.id,
        },
      });
      return settlement;
    });
  }
  async submit(id: number, dto: SubmitCheckoutSettlementDto, user: AuthUser) {
    const actual = new Date(dto.actualCheckoutDate);
    return this.prisma.db.$transaction(async (tx) => {
      const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
        where: { id },
        include: { contract: { include: { bills: true } } },
      });
      if (settlement.status !== 'DRAFT')
        throw new BadRequestException('只有草稿结算单可以提交');
      if (settlement.contract.status !== 'PENDING_CHECKOUT')
        throw new BadRequestException('合同当前不处于待退房状态');
      if (actual < settlement.contract.startDate)
        throw new BadRequestException('实际退房日期不能早于合同开始日期');
      for (const item of dto.items) {
        const amount = new Prisma.Decimal(item.amount);
        if (!amount.isFinite() || amount.lte(0))
          throw new BadRequestException('结算项目金额必须大于零');
        if (item.itemType === 'RENT_ARREARS') {
          const bill = settlement.contract.bills.find(
            (value) =>
              value.id === item.rentBillId &&
              !['VOIDED', 'REFUNDED'].includes(value.status),
          );
          if (!bill || amount.gt(bill.outstandingAmount))
            throw new BadRequestException(
              '欠租项目必须关联有效账单，且金额不得超过账单未收',
            );
        } else if (!item.inspectionRecordRef)
          throw new BadRequestException(
            '维修、损坏、清洁及其他扣款必须关联验收记录',
          );
      }
      await tx.checkoutSettlementItem.deleteMany({
        where: { checkoutSettlementId: id },
      });
      return tx.checkoutSettlement.update({
        where: { id },
        data: {
          actualCheckoutDate: actual,
          handoverDate: new Date(dto.handoverDate),
          inspectionAt: new Date(dto.inspectionAt),
          targetRoomStatus: dto.targetRoomStatus,
          remark: dto.remark,
          status: 'PENDING',
          submittedBy: user.id,
          submittedAt: new Date(),
          items: {
            create: dto.items.map((item, index) => ({
              ...item,
              amount: new Prisma.Decimal(item.amount),
              sortOrder: index,
            })),
          },
        },
        include: { items: true },
      });
    });
  }
  async approve(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
        where: { id },
        include: {
          items: true,
          contract: {
            include: { room: true, bills: { orderBy: { periodSeq: 'asc' } } },
          },
        },
      });
      if (settlement.status !== 'PENDING')
        throw new BadRequestException('只有待确认结算单可以确认');
      if (!settlement.actualCheckoutDate)
        throw new BadRequestException('结算单缺少实际退房日期');
      const eligibleBills = settlement.contract.bills.filter(
        (bill) =>
          bill.periodStart <= settlement.actualCheckoutDate! &&
          !['VOIDED', 'REFUNDED'].includes(bill.status),
      );
      const outstanding = eligibleBills.reduce(
        (sum, bill) => sum.plus(bill.outstandingAmount),
        new Prisma.Decimal(0),
      );
      const arrearsItems = settlement.items.filter(
        (item) => item.itemType === 'RENT_ARREARS',
      );
      const declaredArrears = arrearsItems.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );
      if (!declaredArrears.equals(outstanding))
        throw new BadRequestException(
          '欠租结算项目合计必须等于实际退房日前有效账单的未收金额',
        );
      const otherCharges = settlement.items
        .filter((item) => item.itemType !== 'RENT_ARREARS')
        .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
      const latest = await tx.depositTransaction.findFirst({
        where: { contractId: settlement.contractId },
        orderBy: { id: 'desc' },
      });
      let depositBalance = new Prisma.Decimal(latest?.balanceAfter ?? 0);
      const initialDepositBalance = depositBalance;
      let depositOffsetAmount = new Prisma.Decimal(0);
      for (const item of arrearsItems) {
        const bill = eligibleBills.find(
          (value) => value.id === item.rentBillId,
        )!;
        const offset = Prisma.Decimal.min(
          depositBalance,
          new Prisma.Decimal(item.amount),
        );
        if (offset.lte(0)) continue;
        depositBalance = depositBalance.minus(offset).toDecimalPlaces(2);
        depositOffsetAmount = depositOffsetAmount.plus(offset);
        const receivedAmount = new Prisma.Decimal(bill.receivedAmount)
          .plus(offset)
          .toDecimalPlaces(2);
        await tx.rentBill.update({
          where: { id: bill.id },
          data: {
            receivedAmount,
            outstandingAmount: new Prisma.Decimal(bill.payableAmount)
              .minus(receivedAmount)
              .toDecimalPlaces(2),
            status: receivedAmount.equals(bill.payableAmount)
              ? 'PAID'
              : 'PARTIAL',
          },
        });
        await tx.depositTransaction.create({
          data: {
            contractId: settlement.contractId,
            transactionNo: `YJZK${Date.now()}${bill.id}`,
            transactionType: 'OFFSET_ARREARS',
            amount: offset,
            balanceAfter: depositBalance,
            rentBillId: bill.id,
            checkoutSettlementId: settlement.id,
            reason: `退租结算抵扣欠租账单 ${bill.billNo}`,
          },
        });
      }
      const otherDeductionAmount = Prisma.Decimal.min(
        depositBalance,
        otherCharges,
      );
      if (otherDeductionAmount.gt(0)) {
        depositBalance = depositBalance
          .minus(otherDeductionAmount)
          .toDecimalPlaces(2);
        await tx.depositTransaction.create({
          data: {
            contractId: settlement.contractId,
            transactionNo: `YJJS${Date.now()}${settlement.id}`,
            transactionType: 'OFFSET_SETTLEMENT',
            amount: otherDeductionAmount,
            balanceAfter: depositBalance,
            checkoutSettlementId: settlement.id,
            reason: '退租结算抵扣验房扣款',
          },
        });
      }
      const finalReceivable = Prisma.Decimal.max(
        new Prisma.Decimal(0),
        outstanding.plus(otherCharges).minus(initialDepositBalance),
      ).toDecimalPlaces(2);
      const prepayment = await tx.prepaymentTransaction.findFirst({
        where: { contractId: settlement.contractId },
        orderBy: { id: 'desc' },
      });
      await tx.rentBill.updateMany({
        where: {
          contractId: settlement.contractId,
          periodStart: { gt: settlement.actualCheckoutDate },
          receivedAmount: 0,
          status: { notIn: ['VOIDED', 'REFUNDED'] },
        },
        data: { status: 'VOIDED', outstandingAmount: 0 },
      });
      const updated = await tx.checkoutSettlement.update({
        where: { id },
        data: {
          rentReceivable: eligibleBills.reduce(
            (sum, bill) => sum.plus(bill.payableAmount),
            new Prisma.Decimal(0),
          ),
          rentReceived: eligibleBills.reduce(
            (sum, bill) => sum.plus(bill.receivedAmount),
            new Prisma.Decimal(0),
          ),
          rentOutstanding: outstanding,
          prepaymentBalance: new Prisma.Decimal(prepayment?.balanceAfter ?? 0),
          depositBalance: initialDepositBalance,
          depositOffsetAmount,
          otherDeductionAmount,
          depositRefundableAmount: depositBalance,
          prepaymentRefundableAmount: new Prisma.Decimal(
            prepayment?.balanceAfter ?? 0,
          ),
          finalReceivable,
          status: 'APPROVED',
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });
      if (
        depositBalance.isZero() &&
        finalReceivable.isZero() &&
        new Prisma.Decimal(prepayment?.balanceAfter ?? 0).isZero()
      )
        await this.completeWithoutDepositRefund(tx, updated, user);
      return updated;
    });
  }
  async reject(id: number, reason: string, user: AuthUser) {
    const settlement =
      await this.prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id },
      });
    if (settlement.status !== 'PENDING')
      throw new BadRequestException('只有待确认结算单可以驳回');
    return this.prisma.db.checkoutSettlement.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedReason: reason,
        approvedBy: user.id,
        approvedAt: new Date(),
      },
    });
  }
  private async completeWithoutDepositRefund(
    tx: Prisma.TransactionClient,
    settlement: {
      id: number;
      contractId: number;
      targetRoomStatus: import('@prisma/client').RoomStatus;
    },
    user: AuthUser,
  ) {
    const contract = await tx.contract.findUniqueOrThrow({
      where: { id: settlement.contractId },
    });
    await tx.contract.update({
      where: { id: settlement.contractId },
      data: { status: 'ENDED' },
    });
    await tx.room.update({
      where: { id: contract.roomId },
      data: {
        roomStatus: settlement.targetRoomStatus,
        statusChangedAt: new Date(),
      },
    });
    await tx.roomStatusHistory.create({
      data: {
        roomId: contract.roomId,
        fromStatus: 'PENDING_CHECKOUT',
        toStatus: settlement.targetRoomStatus,
        changeReason: '退租结算完成',
        businessType: 'CHECKOUT',
        businessId: settlement.id,
        changedBy: user.id,
      },
    });
    await tx.checkoutSettlement.update({
      where: { id: settlement.id },
      data: { status: 'COMPLETED' },
    });
  }
}
