import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

export type ContractVoidReversalCategory =
  | 'RENT_BILL'
  | 'PAYMENT'
  | 'PAYMENT_ALLOCATION'
  | 'PREPAYMENT'
  | 'DEPOSIT'
  | 'REFUND'
  | 'ADJUSTMENT'
  | 'PRICING_REBATE'
  | 'CHECKOUT'
  | 'COMMISSION'
  | 'ROOM_STATUS';

export type ContractVoidImpactInput = {
  contract: { id: number; status: string; roomId: number };
  bills: Array<{
    id: number;
    status: string;
    payableAmount: string;
    receivedAmount: string;
    outstandingAmount: string;
    occurredAt?: string | null;
  }>;
  payments: Array<{
    id: number;
    status: string;
    paymentCategory?: string;
    amount: string;
    allocatedAmount: string;
    refundedAmount: string;
    prepaymentNet: string;
    occurredAt?: string | null;
  }>;
  refunds?: Array<{
    id: number;
    paymentId: number;
    approvalStatus: string;
    amount: string;
    occurredAt?: string | null;
  }>;
  checkoutRentRefunds?: Array<{
    id: number;
    checkoutSettlementItemId: number;
    paymentAllocationId: number;
    paymentId: number;
    rentBillId: number;
    depositRefundId: number | null;
    status: string;
    amount: string;
    occurredAt?: string | null;
  }>;
  prepaymentBalance: string;
  depositBalance: string;
  pending: ContractVoidPendingWorkflows;
  completedCheckoutIds: number[];
  laterContractIds: number[];
  currentRoomStatus: string;
};

export type ContractVoidPendingWorkflows = {
  adjustments: number[];
  refunds: number[];
  voidRequests: number[];
  depositRefunds: number[];
  changes: number[];
  rebates: number[];
  checkouts: number[];
};

export type ContractVoidImpactRow = {
  category: ContractVoidReversalCategory;
  originalEntityType: string;
  originalEntityId: number | null;
  amount: string;
  balanceBefore: string | null;
  balanceAfter: string | null;
  originalOccurredAt: string | null;
  affectsNetImpact: boolean;
  metadata: Record<string, unknown>;
};

export type ContractVoidImpact = {
  contract: ContractVoidImpactInput['contract'];
  summary: {
    rentBillPayable: string;
    effectivePayment: string;
    depositBalance: string;
    prepaymentBalance: string;
    refundNet: string;
    currentNetImpact: string;
    plannedReversal: string;
    postReversalNetImpact: string;
  };
  rows: ContractVoidImpactRow[];
  pending: ContractVoidPendingWorkflows;
  completedCheckoutIds: number[];
  room: {
    currentStatus: string;
    hasLaterContract: boolean;
    action: 'KEEP_CURRENT_STATUS' | 'RECALCULATE';
  };
  flags: {
    hasPendingWorkflows: boolean;
    hasCompletedCheckout: boolean;
    hasLaterContract: boolean;
  };
};

type DecimalValue = Prisma.Decimal.Value;

const zero = new Prisma.Decimal(0);

function decimal(value: DecimalValue) {
  return new Prisma.Decimal(value).toDecimalPlaces(2);
}

function amount(value: DecimalValue) {
  return decimal(value).toFixed(2);
}

function sortedIds(ids: number[]) {
  return [...ids].sort((left, right) => left - right);
}

function sortRows(rows: ContractVoidImpactRow[]) {
  return [...rows].sort((left, right) => {
    const category = left.category.localeCompare(right.category);
    if (category !== 0) return category;
    const entityType = left.originalEntityType.localeCompare(
      right.originalEntityType,
    );
    if (entityType !== 0) return entityType;
    return (left.originalEntityId ?? -1) - (right.originalEntityId ?? -1);
  });
}

function monetaryRow(
  category: ContractVoidReversalCategory,
  originalEntityType: string,
  originalEntityId: number | null,
  balanceBefore: DecimalValue,
  originalOccurredAt: string | null,
  affectsNetImpact: boolean,
  metadata: Record<string, unknown>,
): ContractVoidImpactRow {
  const before = decimal(balanceBefore);
  return {
    category,
    originalEntityType,
    originalEntityId,
    amount: amount(before.negated()),
    balanceBefore: amount(before),
    balanceAfter: amount(zero),
    originalOccurredAt,
    affectsNetImpact,
    metadata,
  };
}

function indicatorRow(
  category: ContractVoidReversalCategory,
  originalEntityType: string,
  originalEntityId: number | null,
  metadata: Record<string, unknown>,
): ContractVoidImpactRow {
  return {
    category,
    originalEntityType,
    originalEntityId,
    amount: '0.00',
    balanceBefore: null,
    balanceAfter: null,
    originalOccurredAt: null,
    affectsNetImpact: false,
    metadata,
  };
}

function pendingRows(pending: ContractVoidPendingWorkflows) {
  const definitions: Array<{
    ids: number[];
    category: ContractVoidReversalCategory;
    entityType: string;
  }> = [
    {
      ids: pending.adjustments,
      category: 'ADJUSTMENT',
      entityType: 'BillAdjustment',
    },
    { ids: pending.refunds, category: 'REFUND', entityType: 'PaymentRefund' },
    {
      ids: pending.voidRequests,
      category: 'PAYMENT',
      entityType: 'PaymentVoidRequest',
    },
    {
      ids: pending.changes,
      category: 'RENT_BILL',
      entityType: 'ContractChange',
    },
    {
      ids: pending.rebates,
      category: 'PRICING_REBATE',
      entityType: 'PricingRebate',
    },
    {
      ids: pending.checkouts,
      category: 'CHECKOUT',
      entityType: 'CheckoutSettlement',
    },
    {
      ids: pending.depositRefunds,
      category: 'DEPOSIT',
      entityType: 'DepositRefund',
    },
  ];

  return definitions.flatMap(({ ids, category, entityType }) =>
    sortedIds(ids).map((id) =>
      indicatorRow(category, entityType, id, { pending: true }),
    ),
  );
}

export function computeContractVoidImpact(
  input: ContractVoidImpactInput,
): ContractVoidImpact {
  const traceablePayments = input.payments.filter(
    (payment) => payment.status !== 'VOIDED',
  );
  const traceablePaymentIds = new Set(
    traceablePayments.map((payment) => payment.id),
  );
  const cashPayments = traceablePayments.filter(
    (payment) => payment.paymentCategory !== 'DEPOSIT',
  );
  const cashPaymentIds = new Set(cashPayments.map((payment) => payment.id));
  const approvedRefunds = input.refunds
    ? input.refunds.filter(
        (refund) =>
          refund.approvalStatus === 'APPROVED' &&
          traceablePaymentIds.has(refund.paymentId),
      )
    : traceablePayments
        .filter((payment) => !decimal(payment.refundedAmount).isZero())
        .map((payment) => ({
          id: payment.id,
          paymentId: payment.id,
          approvalStatus: 'APPROVED',
          amount: payment.refundedAmount,
          occurredAt: payment.occurredAt ?? null,
          derived: true,
        }));
  const approvedCheckoutRentRefunds = (input.checkoutRentRefunds ?? []).filter(
    (refund) =>
      refund.status === 'APPLIED' && traceablePaymentIds.has(refund.paymentId),
  );
  const rentBillPayable = input.bills.reduce(
    (total, bill) => total.plus(decimal(bill.payableAmount)),
    zero,
  );
  const grossPayment = cashPayments.reduce(
    (total, payment) => total.plus(decimal(payment.amount)),
    zero,
  );
  const refundNet = approvedRefunds
    .reduce((total, refund) => total.plus(decimal(refund.amount)), zero)
    .plus(
      approvedCheckoutRentRefunds.reduce(
        (total, refund) => total.plus(decimal(refund.amount)),
        zero,
      ),
    );
  const cashRefundNet = approvedRefunds
    .filter((refund) => cashPaymentIds.has(refund.paymentId))
    .reduce((total, refund) => total.plus(decimal(refund.amount)), zero)
    .plus(
      approvedCheckoutRentRefunds
        .filter((refund) => cashPaymentIds.has(refund.paymentId))
        .reduce((total, refund) => total.plus(decimal(refund.amount)), zero),
    );
  const depositBalance = decimal(input.depositBalance);
  const prepaymentBalance = decimal(input.prepaymentBalance);
  const paymentBackedPrepayment = cashPayments.reduce(
    (total, payment) => total.plus(decimal(payment.prepaymentNet)),
    zero,
  );
  const unrepresentedPrepayment = Prisma.Decimal.max(
    prepaymentBalance.minus(paymentBackedPrepayment),
    zero,
  );
  // Automatic deposit receipts mirror the deposit ledger, while a payment's
  // prepayment credit already belongs to that payment amount. Use the current
  // ledger balances only for money not otherwise represented by cash payments.
  const effectivePayment = grossPayment
    .minus(cashRefundNet)
    .plus(depositBalance)
    .plus(unrepresentedPrepayment);
  const currentNetImpact = effectivePayment;

  const rows: ContractVoidImpactRow[] = [
    ...input.bills.map((bill) =>
      monetaryRow(
        'RENT_BILL',
        'RentBill',
        bill.id,
        bill.payableAmount,
        bill.occurredAt ?? null,
        false,
        {
          status: bill.status,
          receivedAmount: amount(bill.receivedAmount),
          outstandingAmount: amount(bill.outstandingAmount),
        },
      ),
    ),
    ...traceablePayments.map((payment) =>
      monetaryRow(
        'PAYMENT',
        'Payment',
        payment.id,
        payment.amount,
        payment.occurredAt ?? null,
        true,
        {
          status: payment.status,
          paymentCategory: payment.paymentCategory ?? null,
          allocatedAmount: amount(payment.allocatedAmount),
          refundedAmount: amount(payment.refundedAmount),
          prepaymentNet: amount(payment.prepaymentNet),
        },
      ),
    ),
    ...approvedRefunds.map((refund) =>
      monetaryRow(
        'REFUND',
        'PaymentRefund',
        refund.id,
        decimal(refund.amount).negated(),
        refund.occurredAt ?? null,
        true,
        {
          paymentId: refund.paymentId,
          ...(Object.hasOwn(refund, 'derived') ? { derived: true } : {}),
        },
      ),
    ),
    ...approvedCheckoutRentRefunds.map((refund) =>
      monetaryRow(
        'REFUND',
        'CheckoutRentRefundAllocation',
        refund.id,
        decimal(refund.amount).negated(),
        refund.occurredAt ?? null,
        true,
        {
          paymentId: refund.paymentId,
          paymentAllocationId: refund.paymentAllocationId,
          rentBillId: refund.rentBillId,
          checkoutSettlementItemId: refund.checkoutSettlementItemId,
          depositRefundId: refund.depositRefundId,
        },
      ),
    ),
    ...(depositBalance.isPositive()
      ? [
          monetaryRow(
            'DEPOSIT',
            'ContractDepositBalance',
            input.contract.id,
            depositBalance,
            null,
            true,
            {},
          ),
        ]
      : []),
    ...(prepaymentBalance.isPositive()
      ? [
          monetaryRow(
            'PREPAYMENT',
            'ContractPrepaymentBalance',
            input.contract.id,
            prepaymentBalance,
            null,
            true,
            {},
          ),
        ]
      : []),
    ...pendingRows(input.pending),
    ...sortedIds(input.completedCheckoutIds).map((id) =>
      indicatorRow('CHECKOUT', 'CheckoutSettlement', id, { completed: true }),
    ),
    indicatorRow('ROOM_STATUS', 'Room', input.contract.roomId, {
      currentStatus: input.currentRoomStatus,
      laterContractIds: sortedIds(input.laterContractIds),
    }),
  ];
  const pending = {
    adjustments: sortedIds(input.pending.adjustments),
    refunds: sortedIds(input.pending.refunds),
    voidRequests: sortedIds(input.pending.voidRequests),
    changes: sortedIds(input.pending.changes),
    rebates: sortedIds(input.pending.rebates),
    depositRefunds: sortedIds(input.pending.depositRefunds),
    checkouts: sortedIds(input.pending.checkouts),
  };
  const hasPendingWorkflows = Object.values(pending).some(
    (ids) => ids.length > 0,
  );
  const hasCompletedCheckout = input.completedCheckoutIds.length > 0;
  const hasLaterContract = input.laterContractIds.length > 0;

  return {
    contract: { ...input.contract },
    summary: {
      rentBillPayable: amount(rentBillPayable),
      effectivePayment: amount(effectivePayment),
      depositBalance: amount(depositBalance),
      prepaymentBalance: amount(prepaymentBalance),
      refundNet: amount(refundNet),
      currentNetImpact: amount(currentNetImpact),
      plannedReversal: amount(currentNetImpact.negated()),
      postReversalNetImpact: '0.00',
    },
    rows: sortRows(rows),
    pending,
    completedCheckoutIds: sortedIds(input.completedCheckoutIds),
    room: {
      currentStatus: input.currentRoomStatus,
      hasLaterContract,
      action: hasLaterContract ? 'KEEP_CURRENT_STATUS' : 'RECALCULATE',
    },
    flags: { hasPendingWorkflows, hasCompletedCheckout, hasLaterContract },
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const canonicalItems = value.map(canonical);
    return canonicalItems.sort((left, right) => {
      const leftJson = JSON.stringify(left);
      const rightJson = JSON.stringify(right);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    });
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}

export function hashContractVoidImpact(impact: ContractVoidImpact): string {
  const canonicalImpact = {
    ...impact,
    rows: sortRows(impact.rows),
    pending: Object.fromEntries(
      Object.entries(impact.pending).map(([key, ids]) => [key, sortedIds(ids)]),
    ) as ContractVoidPendingWorkflows,
    completedCheckoutIds: sortedIds(impact.completedCheckoutIds),
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(canonicalImpact)))
    .digest('hex');
}

export function assertBalancedContractVoidImpact(
  impact: ContractVoidImpact,
): void {
  for (const row of sortRows(impact.rows)) {
    if (row.balanceBefore === null || row.balanceAfter === null) continue;
    if (
      !decimal(row.balanceBefore)
        .plus(decimal(row.amount))
        .equals(decimal(row.balanceAfter))
    ) {
      throw new Error(`合同纠错金额无法平衡：${row.category}`);
    }
  }
  if (
    !decimal(impact.summary.currentNetImpact)
      .plus(decimal(impact.summary.plannedReversal))
      .equals(decimal(impact.summary.postReversalNetImpact))
  ) {
    throw new Error('合同纠错金额无法平衡：总计');
  }
}
