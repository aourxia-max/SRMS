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
      where: { status: { in: ['DRAFT', 'PENDING', 'REJECTED'] } },
      include: { contract: { include: { room: true } }, items: true },
      orderBy: { id: 'desc' },
    });
  }

  async listRefundPending() {
    return this.prisma.db.checkoutSettlement.findMany({
      where: {
        status: 'APPROVED',
        contract: { status: 'PENDING_CHECKOUT' },
      },
      include: { contract: { include: { room: true } }, items: true },
      orderBy: { id: 'desc' },
    });
  }
  async listCompletedContracts(query: {
    keyword?: string;
    page?: number;
    pageSize?: number;
  }) {
    const requestedPage = Math.trunc(query.page ?? 1);
    const requestedPageSize = Math.trunc(query.pageSize ?? 20);
    const page = Number.isFinite(requestedPage)
      ? Math.max(1, requestedPage)
      : 1;
    const pageSize = Number.isFinite(requestedPageSize)
      ? Math.min(100, Math.max(1, requestedPageSize))
      : 20;
    const keyword = query.keyword?.trim();
    const contract: Prisma.ContractWhereInput = {
      status: 'ENDED',
      ...(keyword
        ? {
            OR: [
              { contractNo: { contains: keyword } },
              { room: { fullHouseNo: { contains: keyword } } },
              {
                members: {
                  some: {
                    isCurrent: true,
                    tenant: { name: { contains: keyword } },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const where: Prisma.CheckoutSettlementWhereInput = {
      status: 'COMPLETED',
      contract,
    };
    const [settlements, total] = await Promise.all([
      this.prisma.db.checkoutSettlement.findMany({
        where,
        include: {
          contract: {
            select: {
              contractNo: true,
              room: { select: { id: true, fullHouseNo: true } },
              members: {
                where: { isCurrent: true, memberRole: 'PRIMARY' },
                select: { tenant: { select: { name: true } } },
                take: 1,
              },
            },
          },
          depositRefunds: {
            where: { approvalStatus: 'APPROVED' },
            select: { id: true, refundAmount: true },
          },
        },
        orderBy: [{ actualCheckoutDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.checkoutSettlement.count({ where }),
    ]);
    const zeroRefundSettlementIds = settlements
      .filter((settlement) => settlement.depositRefunds.length === 0)
      .map((settlement) => settlement.id);
    const approvedRefundIds = settlements.flatMap((settlement) =>
      settlement.depositRefunds.map((refund) => refund.id),
    );
    const historyFilters: Prisma.RoomStatusHistoryWhereInput[] = [];
    if (zeroRefundSettlementIds.length) {
      historyFilters.push({
        businessType: 'CHECKOUT',
        businessId: { in: zeroRefundSettlementIds },
      });
    }
    if (approvedRefundIds.length) {
      historyFilters.push({
        businessType: 'DEPOSIT_REFUND',
        businessId: { in: approvedRefundIds },
      });
    }
    const histories = historyFilters.length
      ? await this.prisma.db.roomStatusHistory.findMany({
          where: {
            toStatus: { not: 'PENDING_CHECKOUT' },
            OR: historyFilters,
          },
          orderBy: { changedAt: 'desc' },
          select: { businessType: true, businessId: true, changedAt: true },
        })
      : [];
    const historyByBusiness = new Map<string, Date>();
    for (const history of histories) {
      const key = `${history.businessType}:${history.businessId}`;
      const current = historyByBusiness.get(key);
      if (!current || history.changedAt > current)
        historyByBusiness.set(key, history.changedAt);
    }

    return {
      items: settlements.map((settlement) => {
        const isZeroRefund = settlement.depositRefunds.length === 0;
        const completionTimes = (
          isZeroRefund
            ? [historyByBusiness.get(`CHECKOUT:${settlement.id}`)]
            : settlement.depositRefunds.map((refund) =>
                historyByBusiness.get(`DEPOSIT_REFUND:${refund.id}`),
              )
        ).filter((value): value is Date => value instanceof Date);
        return {
          settlementId: settlement.id,
          settlementNo: settlement.settlementNo,
          contractNo: settlement.contract.contractNo,
          roomFullHouseNo: settlement.contract.room.fullHouseNo,
          tenantName: settlement.contract.members[0]?.tenant.name ?? '',
          actualCheckoutDate: settlement.actualCheckoutDate,
          refundAmount: this.money(
            settlement.depositRefunds.reduce(
              (sum, refund) => sum.plus(refund.refundAmount),
              new Prisma.Decimal(0),
            ),
          ),
          completedAt:
            completionTimes.length > 0
              ? new Date(
                  Math.max(...completionTimes.map((value) => value.getTime())),
                )
              : null,
        };
      }),
      page,
      pageSize,
      total,
    };
  }
  async getFinanceSnapshot(contractId: number, at = new Date()) {
    const contract = await this.prisma.db.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: { bills: true },
    });
    const [deposit, prepayment] = await Promise.all([
      this.prisma.db.depositTransaction.findFirst({
        where: { contractId },
        orderBy: { id: 'desc' },
      }),
      this.prisma.db.prepaymentTransaction.findFirst({
        where: { contractId },
        orderBy: { id: 'desc' },
      }),
    ]);
    const validBills = contract.bills.filter(
      (bill) => !['VOIDED', 'REFUNDED'].includes(bill.status),
    );
    const currentBills = validBills.filter((bill) => bill.periodStart <= at);
    return {
      depositBalance: this.money(deposit?.balanceAfter ?? 0),
      rentOutstanding: this.money(
        currentBills.reduce(
          (sum, bill) => sum.plus(bill.outstandingAmount),
          new Prisma.Decimal(0),
        ),
      ),
      prepaymentBalance: this.money(prepayment?.balanceAfter ?? 0),
      futureBillCount: validBills.filter((bill) => bill.periodStart > at)
        .length,
    };
  }
  async getDetail(id: number) {
    const settlement =
      await this.prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id },
        include: {
          contract: { include: { room: true } },
          items: { orderBy: { sortOrder: 'asc' } },
          depositRefunds: {
            select: {
              id: true,
              refundNo: true,
              refundAmount: true,
              refundDate: true,
              refundMethod: true,
              approvalStatus: true,
              submittedAt: true,
              approvedAt: true,
              files: { select: { fileAssetId: true } },
            },
          },
        },
      });
    return {
      ...settlement,
      rentReceivable: this.money(settlement.rentReceivable),
      rentReceived: this.money(settlement.rentReceived),
      rentOutstanding: this.money(settlement.rentOutstanding),
      prepaymentBalance: this.money(settlement.prepaymentBalance),
      depositBalance: this.money(settlement.depositBalance),
      depositOffsetAmount: this.money(settlement.depositOffsetAmount),
      otherDeductionAmount: this.money(settlement.otherDeductionAmount),
      depositRefundableAmount: this.money(settlement.depositRefundableAmount),
      prepaymentRefundableAmount: this.money(
        settlement.prepaymentRefundableAmount,
      ),
      finalReceivable: this.money(settlement.finalReceivable),
      items: settlement.items.map((item) => ({
        ...item,
        amount: this.money(item.amount),
      })),
      depositRefunds: settlement.depositRefunds.map((refund) => ({
        ...refund,
        refundAmount: this.money(refund.refundAmount),
      })),
    };
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
      return updated;
    });
  }
  async completeZeroRefund(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
        where: { id },
        include: { contract: true },
      });
      const isZero = [
        settlement.depositRefundableAmount,
        settlement.prepaymentRefundableAmount,
        settlement.finalReceivable,
      ].every((amount) => new Prisma.Decimal(amount).isZero());
      if (
        settlement.status !== 'APPROVED' ||
        settlement.contract.status !== 'PENDING_CHECKOUT' ||
        !isZero
      )
        throw new BadRequestException('零额最终确认条件不满足');

      const claimed = await tx.checkoutSettlement.updateMany({
        where: { id, status: 'APPROVED' },
        data: { status: 'COMPLETED' },
      });
      if (claimed.count !== 1)
        throw new ConflictException('结算单已被最终确认，请刷新后重试');

      await this.completeWithoutDepositRefund(tx, settlement, user);
      return { ...settlement, status: 'COMPLETED' as const };
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
  async cancel(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
        where: { id },
        include: { contract: { include: { room: true } } },
      });
      if (!['DRAFT', 'PENDING', 'REJECTED'].includes(settlement.status))
        throw new BadRequestException(
          '只有草稿、待确认或已驳回的退租结算工单可以取消',
        );
      if (
        settlement.contract.status !== 'PENDING_CHECKOUT' ||
        settlement.contract.room.roomStatus !== 'PENDING_CHECKOUT'
      )
        throw new ConflictException('合同或房源状态已变化，请刷新后重试');

      const initialHistory = await tx.roomStatusHistory.findFirst({
        where: {
          businessType: 'CHECKOUT',
          businessId: id,
          toStatus: 'PENDING_CHECKOUT',
        },
        orderBy: { changedAt: 'asc' },
      });
      if (!initialHistory?.fromStatus)
        throw new ConflictException('缺少发起退租的房态历史，无法安全恢复房态');
      const restoreStatus = initialHistory.fromStatus;

      const claimed = await tx.checkoutSettlement.updateMany({
        where: { id, status: { in: ['DRAFT', 'PENDING', 'REJECTED'] } },
        data: { status: 'CANCELLED' },
      });
      if (claimed.count !== 1)
        throw new ConflictException('退租结算工单状态已变化，请刷新后重试');

      const contractRestored = await tx.contract.updateMany({
        where: { id: settlement.contractId, status: 'PENDING_CHECKOUT' },
        data: { status: 'ACTIVE' },
      });
      if (contractRestored.count !== 1)
        throw new ConflictException('合同状态已变化，请刷新后重试');

      const roomRestored = await tx.room.updateMany({
        where: {
          id: settlement.contract.roomId,
          roomStatus: 'PENDING_CHECKOUT',
        },
        data: {
          roomStatus: restoreStatus,
          statusChangedAt: new Date(),
        },
      });
      if (roomRestored.count !== 1)
        throw new ConflictException('房源状态已变化，请刷新后重试');

      await tx.roomStatusHistory.create({
        data: {
          roomId: settlement.contract.roomId,
          fromStatus: 'PENDING_CHECKOUT',
          toStatus: restoreStatus,
          changeReason: '取消退租结算',
          businessType: 'CHECKOUT',
          businessId: id,
          changedBy: user.id,
        },
      });

      return tx.checkoutSettlement.findUnique({ where: { id } });
    });
  }
  async returnToDraft(id: number, user: AuthUser) {
    void user;
    const settlement =
      await this.prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id },
      });
    if (settlement.status !== 'REJECTED')
      throw new BadRequestException('只有已驳回结算单可以退回草稿');
    return this.prisma.db.checkoutSettlement.update({
      where: { id },
      data: { status: 'DRAFT' },
    });
  }
  private money(value: Prisma.Decimal | string | number) {
    return new Prisma.Decimal(value).toFixed(2);
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
