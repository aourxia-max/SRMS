# SRMS 合同作废／纠错 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增受审批、可审计、并发安全的合同作废／纠错流程，通过反向冲销使错误合同累计有效财务净影响归零，并保护后续合同、当前房态和历史记录。

**Architecture:** 在合同域内新增纠错申请、影响预览、执行编排和冲销明细四个边界清晰的单元。影响计算保持为无数据库依赖的纯函数；确认操作在单一 Prisma 事务中重新锁定并计算，通过唯一来源键保证幂等。现有财务、驾驶舱和合同工作区只消费纠错后的有效状态和追加流水，不删除原记录。

**Tech Stack:** MySQL 8、Prisma 7、NestJS 11、Jest/Supertest、Vue 3、TypeScript、Element Plus、Vitest、Docker Compose

**Spec:** `docs/superpowers/specs/2026-08-26-contract-void-correction-design.md`

## Global Constraints

- 业务基线为 `SRMS-RB-1.0-CR-20260826-01`；与旧规则冲突时以本变更为准。
- 不物理删除或覆盖原合同、金额、凭证、审批、退租和审计记录。
- 不区分现实资金是否到账，不要求退款日期、退款方式或退款凭证。
- 普通管理员只能申请；只有超级管理员可以确认或驳回；后端必须强制校验。
- 有后续合同时不得释放房源或覆盖当前房态。
- 历史冲销一律以执行时刻入账，并保留原业务发生时刻，不回写历史期间。
- 已完成作废不可恢复；本版本不提供复制为新合同草稿。
- 所有页面状态、类型、校验和错误提示使用中文。
- 每个任务严格执行测试先行：先看到预期失败，再写最小实现，再跑通过。
- 不修改或提交 `deploy/.env.test`、密码、令牌或密钥。

---

### Task 1: Prisma 纠错单、冲销明细和附件关系

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260826090000_contract_void_correction/migration.sql`
- Create: `backend/src/contracts/contract-void-schema.spec.ts`

**Interfaces:**
- Produces: Prisma models `ContractVoidRequest`, `ContractVoidReversal`, `ContractVoidRequestFile`
- Produces: enums `ContractVoidRequestStatus`, `ContractVoidReversalCategory`
- Produces: unique keys `activeContractKey`, `completedContractKey`, `executionBatchNo`, `idempotencyKey`
- Extends: `FileCategory` with `CONTRACT_VOID_PROOF`

- [ ] **Step 1: Write a failing schema test**

```ts
it('declares append-only contract void request and reversal storage', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  expect(schema).toContain('enum ContractVoidRequestStatus');
  expect(schema).toContain('model ContractVoidRequest');
  expect(schema).toContain('activeContractKey');
  expect(schema).toContain('completedContractKey');
  expect(schema).toContain('model ContractVoidReversal');
  expect(schema).toContain('idempotencyKey');
  expect(schema).toContain('model ContractVoidRequestFile');
});
```

- [ ] **Step 2: Run the schema test and verify the missing models fail**

  expect(schema).toContain('CONTRACT_VOID_PROOF');
Run: `npm --prefix backend test -- --runInBand contract-void-schema.spec.ts`

Expected: FAIL because `ContractVoidRequest` is absent.

- [ ] **Step 3: Add the Prisma enums and models**

```prisma
enum ContractVoidRequestStatus {
  PENDING
  COMPLETED
  REJECTED
  CANCELLED
}

enum ContractVoidReversalCategory {
  RENT_BILL
  PAYMENT
  PAYMENT_ALLOCATION
  PREPAYMENT
  DEPOSIT
  REFUND
  ADJUSTMENT
  PRICING_REBATE
  CHECKOUT
  COMMISSION
  ROOM_STATUS
}

model ContractVoidRequest {
  id                   Int                       @id @default(autoincrement()) @db.UnsignedInt
  requestNo            String                    @unique @map("request_no") @db.VarChar(40)
  contractId           Int                       @map("contract_id") @db.UnsignedInt
  status               ContractVoidRequestStatus @default(PENDING)
  reason               String                    @db.VarChar(500)
  impactSnapshot       Json                      @map("impact_snapshot")
  impactHash           String                    @map("impact_hash") @db.Char(64)
  activeContractKey    String?                   @unique @map("active_contract_key") @db.VarChar(80)
  completedContractKey String?                   @unique @map("completed_contract_key") @db.VarChar(80)
  executionBatchNo     String?                   @unique @map("execution_batch_no") @db.VarChar(40)
  resultSnapshot       Json?                     @map("result_snapshot")
  submittedBy          Int                       @map("submitted_by") @db.UnsignedInt
  submittedAt          DateTime                  @default(now()) @map("submitted_at") @db.DateTime(3)
  completedBy          Int?                      @map("completed_by") @db.UnsignedInt
  completedAt          DateTime?                 @map("completed_at") @db.DateTime(3)
  rejectedBy           Int?                      @map("rejected_by") @db.UnsignedInt
  rejectedAt           DateTime?                 @map("rejected_at") @db.DateTime(3)
  rejectedReason       String?                   @map("rejected_reason") @db.VarChar(500)
  cancelledBy          Int?                      @map("cancelled_by") @db.UnsignedInt
  cancelledAt          DateTime?                 @map("cancelled_at") @db.DateTime(3)
  createdAt            DateTime                  @default(now()) @map("created_at") @db.DateTime(3)
  updatedAt            DateTime                  @updatedAt @map("updated_at") @db.DateTime(3)
  contract             Contract                  @relation(fields: [contractId], references: [id], onDelete: Restrict)
  reversals            ContractVoidReversal[]
  files                ContractVoidRequestFile[]

  @@index([contractId, status, submittedAt])
  @@map("contract_void_requests")
}

model ContractVoidReversal {
  id                    Int                          @id @default(autoincrement()) @db.UnsignedInt
  contractVoidRequestId Int                          @map("contract_void_request_id") @db.UnsignedInt
  category              ContractVoidReversalCategory
  originalEntityType    String                       @map("original_entity_type") @db.VarChar(60)
  originalEntityId      Int?                         @map("original_entity_id") @db.UnsignedInt
  amount                Decimal                      @db.Decimal(14, 2)
  balanceBefore         Decimal?                     @map("balance_before") @db.Decimal(14, 2)
  balanceAfter          Decimal?                     @map("balance_after") @db.Decimal(14, 2)
  generatedEntityType   String?                      @map("generated_entity_type") @db.VarChar(60)
  generatedEntityId     Int?                         @map("generated_entity_id") @db.UnsignedInt
  originalOccurredAt    DateTime?                    @map("original_occurred_at") @db.DateTime(3)
  correctionOccurredAt  DateTime                     @map("correction_occurred_at") @db.DateTime(3)
  idempotencyKey        String                       @unique @map("idempotency_key") @db.VarChar(160)
  metadata              Json?
  request               ContractVoidRequest          @relation(fields: [contractVoidRequestId], references: [id], onDelete: Restrict)

  @@index([contractVoidRequestId, category])
  @@index([originalEntityType, originalEntityId])
  @@map("contract_void_reversals")
}
```

Add `Contract.voidRequests`, `FileAsset.contractVoidRequestFiles`, and the join model with composite primary key `[contractVoidRequestId, fileAssetId]`. Reuse the existing `ContractStatus.VOIDED`; do not add a duplicate enum value.
Extend the existing `FileCategory` enum with `CONTRACT_VOID_PROOF`; do not store a free-form attachment category string.


- [ ] **Step 4: Write the SQL migration with matching foreign keys and unique indexes**

The migration must create all three tables, enum-compatible VARCHAR columns as generated by Prisma for MySQL, `ON DELETE RESTRICT` foreign keys, and indexes matching the schema. It must not update existing contracts.

- [ ] **Step 5: Validate and generate Prisma client**

Run: `npm --prefix backend run prisma:validate`

Run: `npm --prefix backend run prisma:generate`

Expected: both commands exit 0.

- [ ] **Step 6: Run the schema test**

Run: `npm --prefix backend test -- --runInBand contract-void-schema.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260826090000_contract_void_correction backend/src/contracts/contract-void-schema.spec.ts
git commit -m "feat: add contract void correction schema"
```

---

### Task 2: Pure impact calculator and stable preview hash

**Files:**
- Create: `backend/src/contracts/contract-void-impact.ts`
- Create: `backend/src/contracts/contract-void-impact.spec.ts`

**Interfaces:**
- Produces: `computeContractVoidImpact(input: ContractVoidImpactInput): ContractVoidImpact`
- Produces: `hashContractVoidImpact(impact: ContractVoidImpact): string`
- Produces: `assertBalancedContractVoidImpact(impact: ContractVoidImpact): void`
- Consumes later: preview service and executor both call the same pure functions

- [ ] **Step 1: Define exact domain types in the failing test**

```ts
const input: ContractVoidImpactInput = {
  contract: { id: 7, status: 'ACTIVE', roomId: 3 },
  bills: [{ id: 11, status: 'PAID', payableAmount: '3000.00', receivedAmount: '3000.00', outstandingAmount: '0.00' }],
  payments: [{ id: 21, status: 'CONFIRMED', amount: '3000.00', allocatedAmount: '3000.00', refundedAmount: '500.00', prepaymentNet: '0.00' }],
  prepaymentBalance: '0.00',
  depositBalance: '1000.00',
  pending: { adjustments: [31], refunds: [], voidRequests: [], changes: [], rebates: [], checkouts: [] },
  completedCheckoutIds: [],
  laterContractIds: [],
  currentRoomStatus: 'RENTED',
};

expect(computeContractVoidImpact(input).summary).toEqual({
  rentBillPayable: '3000.00',
  effectivePayment: '2500.00',
  depositBalance: '1000.00',
  prepaymentBalance: '0.00',
  refundNet: '500.00',
  currentNetImpact: '3500.00',
  plannedReversal: '-3500.00',
  postReversalNetImpact: '0.00',
});
```

- [ ] **Step 2: Run the calculator test and verify it fails**

Run: `npm --prefix backend test -- --runInBand contract-void-impact.spec.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement decimal-safe calculation**

Use `Prisma.Decimal` for every amount. Count only effective statuses:

```ts
const activePayment = !['VOIDED', 'FULLY_REFUNDED'].includes(payment.status);
const paymentNet = activePayment
  ? decimal(payment.amount).minus(payment.refundedAmount)
  : decimal(0);
```

Return category rows with `originalEntityType`, `originalEntityId`, signed `amount`, `balanceBefore`, `balanceAfter`, `originalOccurredAt`, and metadata needed by the executor. Do not mutate the input.

- [ ] **Step 4: Implement canonical SHA-256 hashing**

Sort object keys recursively and sort impact rows by `category`, `originalEntityType`, and `originalEntityId` before hashing. The same business state must produce the same hash regardless of Prisma relation order.

- [ ] **Step 5: Add balance and edge-case tests**

Cover no payments, partial payment, approved partial refund, fully refunded payment, already voided payment, positive deposit, consumed prepayment, completed checkout, later contract, and pending workflow IDs. Assert an unbalanced fixture throws `合同纠错金额无法平衡：<分类>`.

- [ ] **Step 6: Run the calculator tests**

Run: `npm --prefix backend test -- --runInBand contract-void-impact.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/contracts/contract-void-impact.ts backend/src/contracts/contract-void-impact.spec.ts
git commit -m "feat: calculate contract void impact"
```

---

### Task 3: Impact snapshot loader and preview query

**Files:**
- Create: `backend/src/contracts/contract-void-preview.service.ts`
- Create: `backend/src/contracts/contract-void-preview.service.spec.ts`
- Modify: `backend/src/contracts/contracts.module.ts`

**Interfaces:**
- Produces: `ContractVoidPreviewService.preview(contractId: number, user: AuthUser): Promise<ContractVoidImpact>`
- Produces: `ContractVoidPreviewService.loadInput(db: Prisma.TransactionClient | PrismaClient, contractId: number): Promise<ContractVoidImpactInput>`
- Consumes: Task 2 calculator and hash

- [ ] **Step 1: Write a failing preview service test**

Mock Prisma delegates and assert one preview loads contract members, room, bills and allocations, payments and refunds, prepayment transactions, deposit transactions, adjustments, rebates, checkout settlements, commissions, pending requests, and later non-voided room contracts.

```ts
await expect(service.preview(7, admin)).resolves.toMatchObject({
  contract: { id: 7 },
  impactHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  room: { hasLaterContract: true, action: 'KEEP_CURRENT_STATUS' },
});
```

- [ ] **Step 2: Run and verify failure**

Run: `npm --prefix backend test -- --runInBand contract-void-preview.service.spec.ts`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement a single snapshot loader**

Select only required fields. Derive balances from the latest `PrepaymentTransaction.balanceAfter` and `DepositTransaction.balanceAfter`. Preserve both `occurredAt` and execution time. Identify later contracts by the same `roomId`, `id != contractId`, and `status != VOIDED`.

- [ ] **Step 4: Enforce preview visibility**

Allow `SUPER_ADMIN` and `ADMIN`; reject `VISITOR` with `当前角色不能查看合同作废影响`. Reject an already voided contract with `合同已作废，不能再次发起纠错`.

- [ ] **Step 5: Run tests**

Run: `npm --prefix backend test -- --runInBand contract-void-preview.service.spec.ts contract-void-impact.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/contracts/contract-void-preview.service.ts backend/src/contracts/contract-void-preview.service.spec.ts backend/src/contracts/contracts.module.ts
git commit -m "feat: preview contract void impact"
```

---

### Task 4: Application workflow, DTO validation, files and backend permissions

**Files:**
- Create: `backend/src/contracts/dto/contract-void.dto.ts`
- Create: `backend/src/contracts/contract-void-requests.service.ts`
- Create: `backend/src/contracts/contract-void-requests.service.spec.ts`
- Create: `backend/src/contracts/contract-void.controller.ts`
- Create: `backend/src/contracts/contract-void.controller.spec.ts`
- Modify: `backend/src/contracts/contracts.module.ts`
- Modify: `backend/src/files/files.service.ts`
- Modify: `backend/src/files/files.service.spec.ts`

**Interfaces:**
- Produces endpoints:
  - `GET /contracts/void-requests`
  - `GET /contracts/void-requests/:id`
  - `GET /contracts/:id/void-preview`
  - `POST /contracts/void-requests`
  - `POST /contracts/void-requests/:id/cancel`
  - `POST /contracts/void-requests/:id/reject`
  - `POST /contracts/void-request-files`
- Produces DTOs `ListContractVoidRequestsDto`, `SubmitContractVoidRequestDto`, `RejectContractVoidRequestDto`
- Consumes: Task 3 preview

- [ ] **Step 1: Write failing DTO and service tests**

```ts
const submit = plainToInstance(SubmitContractVoidRequestDto, {
  contractId: 7,
  reason: '',
  impactHash: 'bad',
  idempotencyKey: '',
});
expect(await validate(submit)).not.toHaveLength(0);
```

Assert `reason` is 1–500 characters, `impactHash` is 64 lowercase hex characters, `fileAssetIds` are unique positive integers, and `idempotencyKey` is 16–100 characters.

- [ ] **Step 2: Run and verify failure**

Run: `npm --prefix backend test -- --runInBand contract-void-requests.service.spec.ts contract-void.controller.spec.ts`

Expected: FAIL because the workflow does not exist.

- [ ] **Step 3: Implement request creation and uniqueness**

Create `activeContractKey = contract:${contractId}` while pending. Store the latest impact snapshot and hash. If the submitted hash differs, return `合同关联数据已变化，请重新预览`. Convert the unique-key collision to `该合同已有待确认的作废申请`.

- [ ] **Step 4: Implement cancel and reject transitions**

The submitter or a super administrator can cancel only `PENDING`; only a super administrator can reject. Terminal transitions clear `activeContractKey`. Reject requires a non-empty reason. Every transition creates an operation log.

- [ ] **Step 5: Implement contract-void file upload**

Reuse `FilesService` size, MIME, SHA-256 and storage rules. Save category `CONTRACT_VOID_PROOF`, link through `ContractVoidRequestFile`, and keep attachment optional.

- [ ] **Step 6: Add controller role tests**

Assert `VISITOR` cannot preview or create, `ADMIN` cannot reject, and response envelopes are `{ code: 200, message: 'success', data }`.

- [ ] **Step 7: Run tests**

Run: `npm --prefix backend test -- --runInBand contract-void-requests.service.spec.ts contract-void.controller.spec.ts files.service.spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/contracts/dto/contract-void.dto.ts backend/src/contracts/contract-void-requests.service.ts backend/src/contracts/contract-void-requests.service.spec.ts backend/src/contracts/contract-void.controller.ts backend/src/contracts/contract-void.controller.spec.ts backend/src/contracts/contracts.module.ts backend/src/files/files.service.ts backend/src/files/files.service.spec.ts
git commit -m "feat: add contract void request workflow"
```

---

### Task 5: Transactional executor, cancellation and append-only reversals

**Files:**
- Create: `backend/src/contracts/contract-void-executor.service.ts`
- Create: `backend/src/contracts/contract-void-executor.service.spec.ts`
- Create: `backend/src/contracts/contract-void-reversal-writer.ts`
- Create: `backend/src/contracts/contract-void-reversal-writer.spec.ts`
- Create: `backend/src/system/security-audit-chain.service.ts`
- Create: `backend/src/system/security-audit-chain.service.spec.ts`
- Modify: `backend/src/contracts/contracts.module.ts`
- Modify: `backend/src/system/system.module.ts`
- Modify: `backend/src/system/system.service.ts`
- Modify: `backend/src/contracts/contract-void-requests.service.ts`
- Modify: `backend/src/contracts/contract-void.controller.ts`

**Interfaces:**
- Produces: `ContractVoidExecutorService.execute(requestId: number, previewHash: string, confirmation: string, idempotencyKey: string, user: AuthUser): Promise<ContractVoidResult>`
- Produces: `ContractVoidReversalWriter.write(tx, request, impact, now): Promise<ContractVoidReversal[]>`
- Produces: `SecurityAuditChainService.append(tx, event): Promise<SecurityAuditLog>`
- Produces endpoint: `POST /contracts/void-requests/:id/approve`
- Consumes: Tasks 1–4

- [ ] **Step 1: Write a failing atomic execution test**

```ts
await expect(executor.execute(9, hash, '确认作废合同', key, superAdmin))
  .resolves.toMatchObject({ status: 'COMPLETED', contractStatus: 'VOIDED' });
expect(tx.contract.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ status: 'VOIDED' }),
}));
expect(tx.contractVoidReversal.createMany).toHaveBeenCalled();
```

Also assert a thrown reversal error prevents contract, request and room updates from committing.

- [ ] **Step 2: Run and verify failure**

Run: `npm --prefix backend test -- --runInBand contract-void-executor.service.spec.ts contract-void-reversal-writer.spec.ts`

Expected: FAIL because execution is missing.

- [ ] **Step 3: Add ordered row locks and stale-preview protection**

Inside one `prisma.db.$transaction`, lock in this order: request, contract, bills, payments, refunds, prepayment transactions, deposit transactions, adjustments, rebates, checkout settlements, room. Reload the impact and compare `impactHash`; mismatch returns `合同关联数据已变化，请重新预览`.

- [ ] **Step 4: Cancel pending related workflows with exact terminal states**

Set `ContractChange`, `BillAdjustment`, `PaymentRefund`, `PaymentVoidRequest`, `PricingRebate`, and `DepositRefund` from `DRAFT` or `PENDING` to `ApprovalStatus.CANCELLED`. Set `CheckoutSettlement` from `DRAFT`, `PENDING`, or `REJECTED` to `CheckoutSettlementStatus.CANCELLED`. Do not modify approved or completed rows in this cancellation step; those are preserved and receive reversal entries in Step 5. Record one `ContractVoidReversal` per affected record with amount `0.00` and metadata `{ previousStatus, nextStatus }`.

- [ ] **Step 5: Write financial reversals**

- Mark effective `Payment` rows `VOIDED` with `voidReason = 合同纠错单 <requestNo>` while retaining amount and files.
- Mark all contract `RentBill` rows `VOIDED` while retaining snapshot amounts.
- Append `PrepaymentTransaction(transactionType: REVERSAL, amount: abs(currentBalance), balanceAfter: 0)` when the current balance is non-zero.
- Append `DepositTransaction(transactionType: REVERSAL, amount: abs(currentBalance), balanceAfter: 0)` when the current balance is non-zero.
- Preserve approved refunds and completed checkout rows; represent their inverse effect in `ContractVoidReversal` instead of changing their original amounts or dates.
- Create category rows with deterministic keys `contract-void:<requestId>:<category>:<sourceId>`.

- [ ] **Step 6: Enforce confirmation and idempotency**

Reject non-super-admin users with `只有超级管理员可以确认合同作废`. Reject a confirmation other than exact `确认作废合同`. A repeated `idempotencyKey` returns the original completed result; a different key against a completed contract returns `合同已作废，不能重复冲销`.

- [ ] **Step 7: Extract and use the shared security audit-chain writer**

Move the existing canonical payload construction, previous-hash lookup, SHA-256 calculation and insert logic from `SystemService` into `SecurityAuditChainService.append`. Refactor `SystemService` to call the shared service and preserve its current byte-for-byte hash test. Export the service from `SystemModule`, import `SystemModule` in `ContractsModule`, and call it inside the same correction transaction. Create `CONTRACT_VOID_COMPLETED` with request number, contract number, impact hash, execution batch, category totals, room action, before status and after status.

- [ ] **Step 8: Add failure, refund and completed-checkout tests**

Cover approved partial refund, fully refunded payment, already voided payment, completed checkout, positive deposit, consumed prepayment, and a forced exception after reversal insertion. Assert no duplicate reversal source key and final category balances are zero.

- [ ] **Step 9: Run tests**

Run: `npm --prefix backend test -- --runInBand contract-void-executor.service.spec.ts contract-void-reversal-writer.spec.ts contract-void-requests.service.spec.ts security-audit-chain.service.spec.ts system.service.spec.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/contracts/contract-void-executor.service.ts backend/src/contracts/contract-void-executor.service.spec.ts backend/src/contracts/contract-void-reversal-writer.ts backend/src/contracts/contract-void-reversal-writer.spec.ts backend/src/contracts/contract-void-requests.service.ts backend/src/contracts/contract-void.controller.ts backend/src/contracts/contracts.module.ts backend/src/system/security-audit-chain.service.ts backend/src/system/security-audit-chain.service.spec.ts backend/src/system/system.module.ts backend/src/system/system.service.ts
git commit -m "feat: execute atomic contract void reversals"
```

---

### Task 6: Room reconciliation and voided-contract operation guards

**Files:**
- Create: `backend/src/contracts/contract-room-reconciliation.ts`
- Create: `backend/src/contracts/contract-room-reconciliation.spec.ts`
- Create: `backend/src/contracts/contract-operability.ts`
- Create: `backend/src/contracts/contract-operability.spec.ts`
- Modify: `backend/src/contracts/contract-void-executor.service.ts`
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/payments/payments.service.ts`
- Modify: `backend/src/payments/adjustments.service.ts`
- Modify: `backend/src/payments/refunds.service.ts`
- Modify: `backend/src/payments/void-requests.service.ts`
- Modify: `backend/src/pricing-rebates/pricing-rebates.service.ts`
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/deposits.service.ts`
- Modify: `backend/src/finance/commissions.service.ts`

**Interfaces:**
- Produces: `resolveRoomStatusAfterContractVoid(input: RoomReconciliationInput): RoomReconciliationResult`
- Produces: `assertContractNotVoided(status: ContractStatus, actionLabel: string): void`
- Consumes: Task 5 executor

- [ ] **Step 1: Write failing room-resolution tests**

```ts
expect(resolveRoomStatusAfterContractVoid({
  currentStatus: 'RENTED',
  laterContracts: [{ status: 'ACTIVE' }],
})).toEqual({ action: 'KEEP_CURRENT_STATUS', targetStatus: 'RENTED' });
```

Cover no other contract, pending-start successor, active successor, maintenance, for-sale, sold and disabled room states.

- [ ] **Step 2: Write failing guard tests**

Assert every service entry rejects `VOIDED` with action-specific Chinese messages such as `已作废合同不能登记收款` and `已作废合同不能发起退租`.

- [ ] **Step 3: Run and verify failure**

Run: `npm --prefix backend test -- --runInBand contract-room-reconciliation.spec.ts contract-operability.spec.ts`

Expected: FAIL because helpers are missing.

- [ ] **Step 4: Implement room reconciliation**

Keep `MAINTENANCE`, `FOR_SALE`, `SOLD`, and `DISABLED`. Keep current status when another non-voided current/future contract exists. Otherwise return the existing system's available-room status and write `RoomStatusHistory` with `businessType = CONTRACT_VOID` and `businessId = requestId` only when the status actually changes.

- [ ] **Step 5: Apply backend guards**

Call `assertContractNotVoided` after loading the contract and before any mutation in payment, adjustment, refund, payment void, rebate, checkout, deposit, commission and contract-change paths. Preserve existing stricter status rules.

- [ ] **Step 6: Run affected service tests**

Run: `npm --prefix backend test -- --runInBand contract-room-reconciliation.spec.ts contract-operability.spec.ts payments.service.spec.ts adjustments.service.spec.ts refunds.service.spec.ts void-requests.service.spec.ts pricing-rebates.service.spec.ts checkout.service.spec.ts deposits.service.spec.ts commissions.service.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/contracts backend/src/payments backend/src/pricing-rebates backend/src/checkout backend/src/finance/commissions.service.ts backend/src/finance/commissions.service.spec.ts
git commit -m "feat: protect voided contracts and reconcile rooms"
```

---

### Task 7: Finance, dashboard, exports and contract presentation

**Files:**
- Modify: `backend/src/finance/finance.service.ts`
- Modify: `backend/src/finance/finance.service.spec.ts`
- Modify: `backend/src/finance/finance-export.service.ts`
- Modify: `backend/src/finance/finance-export.service.spec.ts`
- Modify: `backend/src/finance/commissions.service.ts`
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/dashboard-room-card-rent.spec.ts`
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/contracts/contracts.service.spec.ts`
- Modify: `backend/src/rent-bills/rent-bills.service.ts`
- Modify: `backend/src/rent-bills/rent-bills.service.spec.ts`

**Interfaces:**
- Produces finance flow type `CONTRACT_VOID_REVERSAL` with Chinese label `合同纠错冲销`
- Produces contract detail field `voidRequest?: { id; requestNo; status; completedAt }`
- Consumes: Task 1 reversal rows and `ContractStatus.VOIDED`

- [ ] **Step 1: Write failing reporting tests**

Assert voided bills and payments do not contribute to rent collection, deposit balance, prepayment balance or dashboard rent figures. Assert correction rows appear in cash-flow detail on `correctionOccurredAt`, preserve `originalOccurredAt`, and export as `合同纠错冲销`.

- [ ] **Step 2: Run and verify failure**

Run: `npm --prefix backend test -- --runInBand finance.service.spec.ts finance-export.service.spec.ts dashboard-room-card-rent.spec.ts rent-bills.service.spec.ts`

Expected: at least one assertion fails because correction reversals are not yet queried.

- [ ] **Step 3: Update active-value queries**

Exclude `Contract.status = VOIDED`, `RentBill.status = VOIDED`, and `Payment.status = VOIDED` from effective operating totals. Filter commission list and export by `contract.status != VOIDED`. Keep original records visible in detail queries.

- [ ] **Step 4: Append correction flow rows**

Map financial `ContractVoidReversal` rows into the existing money-flow result with request number, contract number, correction date, original business date, signed amount and source links. Do not rewrite old payment or refund dates.

- [ ] **Step 5: Add contract status presentation data**

Return the completed or pending correction summary in contract detail and preserve `VOIDED` contracts in unfiltered contract lists. Effective-contract selectors used by payment, rebate and checkout must omit them.

- [ ] **Step 6: Run reporting tests**

Run: `npm --prefix backend test -- --runInBand finance.service.spec.ts finance-export.service.spec.ts commissions.service.spec.ts dashboard-room-card-rent.spec.ts contracts.service.spec.ts rent-bills.service.spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/finance backend/src/dashboard backend/src/contracts/contracts.service.ts backend/src/contracts/contracts.service.spec.ts backend/src/rent-bills
git commit -m "feat: report contract void reversals"
```

---

### Task 8: Frontend types, API client and Chinese presentation helpers

**Files:**
- Modify: `frontend/src/types/contracts.ts`
- Modify: `frontend/src/services/contracts.ts`
- Create: `frontend/src/services/contract-voids.spec.ts`
- Create: `frontend/src/components/contracts/voids/contract-void-presentation.ts`
- Create: `frontend/src/components/contracts/voids/contract-void-presentation.spec.ts`
- Modify: `frontend/src/utils/status-labels.ts`
- Modify: `frontend/src/utils/status-labels.spec.ts`

**Interfaces:**
- Produces types `ContractVoidRequest`, `ContractVoidImpact`, `ContractVoidReversal`, `ContractVoidRequestStatus`
- Produces clients `previewContractVoid`, `listContractVoidRequests`, `getContractVoidRequest`, `submitContractVoidRequest`, `cancelContractVoidRequest`, `approveContractVoidRequest`, `rejectContractVoidRequest`
- Produces `contractVoidStatusLabel` and category labels

- [ ] **Step 1: Write failing API-client and presentation tests**

```ts
expect(contractVoidStatusLabel('COMPLETED')).toBe('已完成');
expect(contractVoidCategoryLabel('DEPOSIT')).toBe('押金');
await previewContractVoid(7);
expect(http.get).toHaveBeenCalledWith('/contracts/7/void-preview');
```

- [ ] **Step 2: Run and verify failure**

Run: `npm --prefix frontend run test:unit -- src/services/contract-voids.spec.ts src/components/contracts/voids/contract-void-presentation.spec.ts`

Expected: FAIL because the exports are missing.

- [ ] **Step 3: Add exact frontend types and clients**

Use string amounts in API types. Keep `impactHash`, `executionBatchNo`, original/correction dates and source links. Submit confirmation only for super-admin direct execution or approval.

- [ ] **Step 4: Add complete Chinese mappings**

Map four request statuses, eleven reversal categories and `VOIDED` contract state. Unknown values display `未知状态（<value>）` rather than raw code alone.

- [ ] **Step 5: Run tests**

Run: `npm --prefix frontend run test:unit -- src/services/contract-voids.spec.ts src/components/contracts/voids/contract-void-presentation.spec.ts src/utils/status-labels.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/contracts.ts frontend/src/services/contracts.ts frontend/src/services/contract-voids.spec.ts frontend/src/components/contracts/voids frontend/src/utils/status-labels.ts frontend/src/utils/status-labels.spec.ts
git commit -m "feat: add contract void frontend domain"
```

---

### Task 9: Contract workspace pages and risk-confirmation interaction

**Files:**
- Create: `frontend/src/components/contracts/voids/ContractVoidPanel.vue`
- Create: `frontend/src/components/contracts/voids/ContractVoidImpactCards.vue`
- Create: `frontend/src/components/contracts/voids/contract-void-panel.spec.ts`
- Modify: `frontend/src/components/contracts/ContractTopNav.vue`
- Modify: `frontend/src/components/contracts/contract-top-nav.spec.ts`
- Modify: `frontend/src/components/contracts/ContractDetailPanel.vue`
- Create: `frontend/src/components/contracts/contract-detail-void-entry.spec.ts`
- Modify: `frontend/src/components/contracts/ContractListPanel.vue`
- Modify: `frontend/src/views/contracts/ContractsWorkspace.vue`
- Modify: `frontend/src/views/contracts/contract-workspace.spec.ts`
- Modify: `frontend/src/types/contracts.ts`

**Interfaces:**
- Adds workspace tab `'void-correction'`
- Adds detail event `void-correction: [contractId: number]`
- Consumes: Task 8 API and types

- [ ] **Step 1: Write failing navigation and entry tests**

Assert the top navigation contains the fifth item `合同作废／纠错`, the detail button is shown only to `ADMIN` and `SUPER_ADMIN` on non-voided contracts, and clicking it opens the panel with the selected contract.

- [ ] **Step 2: Run and verify failure**

Run: `npm --prefix frontend run test:unit -- src/components/contracts/contract-top-nav.spec.ts src/components/contracts/contract-detail-void-entry.spec.ts src/views/contracts/contract-workspace.spec.ts`

Expected: FAIL because the tab and action are absent.

- [ ] **Step 3: Build the request list and search**

`ContractVoidPanel.vue` must provide contract number, room and tenant search; four Chinese status filters; columns for request number, contract, room, tenant, reason, submitter, status and time; and read-only detail for terminal requests.

- [ ] **Step 4: Build impact preview and submission form**

`ContractVoidImpactCards.vue` renders bill, payment, deposit, prepayment, refund and final net cards. The form requires reason, accepts optional attachment, shows pending workflow IDs, completed checkout, later contract and room action, and disables submit when `impactHash` is absent.

- [ ] **Step 5: Implement risk confirmation**

For super-admin direct execution and approval, use an Element Plus prompt whose validator accepts only exact `确认作废合同`. A stale-preview response reloads the preview and shows `合同关联数据已变化，已为你重新计算，请再次核对`.

- [ ] **Step 6: Implement terminal-state and voided-contract UI**

Show a red `已作废` tag in contract list and detail. Hide payment, checkout, rebate, commission editing and void entry actions on a voided contract. Keep attachment preview and historical tabs available.

- [ ] **Step 7: Add panel tests**

Cover admin submit, super-admin direct confirmation, reject, cancel own pending request, stale preview reload, Chinese empty states, attachment upload, terminal read-only behavior, and no duplicate submit while saving.

- [ ] **Step 8: Run frontend tests**

Run: `npm --prefix frontend run test:unit -- src/components/contracts/voids/contract-void-panel.spec.ts src/components/contracts/contract-top-nav.spec.ts src/components/contracts/contract-detail-void-entry.spec.ts src/views/contracts/contract-workspace.spec.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/contracts frontend/src/views/contracts/ContractsWorkspace.vue frontend/src/views/contracts/contract-workspace.spec.ts frontend/src/types/contracts.ts
git commit -m "feat: add contract void correction workspace"
```

---

### Task 10: Backend API integration and end-to-end financial invariants

**Files:**
- Create: `backend/test/contract-void-correction.e2e-spec.ts`
- Modify: `backend/src/contracts/contract-void.controller.spec.ts`
- Modify: `backend/src/contracts/contract-void-executor.service.spec.ts`

**Interfaces:**
- Verifies all endpoints and cross-module invariants from Tasks 1–9

- [ ] **Step 1: Write an E2E fixture builder**

Create uniquely numbered test rooms, tenants and contracts. Build four scenarios: simple unpaid contract, paid contract with auto deposit, completed checkout contract, and historical contract followed by another active contract in the same room.

- [ ] **Step 2: Write failing role and workflow E2E cases**

Assert visitor preview is 403; admin application becomes `PENDING`; admin approval is 403; super-admin wrong confirmation is 400; super-admin exact confirmation completes; repeated idempotency key returns the original result.

- [ ] **Step 3: Write failing money and room E2E assertions**

For each scenario assert:

```ts
expect(result.data.summary.postReversalNetImpact).toBe('0.00');
expect(contract.status).toBe('VOIDED');
expect(allBills.every((bill) => bill.status === 'VOIDED')).toBe(true);
expect(latestDepositBalance).toBe('0.00');
expect(latestPrepaymentBalance).toBe('0.00');
expect(successorRoomStatus).toBe(roomStatusBeforeVoid);
```

- [ ] **Step 4: Run E2E and verify failure before final integration fixes**

Run with the existing isolated test configuration, importing `deploy/.env.test` into the process without printing it:

`npm --prefix backend run test:e2e -- --runInBand contract-void-correction.e2e-spec.ts`

Expected: FAIL at the first missing integration behavior.

- [ ] **Step 5: Fix only integration gaps exposed by E2E**

Keep fixes inside contract-void services, existing status filters and room reconciliation. Do not add physical deletes, recovery, contract copying or generic accounting-edit APIs.

- [ ] **Step 6: Run E2E again**

Run: `npm --prefix backend run test:e2e -- --runInBand contract-void-correction.e2e-spec.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/test/contract-void-correction.e2e-spec.ts backend/src
git commit -m "test: verify contract void correction workflow"
```

---

### Task 11: Full regression, migration rehearsal and acceptance record

**Files:**
- Create: `docs/contract-void-correction-acceptance.md`
- Modify only if verification exposes defects: files already listed in Tasks 1–10

**Interfaces:**
- Produces final verification evidence and manual acceptance steps

- [ ] **Step 1: Run database checks**

Run: `npm run db:validate`

Run: `npm run db:generate`

Expected: both exit 0.

- [ ] **Step 2: Run backend lint, unit tests and build**

Run: `npm run lint`

Run: `npm test -- --runInBand`

Run: `npm --prefix backend run build`

Expected: all exit 0.

- [ ] **Step 3: Run frontend unit tests and build**

Run: `npm --prefix frontend run test:unit -- --testTimeout=15000`

Run: `npm --prefix frontend run build`

Expected: all tests pass and build exits 0. Record the existing bundle-size warning separately; do not treat it as a contract-void failure.

- [ ] **Step 4: Rehearse migration against the test database**

Back up the test database, apply `20260826090000_contract_void_correction`, run `prisma migrate status`, and confirm all new tables, foreign keys and unique indexes exist. Do not display `deploy/.env.test`.

- [ ] **Step 5: Run all backend E2E suites**

Run: `npm --prefix backend run test:e2e -- --runInBand`

Expected: all E2E suites pass.

- [ ] **Step 6: Update the local Docker test environment**

Run: `docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.yml up -d --build api web`

Check: `http://localhost:13000/api/health` returns 200 and `http://localhost:15173/` returns 200.

- [ ] **Step 7: Perform four manual acceptance flows**

Use records prefixed `合同纠错测试-` and verify: simple unpaid void, paid plus auto-deposit void, completed-checkout historical correction, and historical contract with an active successor. Confirm source records remain, correction detail is complete, all financial category net effects are zero, and successor room state is unchanged.

- [ ] **Step 8: Write the acceptance record**

Document commit, migration, modified files, automated test counts, four manual outcomes, test-environment URLs, known warnings and rollback procedure in `docs/contract-void-correction-acceptance.md`.

- [ ] **Step 9: Commit**

```bash
git add docs/contract-void-correction-acceptance.md
git commit -m "docs: record contract void correction acceptance"
```

---

### Task 12: Review gate, local integration and production-safety handoff

**Files:**
- Review: all files changed in Tasks 1–11
- No new production code unless review finds a verified defect

**Interfaces:**
- Produces a reviewed branch ready for the user's chosen integration path

- [ ] **Step 1: Request a requirements review**

Provide the reviewer the spec path, plan path, base SHA and feature HEAD. Require explicit coverage of permissions, no physical delete, all financial categories, completed checkout, later contracts, historical posting date, idempotency and Chinese UI.

- [ ] **Step 2: Request a code-quality review**

Require explicit review of transaction boundaries, row-lock order, unique keys, Decimal arithmetic, stale preview handling, audit append-only behavior and report double counting.

- [ ] **Step 3: Fix Critical and Important findings with a red-green test**

For each valid finding, add a test that fails for the reported behavior, implement the narrow fix, rerun the affected suite and commit the fix separately.

- [ ] **Step 4: Run final verification from a clean branch**

Run: `git status --short`

Run: `npm run lint && npm test -- --runInBand && npm --prefix backend run test:e2e -- --runInBand && npm --prefix frontend run test:unit -- --testTimeout=15000 && npm run build && npm run db:validate`

Expected: no tracked changes and every command exits 0.

- [ ] **Step 5: Present integration choices**

Offer local merge, push and pull request, or keeping the feature branch. Do not push GitHub or deploy production without the user's explicit choice.
