import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeContractVoidImpact,
  hashContractVoidImpact,
  type ContractVoidImpact,
  type ContractVoidImpactInput,
} from './contract-void-impact';

type ContractVoidSourceSnapshot = {
  prepaymentBalanceSource: {
    id: number;
    balanceAfter: string;
    occurredAt: string;
  } | null;
  depositBalanceSource: {
    id: number;
    balanceAfter: string;
    occurredAt: string;
  } | null;
  contractMembers: Array<{
    id: number;
    tenantId: number;
    memberRole: string;
    isCurrent: boolean;
  }>;
  paymentAllocations: Array<{
    id: number;
    paymentId: number;
    rentBillId: number;
    allocatedAmount: string;
    reversedAmount: string;
    allocationType: string;
    occurredAt: string;
  }>;
  adjustments: Array<{
    id: number;
    rentBillId: number;
    adjustmentType: string;
    direction: string;
    amount: string;
    beforeAmount: string;
    afterAmount: string;
    approvalStatus: string;
    occurredAt: string;
    submittedAt: string;
    approvedAt: string | null;
  }>;
  rebates: Array<{
    id: number;
    sourceType: string;
    rebateType: string;
    rentBillId: number | null;
    approvalStatus: string;
    settlementMethod: string;
    grossBilledAmount: string;
    previousRebateAmount: string;
    referenceAmount: string | null;
    targetNetRentAmount: string | null;
    actualAmount: string;
    differenceAmount: string | null;
    periodStart: string;
    periodEnd: string;
    refundDate: string | null;
    occurredAt: string | null;
    submittedAt: string | null;
    approvedAt: string | null;
  }>;
  checkoutSettlements: Array<{
    id: number;
    checkoutType: string;
    originContractStatus: string;
    status: string;
    rentReceivable: string;
    rentReceived: string;
    rentOutstanding: string;
    prepaymentBalance: string;
    depositBalance: string;
    depositOffsetAmount: string;
    otherDeductionAmount: string;
    depositRefundableAmount: string;
    prepaymentRefundableAmount: string;
    finalReceivable: string;
    supplementalArrearsAmount: string;
    supplementalInspectionAmount: string;
    supplementalReceivedAmount: string;
    supplementalOutstandingAmount: string;
    occurredAt: string | null;
    approvedAt: string | null;
  }>;
  commissions: Array<{
    id: number;
    amount: string;
    occurredAt: string;
    deletedAt: string | null;
  }>;
};

export type ContractVoidSnapshotInput = ContractVoidImpactInput & {
  sourceSnapshot: ContractVoidSourceSnapshot;
};

export type ContractVoidPreview = ContractVoidImpact & {
  sourceSnapshot: ContractVoidSourceSnapshot;
  impactHash: string;
};

const zero = new Prisma.Decimal(0);

function money(value: Prisma.Decimal.Value) {
  return new Prisma.Decimal(value).toDecimalPlaces(2).toFixed(2);
}

function nullableMoney(value: Prisma.Decimal.Value | null) {
  return value === null ? null : money(value);
}

function dateText(value: Date | null) {
  return value?.toISOString() ?? null;
}

function sortById<T extends { id: number }>(items: T[]) {
  return [...items].sort((left, right) => left.id - right.id);
}

@Injectable()
export class ContractVoidPreviewService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(
    contractId: number,
    user: AuthUser,
  ): Promise<ContractVoidPreview> {
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('当前角色不能查看合同作废影响');
    }
    const input = await this.loadInput(this.prisma.db, contractId);
    const impact = computeContractVoidImpact(input);
    const snapshot = { ...impact, sourceSnapshot: input.sourceSnapshot };
    return {
      ...snapshot,
      impactHash: hashContractVoidImpact(snapshot),
    };
  }

  async loadInput(
    db: Prisma.TransactionClient | PrismaClient,
    contractId: number,
  ): Promise<ContractVoidSnapshotInput> {
    const contract = await db.contract.findUniqueOrThrow({
      where: { id: contractId },
      select: {
        id: true,
        status: true,
        roomId: true,
        room: { select: { roomStatus: true } },
        members: {
          select: {
            id: true,
            tenantId: true,
            memberRole: true,
            isCurrent: true,
          },
        },
        bills: {
          select: {
            id: true,
            status: true,
            payableAmount: true,
            receivedAmount: true,
            outstandingAmount: true,
            periodStart: true,
            adjustments: {
              select: {
                id: true,
                rentBillId: true,
                adjustmentType: true,
                direction: true,
                amount: true,
                beforeAmount: true,
                afterAmount: true,
                approvalStatus: true,
                submittedAt: true,
                approvedAt: true,
              },
            },
          },
        },
        payments: {
          select: {
            id: true,
            status: true,
            amount: true,
            paymentDate: true,
            allocations: {
              select: {
                id: true,
                paymentId: true,
                rentBillId: true,
                allocatedAmount: true,
                reversedAmount: true,
                allocationType: true,
                allocatedAt: true,
              },
            },
            prepaymentTransactions: {
              select: {
                id: true,
                transactionType: true,
                amount: true,
              },
            },
            voidRequests: {
              select: { id: true, approvalStatus: true },
            },
          },
        },
        refunds: {
          select: {
            id: true,
            paymentId: true,
            approvalStatus: true,
            refundAmount: true,
            refundDate: true,
          },
        },
        prepaymentTransactions: {
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true, balanceAfter: true, occurredAt: true },
        },
        depositTransactions: {
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { id: true, balanceAfter: true, occurredAt: true },
        },
        changes: { select: { id: true, approvalStatus: true } },
        pricingRebates: {
          select: {
            id: true,
            sourceType: true,
            rebateType: true,
            rentBillId: true,
            approvalStatus: true,
            settlementMethod: true,
            grossBilledAmount: true,
            previousRebateAmount: true,
            referenceAmount: true,
            targetNetRentAmount: true,
            actualAmount: true,
            differenceAmount: true,
            periodStart: true,
            periodEnd: true,
            refundDate: true,
            submittedAt: true,
            approvedAt: true,
          },
        },
        checkoutSettlements: {
          select: {
            id: true,
            checkoutType: true,
            originContractStatus: true,
            status: true,
            rentReceivable: true,
            rentReceived: true,
            rentOutstanding: true,
            prepaymentBalance: true,
            depositBalance: true,
            depositOffsetAmount: true,
            otherDeductionAmount: true,
            depositRefundableAmount: true,
            prepaymentRefundableAmount: true,
            finalReceivable: true,
            supplementalArrearsAmount: true,
            supplementalInspectionAmount: true,
            supplementalReceivedAmount: true,
            supplementalOutstandingAmount: true,
            actualCheckoutDate: true,
            approvedAt: true,
          },
        },
        commissions: {
          select: { id: true, amount: true, createdAt: true, deletedAt: true },
        },
      },
    });
    if (contract.status === 'VOIDED') {
      throw new BadRequestException('合同已作废，不能再次发起纠错');
    }

    const laterContracts = await db.contract.findMany({
      where: {
        roomId: contract.roomId,
        id: { not: contractId },
        status: { not: 'VOIDED' },
      },
      select: { id: true },
    });
    const paymentAllocations = sortById(
      contract.payments.flatMap((payment) => payment.allocations),
    );
    const adjustments = sortById(
      contract.bills.flatMap((bill) => bill.adjustments),
    );

    return {
      contract: {
        id: contract.id,
        status: contract.status,
        roomId: contract.roomId,
      },
      bills: contract.bills.map((bill) => ({
        id: bill.id,
        status: bill.status,
        payableAmount: money(bill.payableAmount),
        receivedAmount: money(bill.receivedAmount),
        outstandingAmount: money(bill.outstandingAmount),
        occurredAt: bill.periodStart.toISOString(),
      })),
      payments: contract.payments.map((payment) => ({
        id: payment.id,
        status: payment.status,
        amount: money(payment.amount),
        allocatedAmount: money(
          payment.allocations.reduce(
            (sum, allocation) =>
              sum
                .plus(allocation.allocatedAmount)
                .minus(allocation.reversedAmount),
            zero,
          ),
        ),
        refundedAmount: money(
          contract.refunds
            .filter(
              (refund) =>
                refund.paymentId === payment.id &&
                refund.approvalStatus === 'APPROVED',
            )
            .reduce((sum, refund) => sum.plus(refund.refundAmount), zero),
        ),
        prepaymentNet: money(
          payment.prepaymentTransactions.reduce((sum, transaction) => {
            if (transaction.transactionType === 'CREDIT_RECEIPT') {
              return sum.plus(transaction.amount);
            }
            if (transaction.transactionType === 'REVERSAL') {
              return sum.minus(transaction.amount);
            }
            return sum;
          }, zero),
        ),
        occurredAt: payment.paymentDate.toISOString(),
      })),
      refunds: contract.refunds.map((refund) => ({
        id: refund.id,
        paymentId: refund.paymentId,
        approvalStatus: refund.approvalStatus,
        amount: money(refund.refundAmount),
        occurredAt: refund.refundDate.toISOString(),
      })),
      prepaymentBalance: money(
        contract.prepaymentTransactions[0]?.balanceAfter ?? zero,
      ),
      depositBalance: money(
        contract.depositTransactions[0]?.balanceAfter ?? zero,
      ),
      pending: {
        adjustments: adjustments
          .filter((item) => ['DRAFT', 'PENDING'].includes(item.approvalStatus))
          .map((item) => item.id),
        refunds: contract.refunds
          .filter((item) => ['DRAFT', 'PENDING'].includes(item.approvalStatus))
          .map((item) => item.id),
        voidRequests: contract.payments.flatMap((payment) =>
          payment.voidRequests
            .filter((item) =>
              ['DRAFT', 'PENDING'].includes(item.approvalStatus),
            )
            .map((item) => item.id),
        ),
        changes: contract.changes
          .filter((item) => ['DRAFT', 'PENDING'].includes(item.approvalStatus))
          .map((item) => item.id),
        rebates: contract.pricingRebates
          .filter((item) => ['DRAFT', 'PENDING'].includes(item.approvalStatus))
          .map((item) => item.id),
        checkouts: contract.checkoutSettlements
          .filter((item) => ['DRAFT', 'PENDING'].includes(item.status))
          .map((item) => item.id),
      },
      completedCheckoutIds: contract.checkoutSettlements
        .filter((item) => item.status === 'COMPLETED')
        .map((item) => item.id),
      laterContractIds: laterContracts.map((item) => item.id),
      currentRoomStatus: contract.room.roomStatus,
      sourceSnapshot: {
        prepaymentBalanceSource: contract.prepaymentTransactions[0]
          ? {
              id: contract.prepaymentTransactions[0].id,
              balanceAfter: money(
                contract.prepaymentTransactions[0].balanceAfter,
              ),
              occurredAt:
                contract.prepaymentTransactions[0].occurredAt.toISOString(),
            }
          : null,
        depositBalanceSource: contract.depositTransactions[0]
          ? {
              id: contract.depositTransactions[0].id,
              balanceAfter: money(contract.depositTransactions[0].balanceAfter),
              occurredAt:
                contract.depositTransactions[0].occurredAt.toISOString(),
            }
          : null,
        contractMembers: sortById(contract.members),
        paymentAllocations: paymentAllocations.map((allocation) => ({
          id: allocation.id,
          paymentId: allocation.paymentId,
          rentBillId: allocation.rentBillId,
          allocatedAmount: money(allocation.allocatedAmount),
          reversedAmount: money(allocation.reversedAmount),
          allocationType: allocation.allocationType,
          occurredAt: allocation.allocatedAt.toISOString(),
        })),
        adjustments: adjustments.map((adjustment) => ({
          id: adjustment.id,
          rentBillId: adjustment.rentBillId,
          adjustmentType: adjustment.adjustmentType,
          direction: adjustment.direction,
          amount: money(adjustment.amount),
          beforeAmount: money(adjustment.beforeAmount),
          afterAmount: money(adjustment.afterAmount),
          approvalStatus: adjustment.approvalStatus,
          occurredAt: (
            adjustment.approvedAt ?? adjustment.submittedAt
          ).toISOString(),
          submittedAt: adjustment.submittedAt.toISOString(),
          approvedAt: dateText(adjustment.approvedAt),
        })),
        rebates: sortById(contract.pricingRebates).map((rebate) => ({
          id: rebate.id,
          sourceType: rebate.sourceType,
          rebateType: rebate.rebateType,
          rentBillId: rebate.rentBillId,
          approvalStatus: rebate.approvalStatus,
          settlementMethod: rebate.settlementMethod,
          grossBilledAmount: money(rebate.grossBilledAmount),
          previousRebateAmount: money(rebate.previousRebateAmount),
          referenceAmount: nullableMoney(rebate.referenceAmount),
          targetNetRentAmount: nullableMoney(rebate.targetNetRentAmount),
          actualAmount: money(rebate.actualAmount),
          differenceAmount: nullableMoney(rebate.differenceAmount),
          periodStart: rebate.periodStart.toISOString(),
          periodEnd: rebate.periodEnd.toISOString(),
          refundDate: dateText(rebate.refundDate),
          occurredAt: dateText(rebate.approvedAt ?? rebate.submittedAt),
          submittedAt: dateText(rebate.submittedAt),
          approvedAt: dateText(rebate.approvedAt),
        })),
        checkoutSettlements: sortById(contract.checkoutSettlements).map(
          (checkout) => ({
            id: checkout.id,
            checkoutType: checkout.checkoutType,
            originContractStatus: checkout.originContractStatus,
            status: checkout.status,
            rentReceivable: money(checkout.rentReceivable),
            rentReceived: money(checkout.rentReceived),
            rentOutstanding: money(checkout.rentOutstanding),
            prepaymentBalance: money(checkout.prepaymentBalance),
            depositBalance: money(checkout.depositBalance),
            depositOffsetAmount: money(checkout.depositOffsetAmount),
            otherDeductionAmount: money(checkout.otherDeductionAmount),
            depositRefundableAmount: money(checkout.depositRefundableAmount),
            prepaymentRefundableAmount: money(
              checkout.prepaymentRefundableAmount,
            ),
            finalReceivable: money(checkout.finalReceivable),
            supplementalArrearsAmount: money(
              checkout.supplementalArrearsAmount,
            ),
            supplementalInspectionAmount: money(
              checkout.supplementalInspectionAmount,
            ),
            supplementalReceivedAmount: money(
              checkout.supplementalReceivedAmount,
            ),
            supplementalOutstandingAmount: money(
              checkout.supplementalOutstandingAmount,
            ),
            occurredAt: dateText(checkout.actualCheckoutDate),
            approvedAt: dateText(checkout.approvedAt),
          }),
        ),
        commissions: sortById(contract.commissions).map((commission) => ({
          id: commission.id,
          amount: money(commission.amount),
          occurredAt: commission.createdAt.toISOString(),
          deletedAt: dateText(commission.deletedAt),
        })),
      },
    };
  }
}
