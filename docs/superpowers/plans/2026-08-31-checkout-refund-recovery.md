# 退租退款闭环修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复部分缴费未来账单导致的退租失败，补齐退款申请取消、整个退租取消、多待处理工单展示和并发防重，使退租、退款、账单、收款、押金及房态保持一致。

**Architecture:** 新增独立的未来账单核销/反向恢复模块，将未来未收金额转换为可审计的账单调减；最终退款与零额完成均调用同一核销入口。退款申请取消由退款服务负责，整个退租取消由结算服务调用独立回滚模块；前端明确区分两种取消，并以分项金额校验总额。

**Tech Stack:** NestJS 11、Prisma 7、MySQL、Jest、Vue 3、Pinia、Vitest、TypeScript。

**Spec:** `docs/superpowers/specs/2026-08-30-checkout-rent-refund-design.md`

## Global Constraints

- 采用用户确认的方案：未来账单应收 ¥800、已收 ¥300、退还 ¥100，最终应收 ¥200、已收 ¥200、未收 ¥0。
- 实际退房日及以前的有效欠款不得自动核销。
- 不物理删除退款、账单调整、押金流水或预留记录。
- 已确认实际退款或已完成退租不可普通取消，只能走合同纠错流程。
- 后端强制权限与并发校验；前端隐藏按钮不能替代后端校验。
- 所有错误提示必须中文。
- 不读取、不输出、不提交任何环境密码或密钥。

---

### Task 1: 未来账单未收核销模块

**Files:**
- Create: `backend/src/checkout/checkout-future-bill-normalization.ts`
- Create: `backend/src/checkout/checkout-future-bill-normalization.spec.ts`

**Interfaces:**
- Produces: `normalizeFutureCheckoutBills(tx, input): Promise<FutureBillNormalizationResult>`
- Produces: `reverseFutureCheckoutBillNormalization(tx, input): Promise<void>`
- `input` contains `settlementId`, `contractId`, `actualCheckoutDate`, `operatorId`, `occurredAt`.

- [ ] **Step 1: Write failing normalization tests**

```ts
it('turns an 800/300/500 future bill into 300/300/0 with an approved correction', async () => {
  const result = await normalizeFutureCheckoutBills(tx, input);
  expect(result.cancelledOutstandingAmount).toBe('500.00');
  expect(tx.rentBill.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ payableAmount: new Prisma.Decimal('300.00'), outstandingAmount: new Prisma.Decimal(0), status: 'PAID' }),
  }));
});

it('voids a wholly unpaid future bill and never touches a bill containing the checkout date', async () => {
  await normalizeFutureCheckoutBills(tx, input);
  expect(updateForFutureBill.data.status).toBe('VOIDED');
  expect(tx.rentBill.update).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: currentBillId } }));
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm --prefix backend run test -- checkout-future-bill-normalization.spec.ts --runInBand`

Expected: FAIL because the module and functions do not exist.

- [ ] **Step 3: Implement the minimal normalization and reversal functions**

```ts
export async function normalizeFutureCheckoutBills(tx: Prisma.TransactionClient, input: NormalizeInput) {
  const bills = await tx.rentBill.findMany({
    where: { contractId: input.contractId, billCategory: 'RENT', periodStart: { gt: input.actualCheckoutDate }, status: { not: 'REFUNDED' } },
    orderBy: { id: 'asc' },
  });
  // For every positive outstandingAmount, create an approved CORRECTION decrease,
  // set payableAmount to receivedAmount, outstandingAmount to zero,
  // and choose VOIDED when received is zero, otherwise PAID.
}
```

The adjustment reason is exactly `退租结算 ${settlementId} 核销未来未收租金`; reversal creates a `CORRECTION` increase and links `reversedByAdjustmentId`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm --prefix backend run test -- checkout-future-bill-normalization.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/checkout/checkout-future-bill-normalization.ts backend/src/checkout/checkout-future-bill-normalization.spec.ts
git commit -m "fix: normalize future checkout bill balances"
```

### Task 2: 将核销接入结算确认、最终退款和零额完成

**Files:**
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`
- Modify: `backend/src/checkout/deposit-refunds.service.ts`
- Modify: `backend/src/checkout/deposit-refunds.service.spec.ts`
- Modify: `backend/src/checkout/checkout-rent-refund-writer.ts`
- Modify: `backend/src/checkout/checkout-rent-refund-writer.spec.ts`

**Interfaces:**
- Consumes: `normalizeFutureCheckoutBills` from Task 1.
- Preserves: `applyCheckoutRentRefund(tx, input)` public signature.

- [ ] **Step 1: Add failing service tests for partial future bills**

```ts
it('normalizes future unpaid balance before applying a 100 rent refund', async () => {
  await service.approve(refundId, superAdmin);
  expect(normalizeFutureCheckoutBills).toHaveBeenCalledBefore(applyCheckoutRentRefund);
});

it('normalizes future partial bills on zero-refund completion', async () => {
  await service.completeZeroRefund(settlementId, superAdmin);
  expect(normalizeFutureCheckoutBills).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ settlementId }));
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --prefix backend run test -- checkout.service.spec.ts deposit-refunds.service.spec.ts checkout-rent-refund-writer.spec.ts --runInBand`

Expected: FAIL because the services do not invoke future bill normalization and the writer still rejects the reproduced state.

- [ ] **Step 3: Replace the blind future-bill update and invoke the shared normalizer**

```ts
await normalizeFutureCheckoutBills(tx, {
  settlementId: settlement.id,
  contractId: settlement.contractId,
  actualCheckoutDate: settlement.actualCheckoutDate,
  operatorId: user.id,
  occurredAt,
});
```

Call it during settlement approval, immediately before rent refund application, and before zero-refund completion. Remove the `updateMany` that only voids `receivedAmount: 0` future bills. Keep the writer invariant `payableAmount === receivedAmount` after normalization.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm --prefix backend run test -- checkout.service.spec.ts deposit-refunds.service.spec.ts checkout-rent-refund-writer.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/checkout/checkout.service.ts backend/src/checkout/checkout.service.spec.ts backend/src/checkout/deposit-refunds.service.ts backend/src/checkout/deposit-refunds.service.spec.ts backend/src/checkout/checkout-rent-refund-writer.ts backend/src/checkout/checkout-rent-refund-writer.spec.ts
git commit -m "fix: complete checkout with partially paid future bills"
```

### Task 3: 取消待确认退款申请

**Files:**
- Modify: `backend/src/checkout/deposit-refunds.service.ts`
- Modify: `backend/src/checkout/deposit-refunds.service.spec.ts`
- Modify: `backend/src/checkout/deposit-refunds.controller.ts`
- Modify: `backend/src/checkout/deposit-refunds.controller.spec.ts`
- Modify: `frontend/src/services/checkout.ts`

**Interfaces:**
- Produces: `DepositRefundsService.cancel(id: number, user: AuthUser)`.
- Produces: `POST /api/deposit-refunds/:id/cancel` for `SUPER_ADMIN` and `ADMIN`.
- Produces: `checkoutApi.cancelRefund(id: number)`.

- [ ] **Step 1: Write failing service and controller tests**

```ts
it('cancels only a pending refund and keeps checkout rent reservations', async () => {
  await service.cancel(49, admin);
  expect(db.depositRefund.updateMany).toHaveBeenCalledWith({
    where: { id: 49, approvalStatus: 'PENDING' },
    data: { approvalStatus: 'CANCELLED', cancelledReason: '取消本次退款申请' },
  });
  expect(db.checkoutRentRefundAllocation.updateMany).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm --prefix backend run test -- deposit-refunds.service.spec.ts deposit-refunds.controller.spec.ts --runInBand`

Expected: FAIL because `cancel` and the route do not exist.

- [ ] **Step 3: Implement cancellation with row locks, CAS and security audit**

Only `PENDING` is accepted. Set `approvalStatus = CANCELLED`, retain the settlement as `APPROVED`, leave reservations `RESERVED`, and write `CHECKOUT_REFUND_CANCELLED` audit data without user-entered reason.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm --prefix backend run test -- deposit-refunds.service.spec.ts deposit-refunds.controller.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/checkout/deposit-refunds.service.ts backend/src/checkout/deposit-refunds.service.spec.ts backend/src/checkout/deposit-refunds.controller.ts backend/src/checkout/deposit-refunds.controller.spec.ts frontend/src/services/checkout.ts
git commit -m "feat: cancel pending checkout refund applications"
```

### Task 4: 安全取消已确认但未完成的整个退租

**Files:**
- Create: `backend/src/checkout/checkout-approved-cancellation.ts`
- Create: `backend/src/checkout/checkout-approved-cancellation.spec.ts`
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`

**Interfaces:**
- Produces: `rollbackApprovedCheckout(tx, input): Promise<void>`.
- Consumes: `reverseFutureCheckoutBillNormalization` from Task 1.
- Extends: existing `CheckoutService.cancel` to accept `APPROVED` only before final refund.

- [ ] **Step 1: Write failing rollback tests**

```ts
it('cancels the pending combined refund, releases reservations and restores deposit offsets', async () => {
  await rollbackApprovedCheckout(tx, input);
  expect(tx.depositRefund.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalStatus: 'CANCELLED' }) }));
  expect(tx.checkoutRentRefundAllocation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'RELEASED' }) }));
  expect(tx.depositTransaction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ transactionType: 'REVERSAL' }) }));
});

it('rejects cancellation while a confirmed checkout supplemental payment exists', async () => {
  await expect(rollbackApprovedCheckout(txWithConfirmedSupplement, input)).rejects.toThrow('请先退款或作废退租补收款');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm --prefix backend run test -- checkout-approved-cancellation.spec.ts checkout.service.spec.ts --runInBand`

Expected: FAIL because the rollback module and APPROVED cancellation do not exist.

- [ ] **Step 3: Implement atomic rollback**

Lock contract, room, settlement, refund, deposit transactions, future bills, supplemental bill, payments and reservations in deterministic order. Cancel pending combined refunds; reverse settlement-linked deposit offsets; reverse future-bill corrections; void an unpaid supplemental bill; guardedly restore legacy future zero-received bills lacking a correction; release reservations; restore contract and room; write room history and security audit. Reject if a combined refund is already approved, settlement is completed, or supplemental money remains confirmed.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm --prefix backend run test -- checkout-approved-cancellation.spec.ts checkout.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/checkout/checkout-approved-cancellation.ts backend/src/checkout/checkout-approved-cancellation.spec.ts backend/src/checkout/checkout.service.ts backend/src/checkout/checkout.service.spec.ts
git commit -m "feat: safely cancel approved checkout settlements"
```

### Task 5: 普通退款和收款作废的审批期防重

**Files:**
- Modify: `backend/src/checkout/checkout-rent-refund-reservations.ts`
- Modify: `backend/src/checkout/checkout-rent-refund-reservations.spec.ts`
- Modify: `backend/src/payments/refunds.service.ts`
- Modify: `backend/src/payments/refunds.service.spec.ts`
- Modify: `backend/src/payments/void-requests.service.ts`
- Modify: `backend/src/payments/void-requests.service.spec.ts`

**Interfaces:**
- Produces: `assertNoCheckoutRentRefundReservationForAllocations(tx, allocationIds)`.
- Reuses: `assertNoCheckoutRentRefundReservation(tx, paymentId)`.

- [ ] **Step 1: Write failing approval-race tests**

```ts
it('rejects ordinary refund approval when its allocation became reserved by checkout', async () => {
  await expect(service.approve(refundId, dto, superAdmin)).rejects.toThrow('相关租金已被退租退款流程占用');
});

it('rejects payment void approval when the payment became reserved after submission', async () => {
  await expect(service.approve(voidId, superAdmin)).rejects.toThrow('相关租金已被退租退款流程占用');
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --prefix backend run test -- refunds.service.spec.ts void-requests.service.spec.ts checkout-rent-refund-reservations.spec.ts --runInBand`

Expected: FAIL because approval currently checks only the submission-time state.

- [ ] **Step 3: Add locked approval-time checks**

Ordinary refund checks only its affected payment allocation IDs; payment void checks the whole payment. Perform both checks after existing contract/payment/allocation locks and before any bill or allocation write.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm --prefix backend run test -- refunds.service.spec.ts void-requests.service.spec.ts checkout-rent-refund-reservations.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/checkout/checkout-rent-refund-reservations.ts backend/src/checkout/checkout-rent-refund-reservations.spec.ts backend/src/payments/refunds.service.ts backend/src/payments/refunds.service.spec.ts backend/src/payments/void-requests.service.ts backend/src/payments/void-requests.service.spec.ts
git commit -m "fix: recheck checkout reservations during reversals"
```

### Task 6: 退款页多工单、金额校验与两种取消按钮

**Files:**
- Modify: `frontend/src/views/checkout/checkout-types.ts`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue`
- Modify: `frontend/src/views/checkout/CheckoutRefundPanel.vue`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`
- Modify: `frontend/src/views/checkout/task8-refund-hardening.spec.ts`

**Interfaces:**
- `CheckoutRefundPanel` emits `cancelRefund(refundId)` and `cancelCheckout(settlementId)`.
- `CheckoutWorkspace` stores `refundPendingSettlements` and the selected settlement ID.
- `totalRefundAmount` becomes required for an actionable refund; component independently sums the three parts.

- [ ] **Step 1: Write failing component tests**

```ts
it('shows every pending checkout and loads the selected settlement', async () => {
  expect(wrapper.findAll('[data-test="refund-settlement-option"]')).toHaveLength(2);
  await wrapper.findAll('[data-test="refund-settlement-option"]')[1].trigger('click');
  expect(api.detail).toHaveBeenLastCalledWith(secondSettlementId);
});

it('blocks submission when total is missing or differs from component amounts', async () => {
  expect(wrapper.text()).toContain('退款金额数据不一致，请刷新后重试');
  expect(wrapper.find('[data-test="refund-submit"]').attributes('disabled')).toBeDefined();
});

it('offers cancel refund and cancel checkout as separate actions', () => {
  expect(wrapper.find('[data-test="refund-cancel"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="checkout-cancel-approved"]').exists()).toBe(true);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm --prefix frontend run test:unit -- src/views/checkout/checkout-workspace.spec.ts src/views/checkout/task8-refund-hardening.spec.ts`

Expected: FAIL because only the first pending settlement is retained, total defaults to zero, and no cancel actions exist.

- [ ] **Step 3: Implement selection, independent amount validation and cancel handlers**

Render compact settlement cards above the refund panel. Compute `componentTotal = deposit + prepayment + rent`, require a finite server total equal to it, and disable zero completion, refund submission and approval when inconsistent. Use distinct Chinese confirmation text for the two cancel operations; call `checkoutApi.cancelRefund` or `checkoutApi.cancel` and refresh all three checkout lists after success.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm --prefix frontend run test:unit -- src/views/checkout/checkout-workspace.spec.ts src/views/checkout/task8-refund-hardening.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/checkout/checkout-types.ts frontend/src/views/checkout/CheckoutWorkspace.vue frontend/src/views/checkout/CheckoutRefundPanel.vue frontend/src/views/checkout/checkout-workspace.spec.ts frontend/src/views/checkout/task8-refund-hardening.spec.ts
git commit -m "fix: make checkout refund recovery actions complete"
```

### Task 7: MySQL 接口回归与验收文档

**Files:**
- Modify: `backend/test/checkout-rent-refund.e2e-spec.ts`
- Modify: `docs/checkout-rent-refund-acceptance.md`

**Interfaces:**
- Exercises real HTTP services and the isolated local MySQL test database.

- [ ] **Step 1: Add the real-MySQL failing regression scenario**

Create a contract with a future rent bill of ¥800 and a confirmed ¥300 allocation, submit ¥100 rent refund, approve settlement, register combined refund, and assert the final endpoint currently fails before the fix. Add cancellation coverage for the pending refund and the approved settlement recovery path.

- [ ] **Step 2: Back up and validate the local test database before E2E**

Use the configured local test database only. Create a timestamped `mysqldump`, run `mysql --execute="SELECT 1"` against the dump target configuration, and verify the dump is non-empty. Never print the connection string or credentials.

- [ ] **Step 3: Run MySQL E2E and verify GREEN after implementation**

Run: `npm --prefix backend run test:e2e -- --runInBand test/checkout-rent-refund.e2e-spec.ts`

Expected: PASS with the partial-future-bill final values `200.00 / 200.00 / 0.00`, no active reservation after completion, and restored balances after cancellation.

- [ ] **Step 4: Run complete verification**

```bash
npm run db:validate
npm run lint
npm run build
npm --prefix backend run test -- --runInBand
npm --prefix frontend run test:unit
```

Expected: every command exits 0; backend and frontend show zero failed tests.

- [ ] **Step 5: Update acceptance evidence and commit**

Record exact commands, test counts, the reproduced ¥800/¥300/¥100 result, cancellation behavior, and any remaining operational limitation.

```bash
git add backend/test/checkout-rent-refund.e2e-spec.ts docs/checkout-rent-refund-acceptance.md
git commit -m "test: cover checkout refund recovery workflow"
```
