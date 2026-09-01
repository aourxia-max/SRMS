import { Injectable } from '@nestjs/common';
import { ContractVoidReversalCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { contractBusinessDateRange } from '../contracts/contract-business-day';

const financialReversalCategories: ContractVoidReversalCategory[] = [
  'RENT_BILL',
  'PAYMENT',
  'PAYMENT_ALLOCATION',
  'PREPAYMENT',
  'DEPOSIT',
  'REFUND',
  'ADJUSTMENT',
  'PRICING_REBATE',
];

type CashFlowSource = { entityType: string; entityId: number | null };

export type CashFlowRow = {
  date: Date;
  flowType: string;
  type: string;
  category: ContractVoidReversalCategory | null;
  amount: Prisma.Decimal;
  direction: 'IN' | 'OUT';
  external: boolean;
  countsAsRentReceipt: boolean;
  reference: string;
  requestNo: string | null;
  contractNo: string | null;
  correctionOccurredAt: Date | null;
  originalOccurredAt: Date | null;
  source: CashFlowSource | null;
  generatedSource: CashFlowSource | null;
};

type SortableCashFlowRow = CashFlowRow & { sortAt: Date };

function source(entityType: string | null, entityId: number | null) {
  return entityType ? { entityType, entityId } : null;
}

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}
  async overview() {
    const [latestBalances, latestPrepaymentBalances] = await Promise.all([
      this.prisma.db.depositTransaction.findMany({
        where: { contract: { status: { not: 'VOIDED' } } },
        distinct: ['contractId'],
        orderBy: [{ contractId: 'asc' }, { id: 'desc' }],
        select: { contractId: true, balanceAfter: true },
      }),
      this.prisma.db.prepaymentTransaction.findMany({
        where: { contract: { status: { not: 'VOIDED' } } },
        distinct: ['contractId'],
        orderBy: [{ contractId: 'asc' }, { id: 'desc' }],
        select: { contractId: true, balanceAfter: true },
      }),
    ]);
    return {
      depositBalanceTotal: latestBalances.reduce(
        (sum, item) => sum.plus(item.balanceAfter),
        new Prisma.Decimal(0),
      ),
      prepaymentBalanceTotal: latestPrepaymentBalances.reduce(
        (sum, item) => sum.plus(item.balanceAfter),
        new Prisma.Decimal(0),
      ),
    };
  }
  async rentCollection(from?: string, to?: string) {
    const bills = await this.prisma.db.rentBill.findMany({
      where: {
        billCategory: 'RENT',
        status: { not: 'VOIDED' },
        contract: { status: { not: 'VOIDED' } },
        ...(from || to
          ? {
              periodStart: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      include: {
        contract: {
          include: {
            room: true,
            members: {
              where: { memberRole: 'PRIMARY', isCurrent: true },
              include: { tenant: true },
            },
          },
        },
        allocations: { include: { payment: true } },
        adjustments: {
          where: {
            adjustmentType: { in: ['DISCOUNT', 'WAIVER'] },
            direction: 'DECREASE',
            approvalStatus: 'APPROVED',
            reversedByAdjustmentId: null,
          },
          select: { amount: true },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    const rows = bills.map((bill) => {
      const validReceived = bill.allocations
        .filter((item) =>
          ['CONFIRMED', 'PARTIALLY_REFUNDED'].includes(item.payment.status),
        )
        .reduce(
          (sum, item) =>
            sum.plus(
              new Prisma.Decimal(item.allocatedAmount).minus(
                item.reversedAmount,
              ),
            ),
          new Prisma.Decimal(0),
        );
      const netReceivable = new Prisma.Decimal(bill.payableAmount);
      const concessionAmount = bill.adjustments.reduce(
        (sum, adjustment) => sum.plus(adjustment.amount),
        new Prisma.Decimal(bill.rentFreeAmount).plus(bill.discountAmount),
      );
      return {
        billNo: bill.billNo,
        contractNo: bill.contract.contractNo,
        houseNo: bill.contract.room.fullHouseNo,
        tenantName: bill.contract.members[0]?.tenant.name ?? '',
        periodStart: bill.periodStart,
        originalReceivable: bill.baseRentAmount,
        concessionAmount,
        netReceivable,
        validReceived,
        outstanding: Prisma.Decimal.max(0, netReceivable.minus(validReceived)),
        status: bill.status,
      };
    });
    const total = rows.reduce(
      (sum, row) => ({
        originalReceivable: sum.originalReceivable.plus(row.originalReceivable),
        concessionAmount: sum.concessionAmount.plus(row.concessionAmount),
        netReceivable: sum.netReceivable.plus(row.netReceivable),
        validReceived: sum.validReceived.plus(row.validReceived),
        outstanding: sum.outstanding.plus(row.outstanding),
      }),
      {
        originalReceivable: new Prisma.Decimal(0),
        concessionAmount: new Prisma.Decimal(0),
        netReceivable: new Prisma.Decimal(0),
        validReceived: new Prisma.Decimal(0),
        outstanding: new Prisma.Decimal(0),
      },
    );
    return {
      rows,
      total,
      collectionRate: total.netReceivable.isZero()
        ? null
        : total.validReceived
            .div(total.netReceivable)
            .mul(100)
            .toDecimalPlaces(2),
    };
  }
  async cashFlows(from?: string, to?: string) {
    const date = contractBusinessDateRange(from, to);
    const terminalPaymentIds = (
      await this.prisma.db.contractVoidReversal.findMany({
        where: {
          category: 'PAYMENT',
          originalEntityType: 'Payment',
          originalEntityId: { not: null },
        },
        select: { originalEntityId: true },
        orderBy: { originalEntityId: 'asc' },
      })
    )
      .map((item) => item.originalEntityId)
      .filter((id): id is number => id !== null);
    const terminalPaymentIdSet = new Set(terminalPaymentIds);
    const [payments, refunds, checkoutRefunds, deposits, reversals] =
      await Promise.all([
        this.prisma.db.payment.findMany({
          where: {
            OR: [
              {
                status: {
                  in: ['CONFIRMED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED'],
                },
              },
              { id: { in: terminalPaymentIds } },
            ],
            ...(date ? { paymentDate: date } : {}),
          },
        }),
        this.prisma.db.paymentRefund.findMany({
          where: {
            approvalStatus: 'APPROVED',
            ...(date ? { refundDate: date } : {}),
          },
        }),
        this.prisma.db.depositRefund.findMany({
          where: {
            approvalStatus: 'APPROVED',
            ...(date ? { refundDate: date } : {}),
          },
        }),
        this.prisma.db.depositTransaction.findMany({
          where: date ? { occurredAt: date } : {},
        }),
        this.prisma.db.contractVoidReversal.findMany({
          where: {
            category: { in: financialReversalCategories },
            balanceBefore: { not: null },
            balanceAfter: { not: null },
            ...(date ? { correctionOccurredAt: date } : {}),
          },
          include: {
            request: {
              select: {
                requestNo: true,
                contract: { select: { contractNo: true } },
              },
            },
          },
          orderBy: [{ correctionOccurredAt: 'desc' }, { id: 'desc' }],
        }),
      ]);
    const sortableFlows: SortableCashFlowRow[] = [
      ...payments.map((item) => ({
        date: item.paymentDate,
        sortAt: item.updatedAt ?? item.paymentDate,
        flowType: 'PAYMENT',
        type:
          item.paymentCategory === 'RENT'
            ? '租金收款'
            : item.paymentCategory === 'CHECKOUT_SUPPLEMENTAL'
              ? '退租补收'
              : item.paymentCategory === 'DEPOSIT'
                ? '押金收取'
                : '预收款收取',
        category: null,
        amount: item.amount,
        direction: 'IN' as const,
        external: true,
        countsAsRentReceipt:
          item.paymentCategory === 'RENT' &&
          ['CONFIRMED', 'PARTIALLY_REFUNDED'].includes(item.status),
        reference: item.receiptNo,
        requestNo: null,
        contractNo: null,
        correctionOccurredAt: null,
        originalOccurredAt: item.paymentDate,
        source: source('Payment', item.id),
        generatedSource: null,
      })),
      ...refunds.map((item) => ({
        date: item.refundDate,
        sortAt: item.updatedAt ?? item.refundDate,
        flowType: 'PAYMENT_REFUND',
        type: '收款退款',
        category: null,
        amount: item.refundAmount,
        direction: 'OUT' as const,
        external: true,
        countsAsRentReceipt: false,
        reference: item.refundNo,
        requestNo: null,
        contractNo: null,
        correctionOccurredAt: null,
        originalOccurredAt: item.refundDate,
        source: source('PaymentRefund', item.id),
        generatedSource: null,
      })),
      ...checkoutRefunds.map((item) => ({
        date: item.refundDate,
        sortAt: item.updatedAt ?? item.refundDate,
        flowType: 'CHECKOUT_COMBINED_REFUND',
        type: `退租合并退款（押金 ¥${new Prisma.Decimal(item.depositRefundAmount).toFixed(2)}、预收款 ¥${new Prisma.Decimal(item.prepaymentRefundAmount).toFixed(2)}、租金 ¥${new Prisma.Decimal(item.rentRefundAmount).toFixed(2)}）`,
        category: null,
        amount: item.refundAmount,
        direction: 'OUT' as const,
        external: true,
        countsAsRentReceipt: false,
        reference: item.refundNo,
        requestNo: null,
        contractNo: null,
        correctionOccurredAt: null,
        originalOccurredAt: item.refundDate,
        source: source('DepositRefund', item.id),
        generatedSource: null,
      })),
      ...deposits
        .filter((item) =>
          ['OFFSET_ARREARS', 'OFFSET_SETTLEMENT'].includes(
            item.transactionType,
          ),
        )
        .map((item) => ({
          date: item.occurredAt,
          sortAt: item.occurredAt,
          flowType: 'DEPOSIT_OFFSET',
          type: '押金内部抵扣',
          category: null,
          amount: item.amount,
          direction: 'OUT' as const,
          external: false,
          countsAsRentReceipt: false,
          reference: item.transactionNo,
          requestNo: null,
          contractNo: null,
          correctionOccurredAt: null,
          originalOccurredAt: item.occurredAt,
          source: source('DepositTransaction', item.id),
          generatedSource: null,
        })),
      ...reversals
        .filter((item) => item.category !== 'COMMISSION')
        .map((item) => ({
          date: item.correctionOccurredAt,
          sortAt: item.correctionOccurredAt,
          flowType: 'CONTRACT_VOID_REVERSAL',
          type: '合同纠错冲销',
          category: item.category,
          amount: item.amount,
          direction: item.amount.isNegative()
            ? ('OUT' as const)
            : ('IN' as const),
          external: false,
          countsAsRentReceipt: false,
          reference: item.request.requestNo,
          requestNo: item.request.requestNo,
          contractNo: item.request.contract.contractNo,
          correctionOccurredAt: item.correctionOccurredAt,
          originalOccurredAt: item.originalOccurredAt,
          source: source(item.originalEntityType, item.originalEntityId),
          generatedSource: source(
            item.generatedEntityType,
            item.generatedEntityId,
          ),
        })),
    ].sort((left, right) => {
      const byEditTime = right.sortAt.getTime() - left.sortAt.getTime();
      if (byEditTime !== 0) return byEditTime;
      const byId = (right.source?.entityId ?? 0) - (left.source?.entityId ?? 0);
      if (byId !== 0) return byId;
      return left.flowType.localeCompare(right.flowType);
    });
    const flows = sortableFlows.map((item) => {
      const { sortAt, ...flow } = item;
      void sortAt;
      return flow;
    });
    const inflow = flows
      .filter((item) => item.external && item.direction === 'IN')
      .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    const outflow = flows
      .filter((item) => item.external && item.direction === 'OUT')
      .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    const rentAndDepositReceivedTotal = payments
      .filter(
        (item) =>
          !terminalPaymentIdSet.has(item.id) &&
          ['RENT', 'PREPAYMENT', 'DEPOSIT'].includes(item.paymentCategory) &&
          ['CONFIRMED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED'].includes(
            item.status,
          ),
      )
      .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    return {
      flows,
      total: flows.length,
      inflow,
      outflow,
      netCashFlow: inflow.minus(outflow),
      rentAndDepositReceivedTotal,
    };
  }
}
