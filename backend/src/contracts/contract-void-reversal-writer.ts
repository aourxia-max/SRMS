import { ConflictException, Injectable } from '@nestjs/common';
import {
  ContractVoidReversalCategory,
  Prisma,
  type ContractVoidReversal,
} from '@prisma/client';
import type { ContractVoidImpact } from './contract-void-impact';
import type { ContractVoidSnapshotInput } from './contract-void-preview.service';

export type ContractVoidExecutionRequest = {
  id: number;
  requestNo: string;
  contractId: number;
  operatorId: number;
};

export type ContractVoidExecutionImpact = ContractVoidImpact & {
  sourceSnapshot: ContractVoidSnapshotInput['sourceSnapshot'];
};

type WorkflowRow = { id: number; approvalStatus: string };
type CheckoutWorkflowRow = { id: number; status: string };
type WorkflowDelegate = {
  findMany(args: unknown): Promise<WorkflowRow[]>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
type CheckoutWorkflowDelegate = {
  findMany(args: unknown): Promise<CheckoutWorkflowRow[]>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
type PlannedRow = Omit<
  Prisma.ContractVoidReversalCreateManyInput,
  'idempotencyKey'
>;

const zero = new Prisma.Decimal(0);

function decimal(value: Prisma.Decimal.Value) {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

function occurredAt(value: string | null | undefined) {
  return value ? new Date(value) : null;
}

function financialRow(input: {
  requestId: number;
  category: ContractVoidReversalCategory;
  entityType: string;
  entityId: number;
  balanceBefore: Prisma.Decimal.Value;
  originalOccurredAt?: string | null;
  correctionOccurredAt: Date;
  metadata?: Prisma.InputJsonValue;
  generatedEntityType?: string;
  generatedEntityId?: number;
}): PlannedRow {
  const before = decimal(input.balanceBefore);
  return {
    contractVoidRequestId: input.requestId,
    category: input.category,
    originalEntityType: input.entityType,
    originalEntityId: input.entityId,
    amount: before.negated(),
    balanceBefore: before,
    balanceAfter: zero,
    generatedEntityType: input.generatedEntityType,
    generatedEntityId: input.generatedEntityId,
    originalOccurredAt: occurredAt(input.originalOccurredAt),
    correctionOccurredAt: input.correctionOccurredAt,
    metadata: input.metadata,
  };
}

function indicatorRow(input: {
  requestId: number;
  category: ContractVoidReversalCategory;
  entityType: string;
  entityId: number;
  correctionOccurredAt: Date;
  originalOccurredAt?: string | null;
  metadata: Prisma.InputJsonValue;
}): PlannedRow {
  return {
    contractVoidRequestId: input.requestId,
    category: input.category,
    originalEntityType: input.entityType,
    originalEntityId: input.entityId,
    amount: zero,
    balanceBefore: null,
    balanceAfter: null,
    originalOccurredAt: occurredAt(input.originalOccurredAt),
    correctionOccurredAt: input.correctionOccurredAt,
    metadata: input.metadata,
  };
}

function primarySourceType(
  category: ContractVoidReversalCategory,
  entityType: string,
) {
  return (
    (category === 'RENT_BILL' && entityType === 'RentBill') ||
    (category === 'PAYMENT' && entityType === 'Payment') ||
    (category === 'PAYMENT_ALLOCATION' && entityType === 'PaymentAllocation') ||
    (category === 'PREPAYMENT' && entityType === 'ContractPrepaymentBalance') ||
    (category === 'DEPOSIT' && entityType === 'ContractDepositBalance') ||
    (category === 'REFUND' && entityType === 'PaymentRefund') ||
    (category === 'ADJUSTMENT' && entityType === 'BillAdjustment') ||
    (category === 'PRICING_REBATE' && entityType === 'PricingRebate') ||
    (category === 'CHECKOUT' && entityType === 'CheckoutSettlement') ||
    (category === 'COMMISSION' && entityType === 'ContractCommission') ||
    (category === 'ROOM_STATUS' && entityType === 'Room')
  );
}

function idempotencyKey(requestId: number, row: PlannedRow) {
  const sourceId = primarySourceType(row.category, row.originalEntityType)
    ? String(row.originalEntityId ?? row.originalEntityType)
    : `${row.originalEntityType}-${row.originalEntityId ?? 'none'}`;
  return `contract-void:${requestId}:${row.category}:${sourceId}`;
}

@Injectable()
export class ContractVoidReversalWriter {
  async write(
    tx: Prisma.TransactionClient,
    request: ContractVoidExecutionRequest,
    impact: ContractVoidExecutionImpact,
    now: Date,
  ): Promise<ContractVoidReversal[]> {
    const planned = new Map<string, PlannedRow>();
    const add = (row: PlannedRow) => {
      planned.set(
        `${row.category}:${row.originalEntityType}:${row.originalEntityId ?? 'none'}`,
        row,
      );
    };

    for (const row of impact.rows) {
      if (row.metadata.pending === true) continue;
      if (row.category === 'PREPAYMENT' || row.category === 'DEPOSIT') continue;
      add({
        contractVoidRequestId: request.id,
        category: row.category,
        originalEntityType: row.originalEntityType,
        originalEntityId: row.originalEntityId,
        amount: decimal(row.amount),
        balanceBefore:
          row.balanceBefore === null ? null : decimal(row.balanceBefore),
        balanceAfter:
          row.balanceAfter === null ? null : decimal(row.balanceAfter),
        originalOccurredAt: occurredAt(row.originalOccurredAt),
        correctionOccurredAt: now,
        metadata: {
          ...row.metadata,
          affectsNetImpact: row.affectsNetImpact,
          ...(row.category === 'ROOM_STATUS'
            ? {
                action: impact.room.action,
                resultStatus: impact.room.currentStatus,
              }
            : {}),
        },
      });
    }

    await this.cancelApprovalWorkflows(tx, request, impact, now, add);
    await this.cancelCheckoutWorkflows(tx, request, impact, now, add);

    const paymentIds = impact.rows
      .filter(
        (row) =>
          row.category === 'PAYMENT' &&
          row.originalEntityType === 'Payment' &&
          row.originalEntityId !== null,
      )
      .map((row) => row.originalEntityId!);
    if (paymentIds.length) {
      await tx.payment.updateMany({
        where: {
          id: { in: paymentIds },
          status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED'] },
        },
        data: {
          status: 'VOIDED',
          voidReason: `合同纠错单 ${request.requestNo}`,
          voidedBy: request.operatorId,
          voidedAt: now,
        },
      });
    }
    await tx.rentBill.updateMany({
      where: { contractId: request.contractId, status: { not: 'VOIDED' } },
      data: { status: 'VOIDED' },
    });

    const prepaymentBalance = decimal(impact.summary.prepaymentBalance);
    if (!prepaymentBalance.isZero()) {
      const generated = await tx.prepaymentTransaction.create({
        data: {
          contractId: request.contractId,
          transactionNo: `HTZFYS-${request.id}`,
          transactionType: 'REVERSAL',
          amount: prepaymentBalance.abs(),
          balanceAfter: zero,
          reason: `合同纠错单 ${request.requestNo} 预收款余额冲销`,
          occurredAt: now,
        },
      });
      add(
        financialRow({
          requestId: request.id,
          category: 'PREPAYMENT',
          entityType: 'ContractPrepaymentBalance',
          entityId: request.contractId,
          balanceBefore: prepaymentBalance,
          originalOccurredAt:
            impact.sourceSnapshot.prepaymentBalanceSource?.occurredAt,
          correctionOccurredAt: now,
          generatedEntityType: 'PrepaymentTransaction',
          generatedEntityId: generated.id,
          metadata: {
            sourceTransactionId:
              impact.sourceSnapshot.prepaymentBalanceSource?.id ?? null,
            affectsNetImpact: true,
          },
        }),
      );
    }

    const depositBalance = decimal(impact.summary.depositBalance);
    if (!depositBalance.isZero()) {
      const generated = await tx.depositTransaction.create({
        data: {
          contractId: request.contractId,
          transactionNo: `HTZFYJ-${request.id}`,
          transactionType: 'REVERSAL',
          amount: depositBalance.abs(),
          balanceAfter: zero,
          reason: `合同纠错单 ${request.requestNo} 押金余额冲销`,
          occurredAt: now,
        },
      });
      add(
        financialRow({
          requestId: request.id,
          category: 'DEPOSIT',
          entityType: 'ContractDepositBalance',
          entityId: request.contractId,
          balanceBefore: depositBalance,
          originalOccurredAt:
            impact.sourceSnapshot.depositBalanceSource?.occurredAt,
          correctionOccurredAt: now,
          generatedEntityType: 'DepositTransaction',
          generatedEntityId: generated.id,
          metadata: {
            sourceTransactionId:
              impact.sourceSnapshot.depositBalanceSource?.id ?? null,
            affectsNetImpact: true,
          },
        }),
      );
    }

    for (const allocation of impact.sourceSnapshot.paymentAllocations) {
      const current = decimal(allocation.allocatedAmount).minus(
        allocation.reversedAmount,
      );
      add(
        financialRow({
          requestId: request.id,
          category: 'PAYMENT_ALLOCATION',
          entityType: 'PaymentAllocation',
          entityId: allocation.id,
          balanceBefore: current,
          originalOccurredAt: allocation.occurredAt,
          correctionOccurredAt: now,
          metadata: {
            paymentId: allocation.paymentId,
            rentBillId: allocation.rentBillId,
            allocatedAmount: allocation.allocatedAmount,
            reversedAmount: allocation.reversedAmount,
            allocationType: allocation.allocationType,
            affectsNetImpact: false,
          },
        }),
      );
    }

    for (const adjustment of impact.sourceSnapshot.adjustments.filter(
      (item) => item.approvalStatus === 'APPROVED',
    )) {
      const effect = decimal(adjustment.afterAmount).minus(
        adjustment.beforeAmount,
      );
      add(
        financialRow({
          requestId: request.id,
          category: 'ADJUSTMENT',
          entityType: 'BillAdjustment',
          entityId: adjustment.id,
          balanceBefore: effect,
          originalOccurredAt: adjustment.occurredAt,
          correctionOccurredAt: now,
          metadata: {
            rentBillId: adjustment.rentBillId,
            direction: adjustment.direction,
            amount: adjustment.amount,
            beforeAmount: adjustment.beforeAmount,
            afterAmount: adjustment.afterAmount,
            affectsNetImpact: false,
          },
        }),
      );
    }

    for (const rebate of impact.sourceSnapshot.rebates.filter(
      (item) => item.approvalStatus === 'APPROVED',
    )) {
      add(
        financialRow({
          requestId: request.id,
          category: 'PRICING_REBATE',
          entityType: 'PricingRebate',
          entityId: rebate.id,
          balanceBefore: decimal(rebate.actualAmount).negated(),
          originalOccurredAt: rebate.occurredAt ?? rebate.approvedAt,
          correctionOccurredAt: now,
          metadata: {
            settlementMethod: rebate.settlementMethod,
            rentBillId: rebate.rentBillId,
            actualAmount: rebate.actualAmount,
            affectsNetImpact: false,
          },
        }),
      );
    }

    for (const concession of impact.sourceSnapshot.concessions) {
      add(
        indicatorRow({
          requestId: request.id,
          category: 'PRICING_REBATE',
          entityType: 'ContractConcession',
          entityId: concession.id,
          correctionOccurredAt: now,
          originalOccurredAt: concession.endDate ?? concession.startDate,
          metadata: {
            status: concession.status,
            concessionType: concession.concessionType,
            applyMode: concession.applyMode,
            fixedAmount: concession.fixedAmount,
            discountRate: concession.discountRate,
            billingPeriodCount: concession.billingPeriodCount,
            affectsNetImpact: false,
          },
        }),
      );
    }

    for (const voidRequest of impact.sourceSnapshot
      .approvedPaymentVoidRequests) {
      add(
        indicatorRow({
          requestId: request.id,
          category: 'PAYMENT',
          entityType: 'PaymentVoidRequest',
          entityId: voidRequest.id,
          correctionOccurredAt: now,
          originalOccurredAt: voidRequest.approvedAt,
          metadata: {
            requestNo: voidRequest.requestNo,
            status: voidRequest.status,
            paymentId: voidRequest.paymentId,
            approvedAt: voidRequest.approvedAt,
            affectsNetImpact: false,
          },
        }),
      );
    }

    for (const refund of impact.sourceSnapshot.approvedDepositRefunds) {
      add(
        indicatorRow({
          requestId: request.id,
          category: 'DEPOSIT',
          entityType: 'DepositRefund',
          entityId: refund.id,
          correctionOccurredAt: now,
          originalOccurredAt: refund.approvedAt,
          metadata: {
            refundNo: refund.refundNo,
            amount: refund.amount,
            refundDate: refund.refundDate,
            refundMethod: refund.refundMethod,
            checkoutSettlementId: refund.checkoutSettlementId,
            approvedAt: refund.approvedAt,
            depositTransactionIds: refund.depositTransactionIds,
            affectsNetImpact: false,
          },
        }),
      );
    }

    for (const checkout of impact.sourceSnapshot.checkoutSettlements.filter(
      (item) => item.status === 'COMPLETED',
    )) {
      add(
        indicatorRow({
          requestId: request.id,
          category: 'CHECKOUT',
          entityType: 'CheckoutSettlement',
          entityId: checkout.id,
          correctionOccurredAt: now,
          originalOccurredAt: checkout.occurredAt ?? checkout.approvedAt,
          metadata: {
            completed: true,
            sourceSnapshot: checkout,
            affectsNetImpact: false,
          },
        }),
      );
    }

    for (const commission of impact.sourceSnapshot.commissions.filter(
      (item) => item.deletedAt === null,
    )) {
      add(
        indicatorRow({
          requestId: request.id,
          category: 'COMMISSION',
          entityType: 'ContractCommission',
          entityId: commission.id,
          originalOccurredAt: commission.occurredAt,
          correctionOccurredAt: now,
          metadata: {
            originalAmount: decimal(commission.amount).toFixed(2),
            affectsNetImpact: false,
          },
        }),
      );
    }

    const data = [...planned.values()].map((row) => ({
      ...row,
      idempotencyKey: idempotencyKey(request.id, row),
    }));
    if (data.length) {
      const inserted = await tx.contractVoidReversal.createMany({
        data,
      });
      if (inserted.count !== data.length) {
        throw new ConflictException('合同作废冲销写入不完整，请重试');
      }
    }
    const reversals = await tx.contractVoidReversal.findMany({
      where: { contractVoidRequestId: request.id },
      orderBy: { id: 'asc' },
    });
    const plannedKeys = data.map((row) => row.idempotencyKey).sort();
    const reloadedKeys = reversals.map((row) => row.idempotencyKey).sort();
    if (
      plannedKeys.length !== reloadedKeys.length ||
      plannedKeys.some((key, index) => key !== reloadedKeys[index])
    ) {
      throw new ConflictException('合同作废冲销记录校验失败，请人工核对');
    }
    return reversals;
  }

  private async cancelApprovalWorkflows(
    tx: Prisma.TransactionClient,
    request: ContractVoidExecutionRequest,
    impact: ContractVoidExecutionImpact,
    now: Date,
    add: (row: PlannedRow) => void,
  ) {
    const workflows: Array<{
      ids: number[];
      delegate: WorkflowDelegate;
      category: ContractVoidReversalCategory;
      entityType: string;
    }> = [
      {
        ids: impact.pending.changes,
        delegate: tx.contractChange,
        category: 'RENT_BILL',
        entityType: 'ContractChange',
      },
      {
        ids: impact.pending.adjustments,
        delegate: tx.billAdjustment,
        category: 'ADJUSTMENT',
        entityType: 'BillAdjustment',
      },
      {
        ids: impact.pending.refunds,
        delegate: tx.paymentRefund,
        category: 'REFUND',
        entityType: 'PaymentRefund',
      },
      {
        ids: impact.pending.voidRequests,
        delegate: tx.paymentVoidRequest,
        category: 'PAYMENT',
        entityType: 'PaymentVoidRequest',
      },
      {
        ids: impact.pending.rebates,
        delegate: tx.pricingRebate,
        category: 'PRICING_REBATE',
        entityType: 'PricingRebate',
      },
      {
        ids: impact.pending.depositRefunds,
        delegate: tx.depositRefund,
        category: 'DEPOSIT',
        entityType: 'DepositRefund',
      },
    ];
    for (const workflow of workflows) {
      if (!workflow.ids.length) continue;
      const rows = await workflow.delegate.findMany({
        where: {
          id: { in: workflow.ids },
          approvalStatus: { in: ['DRAFT', 'PENDING'] },
        },
        select: { id: true, approvalStatus: true },
        orderBy: { id: 'asc' },
      });
      const expectedIds = [...workflow.ids].sort((left, right) => left - right);
      if (
        rows.length !== expectedIds.length ||
        rows.some((row, index) => row.id !== expectedIds[index])
      ) {
        throw new ConflictException('合同关联审批状态已并发变化，请重新预览');
      }
      const ids = rows.map((row) => row.id);
      const updated = await workflow.delegate.updateMany({
        where: {
          id: { in: ids },
          approvalStatus: { in: ['DRAFT', 'PENDING'] },
        },
        data: { approvalStatus: 'CANCELLED' },
      });
      if (updated.count !== rows.length) {
        throw new ConflictException('合同关联审批状态已并发变化，请重新预览');
      }
      for (const row of rows) {
        add(
          indicatorRow({
            requestId: request.id,
            category: workflow.category,
            entityType: workflow.entityType,
            entityId: row.id,
            correctionOccurredAt: now,
            metadata: {
              previousStatus: row.approvalStatus,
              nextStatus: 'CANCELLED',
            },
          }),
        );
      }
    }
  }

  private async cancelCheckoutWorkflows(
    tx: Prisma.TransactionClient,
    request: ContractVoidExecutionRequest,
    impact: ContractVoidExecutionImpact,
    now: Date,
    add: (row: PlannedRow) => void,
  ) {
    if (!impact.pending.checkouts.length) return;
    const delegate =
      tx.checkoutSettlement as unknown as CheckoutWorkflowDelegate;
    const rows = await delegate.findMany({
      where: {
        id: { in: impact.pending.checkouts },
        status: { in: ['DRAFT', 'PENDING'] },
      },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
    });
    const expectedIds = [...impact.pending.checkouts].sort(
      (left, right) => left - right,
    );
    if (
      rows.length !== expectedIds.length ||
      rows.some((row, index) => row.id !== expectedIds[index])
    ) {
      throw new ConflictException('合同关联审批状态已并发变化，请重新预览');
    }
    const ids = rows.map((row) => row.id);
    const updated = await delegate.updateMany({
      where: { id: { in: ids }, status: { in: ['DRAFT', 'PENDING'] } },
      data: { status: 'CANCELLED' },
    });
    if (updated.count !== rows.length) {
      throw new ConflictException('合同关联审批状态已并发变化，请重新预览');
    }
    for (const row of rows) {
      add(
        indicatorRow({
          requestId: request.id,
          category: 'CHECKOUT',
          entityType: 'CheckoutSettlement',
          entityId: row.id,
          correctionOccurredAt: now,
          metadata: {
            previousStatus: row.status,
            nextStatus: 'CANCELLED',
          },
        }),
      );
    }
  }
}
