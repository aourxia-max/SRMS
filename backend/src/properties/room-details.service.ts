import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { contractBusinessDay } from '../contracts/contract-business-day';
import {
  ACTIVE_CHECKOUT_CUTOFF_STATUSES,
  effectiveRentBillStatus,
  isRentBillPerformed,
  resolveCheckoutCutoff,
} from '../checkout/checkout-accounting-cutoff';

const activeStatuses = ['ACTIVE', 'PENDING_START', 'PENDING_CHECKOUT'];

@Injectable()
export class RoomDetailsService {
  constructor(private readonly prisma: PrismaService) {}

  async detail(roomId: number, user: AuthUser) {
    const room = await this.prisma.db.room.findFirstOrThrow({
      where: { id: roomId, deletedAt: null },
      include: {
        building: true,
        histories: { orderBy: { changedAt: 'desc' } },
        contracts: {
          orderBy: { startDate: 'desc' },
          include: {
            checkoutSettlements: {
              where: { status: { in: [...ACTIVE_CHECKOUT_CUTOFF_STATUSES] } },
              select: { status: true, actualCheckoutDate: true },
              orderBy: { id: 'desc' },
            },
            members: { where: { isCurrent: true }, include: { tenant: true } },
            bills: {
              select: {
                id: true,
                periodStart: true,
                dueDate: true,
                outstandingAmount: true,
                status: true,
                billCategory: true,
              },
            },
          },
        },
      },
    });
    const focus =
      room.contracts.find((contract) =>
        activeStatuses.includes(contract.status),
      ) ??
      room.contracts[0] ??
      null;
    const contractIds = room.contracts.map((contract) => contract.id);
    const [
      pendingContractChanges,
      pendingBillAdjustments,
      pendingPaymentRefunds,
      pendingPaymentVoids,
      pendingPricingRebates,
      pendingDepositRefunds,
      pendingCheckoutSettlements,
    ] = await Promise.all([
      this.prisma.db.contractChange.count({
        where: { contractId: { in: contractIds }, approvalStatus: 'PENDING' },
      }),
      this.prisma.db.billAdjustment.count({
        where: {
          rentBill: { contractId: { in: contractIds } },
          approvalStatus: 'PENDING',
        },
      }),
      this.prisma.db.paymentRefund.count({
        where: { contractId: { in: contractIds }, approvalStatus: 'PENDING' },
      }),
      this.prisma.db.paymentVoidRequest.count({
        where: {
          payment: { contractId: { in: contractIds } },
          approvalStatus: 'PENDING',
        },
      }),
      this.prisma.db.pricingRebate.count({
        where: { contractId: { in: contractIds }, approvalStatus: 'PENDING' },
      }),
      this.prisma.db.depositRefund.count({
        where: { contractId: { in: contractIds }, approvalStatus: 'PENDING' },
      }),
      this.prisma.db.checkoutSettlement.count({
        where: {
          contractId: { in: contractIds },
          status: { in: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] },
        },
      }),
    ]);
    const now = new Date();
    const today = contractBusinessDay(now);
    const focusCutoff = resolveCheckoutCutoff(focus?.checkoutSettlements ?? []);
    const riskLabels: string[] = [];
    if (room.roomStatus === 'MAINTENANCE') riskLabels.push('维修中');
    const addPendingLabel = (count: number, label: string) => {
      if (count > 0)
        riskLabels.push(count > 1 ? label + '（' + count + '）' : label);
    };
    addPendingLabel(pendingContractChanges, '合同变更待审批');
    addPendingLabel(pendingBillAdjustments, '账单调整待审批');
    addPendingLabel(pendingPaymentRefunds, '收款退款待审批');
    addPendingLabel(pendingPaymentVoids, '收款作废待审批');
    addPendingLabel(pendingPricingRebates, '固定月租退差待审批');
    addPendingLabel(pendingDepositRefunds, '押金退款待审批');
    addPendingLabel(pendingCheckoutSettlements, '退租结算待处理');
    if (
      focus?.bills.some(
        (bill) =>
          bill.billCategory === 'RENT' &&
          isRentBillPerformed(bill.periodStart, focusCutoff) &&
          bill.dueDate < today &&
          new Prisma.Decimal(bill.outstandingAmount).gt(0) &&
          !['VOIDED', 'REFUNDED'].includes(bill.status),
      )
    )
      riskLabels.push('有逾期账单');
    if (focus) {
      const in30 = new Date(now);
      in30.setDate(in30.getDate() + 30);
      if (focus.endDate >= now && focus.endDate <= in30)
        riskLabels.push('合同即将到期');
    }
    if (!riskLabels.length) riskLabels.push('当前无待办');

    const contracts = room.contracts.map(({ bills, ...contract }) => ({
      ...contract,
      hasOverdueBill: bills.some(
        (bill) =>
          bill.billCategory === 'RENT' &&
          isRentBillPerformed(
            bill.periodStart,
            resolveCheckoutCutoff(contract.checkoutSettlements ?? []),
          ) &&
          bill.dueDate < today &&
          new Prisma.Decimal(bill.outstandingAmount).gt(0) &&
          !['VOIDED', 'REFUNDED'].includes(bill.status),
      ),
    }));
    const result: Record<string, unknown> = {
      room: { ...room, contracts },
      focusContractId: focus?.id ?? null,
      riskLabels,
    };
    if (user.role === UserRole.SUPER_ADMIN && focus) {
      const [bills, payments, prepayments, refunds] = await Promise.all([
        this.prisma.db.rentBill.findMany({
          where: {
            contractId: focus.id,
            billCategory: 'RENT',
            status: { not: 'VOIDED' },
          },
          orderBy: { periodSeq: 'asc' },
        }),
        this.prisma.db.payment.findMany({
          where: { contractId: focus.id },
          include: { allocations: { include: { rentBill: true } } },
          orderBy: { id: 'desc' },
        }),
        this.prisma.db.prepaymentTransaction.findMany({
          where: { contractId: focus.id },
          orderBy: { id: 'desc' },
        }),
        this.prisma.db.paymentRefund.findMany({
          where: { contractId: focus.id },
          orderBy: { id: 'desc' },
        }),
      ]);
      const projectedBills = bills.map((bill) => {
        const performed = isRentBillPerformed(bill.periodStart, focusCutoff);
        return {
          ...bill,
          status: effectiveRentBillStatus(
            bill.status,
            bill.periodStart,
            focusCutoff,
          ),
          payableAmount: performed ? bill.payableAmount : new Prisma.Decimal(0),
          outstandingAmount: performed
            ? bill.outstandingAmount
            : new Prisma.Decimal(0),
        };
      });
      const total = projectedBills.reduce(
        (sum, bill) => ({
          payable: sum.payable.plus(bill.payableAmount),
          received: sum.received.plus(bill.receivedAmount),
          outstanding: sum.outstanding.plus(bill.outstandingAmount),
        }),
        {
          payable: new Prisma.Decimal(0),
          received: new Prisma.Decimal(0),
          outstanding: new Prisma.Decimal(0),
        },
      );
      result.financial = {
        contractId: focus.id,
        summary: total,
        bills: projectedBills,
        payments,
        prepaymentBalance:
          prepayments[0]?.balanceAfter ?? new Prisma.Decimal(0),
        refunds,
      };
    }
    return result;
  }
}
