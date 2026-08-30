import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { calculateCheckoutAmounts } from './checkout-calculation';
import {
  assertCheckoutRentRefundReservationMatches,
  planCheckoutRentRefund,
  releaseCheckoutRentRefund,
  reserveCheckoutRentRefund,
} from './checkout-rent-refund-reservations';
import { PrismaService } from '../prisma/prisma.service';
import { assertNoPendingCheckoutSupplementalReversal } from '../payments/checkout-supplemental-balance';
import { InitiateCheckoutDto } from './dto/initiate-checkout.dto';
import {
  CHECKOUT_SETTLEMENT_AMOUNT_MESSAGE,
  CHECKOUT_SETTLEMENT_AMOUNT_PATTERN,
  SubmitCheckoutSettlementDto,
} from './dto/submit-checkout-settlement.dto';
import { lockRoomAndTargetContract } from '../contracts/contract-room-locks';
import { assertContractNotVoided } from '../contracts/contract-operability';

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
      (bill) =>
        bill.billCategory === 'RENT' &&
        !['VOIDED', 'REFUNDED'].includes(bill.status),
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
          items: {
            orderBy: { sortOrder: 'asc' },
            include: {
              checkoutRentRefundAllocations: {
                select: {
                  id: true,
                  paymentAllocationId: true,
                  reservedAmount: true,
                  status: true,
                  rentBill: {
                    select: {
                      billNo: true,
                      periodStart: true,
                      periodEnd: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
    const refundApprovalStatus =
      settlement.status === 'APPROVED'
        ? 'PENDING'
        : settlement.status === 'COMPLETED'
          ? 'APPROVED'
          : undefined;
    const depositRefund = refundApprovalStatus
      ? await this.prisma.db.depositRefund.findFirst({
          where: {
            checkoutSettlementId: settlement.id,
            approvalStatus: refundApprovalStatus,
          },
          orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            refundNo: true,
            refundAmount: true,
            refundDate: true,
            refundMethod: true,
            approvalStatus: true,
            submittedAt: true,
            approvedAt: true,
            files: {
              select: {
                fileAssetId: true,
                fileAsset: { select: { originalName: true, mimeType: true } },
              },
            },
          },
        })
      : null;
    const depositRefunds = depositRefund ? [depositRefund] : [];
    const visibleReservationStatus =
      settlement.status === 'APPROVED' ? 'RESERVED' : 'APPLIED';
    const rentRefundAllocations = settlement.items.flatMap((item) =>
      item.checkoutRentRefundAllocations
        .filter((allocation) => allocation.status === visibleReservationStatus)
        .map((allocation) => ({
          paymentAllocationId: allocation.paymentAllocationId,
          status: allocation.status,
          billNo: allocation.rentBill.billNo,
          periodStart: allocation.rentBill.periodStart
            .toISOString()
            .slice(0, 10),
          periodEnd: allocation.rentBill.periodEnd.toISOString().slice(0, 10),
          amount: this.money(allocation.reservedAmount),
        })),
    );
    const totalRefundAmount = new Prisma.Decimal(
      settlement.depositRefundableAmount,
    )
      .plus(settlement.prepaymentRefundableAmount)
      .plus(settlement.rentRefundableAmount)
      .toDecimalPlaces(2);

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
      rentRefundableAmount: this.money(settlement.rentRefundableAmount),
      totalRefundAmount: this.money(totalRefundAmount),
      rentRefundAllocations,
      finalReceivable: this.money(settlement.finalReceivable),
      supplementalRequired: settlement.supplementalRequired,
      supplementalArrearsAmount: this.money(
        settlement.supplementalArrearsAmount,
      ),
      supplementalInspectionAmount: this.money(
        settlement.supplementalInspectionAmount,
      ),
      supplementalReceivedAmount: this.money(
        settlement.supplementalReceivedAmount,
      ),
      supplementalOutstandingAmount: this.money(
        settlement.supplementalOutstandingAmount,
      ),
      supplementalCollectedAt: settlement.supplementalCollectedAt,
      items: settlement.items
        .filter(
          (item) =>
            !(
              item.itemType === 'RENT_REFUND' &&
              new Prisma.Decimal(settlement.rentRefundableAmount).isZero() &&
              item.checkoutRentRefundAllocations.length === 0
            ),
        )
        .map(({ checkoutRentRefundAllocations, ...item }) => {
          void checkoutRentRefundAllocations;
          return {
            ...item,
            amount: this.money(item.amount),
          };
        }),
      depositRefunds: depositRefunds.map(({ files, ...refund }) => ({
        ...refund,
        refundAmount: this.money(refund.refundAmount),
        files: files.map(({ fileAssetId, fileAsset }) => ({
          fileAssetId,
          originalName: fileAsset.originalName,
          mimeType: fileAsset.mimeType,
        })),
      })),
    };
  }
  async preview(id: number, dto: SubmitCheckoutSettlementDto) {
    const settlement =
      await this.prisma.db.checkoutSettlement.findUniqueOrThrow({
        where: { id },
        include: { contract: { include: { bills: true } } },
      });
    if (!['DRAFT', 'PENDING', 'REJECTED'].includes(settlement.status))
      throw new BadRequestException('当前退租结算单不能预估金额');
    if (settlement.contract.status !== 'PENDING_CHECKOUT')
      throw new BadRequestException('合同当前不处于待退房状态');
    const actual = new Date(dto.actualCheckoutDate);
    if (
      settlement.originContractStatus !== 'PENDING_START' &&
      actual < settlement.contract.startDate
    )
      throw new BadRequestException('实际退房日期不能早于合同开始日期');
    const arrearsBillIds = dto.items
      .filter((item) => item.itemType === 'RENT_ARREARS')
      .map((item) => item.rentBillId);
    if (new Set(arrearsBillIds).size !== arrearsBillIds.length)
      throw new BadRequestException('同一欠租账单不能重复添加');
    if (dto.items.filter((item) => item.itemType === 'RENT_REFUND').length > 1)
      throw new BadRequestException('同一退租结算只能添加一项退还租金');
    for (const item of dto.items) {
      if (
        typeof item.amount !== 'string' ||
        !CHECKOUT_SETTLEMENT_AMOUNT_PATTERN.test(item.amount)
      )
        throw new BadRequestException(CHECKOUT_SETTLEMENT_AMOUNT_MESSAGE);
      const itemAmount = new Prisma.Decimal(item.amount);
      if (!itemAmount.isFinite() || itemAmount.lte(0))
        throw new BadRequestException('结算项目金额必须大于零');
      if (
        item.itemType === 'RENT_REFUND' &&
        (item.rentBillId !== undefined ||
          item.inspectionRecordRef !== undefined)
      )
        throw new BadRequestException('退还租金不能关联租金账单或验房记录');
      if (
        !['RENT_ARREARS', 'RENT_REFUND'].includes(item.itemType) &&
        !item.inspectionRecordRef
      )
        throw new BadRequestException(
          '维修、损坏、清洁及其他扣款必须关联验收记录',
        );
    }
    const eligibleBills = settlement.contract.bills.filter(
      (bill) =>
        bill.periodStart <= actual &&
        !['VOIDED', 'REFUNDED'].includes(bill.status),
    );
    const rentOutstanding = eligibleBills.reduce(
      (sum, bill) => sum.plus(bill.outstandingAmount),
      new Prisma.Decimal(0),
    );
    const rentRefundItem = dto.items.find(
      (item) => item.itemType === 'RENT_REFUND',
    );
    const otherCharges = dto.items
      .filter(
        (item) => !['RENT_ARREARS', 'RENT_REFUND'].includes(item.itemType),
      )
      .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    const [deposit, prepayment, rentRefundPlan] = await Promise.all([
      this.prisma.db.depositTransaction.findFirst({
        where: { contractId: settlement.contractId },
        orderBy: { id: 'desc' },
      }),
      this.prisma.db.prepaymentTransaction.findFirst({
        where: { contractId: settlement.contractId },
        orderBy: { id: 'desc' },
      }),
      planCheckoutRentRefund(this.prisma.db, {
        contractId: settlement.contractId,
        currentSettlementId: settlement.id,
        actualCheckoutDate: actual,
        requestedAmount: rentRefundItem?.amount ?? 0,
      }),
    ]);
    const { plan, candidates } = rentRefundPlan;
    const amounts = calculateCheckoutAmounts({
      depositBalance: deposit?.balanceAfter ?? 0,
      prepaymentBalance: prepayment?.balanceAfter ?? 0,
      rentOutstanding,
      otherCharges,
      rentRefundAmount: rentRefundItem?.amount ?? 0,
    });
    return {
      ...amounts,
      maxRentRefundAmount: plan.maxRefundableAmount,
      rentRefundAllocations: plan.allocations.map((allocation) => ({
        ...allocation,
        billNo: candidates.find(
          (candidate) =>
            candidate.paymentAllocationId === allocation.paymentAllocationId,
        )!.billNo,
        receiptNo: candidates.find(
          (candidate) =>
            candidate.paymentAllocationId === allocation.paymentAllocationId,
        )!.receiptNo,
      })),
    };
  }

  async initiate(contractId: number, dto: InitiateCheckoutDto, user: AuthUser) {
    if (!['EMPTY', 'MAINTENANCE', 'DISABLED'].includes(dto.targetRoomStatus))
      throw new BadRequestException('退房后目标房态只能为空置、维修中或停用');
    return this.prisma.db.$transaction(
      async (tx) => {
        await lockRoomAndTargetContract(tx, contractId);
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM checkout_settlements WHERE contract_id = ${contractId} ORDER BY id FOR UPDATE`,
        );
        const contract = await tx.contract.findUniqueOrThrow({
          where: { id: contractId },
          include: { room: true },
        });
        assertContractNotVoided(contract.status, '发起退租');
        if (!['PENDING_START', 'ACTIVE'].includes(contract.status))
          throw new BadRequestException('只有待开始或履行中的合同可以发起退租');
        const existing = await tx.checkoutSettlement.findFirst({
          where: {
            contractId,
            status: { in: ['DRAFT', 'PENDING', 'APPROVED'] },
          },
        });
        if (existing) throw new ConflictException('该合同已有未完成的退租结算');
        const settlement = await tx.checkoutSettlement.create({
          data: {
            settlementNo: `TZ${Date.now()}${contractId}`,
            contractId,
            checkoutType: dto.checkoutType,
            originContractStatus: contract.status,
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
  async submit(id: number, dto: SubmitCheckoutSettlementDto, user: AuthUser) {
    const actual = new Date(dto.actualCheckoutDate);
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT contract_id FROM checkout_settlements WHERE id = ${id}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM checkout_settlements WHERE id = ${id} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rent_bills WHERE contract_id = (SELECT contract_id FROM checkout_settlements WHERE id = ${id}) ORDER BY id FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM checkout_settlement_items WHERE checkout_settlement_id = ${id} ORDER BY id FOR UPDATE`,
      );
      const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
        where: { id },
        include: { contract: { include: { bills: true } }, items: true },
      });
      if (settlement.status !== 'DRAFT')
        throw new BadRequestException('只有草稿结算单可以提交');
      assertContractNotVoided(settlement.contract.status, '提交退租结算');
      if (settlement.contract.status !== 'PENDING_CHECKOUT')
        throw new BadRequestException('合同当前不处于待退房状态');
      if (
        settlement.originContractStatus !== 'PENDING_START' &&
        actual < settlement.contract.startDate
      )
        throw new BadRequestException('实际退房日期不能早于合同开始日期');
      const arrearsBillIds = dto.items
        .filter((item) => item.itemType === 'RENT_ARREARS')
        .map((item) => item.rentBillId);
      if (new Set(arrearsBillIds).size !== arrearsBillIds.length)
        throw new BadRequestException('同一欠租账单不能重复添加');
      if (
        dto.items.filter((item) => item.itemType === 'RENT_REFUND').length > 1
      )
        throw new BadRequestException('同一退租结算只能添加一项退还租金');
      for (const item of dto.items) {
        if (
          typeof item.amount !== 'string' ||
          !CHECKOUT_SETTLEMENT_AMOUNT_PATTERN.test(item.amount)
        )
          throw new BadRequestException(CHECKOUT_SETTLEMENT_AMOUNT_MESSAGE);
        const amount = new Prisma.Decimal(item.amount);
        if (!amount.isFinite() || amount.lte(0))
          throw new BadRequestException('结算项目金额必须大于零');
        if (
          item.itemType === 'RENT_REFUND' &&
          (item.rentBillId !== undefined ||
            item.inspectionRecordRef !== undefined)
        )
          throw new BadRequestException('退还租金不能关联租金账单或验房记录');
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
        } else if (item.itemType !== 'RENT_REFUND' && !item.inspectionRecordRef)
          throw new BadRequestException(
            '维修、损坏、清洁及其他扣款必须关联验收记录',
          );
      }
      const rentRefundItem = dto.items.find(
        (item) => item.itemType === 'RENT_REFUND',
      );
      const existingRentRefundItem = settlement.items.find(
        (item) => item.itemType === 'RENT_REFUND',
      );
      await tx.checkoutSettlementItem.deleteMany({
        where: {
          checkoutSettlementId: id,
          ...(existingRentRefundItem
            ? { itemType: { not: 'RENT_REFUND' as const } }
            : {}),
        },
      });
      if (existingRentRefundItem && rentRefundItem) {
        await tx.checkoutSettlementItem.update({
          where: { id: existingRentRefundItem.id },
          data: {
            amount: new Prisma.Decimal(rentRefundItem.amount),
            rentBillId: null,
            inspectionRecordRef: null,
            description: rentRefundItem.description,
            evidenceRequired: rentRefundItem.evidenceRequired ?? false,
            confirmedByTenant: rentRefundItem.confirmedByTenant ?? false,
            sortOrder: dto.items.indexOf(rentRefundItem),
          },
        });
      }
      const itemsToCreate = existingRentRefundItem
        ? dto.items.filter((item) => item.itemType !== 'RENT_REFUND')
        : dto.items;
      const updated = await tx.checkoutSettlement.update({
        where: { id },
        data: {
          actualCheckoutDate: actual,
          handoverDate: new Date(dto.handoverDate),
          inspectionAt: new Date(dto.inspectionAt),
          targetRoomStatus: dto.targetRoomStatus,
          remark: dto.remark,
          rentRefundableAmount: new Prisma.Decimal(rentRefundItem?.amount ?? 0),
          status: 'PENDING',
          submittedBy: user.id,
          submittedAt: new Date(),
          items: {
            create: itemsToCreate.map((item) => ({
              ...item,
              amount: new Prisma.Decimal(item.amount),
              sortOrder: dto.items.indexOf(item),
            })),
          },
        },
        include: { items: true },
      });
      if (rentRefundItem) {
        const reservationItem =
          existingRentRefundItem ??
          updated.items.find((item) => item.itemType === 'RENT_REFUND');
        if (!reservationItem)
          throw new ConflictException('退还租金结算项目创建失败，请刷新后重试');
        await reserveCheckoutRentRefund(tx, {
          settlementId: id,
          settlementItemId: reservationItem.id,
          contractId: settlement.contractId,
          actualCheckoutDate: actual,
          requestedAmount: rentRefundItem.amount,
        });
      } else {
        await releaseCheckoutRentRefund(tx, id, '重新提交未申请退还租金');
      }
      return rentRefundItem
        ? updated
        : {
            ...updated,
            items: updated.items.filter(
              (item) => item.itemType !== 'RENT_REFUND',
            ),
          };
    });
  }
  async approve(id: number, user: AuthUser) {
    const identity = await this.prisma.db.checkoutSettlement.findUniqueOrThrow({
      where: { id },
      select: { contractId: true },
    });
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${identity.contractId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM checkout_settlements WHERE id = ${id} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rent_bills WHERE contract_id = ${identity.contractId} ORDER BY id FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM deposit_transactions WHERE contract_id = ${identity.contractId} ORDER BY id FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM prepayment_transactions WHERE contract_id = ${identity.contractId} ORDER BY id FOR UPDATE`,
      );
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
      assertContractNotVoided(settlement.contract.status, '确认退租结算');
      if (!settlement.actualCheckoutDate)
        throw new BadRequestException('结算单缺少实际退房日期');
      const lockedRentRefundAmount = new Prisma.Decimal(
        settlement.rentRefundableAmount ?? 0,
      ).toDecimalPlaces(2);
      await assertCheckoutRentRefundReservationMatches(
        tx,
        id,
        lockedRentRefundAmount,
      );
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
        .filter(
          (item) => !['RENT_ARREARS', 'RENT_REFUND'].includes(item.itemType),
        )
        .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
      const latest = await tx.depositTransaction.findFirst({
        where: { contractId: settlement.contractId },
        orderBy: { id: 'desc' },
      });
      let depositBalance = new Prisma.Decimal(latest?.balanceAfter ?? 0);
      const prepayment = await tx.prepaymentTransaction.findFirst({
        where: { contractId: settlement.contractId },
        orderBy: { id: 'desc' },
      });
      const calculatedAmounts = calculateCheckoutAmounts({
        depositBalance: latest?.balanceAfter ?? 0,
        prepaymentBalance: prepayment?.balanceAfter ?? 0,
        rentOutstanding: outstanding,
        otherCharges,
        rentRefundAmount: lockedRentRefundAmount,
      });
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
      const supplementalArrearsAmount = new Prisma.Decimal(
        calculatedAmounts.supplementalArrearsAmount,
      );
      const supplementalInspectionAmount = new Prisma.Decimal(
        calculatedAmounts.supplementalInspectionAmount,
      );
      const supplementalOutstandingAmount = supplementalArrearsAmount
        .plus(supplementalInspectionAmount)
        .toDecimalPlaces(2);
      if (supplementalInspectionAmount.gt(0)) {
        const supplementalPeriodSeq =
          Math.max(
            0,
            ...settlement.contract.bills.map((bill) => bill.periodSeq),
          ) + 1;
        await tx.rentBill.create({
          data: {
            billNo: `TZBS${settlement.settlementNo}`,
            contractId: settlement.contractId,
            periodSeq: supplementalPeriodSeq,
            periodStart: settlement.actualCheckoutDate,
            periodEnd: settlement.actualCheckoutDate,
            dueDate: settlement.actualCheckoutDate,
            unitMonthlyRent: new Prisma.Decimal(0),
            baseRentAmount: new Prisma.Decimal(0),
            payableAmount: supplementalInspectionAmount,
            receivedAmount: new Prisma.Decimal(0),
            outstandingAmount: supplementalInspectionAmount,
            status: 'PENDING',
            billCategory: 'CHECKOUT_SUPPLEMENTAL',
            checkoutSettlementId: settlement.id,
          },
        });
      }
      const finalReceivable = supplementalOutstandingAmount;
      await tx.rentBill.updateMany({
        where: {
          contractId: settlement.contractId,
          periodStart: { gt: settlement.actualCheckoutDate },
          receivedAmount: 0,
          status: { notIn: ['VOIDED', 'REFUNDED'] },
        },
        data: { status: 'VOIDED', outstandingAmount: 0 },
      });
      const claimed = await tx.checkoutSettlement.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          rentReceivable: eligibleBills.reduce(
            (sum, bill) => sum.plus(bill.payableAmount),
            new Prisma.Decimal(0),
          ),
          rentReceived: eligibleBills
            .reduce(
              (sum, bill) => sum.plus(bill.payableAmount),
              new Prisma.Decimal(0),
            )
            .minus(supplementalArrearsAmount)
            .toDecimalPlaces(2),
          rentOutstanding: supplementalArrearsAmount,
          prepaymentBalance: new Prisma.Decimal(prepayment?.balanceAfter ?? 0),
          depositBalance: initialDepositBalance,
          depositOffsetAmount,
          otherDeductionAmount,
          depositRefundableAmount: new Prisma.Decimal(
            calculatedAmounts.depositRefundableAmount,
          ),
          prepaymentRefundableAmount: new Prisma.Decimal(
            calculatedAmounts.prepaymentRefundableAmount,
          ),
          rentRefundableAmount: new Prisma.Decimal(
            calculatedAmounts.rentRefundableAmount,
          ),
          finalReceivable,
          supplementalRequired: supplementalOutstandingAmount.gt(0),
          supplementalArrearsAmount,
          supplementalInspectionAmount,
          supplementalReceivedAmount: new Prisma.Decimal(0),
          supplementalOutstandingAmount,
          supplementalCollectedAt: null,
          status: 'APPROVED',
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException('退租结算单状态已变化，请刷新后重试');
      return tx.checkoutSettlement.findUniqueOrThrow({ where: { id } });
    });
  }
  async completeZeroRefund(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(
      async (tx) => {
        const identity = await tx.checkoutSettlement.findUniqueOrThrow({
          where: { id },
          select: { contractId: true },
        });
        await lockRoomAndTargetContract(tx, identity.contractId);
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM checkout_settlements WHERE id = ${id} FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM rent_bills WHERE contract_id = (SELECT contract_id FROM checkout_settlements WHERE id = ${id}) ORDER BY id FOR UPDATE`,
        );
        const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
          where: { id },
          include: { contract: true },
        });
        assertContractNotVoided(settlement.contract.status, '完成退租结算');
        const supplementalOutstandingAmount = settlement.supplementalRequired
          ? settlement.supplementalOutstandingAmount
          : settlement.finalReceivable;
        const isZero = [
          settlement.depositRefundableAmount,
          settlement.prepaymentRefundableAmount,
          settlement.rentRefundableAmount ?? 0,
          supplementalOutstandingAmount,
        ].every((amount) => new Prisma.Decimal(amount).isZero());
        if (
          settlement.status !== 'APPROVED' ||
          settlement.contract.status !== 'PENDING_CHECKOUT' ||
          !isZero
        )
          throw new BadRequestException('零额最终确认条件不满足');

        if (settlement.supplementalRequired)
          await assertNoPendingCheckoutSupplementalReversal(
            tx,
            settlement.contractId,
          );
        const claimed = await tx.checkoutSettlement.updateMany({
          where: { id, status: 'APPROVED' },
          data: { status: 'COMPLETED' },
        });
        if (claimed.count !== 1)
          throw new ConflictException('结算单已被最终确认，请刷新后重试');

        await this.completeWithoutDepositRefund(tx, settlement, user);
        return { ...settlement, status: 'COMPLETED' as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
  async reject(id: number, reason: string, user: AuthUser) {
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT contract_id FROM checkout_settlements WHERE id = ${id}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM checkout_settlements WHERE id = ${id} FOR UPDATE`,
      );
      const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
        where: { id },
        include: { contract: { select: { status: true } } },
      });
      if (settlement.status !== 'PENDING')
        throw new BadRequestException('只有待确认结算单可以驳回');
      assertContractNotVoided(settlement.contract.status, '驳回退租结算');
      await releaseCheckoutRentRefund(tx, id, '驳回退租结算');
      return tx.checkoutSettlement.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectedReason: reason,
          approvedBy: user.id,
          approvedAt: new Date(),
        },
      });
    });
  }
  async cancel(id: number, user: AuthUser) {
    return this.prisma.db.$transaction(
      async (tx) => {
        const identity = await tx.checkoutSettlement.findUniqueOrThrow({
          where: { id },
          select: { contractId: true },
        });
        await lockRoomAndTargetContract(tx, identity.contractId);
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM checkout_settlements WHERE id = ${id} FOR UPDATE`,
        );
        const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
          where: { id },
          include: { contract: { include: { room: true } } },
        });
        if (!['DRAFT', 'PENDING', 'REJECTED'].includes(settlement.status))
          throw new BadRequestException(
            '只有草稿、待确认或已驳回的退租结算工单可以取消',
          );
        assertContractNotVoided(settlement.contract.status, '取消退租结算');
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
          throw new ConflictException(
            '缺少发起退租的房态历史，无法安全恢复房态',
          );
        const restoreStatus = initialHistory.fromStatus;

        if (settlement.supplementalRequired)
          await assertNoPendingCheckoutSupplementalReversal(
            tx,
            settlement.contractId,
          );
        await releaseCheckoutRentRefund(tx, id, '取消退租结算');
        const claimed = await tx.checkoutSettlement.updateMany({
          where: { id, status: { in: ['DRAFT', 'PENDING', 'REJECTED'] } },
          data: { status: 'CANCELLED' },
        });
        if (claimed.count !== 1)
          throw new ConflictException('退租结算工单状态已变化，请刷新后重试');

        const contractRestored = await tx.contract.updateMany({
          where: { id: settlement.contractId, status: 'PENDING_CHECKOUT' },
          data: { status: settlement.originContractStatus },
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
  async returnToDraft(id: number, user: AuthUser) {
    void user;
    return this.prisma.db.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = (SELECT contract_id FROM checkout_settlements WHERE id = ${id}) FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM checkout_settlements WHERE id = ${id} FOR UPDATE`,
      );
      const settlement = await tx.checkoutSettlement.findUniqueOrThrow({
        where: { id },
        include: { contract: { select: { status: true } } },
      });
      if (settlement.status !== 'REJECTED')
        throw new BadRequestException('只有已驳回结算单可以退回草稿');
      assertContractNotVoided(settlement.contract.status, '退回退租结算草稿');
      await releaseCheckoutRentRefund(tx, id, '退回退租结算草稿');
      return tx.checkoutSettlement.update({
        where: { id },
        data: { status: 'DRAFT' },
      });
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
