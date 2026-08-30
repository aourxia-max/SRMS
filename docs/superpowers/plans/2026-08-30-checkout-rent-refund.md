# 退租结算退还租金实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在退租结算中增加“退还租金”，由系统自动预留并回冲符合条件的已缴租金，最终与押金、预收款合并为一次可审计退款。

**Architecture:** 使用纯函数完成可退金额和回冲顺序计算，使用独立预留服务处理并发占用和释放，使用独立记账器在最终退款事务中同步更新账单、收款分配、收款状态和合并退款。现有 `CheckoutService` 只编排流程，前端只提交金额与说明，所有金额、权限和状态由后端重新校验。

**Tech Stack:** Node.js 24、NestJS 11、Prisma 7、MySQL 8.4、Vue 3、TypeScript、Element Plus、Jest、Vitest、Supertest、Docker Compose。

**Spec:** `docs/superpowers/specs/2026-08-30-checkout-rent-refund-design.md`

## 全局约束

- 每张退租结算单最多一项 `RENT_REFUND`。
- 管理员只填写退还金额和说明，不选择收款、账单或分配明细。
- 可回冲范围只包括实际退房日之后的未来账期和包含实际退房日的当前账期。
- 自动回冲顺序固定为未来账期从晚到早，最后处理当前账期；同账单按收款日期和分配 ID 倒序。
- 退还租金不得超过未回冲、未被普通退款/作废/其他退租预留占用的租金分配余额。
- 押金、预收款和租金合并为一次实际退款，财务中心只统计一次外部资金流出。
- 最终确认必须在一个数据库事务中完成，失败时全部回滚。
- 后端强制校验角色、金额、状态和并发占用；前端隐藏按钮不能代替后端权限。
- 所有用户提示和状态必须为中文。
- 不修改历史业务金额；历史合并退款的租金退款拆分为 `0.00`。
- 不输出、不提交 `deploy/.env.test` 中的密码或密钥。

---

## 文件结构与职责

### 新建文件

- `backend/prisma/migrations/20260830090000_checkout_rent_refund/migration.sql`：新增枚举值、结算快照字段、合并退款拆分字段、账单调整关联和回冲预留表。
- `backend/src/checkout/checkout-rent-refund-allocation.ts`：纯函数计算可回冲金额和确定性分配顺序。
- `backend/src/checkout/checkout-rent-refund-allocation.spec.ts`：纯计算单元测试。
- `backend/src/checkout/checkout-rent-refund-reservations.ts`：事务内创建、校验和释放回冲预留。
- `backend/src/checkout/checkout-rent-refund-reservations.spec.ts`：预留生命周期与冲突测试。
- `backend/src/checkout/checkout-rent-refund-writer.ts`：最终合并退款中的租金原子回冲和账单调整。
- `backend/src/checkout/checkout-rent-refund-writer.spec.ts`：账务写入与幂等测试。
- `backend/test/checkout-rent-refund.e2e-spec.ts`：真实 MySQL 接口闭环和并发测试。
- `docs/checkout-rent-refund-acceptance.md`：实施结果、测试结果和手工验收步骤。

### 修改文件

- `backend/prisma/schema.prisma`：声明新增字段、枚举和关系。
- `backend/src/checkout/checkout-calculation.ts`：将应退租金加入合计应退。
- `backend/src/checkout/checkout-calculation.spec.ts`：金额汇总回归测试。
- `backend/src/checkout/dto/submit-checkout-settlement.dto.ts`：`RENT_REFUND` 条件字段校验入口。
- `backend/src/checkout/checkout.service.ts`：编排预览、提交、确认、驳回、退回草稿和取消时的预留流程。
- `backend/src/checkout/checkout.service.spec.ts`：结算状态、权限和错误提示测试。
- `backend/src/checkout/deposit-refunds.service.ts`：登记和确认三类合并退款，并调用租金回冲记账器。
- `backend/src/checkout/deposit-refunds.service.spec.ts`：合并退款原子事务测试。
- `backend/src/checkout/dto/submit-deposit-refund.dto.ts`：保持总额由后端锁定，不接受客户端拆分金额。
- `backend/src/payments/checkout-supplemental-balance.ts`：普通退款/作废增加退租租金预留保护。
- `backend/src/payments/checkout-supplemental-balance.spec.ts`：双向防重复占用测试。
- `backend/src/payments/refunds.service.ts`：提交普通退款时扣除有效退租预留额度。
- `backend/src/payments/void-requests.service.ts`：收款作废时拒绝触碰有效退租预留。
- `backend/src/payments/payments.service.ts`：收款详情合并展示普通退款和退租租金回冲。
- `backend/src/payments/payments.service.spec.ts`：收款详情与状态序列化测试。
- `backend/src/finance/finance.service.ts`：合并退款只形成一笔外部资金流。
- `backend/src/finance/finance.service.spec.ts`：防重复统计测试。
- `backend/src/contracts/contract-void-impact.ts`：合同纠错快照纳入退租租金回冲明细。
- `backend/src/contracts/contract-void-reversal-writer.ts`：纠错时按既有安全规则逆转新增明细。
- `frontend/src/views/checkout/checkout-types.ts`：新增退还租金、上限、拆分和回冲明细类型。
- `frontend/src/services/checkout.ts`：更新预览和合并退款接口类型。
- `frontend/src/views/checkout/CheckoutSettlementPanel.vue`：新增按钮、金额/说明输入、上限和汇总卡片。
- `frontend/src/views/checkout/checkout-settlement-preview.spec.ts`：页面输入、预览和中文校验测试。
- `frontend/src/views/checkout/CheckoutRefundPanel.vue`：改为“退租退款确认”并展示三类拆分。
- `frontend/src/views/checkout/CheckoutTopNav.vue`：导航中文名称调整。
- `frontend/src/views/checkout/CheckoutWorkspace.vue`：刷新预览、退款提交和只读明细展示。
- `frontend/src/views/checkout/checkout-workspace.spec.ts`：完整前端交互测试。
- `frontend/src/types/payments.ts`：收款详情新增退租回冲记录类型。
- `frontend/src/views/payments/PaymentDetailView.vue`：展示“退租租金退款”来源和结算单号。
- `backend/src/finance/finance.service.spec.ts`：确认资金流水返回中文类型且不重复；现有 `FinanceView.vue` 直接展示后端 `type` 字段，无需新增分支。
- `docs/database-design.md`、`docs/checkout-pages-design.md`：同步正式数据结构和业务流程。

---

### Task 1：数据库结构与兼容迁移

**Files:**
- Create: `backend/prisma/migrations/20260830090000_checkout_rent_refund/migration.sql`
- Modify: `backend/prisma/schema.prisma:222-274,919-945,1100-1197`
- Test: `backend/src/payments/payment-schema.spec.ts`

**Interfaces:**
- Consumes: 现有 `CheckoutSettlement`、`CheckoutSettlementItem`、`PaymentAllocation`、`RentBill`、`BillAdjustment`、`DepositRefund`。
- Produces: Prisma 模型 `CheckoutRentRefundAllocation`；枚举值 `RENT_REFUND`、`CHECKOUT_RENT_REFUND`；字段 `rentRefundableAmount`、`depositRefundAmount`、`prepaymentRefundAmount`、`rentRefundAmount`。

- [ ] **Step 1: 写失败的 Prisma 结构测试**

在 `backend/src/payments/payment-schema.spec.ts` 增加源码结构断言：

```ts
expect(schema).toContain('RENT_REFUND');
expect(schema).toContain('CHECKOUT_RENT_REFUND');
expect(schema).toContain('model CheckoutRentRefundAllocation');
expect(schema).toContain('rentRefundableAmount');
expect(schema).toContain('rentRefundAmount');
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix backend test -- --runInBand payment-schema.spec.ts`

Expected: FAIL，提示新增枚举、模型或字段不存在。

- [ ] **Step 3: 修改 Prisma 模型**

新增明确枚举与模型：

```prisma
enum CheckoutRentRefundAllocationStatus {
  RESERVED
  RELEASED
  APPLIED
}

model CheckoutRentRefundAllocation {
  id                       Int                                @id @default(autoincrement()) @db.UnsignedInt
  checkoutSettlementItemId Int                                @map("checkout_settlement_item_id") @db.UnsignedInt
  paymentAllocationId      Int                                @map("payment_allocation_id") @db.UnsignedInt
  paymentId                Int                                @map("payment_id") @db.UnsignedInt
  rentBillId               Int                                @map("rent_bill_id") @db.UnsignedInt
  reservedAmount           Decimal                            @map("reserved_amount") @db.Decimal(14, 2)
  status                   CheckoutRentRefundAllocationStatus @default(RESERVED)
  reservedAt               DateTime                           @default(now()) @map("reserved_at") @db.DateTime(3)
  releasedAt               DateTime?                          @map("released_at") @db.DateTime(3)
  appliedAt                DateTime?                          @map("applied_at") @db.DateTime(3)
  depositRefundId          Int?                               @map("deposit_refund_id") @db.UnsignedInt
  item                     CheckoutSettlementItem             @relation(fields: [checkoutSettlementItemId], references: [id], onDelete: Restrict)
  paymentAllocation        PaymentAllocation                  @relation(fields: [paymentAllocationId], references: [id], onDelete: Restrict)
  payment                  Payment                            @relation(fields: [paymentId], references: [id], onDelete: Restrict)
  rentBill                 RentBill                           @relation(fields: [rentBillId], references: [id], onDelete: Restrict)
  depositRefund            DepositRefund?                     @relation(fields: [depositRefundId], references: [id], onDelete: Restrict)

  @@index([checkoutSettlementItemId, status])
  @@index([paymentAllocationId, status])
  @@index([depositRefundId])
  @@map("checkout_rent_refund_allocations")
}
```

在迁移中新增字段并用关联结算快照回填历史退款拆分；所有历史 `rent_refund_amount` 为 `0.00`。迁移不得删除或覆盖历史金额。

- [ ] **Step 4: 校验 Prisma 和迁移 SQL**

Run: `npm run db:validate`

Expected: `The schema at prisma/schema.prisma is valid`。

Run: `npm --prefix backend run prisma:generate`

Expected: Prisma Client 生成成功。

- [ ] **Step 5: 运行结构测试**

Run: `npm --prefix backend test -- --runInBand payment-schema.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260830090000_checkout_rent_refund/migration.sql backend/src/payments/payment-schema.spec.ts
git commit -m "feat: add checkout rent refund schema"
```

---

### Task 2：纯回冲分配计算器

**Files:**
- Create: `backend/src/checkout/checkout-rent-refund-allocation.ts`
- Create: `backend/src/checkout/checkout-rent-refund-allocation.spec.ts`

**Interfaces:**
- Consumes: `RentRefundCandidate[]` 和请求金额。
- Produces: `allocateCheckoutRentRefund(input): CheckoutRentRefundPlan`，供预览和事务内预留共同调用。

- [ ] **Step 1: 写未来账期优先的失败测试**

```ts
expect(
  allocateCheckoutRentRefund({
    actualCheckoutDate: new Date('2026-08-15'),
    requestedAmount: '4000.00',
    candidates: [
      candidate(1, '2026-08-01', '2026-08-31', '3000.00', '2026-08-01'),
      candidate(2, '2026-09-01', '2026-09-30', '3000.00', '2026-08-01'),
    ],
  }).allocations,
).toEqual([
  expect.objectContaining({ paymentAllocationId: 2, amount: '3000.00' }),
  expect.objectContaining({ paymentAllocationId: 1, amount: '1000.00' }),
]);
```

同时增加：历史账期排除、同账单按收款日期/ID 倒序、部分回冲、超额拒绝和 0 元上限测试。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix backend test -- --runInBand checkout-rent-refund-allocation.spec.ts`

Expected: FAIL，提示模块或函数不存在。

- [ ] **Step 3: 实现纯函数和类型**

```ts
export type RentRefundCandidate = {
  paymentAllocationId: number;
  paymentId: number;
  rentBillId: number;
  periodStart: Date;
  periodEnd: Date;
  paymentDate: Date;
  availableAmount: Prisma.Decimal.Value;
};

export type CheckoutRentRefundPlan = {
  maxRefundableAmount: string;
  requestedAmount: string;
  allocations: Array<{
    paymentAllocationId: number;
    paymentId: number;
    rentBillId: number;
    amount: string;
  }>;
};

export function allocateCheckoutRentRefund(input: {
  actualCheckoutDate: Date;
  requestedAmount: Prisma.Decimal.Value;
  candidates: RentRefundCandidate[];
}): CheckoutRentRefundPlan;
```

函数只排序和计算，不访问数据库。超额时抛出带 `maxRefundableAmount` 的领域错误，由服务层转换为中文 `BadRequestException`。

- [ ] **Step 4: 运行单元测试**

Run: `npm --prefix backend test -- --runInBand checkout-rent-refund-allocation.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/src/checkout/checkout-rent-refund-allocation.ts backend/src/checkout/checkout-rent-refund-allocation.spec.ts
git commit -m "feat: calculate checkout rent refund allocations"
```

---

### Task 3：结算金额与预览接口

**Files:**
- Modify: `backend/src/checkout/checkout-calculation.ts`
- Modify: `backend/src/checkout/checkout-calculation.spec.ts`
- Modify: `backend/src/checkout/dto/submit-checkout-settlement.dto.ts`
- Modify: `backend/src/checkout/checkout.service.ts:267-347`
- Modify: `backend/src/checkout/checkout.service.spec.ts`
- Modify: `backend/src/checkout/checkout.controller.spec.ts`

**Interfaces:**
- Consumes: `allocateCheckoutRentRefund`。
- Produces: 预览字段 `rentRefundableAmount`、`maxRentRefundAmount`、`rentRefundAllocations` 和新的 `totalRefundAmount`。

- [ ] **Step 1: 写金额汇总失败测试**

```ts
expect(
  calculateCheckoutAmounts({
    depositBalance: '10000.00',
    prepaymentBalance: '1000.00',
    rentOutstanding: '0.00',
    otherCharges: '500.00',
    rentRefundAmount: '2000.00',
  }),
).toMatchObject({
  depositRefundableAmount: '9500.00',
  prepaymentRefundableAmount: '1000.00',
  rentRefundableAmount: '2000.00',
  totalRefundAmount: '12500.00',
});
```

- [ ] **Step 2: 写 DTO 和预览失败测试**

覆盖：

```ts
const item = {
  itemType: 'RENT_REFUND',
  amount: '2000.00',
  description: '提前退房退还未履行租金',
};
```

断言 `RENT_REFUND` 不要求 `rentBillId` 或 `inspectionRecordRef`，但要求金额大于 0、说明非空且每单最多一项。

- [ ] **Step 3: 运行失败测试**

Run: `npm --prefix backend test -- --runInBand checkout-calculation.spec.ts checkout.service.spec.ts checkout.controller.spec.ts`

Expected: FAIL，缺少租金退款字段或仍要求验房编号。

- [ ] **Step 4: 实现预览读取与中文错误**

在 `CheckoutService.preview` 中读取候选分配时计算：

```ts
const plan = allocateCheckoutRentRefund({
  actualCheckoutDate: actual,
  requestedAmount: rentRefundItem?.amount ?? 0,
  candidates: await loadRentRefundCandidates(this.prisma.db, contractId),
});
```

返回建议明细但不写数据库。超额统一转换为：

```ts
throw new BadRequestException(
  `退还租金不能超过当前可回冲金额 ¥${plan.maxRefundableAmount}。`,
);
```

- [ ] **Step 5: 运行测试**

Run: `npm --prefix backend test -- --runInBand checkout-calculation.spec.ts checkout.service.spec.ts checkout.controller.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/src/checkout/checkout-calculation.ts backend/src/checkout/checkout-calculation.spec.ts backend/src/checkout/dto/submit-checkout-settlement.dto.ts backend/src/checkout/checkout.service.ts backend/src/checkout/checkout.service.spec.ts backend/src/checkout/checkout.controller.spec.ts
git commit -m "feat: preview checkout rent refunds"
```

---

### Task 4：事务预留、释放与逆转保护

**Files:**
- Create: `backend/src/checkout/checkout-rent-refund-reservations.ts`
- Create: `backend/src/checkout/checkout-rent-refund-reservations.spec.ts`
- Modify: `backend/src/checkout/checkout.service.ts:349-493,763-890`
- Modify: `backend/src/checkout/checkout.service.spec.ts`
- Modify: `backend/src/payments/checkout-supplemental-balance.ts`
- Modify: `backend/src/payments/checkout-supplemental-balance.spec.ts`
- Modify: `backend/src/payments/refunds.service.ts:33-108`
- Modify: `backend/src/payments/refunds.service.spec.ts`
- Modify: `backend/src/payments/void-requests.service.ts:30-115`
- Modify: `backend/src/payments/void-requests.service.spec.ts`

**Interfaces:**
- Consumes: `allocateCheckoutRentRefund` 和 Prisma 事务客户端。
- Produces: `reserveCheckoutRentRefund(tx, input)`, `releaseCheckoutRentRefund(tx, settlementId, reason)`, `assertNoCheckoutRentRefundReservation(tx, paymentId)`。

- [ ] **Step 1: 写预留生命周期失败测试**

```ts
await reserveCheckoutRentRefund(tx, {
  settlementId: 9,
  settlementItemId: 81,
  contractId: 4,
  actualCheckoutDate: new Date('2026-08-15'),
  requestedAmount: '2000.00',
});

expect(tx.checkoutRentRefundAllocation.createMany).toHaveBeenCalledWith({
  data: expect.arrayContaining([
    expect.objectContaining({ status: 'RESERVED' }),
  ]),
});
```

增加驳回、退回草稿、取消释放，以及普通退款/作废触碰有效预留时拒绝的测试。

- [ ] **Step 2: 运行失败测试**

Run: `npm --prefix backend test -- --runInBand checkout-rent-refund-reservations.spec.ts checkout-supplemental-balance.spec.ts refunds.service.spec.ts void-requests.service.spec.ts checkout.service.spec.ts`

Expected: FAIL，预留服务和保护函数不存在。

- [ ] **Step 3: 实现候选余额读取和事务锁**

候选可用额必须按以下公式计算：

```text
可用额 = 原分配金额
       - 已回冲金额
       - 待审批普通退款占用
       - 有效退租预留占用
```

事务内依次锁定合同、账单、收款、收款分配、普通退款分配和退租预留，所有 `SELECT ... FOR UPDATE` 使用稳定 ID 顺序，避免死锁。

- [ ] **Step 4: 接入结算状态流转**

- `submit`：释放该结算旧的有效预留后重新计算并创建新预留。
- `reject`、`returnToDraft`、`cancel`：将有效预留更新为 `RELEASED` 并写时间。
- `approve`：验证预留金额等于锁定租金退款金额，保持 `RESERVED`。

- [ ] **Step 5: 接入普通退款和作废保护**

普通退款提交和收款作废必须调用：

```ts
await assertNoCheckoutRentRefundReservation(tx, payment.id);
```

冲突时返回：`相关租金已被退租退款流程占用，不能重复退款或作废。`

- [ ] **Step 6: 运行相关测试**

Run: `npm --prefix backend test -- --runInBand checkout-rent-refund-reservations.spec.ts checkout-supplemental-balance.spec.ts refunds.service.spec.ts void-requests.service.spec.ts checkout.service.spec.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add backend/src/checkout/checkout-rent-refund-reservations.ts backend/src/checkout/checkout-rent-refund-reservations.spec.ts backend/src/checkout/checkout.service.ts backend/src/checkout/checkout.service.spec.ts backend/src/payments/checkout-supplemental-balance.ts backend/src/payments/checkout-supplemental-balance.spec.ts backend/src/payments/refunds.service.ts backend/src/payments/refunds.service.spec.ts backend/src/payments/void-requests.service.ts backend/src/payments/void-requests.service.spec.ts
git commit -m "feat: reserve checkout rent refund allocations"
```

---

### Task 5：最终租金回冲记账器

**Files:**
- Create: `backend/src/checkout/checkout-rent-refund-writer.ts`
- Create: `backend/src/checkout/checkout-rent-refund-writer.spec.ts`
- Modify: `backend/src/checkout/deposit-refunds.service.ts:27-220`
- Modify: `backend/src/checkout/deposit-refunds.service.spec.ts`
- Modify: `backend/src/checkout/dto/submit-deposit-refund.dto.ts`

**Interfaces:**
- Consumes: 状态为 `RESERVED` 的 `CheckoutRentRefundAllocation[]` 和最终 `DepositRefund`。
- Produces: `applyCheckoutRentRefund(tx, input): Promise<CheckoutRentRefundResult>`，返回受影响账单、收款和回冲总额。

- [ ] **Step 1: 写部分回冲失败测试**

```ts
const result = await applyCheckoutRentRefund(tx, {
  settlementId: 9,
  depositRefundId: 33,
  approvedBy: 1,
  occurredAt: new Date('2026-08-30'),
});

expect(tx.rentBill.update).toHaveBeenCalledWith({
  where: { id: 20 },
  data: expect.objectContaining({
    payableAmount: new Prisma.Decimal('2000.00'),
    receivedAmount: new Prisma.Decimal('2000.00'),
    outstandingAmount: new Prisma.Decimal('0.00'),
    status: 'PAID',
  }),
});
expect(result.appliedAmount).toBe('1000.00');
```

增加全额回冲为 `REFUNDED`、跨账单汇总、收款部分/全部退款、重复调用拒绝和任一步失败全事务回滚测试。

- [ ] **Step 2: 运行失败测试**

Run: `npm --prefix backend test -- --runInBand checkout-rent-refund-writer.spec.ts deposit-refunds.service.spec.ts`

Expected: FAIL，记账器不存在或合并退款不包含租金。

- [ ] **Step 3: 实现原子回冲**

接口固定为：

```ts
export async function applyCheckoutRentRefund(
  tx: Prisma.TransactionClient,
  input: {
    settlementId: number;
    depositRefundId: number;
    approvedBy: number;
    occurredAt: Date;
  },
): Promise<{
  appliedAmount: string;
  affectedBillIds: number[];
  affectedPaymentIds: number[];
}>;
```

对同一账单先汇总再写一次：净应收和实收同额减少，未收保持 `0.00`；创建已批准的 `CHECKOUT_RENT_REFUND` 调整；增加 `PaymentAllocation.reversedAmount`；累计普通退款与退租回冲后更新收款状态。

- [ ] **Step 4: 扩展合并退款登记与确认**

客户端仍只提交总额、日期、方式、备注和凭证。后端从结算锁定快照写入：

```ts
{
  refundAmount: deposit.plus(prepayment).plus(rent),
  depositRefundAmount: deposit,
  prepaymentRefundAmount: prepayment,
  rentRefundAmount: rent,
}
```

最终确认按顺序调用押金/预收款现有逻辑和 `applyCheckoutRentRefund`，然后完成合同、房态和审计。不得信任客户端拆分金额。

- [ ] **Step 5: 运行测试**

Run: `npm --prefix backend test -- --runInBand checkout-rent-refund-writer.spec.ts deposit-refunds.service.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/src/checkout/checkout-rent-refund-writer.ts backend/src/checkout/checkout-rent-refund-writer.spec.ts backend/src/checkout/deposit-refunds.service.ts backend/src/checkout/deposit-refunds.service.spec.ts backend/src/checkout/dto/submit-deposit-refund.dto.ts
git commit -m "feat: apply checkout rent refund atomically"
```

---

### Task 6：收款详情、财务流水与合同纠错兼容

**Files:**
- Modify: `backend/src/payments/payments.service.ts:110-280`
- Modify: `backend/src/payments/payments.service.spec.ts`
- Modify: `backend/src/finance/finance.service.ts:158-255`
- Modify: `backend/src/finance/finance.service.spec.ts`
- Modify: `backend/src/contracts/contract-void-impact.ts`
- Modify: `backend/src/contracts/contract-void-impact.spec.ts`
- Modify: `backend/src/contracts/contract-void-reversal-writer.ts`
- Modify: `backend/src/contracts/contract-void-reversal-writer.spec.ts`
- Modify: `frontend/src/types/payments.ts`
- Modify: `frontend/src/views/payments/PaymentDetailView.vue`
- Modify: `frontend/src/views/payments/payment-lifecycle-tags.spec.ts`

**Interfaces:**
- Consumes: 已应用的 `CheckoutRentRefundAllocation` 和合并退款拆分。
- Produces: 收款详情 `checkoutRentRefunds[]`；资金流水 `CHECKOUT_COMBINED_REFUND`；纠错快照中的回冲记录。

- [ ] **Step 1: 写收款详情和财务失败测试**

```ts
expect(detail.checkoutRentRefunds).toEqual([
  expect.objectContaining({
    settlementNo: 'TZ202608300001',
    amount: '1000.00',
    statusText: '已完成',
  }),
]);
expect(report.items.filter((item) => item.flowType === 'CHECKOUT_COMBINED_REFUND')).toHaveLength(1);
expect(report.totalOutflow).toBe('10500.00');
```

断言同一合并退款不能同时作为押金退款和租金退款重复计入外部流出。

- [ ] **Step 2: 运行失败测试**

Run: `npm --prefix backend test -- --runInBand payments.service.spec.ts finance.service.spec.ts contract-void-impact.spec.ts contract-void-reversal-writer.spec.ts`

Expected: FAIL，缺少退租回冲详情或出现重复资金流。

- [ ] **Step 3: 实现统一展示与财务口径**

- 收款详情将普通退款和退租租金退款分区展示，不能伪造成普通退款申请。
- 财务资金流以最终合并退款记录为唯一外部流出来源，备注显示押金/预收款/租金拆分。
- 合同纠错快照记录新增表、调整和合并退款拆分；逆转时保持原始记录并新增纠错流水。

- [ ] **Step 4: 更新前端收款详情**

在 `PaymentDetailView.vue` 增加只读区块：

```vue
<el-tag type="warning">退租租金退款</el-tag>
<span>{{ row.settlementNo }} · {{ money(row.amount) }}</span>
```

不得给该记录提供再次退款或删除入口。

- [ ] **Step 5: 运行后端和前端测试**

Run: `npm --prefix backend test -- --runInBand payments.service.spec.ts finance.service.spec.ts contract-void-impact.spec.ts contract-void-reversal-writer.spec.ts`

Run: `npm --prefix frontend run test:unit -- payment-lifecycle-tags.spec.ts`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add backend/src/payments/payments.service.ts backend/src/payments/payments.service.spec.ts backend/src/finance/finance.service.ts backend/src/finance/finance.service.spec.ts backend/src/contracts/contract-void-impact.ts backend/src/contracts/contract-void-impact.spec.ts backend/src/contracts/contract-void-reversal-writer.ts backend/src/contracts/contract-void-reversal-writer.spec.ts frontend/src/types/payments.ts frontend/src/views/payments/PaymentDetailView.vue frontend/src/views/payments/payment-lifecycle-tags.spec.ts
git commit -m "feat: report checkout rent refunds"
```

---

### Task 7：退租结算前端交互

**Files:**
- Modify: `frontend/src/views/checkout/checkout-types.ts`
- Modify: `frontend/src/services/checkout.ts`
- Modify: `frontend/src/views/checkout/CheckoutSettlementPanel.vue:1-420`
- Modify: `frontend/src/views/checkout/checkout-settlement-preview.spec.ts`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue:235-380`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`

**Interfaces:**
- Consumes: 预览接口字段 `rentRefundableAmount`、`maxRentRefundAmount`、`rentRefundAllocations`。
- Produces: 只含 `itemType`、`amount`、`description` 的 `RENT_REFUND` DTO。

- [ ] **Step 1: 写按钮和输入失败测试**

```ts
await wrapper.get('[data-test="add-rent-refund"]').trigger('click');
expect(wrapper.findAll('[data-test="rent-refund-item"]')).toHaveLength(1);
expect(wrapper.text()).toContain('当前最多可退租金 ¥3,000.00');
expect(wrapper.find('[placeholder="验房记录编号"]').exists()).toBe(false);
```

增加重复点击不新增第二项、金额超限、说明必填、实际退房日期变化触发预览和汇总显示测试。

- [ ] **Step 2: 运行失败测试**

Run: `npm --prefix frontend run test:unit -- checkout-settlement-preview.spec.ts checkout-workspace.spec.ts`

Expected: FAIL，按钮、类型或汇总字段不存在。

- [ ] **Step 3: 更新类型与 API**

```ts
export type CheckoutRentRefundAllocationPreview = {
  paymentAllocationId: number;
  paymentId: number;
  rentBillId: number;
  billNo: string;
  amount: string;
};

export type CheckoutSettlementPreview = {
  depositRefundableAmount: string;
  prepaymentRefundableAmount: string;
  rentRefundableAmount: string;
  maxRentRefundAmount: string;
  totalRefundAmount: string;
  finalReceivable: string;
  rentRefundAllocations: CheckoutRentRefundAllocationPreview[];
};
```

- [ ] **Step 4: 实现结算项目 UI**

- 新增 `data-test="add-rent-refund"` 按钮。
- `RENT_REFUND` 行只渲染金额、说明和删除。
- `previewReady` 对 `RENT_REFUND` 不要求账单 ID 或验房编号。
- 前端先提示超额，但仍以后端响应为最终结果。
- 汇总增加应退租金并保留待补收。

- [ ] **Step 5: 运行前端测试**

Run: `npm --prefix frontend run test:unit -- checkout-settlement-preview.spec.ts checkout-workspace.spec.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/views/checkout/checkout-types.ts frontend/src/services/checkout.ts frontend/src/views/checkout/CheckoutSettlementPanel.vue frontend/src/views/checkout/checkout-settlement-preview.spec.ts frontend/src/views/checkout/CheckoutWorkspace.vue frontend/src/views/checkout/checkout-workspace.spec.ts
git commit -m "feat: add checkout rent refund form"
```

---

### Task 8：退租合并退款页面

**Files:**
- Modify: `frontend/src/views/checkout/CheckoutRefundPanel.vue:1-427`
- Modify: `frontend/src/views/checkout/CheckoutTopNav.vue`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`

**Interfaces:**
- Consumes: 结算锁定拆分和已预留回冲明细。
- Produces: 现有合并退款 DTO `{ checkoutSettlementId, refundAmount, refundDate, refundMethod, remark?, proofFileIds }`，不提交拆分金额。

- [ ] **Step 1: 写中文页面失败测试**

```ts
expect(wrapper.text()).toContain('退租退款确认');
expect(wrapper.text()).toContain('应退押金');
expect(wrapper.text()).toContain('应退预收款');
expect(wrapper.text()).toContain('应退租金');
expect(wrapper.text()).toContain('合计退款');
expect(wrapper.text()).toContain('系统自动回冲明细');
```

断言提交 payload 不含客户端可篡改的三项拆分字段。

- [ ] **Step 2: 运行失败测试**

Run: `npm --prefix frontend run test:unit -- checkout-workspace.spec.ts`

Expected: FAIL，仍显示“押金退还确认”或缺少租金拆分。

- [ ] **Step 3: 更新导航和退款卡片**

- 第三个页签改为“退租退款确认”。
- 卡片显示三类金额和合计。
- 回冲明细只读展示账单编号、账期和金额。
- 保留退款日期中文格式、退款方式、凭证上传与在线预览。
- 确认按钮文案保持“确认退款并完成退租”。

- [ ] **Step 4: 运行测试与构建**

Run: `npm --prefix frontend run test:unit -- checkout-workspace.spec.ts`

Run: `npm --prefix frontend run build`

Expected: PASS，构建无 TypeScript 错误。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/views/checkout/CheckoutRefundPanel.vue frontend/src/views/checkout/CheckoutTopNav.vue frontend/src/views/checkout/CheckoutWorkspace.vue frontend/src/views/checkout/checkout-workspace.spec.ts
git commit -m "feat: show combined checkout refund"
```

---

### Task 9：真实数据库闭环与并发测试

**Files:**
- Create: `backend/test/checkout-rent-refund.e2e-spec.ts`
- Modify: `backend/test/jest-e2e.json`（仅在现有匹配规则不能发现新文件时修改）

**Interfaces:**
- Consumes: 完整 HTTP API、MySQL 事务和迁移后的 Prisma 模型。
- Produces: 可重复执行并自动清理专用数据的 E2E 证明。

- [ ] **Step 1: 写完整闭环 E2E 测试**

测试创建唯一前缀数据并依次执行：

```ts
it('合并退还押金、预收款和租金且只产生一笔外部退款', async () => {
  const preview = await admin.post(`/api/checkout-settlements/${id}/preview`).send(payload);
  expect(preview.body.data.maxRentRefundAmount).toBe('3000.00');

  await admin.post(`/api/checkout-settlements/${id}/submit`).send(payload).expect(201);
  await superAdmin.post(`/api/checkout-settlements/${id}/approve`).expect(201);
  await admin.post('/api/deposit-refunds').send(combinedRefund).expect(201);
  await superAdmin.post(`/api/deposit-refunds/${refundId}/approve`).expect(201);

  expect(await loadBill()).toMatchObject({
    payableAmount: '2000.00',
    receivedAmount: '2000.00',
    outstandingAmount: '0.00',
  });
});
```

同文件增加两个并发提交只能一个成功、普通退款与预留冲突、取消释放、驳回重提和伪造游客/管理员权限测试。

- [ ] **Step 2: 运行迁移前确认测试失败**

Run: `npm --prefix backend run test:e2e -- --runInBand checkout-rent-refund.e2e-spec.ts`

Expected: FAIL，测试库尚未应用新增迁移或接口尚未完整闭环。

- [ ] **Step 3: 备份并迁移本机测试库**

仅使用 `deploy/.env.test` 连接本机测试数据库，不输出变量值。先在 MySQL 容器内生成并校验备份，再复制到已被 Git 忽略的 `deploy/test-data/backups`：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupName = "pre-checkout-rent-refund-$stamp.sql"
New-Item -ItemType Directory -Force -Path deploy/test-data/backups | Out-Null
docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.test.yml exec -T mysql sh -lc "mysqldump --single-transaction --routines --triggers -uroot -p`"`$MYSQL_ROOT_PASSWORD`" `"`$MYSQL_DATABASE`" > /tmp/$backupName && test -s /tmp/$backupName && tail -n 5 /tmp/$backupName | grep -q 'Dump completed'"
$mysqlContainer = docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.test.yml ps -q mysql
docker cp "${mysqlContainer}:/tmp/$backupName" "deploy/test-data/backups/$backupName"
if ((Get-Item "deploy/test-data/backups/$backupName").Length -le 0) { throw '测试库备份为空' }
```

Expected: 备份文件非空且容器内结束标记校验通过。随后执行迁移：

Run: `docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.test.yml exec -T api npx prisma migrate deploy`

Expected: `20260830090000_checkout_rent_refund` applied。

- [ ] **Step 4: 运行 E2E**

Run: `npm --prefix backend run test:e2e -- --runInBand checkout-rent-refund.e2e-spec.ts`

Expected: PASS，测试数据在 `afterAll` 中按唯一前缀清理，不影响房源基础数据。

- [ ] **Step 5: 提交**

```bash
git add backend/test/checkout-rent-refund.e2e-spec.ts backend/test/jest-e2e.json
git commit -m "test: cover checkout rent refund workflow"
```

---

### Task 10：文档同步、全量回归与测试环境更新

**Files:**
- Modify: `docs/database-design.md`
- Modify: `docs/checkout-pages-design.md`
- Create: `docs/checkout-rent-refund-acceptance.md`

**Interfaces:**
- Consumes: 所有实现和测试结果。
- Produces: 正式数据库口径、页面流程、验收记录和可供用户测试的本机测试环境。

- [ ] **Step 1: 同步正式文档**

在 `database-design.md` 记录新增表、字段、关系、金额公式、状态和事务边界；在 `checkout-pages-design.md` 记录按钮、输入、上限、汇总、合并退款和权限。不得保留旧的“合计应退只包含押金和预收款”表述。

- [ ] **Step 2: 运行完整后端测试**

Run: `npm --prefix backend test -- --runInBand`

Expected: 所有测试套件 PASS，无快照或资源泄漏警告。

- [ ] **Step 3: 运行完整前端测试**

Run: `npm --prefix frontend run test:unit`

Expected: 所有 Vitest 测试 PASS。

- [ ] **Step 4: 运行质量检查**

Run: `npm run lint`

Run: `npm run db:validate`

Run: `npm run build`

Run: `git diff --check`

Expected: 全部成功，无英文用户提示、格式错误或未提交生成文件。

- [ ] **Step 5: 运行接口回归**

Run: `npm --prefix backend run test:e2e -- --runInBand payments.e2e-spec.ts finance.e2e-spec.ts checkout-rent-refund.e2e-spec.ts`

Expected: 普通收款/退款、财务报表和退租合并退款全部 PASS。

- [ ] **Step 6: 更新测试环境**

使用 `deploy/.env.test` 执行测试环境 Docker 重建，不打印环境内容：

Run: `docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.test.yml up -d --build api web`

随后验证 `http://localhost:15173/`、`/api/health` 和登录后的 `/checkout`。确认“添加退还租金”、上限、应退租金、合并退款和中文提示可见。

- [ ] **Step 7: 编写验收记录**

`docs/checkout-rent-refund-acceptance.md` 必须记录：迁移结果、测试套件数量、测试用例数量、构建/Lint/Prisma 结果、测试环境地址、手工验收步骤和任何未解决问题。

- [ ] **Step 8: 最终提交**

```bash
git add docs/database-design.md docs/checkout-pages-design.md docs/checkout-rent-refund-acceptance.md
git commit -m "docs: record checkout rent refund acceptance"
```

---

## 最终验收清单

- [ ] 管理员可以只填写退还金额和说明。
- [ ] 系统显示并强制执行最多可退租金。
- [ ] 回冲顺序与规格一致且明细可追溯。
- [ ] 驳回、退回草稿和取消能释放预留。
- [ ] 普通退款、作废和并发退租不能重复占用金额。
- [ ] 账单净应收与实收同额减少，未收不增加。
- [ ] 收款正确显示部分退款或全部退款。
- [ ] 押金、预收款和租金只登记一次合并退款和一笔外部资金流。
- [ ] 最终确认失败时全部回滚。
- [ ] 管理员、超级管理员和游客权限符合规格。
- [ ] 收款详情、财务中心、退租详情和合同纠错兼容。
- [ ] 前端全部中文，日期使用中文格式。
- [ ] 后端测试、前端测试、E2E、Lint、Prisma 校验和构建全部通过。
- [ ] 测试环境可供用户完成手工验收。
