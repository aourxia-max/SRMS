# Contract Deposit Auto-Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every newly created contract's entered deposit become an atomic confirmed deposit receipt and ledger balance, and expose the current total deposit balance in Finance Center.

**Architecture:** Keep `contracts.deposit_required` as the initial deposit amount but create the financial truth in `payments` and `deposit_transactions` inside the existing contract-creation transaction. A focused contract-deposit service owns automatic receipt creation and database idempotency, while Finance Service aggregates the latest ledger balance per contract on the server. Existing contracts receive no backfill.

**Tech Stack:** Node.js 24+, NestJS 11, Prisma 7/MySQL, Jest/Supertest, Vue 3, TypeScript 6, Element Plus, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-contract-deposit-auto-receipt-design.md`

## Global Constraints

- SRMS-RB-1.0 remains the baseline except for the explicit deposit rule override in the linked spec.
- A new contract deposit means actual money received; it must create both a confirmed `DEPOSIT` payment and a `RECEIPT` deposit ledger entry.
- Draft saves never create financial records; a draft submitted after release is a new contract and follows the new rule.
- Existing rows already present in `contracts` receive no backfill and no mutation.
- Current deposit balance and Finance Center totals come only from immutable deposit ledger balances, never directly from `deposit_required`.
- Users do not enter a deposit payment date, method, or proof; the system records the contract creation date and `SYSTEM_AUTO`.
- Automatic deposit receipts do not allocate rent bills and do not increase rent receipts.
- Backend authorization remains mandatory; Finance Center endpoints remain `SUPER_ADMIN` only.
- Preserve all unrelated dirty-worktree changes; stage and commit only the files named by each task.
- All user-visible statuses, methods, validation errors, and labels added by this change must be Chinese.

---

### Task 1: Add automatic-payment provenance and safe payment-method validation

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260823170000_contract_deposit_auto_receipt/migration.sql`
- Create: `backend/src/payments/payment-methods.ts`
- Modify: `backend/src/payments/dto/record-payment.dto.ts`
- Modify: `backend/src/payments/dto/record-checkout-supplemental-payment.dto.ts`
- Modify: `backend/src/payments/dto/edit-payment.dto.ts`
- Modify: `backend/src/payments/dto/submit-refund.dto.ts`
- Modify: `backend/src/checkout/dto/record-deposit.dto.ts`
- Modify: `backend/src/checkout/dto/submit-deposit-refund.dto.ts`
- Modify: `backend/src/pricing-rebates/dto/submit-pricing-rebate.dto.ts`
- Test: `backend/src/payments/dto/record-payment.dto.spec.ts`
- Create: `backend/src/payments/payment-methods.spec.ts`

**Interfaces:**
- Produces: Prisma `PaymentMethod.SYSTEM_AUTO`.
- Produces: nullable unique `Payment.autoSourceKey: string | null`, mapped to `auto_source_key`.
- Produces: `MANUAL_PAYMENT_METHODS` and `isManualPaymentMethod(value: unknown): value is ManualPaymentMethod`.
- Consumes: existing public methods `WECHAT | ALIPAY | BANK_TRANSFER | CASH | POS | OTHER`.

- [ ] **Step 1: Write failing validation tests**

Add tests proving `SYSTEM_AUTO` is an internal method and cannot be submitted through a manual receipt DTO:

```ts
it('rejects the internal automatic method on manual payment input', async () => {
  const errors = await validate(
    plainToInstance(RecordPaymentDto, {
      contractId: 1,
      paymentDate: '2026-08-23',
      amount: '100.00',
      method: 'SYSTEM_AUTO',
      allocations: [],
    }),
  );
  expect(errors.some((item) => item.property === 'method')).toBe(true);
});

it('recognizes only user-selectable payment methods', () => {
  expect(isManualPaymentMethod('BANK_TRANSFER')).toBe(true);
  expect(isManualPaymentMethod('SYSTEM_AUTO')).toBe(false);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm --prefix backend test -- --runInBand src/payments/payment-methods.spec.ts src/payments/dto/record-payment.dto.spec.ts`

Expected: FAIL because `SYSTEM_AUTO`, `MANUAL_PAYMENT_METHODS`, and the manual-method validator do not exist.

- [ ] **Step 3: Add schema and migration**

Extend the Prisma model:

```prisma
enum PaymentMethod {
  WECHAT
  ALIPAY
  BANK_TRANSFER
  CASH
  POS
  OTHER
  SYSTEM_AUTO
}

model Payment {
  // existing fields
  autoSourceKey String? @unique @map("auto_source_key") @db.VarChar(100)
}
```

Create a migration that only changes structure and never inserts historical receipts:

```sql
ALTER TABLE `payments`
  MODIFY COLUMN `method` ENUM(
    'WECHAT','ALIPAY','BANK_TRANSFER','CASH','POS','OTHER','SYSTEM_AUTO'
  ) NOT NULL,
  ADD COLUMN `auto_source_key` VARCHAR(100) NULL AFTER `external_reference`,
  ADD UNIQUE INDEX `payments_auto_source_key_key` (`auto_source_key`);
```

- [ ] **Step 4: Restrict all user-input DTOs to manual methods**

Create the shared boundary:

```ts
export const MANUAL_PAYMENT_METHODS = [
  'WECHAT',
  'ALIPAY',
  'BANK_TRANSFER',
  'CASH',
  'POS',
  'OTHER',
] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export function isManualPaymentMethod(
  value: unknown,
): value is ManualPaymentMethod {
  return MANUAL_PAYMENT_METHODS.includes(value as ManualPaymentMethod);
}
```

Replace broad `@IsEnum(PaymentMethod)` validation on client-controlled method fields with `@IsIn(MANUAL_PAYMENT_METHODS)` while keeping each DTO's required/optional behavior. This prevents callers from impersonating a system-generated receipt.

- [ ] **Step 5: Generate and validate Prisma, then rerun tests**

Run:

```powershell
npm run db:generate
npm run db:validate
npm --prefix backend test -- --runInBand src/payments/payment-methods.spec.ts src/payments/dto/record-payment.dto.spec.ts
```

Expected: Prisma validation succeeds and focused tests PASS.

- [ ] **Step 6: Commit the schema boundary**

```powershell
git add backend/prisma/schema.prisma backend/prisma/migrations/20260823170000_contract_deposit_auto_receipt backend/src/payments/payment-methods.ts backend/src/payments/payment-methods.spec.ts backend/src/payments/dto backend/src/checkout/dto/record-deposit.dto.ts backend/src/checkout/dto/submit-deposit-refund.dto.ts backend/src/pricing-rebates/dto/submit-pricing-rebate.dto.ts
git commit -m "feat: add automatic deposit payment provenance"
```

### Task 2: Create the initial deposit atomically with each new contract

**Files:**
- Create: `backend/src/contracts/contract-deposit.service.ts`
- Create: `backend/src/contracts/contract-deposit.service.spec.ts`
- Modify: `backend/src/contracts/contracts.module.ts`
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/contracts/contracts.service.spec.ts`
- Modify: `backend/test/app.e2e-spec.ts`

**Interfaces:**
- Consumes: `PaymentMethod.SYSTEM_AUTO` and `Payment.autoSourceKey` from Task 1.
- Produces: `ContractDepositService.recordInitialDeposit(tx, input): Promise<void>`.
- Input shape: `{ contractId: number; contractNo: string; amount: Prisma.Decimal.Value; operatorId: number; occurredAt: Date }`.
- Side effects for positive amount: one confirmed `DEPOSIT` payment and one `RECEIPT` deposit transaction in the caller's transaction.

- [ ] **Step 1: Write failing service tests for positive, zero, and duplicate deposits**

Create focused tests around this public method:

```ts
await service.recordInitialDeposit(tx, {
  contractId: 42,
  contractNo: 'HT202608230042 | 1栋101 | 张三',
  amount: new Prisma.Decimal('10000.00'),
  operatorId: 7,
  occurredAt: new Date('2026-08-23T10:00:00+08:00'),
});

expect(tx.payment.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    contractId: 42,
    paymentCategory: 'DEPOSIT',
    amount: new Prisma.Decimal('10000.00'),
    method: 'SYSTEM_AUTO',
    status: 'CONFIRMED',
    autoSourceKey: 'CONTRACT_INITIAL_DEPOSIT:42',
    operatorId: 7,
  }),
});
expect(tx.depositTransaction.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    contractId: 42,
    transactionType: 'RECEIPT',
    amount: new Prisma.Decimal('10000.00'),
    balanceAfter: new Prisma.Decimal('10000.00'),
  }),
});
```

Also assert amount `0.00` performs no writes, and an existing `CONTRACT_INITIAL_DEPOSIT:42` causes a Chinese conflict without creating another ledger row.

- [ ] **Step 2: Run the new service test and verify RED**

Run: `npm --prefix backend test -- --runInBand src/contracts/contract-deposit.service.spec.ts`

Expected: FAIL because `ContractDepositService` does not exist.

- [ ] **Step 3: Implement the focused contract-deposit service**

Implement the method using the transaction client passed by `ContractsService`:

```ts
async recordInitialDeposit(
  tx: Prisma.TransactionClient,
  input: InitialContractDepositInput,
): Promise<void> {
  const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2);
  if (amount.isZero()) return;
  if (!amount.isFinite() || amount.isNegative()) {
    throw new BadRequestException('押金不得为负数');
  }

  const autoSourceKey = `CONTRACT_INITIAL_DEPOSIT:${input.contractId}`;
  const existing = await tx.payment.findUnique({ where: { autoSourceKey } });
  if (existing) throw new ConflictException('该合同押金已自动入账，请勿重复提交');

  const payment = await tx.payment.create({
    data: {
      receiptNo: buildAutomaticDepositReceiptNo(input.contractId),
      contractId: input.contractId,
      paymentCategory: 'DEPOSIT',
      paymentDate: input.occurredAt,
      amount,
      method: 'SYSTEM_AUTO',
      autoSourceKey,
      operatorId: input.operatorId,
      status: 'CONFIRMED',
      remark: '合同押金自动确认到账',
    },
  });

  await tx.depositTransaction.create({
    data: {
      contractId: input.contractId,
      transactionNo: buildAutomaticDepositTransactionNo(input.contractId),
      transactionType: 'RECEIPT',
      amount,
      balanceAfter: amount,
      paymentId: payment.id,
      reason: '合同押金自动确认到账',
      occurredAt: input.occurredAt,
    },
  });
}
```

Use deterministic, length-safe receipt/transaction numbers based on the contract ID so database uniqueness remains a second idempotency barrier. Do not read or update any pre-release contract.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm --prefix backend test -- --runInBand src/contracts/contract-deposit.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write failing contract-creation integration tests**

Extend `contracts.service.spec.ts` to assert:

```ts
expect(contractDeposit.recordInitialDeposit).toHaveBeenCalledWith(
  tx,
  expect.objectContaining({
    contractId: createdContract.id,
    amount: '10000.00',
    operatorId: admin.id,
  }),
);
```

Add separate cases for `depositRequired: '0'`, transaction rejection propagation, and draft submission. In the E2E suite, create a new contract with `depositRequired: '10000.00'`, then verify the authenticated deposit-list endpoint returns balance `10000.00` and exactly one `RECEIPT` item.

- [ ] **Step 6: Run the contract tests and verify RED**

Run: `npm --prefix backend test -- --runInBand src/contracts/contracts.service.spec.ts`

Expected: FAIL because contract creation does not invoke the deposit service.

- [ ] **Step 7: Wire automatic deposit creation into the existing transaction**

Register `ContractDepositService` in `ContractsModule`, inject it into `ContractsService`, and call `recordInitialDeposit` after the final contract number is generated but before the existing transaction returns:

```ts
await this.contractDeposit.recordInitialDeposit(tx, {
  contractId: finalizedContract.id,
  contractNo: finalizedContract.contractNo,
  amount: input.depositRequired,
  operatorId: user.id,
  occurredAt: confirmedAt,
});
```

Do not add a historical migration, scheduled backfill, startup hook, or direct read from `depositRequired` in checkout.

- [ ] **Step 8: Run unit and E2E tests**

Run:

```powershell
npm --prefix backend test -- --runInBand src/contracts/contract-deposit.service.spec.ts src/contracts/contracts.service.spec.ts
npm --prefix backend run test:e2e -- --runInBand test/app.e2e-spec.ts
```

Expected: contract tests PASS; E2E proves a new 10,000 yuan deposit appears exactly once in the ledger.

- [ ] **Step 9: Commit the atomic contract flow**

```powershell
git add backend/src/contracts backend/test/app.e2e-spec.ts
git commit -m "feat: auto-record deposits for new contracts"
```

### Task 3: Add the server-side Finance Center deposit-balance total

**Files:**
- Modify: `backend/src/finance/finance.service.ts`
- Modify: `backend/src/finance/finance.controller.ts`
- Modify: `backend/src/finance/finance.service.spec.ts`
- Modify: `backend/test/app.e2e-spec.ts`

**Interfaces:**
- Produces: `FinanceService.overview(): Promise<{ depositBalanceTotal: Prisma.Decimal }>`.
- Produces: `GET /api/finance/overview` response `{ code: 200, message: 'success', data: { depositBalanceTotal } }`.
- Consumes: the latest `DepositTransaction.balanceAfter` for each contract.

- [ ] **Step 1: Write failing aggregation tests**

Use ledger rows where a single contract has more than one historical balance, proving only the latest row counts:

```ts
depositTransaction.findMany.mockResolvedValue([
  { contractId: 1, balanceAfter: new Prisma.Decimal('7000.00') },
  { contractId: 2, balanceAfter: new Prisma.Decimal('3000.00') },
  { contractId: 3, balanceAfter: new Prisma.Decimal('0.00') },
]);

await expect(service.overview()).resolves.toEqual({
  depositBalanceTotal: new Prisma.Decimal('10000.00'),
});
expect(depositTransaction.findMany).toHaveBeenCalledWith({
  distinct: ['contractId'],
  orderBy: [{ contractId: 'asc' }, { id: 'desc' }],
  select: { contractId: true, balanceAfter: true },
});
```

- [ ] **Step 2: Run the finance test and verify RED**

Run: `npm --prefix backend test -- --runInBand src/finance/finance.service.spec.ts`

Expected: FAIL because `overview()` does not exist.

- [ ] **Step 3: Implement aggregation and protected endpoint**

Add:

```ts
async overview() {
  const latestBalances = await this.prisma.db.depositTransaction.findMany({
    distinct: ['contractId'],
    orderBy: [{ contractId: 'asc' }, { id: 'desc' }],
    select: { contractId: true, balanceAfter: true },
  });
  return {
    depositBalanceTotal: latestBalances.reduce(
      (sum, item) => sum.plus(item.balanceAfter),
      new Prisma.Decimal(0),
    ),
  };
}
```

Expose `GET finance/overview` under the controller's existing JWT, role guard, and `SUPER_ADMIN` role.

- [ ] **Step 4: Add E2E authorization and response assertions**

Verify a super administrator receives `depositBalanceTotal`, while an ordinary administrator and an unauthenticated request receive forbidden/unauthorized responses. Do not calculate the number in the browser.

- [ ] **Step 5: Run finance unit and E2E tests**

Run:

```powershell
npm --prefix backend test -- --runInBand src/finance/finance.service.spec.ts
npm --prefix backend run test:e2e -- --runInBand test/app.e2e-spec.ts
```

Expected: aggregation and authorization tests PASS.

- [ ] **Step 6: Commit Finance Center API**

```powershell
git add backend/src/finance backend/test/app.e2e-spec.ts
git commit -m "feat: expose total deposit balance"
```

### Task 4: Update contract and Finance Center UI with complete Chinese labels

**Files:**
- Modify: `frontend/src/components/contracts/ContractFormPanel.vue`
- Modify: `frontend/src/components/contracts/ContractDetailPanel.vue`
- Modify: `frontend/src/components/contracts/ContractSummaryPanel.vue`
- Modify: `frontend/src/types/payments.ts`
- Modify: `frontend/src/utils/status-labels.ts`
- Modify: `frontend/src/views/payments/PaymentDetailView.vue`
- Modify: `frontend/src/views/FinanceView.vue`
- Modify: `frontend/src/views/contracts/contract-workspace.spec.ts`
- Modify: `frontend/src/views/finance-report-status.spec.ts`

**Interfaces:**
- Consumes: `GET /finance/overview` and `data.depositBalanceTotal` from Task 3.
- Consumes: `PaymentMethod.SYSTEM_AUTO` returned by backend read APIs.
- Produces: Chinese labels “押金（填写即视为已收）”、“押金余额总额”、“系统自动入账”.

- [ ] **Step 1: Write failing component tests**

Update mocks so `/finance/overview` returns `{ depositBalanceTotal: '10000.00' }`, then assert:

```ts
expect(wrapper.text()).toContain('押金余额总额');
expect(wrapper.text()).toContain('￥10,000.00');
expect(contractWrapper.text()).toContain('押金（填写即视为已收）');
```

Add a payment-detail fixture with `method: 'SYSTEM_AUTO'` and assert the rendered page contains “系统自动入账” and does not contain the raw enum.

- [ ] **Step 2: Run frontend tests and verify RED**

Run:

```powershell
npm --prefix frontend run test:unit -- frontend/src/views/finance-report-status.spec.ts frontend/src/views/contracts/contract-workspace.spec.ts
```

Expected: FAIL because the new endpoint, metric, and labels are absent.

- [ ] **Step 3: Update frontend types and shared labels**

Extend the read-side payment type:

```ts
export type PaymentMethod =
  | 'WECHAT'
  | 'ALIPAY'
  | 'BANK_TRANSFER'
  | 'CASH'
  | 'POS'
  | 'OTHER'
  | 'SYSTEM_AUTO';
```

Map `SYSTEM_AUTO` to “系统自动入账” in the shared label utility and every local method map used by payment detail. Do not add it as an option in manual collection or refund selects.

- [ ] **Step 4: Update contract wording without adding extra inputs**

Change the contract form label to exactly “押金（填写即视为已收）”. Keep the existing amount input and non-negative validation. Do not add payment date, payment method, or proof upload controls. In contract detail and summary, use “已收押金” where the value represents the initial contract amount, while actual current balance remains sourced from the deposit ledger.

- [ ] **Step 5: Load and render Finance Center total**

Add state and request:

```ts
const overview = ref({ depositBalanceTotal: '0.00' });

const [overviewResponse, rentResponse, cashResponse, commissionResponse, contractResponse] =
  await Promise.all([
    http.get('/finance/overview'),
    http.get('/finance/rent-collection', { params }),
    http.get('/finance/cash-flows', { params }),
    http.get('/commissions'),
    http.get('/contracts'),
  ]);
overview.value = overviewResponse.data.data;
```

Add “押金余额总额” as a high-visibility KPI with hint “当前实际保管押金”. Because the metric has no date-filter semantics, keep it unchanged when the report date filter changes.

- [ ] **Step 6: Run focused tests and frontend build**

Run:

```powershell
npm --prefix frontend run test:unit -- frontend/src/views/finance-report-status.spec.ts frontend/src/views/contracts/contract-workspace.spec.ts
npm --prefix frontend run build
```

Expected: tests and TypeScript/Vite build PASS.

- [ ] **Step 7: Commit the UI change**

```powershell
git add frontend/src/components/contracts frontend/src/types/payments.ts frontend/src/utils/status-labels.ts frontend/src/views/payments/PaymentDetailView.vue frontend/src/views/FinanceView.vue frontend/src/views/contracts/contract-workspace.spec.ts frontend/src/views/finance-report-status.spec.ts
git commit -m "feat: show automatic deposits in finance center"
```

### Task 5: Synchronize business documentation and run full regression

**Files:**
- Modify: `docs/requirements-freeze-v1.md`
- Modify: `docs/database-design.md`
- Modify: `docs/checkout-settlement-redesign-acceptance.md`
- Modify: `README.md`
- Create: `docs/contract-deposit-auto-receipt-acceptance.md`

**Interfaces:**
- Consumes: all implemented API names, field names, enum values, and test results from Tasks 1–4.
- Produces: a permanent requirements-change record and reproducible acceptance checklist.

- [ ] **Step 1: Update the frozen-requirement change record**

Record the approved override verbatim in `requirements-freeze-v1.md`: new-contract deposit input means actual receipt; no extra date/method input; existing contracts are untouched; ledger remains the balance authority; Finance Center shows the current deposit balance total.

- [ ] **Step 2: Update database and acceptance documentation**

Change `deposit_required` documentation from “应收押金” to “新合同创建时确认已收的初始押金”. Document `SYSTEM_AUTO`, `auto_source_key`, the no-backfill migration rule, latest-balance aggregation, and the atomic transaction. Add manual acceptance steps using a new test-only contract with a 10,000 yuan deposit.

- [ ] **Step 3: Run migration against the local test database**

Use the approved isolated test configuration without printing secrets:

```powershell
npm --prefix backend exec prisma migrate deploy
npm run db:validate
```

Expected: migration applies successfully; no historical `payments` or `deposit_transactions` rows are inserted by the migration.

- [ ] **Step 4: Run the complete automated verification suite**

Run:

```powershell
npm run lint
npm run build
npm --prefix backend test -- --runInBand
npm --prefix frontend run test:unit
npm --prefix backend run test:e2e -- --runInBand
npm run db:validate
```

Expected: lint, both builds, all backend unit suites, all frontend unit suites, backend E2E, and Prisma validation PASS with zero failed tests.

- [ ] **Step 5: Perform database-backed acceptance without changing production**

In the local test environment only:

1. Record counts and balances before the test.
2. Create one test-only contract with deposit `10000.00`.
3. Confirm exactly one `DEPOSIT` payment with method `SYSTEM_AUTO` and one `RECEIPT` ledger row were created.
4. Confirm the contract deposit balance and checkout finance snapshot are `10000.00`.
5. Confirm Finance Center “押金余额总额” increased by exactly `10000.00`.
6. Retry the same automatic source and confirm no duplicate receipt is created.
7. Confirm a pre-release contract with `deposit_required > 0` and no ledger remains unchanged.

- [ ] **Step 6: Record exact verification results**

Update `docs/contract-deposit-auto-receipt-acceptance.md` and README with executed command names, suite/test counts, migration result, test-contract identifier, and any remaining issue. Do not write database passwords, JWT secrets, SSH keys, or `.env` contents.

- [ ] **Step 7: Commit documentation and final verification evidence**

```powershell
git add docs/requirements-freeze-v1.md docs/database-design.md docs/checkout-settlement-redesign-acceptance.md docs/contract-deposit-auto-receipt-acceptance.md README.md
git commit -m "docs: record contract deposit auto-receipt acceptance"
```

- [ ] **Step 8: Review branch readiness**

Run:

```powershell
git status --short
git log --oneline -5
```

Expected: only pre-existing unrelated dirty files remain; this feature's files are committed. Do not merge, push, update the local shared test environment, or deploy production until the user separately authorizes that action.
