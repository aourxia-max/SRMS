# Task 5 Report — 最终租金回冲记账器与三类合并退款

## Status

COMPLETE — 已实现最终租金回冲 writer、三类合并退款登记/确认及安全审计；未实现 Task 6 财务/详情展示。

## Load-bearing schema precheck

Task 1 的计划要求 `BillAdjustment` 可选关联来源 `CheckoutSettlementItem`，但开始 Task 5 时实际 `schema.prisma` 与尚未部署的 `20260830090000_checkout_rent_refund` migration 均缺少该字段、关系、索引和外键。这是 writer 创建可追溯 `CHECKOUT_RENT_REFUND` adjustment 的 load-bearing 缺口。

本任务先以 RED schema 契约证明缺失，再最小补齐：

- `BillAdjustment.checkoutSettlementItemId Int?`
- `BillAdjustment.checkoutSettlementItem`
- `CheckoutSettlementItem.billAdjustments`
- `idx_bill_adjustment_checkout_item`
- `fk_bill_adjustment_checkout_item`

未向 `PaymentAllocationType` 添加 `RENT_REFUND`，其枚举仍只有 `AUTO_OLDEST_FIRST / MANUAL_SUPER_ADMIN / PREPAYMENT_AUTO`。

## TDD evidence

### Baseline

Command:

```powershell
npm --prefix backend test -- --runInBand checkout-rent-refund-reservations.spec.ts deposit-refunds.service.spec.ts refunds.service.spec.ts adjustments.service.spec.ts payment-schema.spec.ts
```

Output:

```text
Test Suites: 5 passed, 5 total
Tests:       45 passed, 45 total
Snapshots:   0 total
Time:        1.291 s
```

### RED 1 — schema 来源关联缺失

Command:

```powershell
npm --prefix backend test -- --runInBand payment-schema.spec.ts
```

Output:

```text
FAIL src/payments/payment-schema.spec.ts
payment workflow Prisma model › links each checkout rent-refund adjustment to its settlement item
Received has value: undefined
expect(adjustmentFields.get('checkoutSettlementItemId')).toMatchObject(...)
Test Suites: 1 failed, 1 total
Tests:       1 failed, 10 passed, 11 total
```

最小补齐 schema/migration 并 generate 后，契约首次因 Prisma DMMF 对可选字段省略 `isRequired: false` 而失败；读取实际 DMMF 后改由 nullable migration 与字段/关系元数据共同证明可选性。随后：

```powershell
npm --prefix backend test -- --runInBand payment-schema.spec.ts
```

```text
Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

### RED 2 — writer 不存在

Command:

```powershell
npm --prefix backend test -- --runInBand checkout-rent-refund-writer.spec.ts
```

Output:

```text
FAIL src/checkout/checkout-rent-refund-writer.spec.ts
Cannot find module './checkout-rent-refund-writer'
Test Suites: 1 failed, 1 total
Tests:       0 total
```

加入只含固定签名并立即抛出“尚未实现”的骨架后，运行任务指定双套件：

```powershell
npm --prefix backend test -- --runInBand checkout-rent-refund-writer.spec.ts deposit-refunds.service.spec.ts
```

Output:

```text
FAIL src/checkout/checkout-rent-refund-writer.spec.ts
- 部分/全额、跨账单、多 allocation/payment：退租租金回冲记账器尚未实现
- RELEASED/APPLIED、金额/引用篡改、超额与失败顺序：收到“尚未实现”而非契约错误
FAIL src/checkout/deposit-refunds.service.spec.ts
- submit 仍抛“退租租金退款尚未完成”
- approve 仍只校验押金+预收款并拒绝正额租金
Test Suites: 2 failed, 2 total
Tests:       14 failed, 8 passed, 22 total
```

### GREEN 1 — writer 与三类合并退款

实现最小 writer 和服务编排后：

```powershell
npm --prefix backend test -- --runInBand checkout-rent-refund-writer.spec.ts deposit-refunds.service.spec.ts
```

```text
Test Suites: 2 passed, 2 total
Tests:       20 passed, 20 total
Snapshots:   0 total
```

### RED/GREEN 3 — 总额不变的拆分互换篡改

新增 `DepositRefund` 押金/预收款互换但总额和 rent 不变的测试。

Command:

```powershell
npm --prefix backend test -- --runInBand checkout-rent-refund-writer.spec.ts
```

RED output:

```text
FAIL applyCheckoutRentRefund › rejects a stored deposit/prepayment split that was swapped without changing the total
Received promise resolved instead of rejected
Resolved to value: {"affectedBillIds":[20],"affectedPaymentIds":[11],"appliedAmount":"1000.00"}
Test Suites: 1 failed, 1 total
Tests:       1 failed, 10 passed, 11 total
```

writer 增加 settlement 三类字段逐项复核后，GREEN output：

```text
Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

### RED/GREEN 4 — 非 RENT 引用篡改

新增同合同 supplemental bill 与 deposit payment 引用测试。

Command:

```powershell
npm --prefix backend test -- --runInBand checkout-rent-refund-writer.spec.ts
```

RED output:

```text
FAIL applyCheckoutRentRefund › rejects a reservation that points to a 非租金账单
FAIL applyCheckoutRentRefund › rejects a reservation that points to a 非租金收款
Received promise resolved instead of rejected
Test Suites: 1 failed, 1 total
Tests:       2 failed, 11 passed, 13 total
```

writer 增加 bill/payment category 与有效状态复核后，GREEN output：

```text
Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

## Final GREEN and quality gates

### 指定与相关回归

Command:

```powershell
npm --prefix backend test -- --runInBand checkout-rent-refund-writer.spec.ts checkout-rent-refund-reservations.spec.ts deposit-refunds.service.spec.ts deposit-refunds.controller.spec.ts refunds.service.spec.ts adjustments.service.spec.ts checkout.service.spec.ts payment-schema.spec.ts
```

Output:

```text
Test Suites: 8 passed, 8 total
Tests:       105 passed, 105 total
Snapshots:   0 total
Time:        1.979 s
```

### Fresh 全后端

Command:

```powershell
npm --prefix backend test -- --runInBand
```

Output:

```text
Test Suites: 83 passed, 83 total
Tests:       588 passed, 588 total
Snapshots:   0 total
Time:        7.075 s
```

### Build

Command:

```powershell
npm --prefix backend run build
```

Output:

```text
> backend@0.0.1 build
> nest build
exit 0
```

### Lint

首次 `lint:check` 只报告新测试文件的 CRLF/Prettier 和同步 fake 被声明为 async、宽泛测试类型泄漏问题；仅格式化本任务五个 TypeScript 文件，并把内存 fake 改为同步返回、在测试输出边界收窄类型。最终命令：

```powershell
npm --prefix backend run lint:check
```

Output:

```text
> backend@0.0.1 lint:check
> eslint "{src,apps,libs,test}/**/*.ts"
exit 0
```

### Prisma validate/generate

Command:

```powershell
npm --prefix backend run prisma:validate
npm --prefix backend run prisma:generate
```

Output:

```text
The schema at prisma\schema.prisma is valid
Generated Prisma Client (v7.8.0) to .\node_modules\@prisma\client in 281ms
exit 0
```

### Whitespace

Command:

```powershell
git diff --check
```

Output:

```text
exit 0（仅 Git 提示部分 LF 文件下次触碰会按工作区规则转为 CRLF，无 whitespace error）
```

## Implementation

- 新增 `applyCheckoutRentRefund(tx, input)`；只使用调用方传入的 `Prisma.TransactionClient`，内部不创建事务。
- 依次锁定并重读 settlement、DepositRefund、来源 item、reservation、rent bill、payment、payment allocation、普通 refund/refund allocation。
- 只消费当前 settlement 的 `RESERVED` 行；存在 `APPLIED` 时拒绝重复，只有 `RELEASED` 时要求退回草稿重提。
- 逐项复核 settlement 与 DepositRefund 的押金/预收款/rent 三类快照、合计、唯一 `RENT_REFUND` item、reservation 总额、缓存引用、contract/category/status。
- 同一 bill 先汇总，仅更新一次；创建一条直接 `APPROVED` 的 `CHECKOUT_RENT_REFUND / DECREASE` adjustment，并记录 before/amount/after、来源 item、提交/批准人和时间。
- 同一 allocation 先汇总，仅更新一次 `reversedAmount`；CAS 把全部 reservation 更新为 `APPLIED`，写 `appliedAt/depositRefundId`。
- payment 状态使用所有 allocation 的 `allocatedAmount` 作为分母；分子只包含普通 `APPROVED` refund allocation、历史 checkout `APPLIED` 和本次回冲。PENDING 普通退款、RELEASED/RESERVED checkout 和 `PaymentAllocation.reversedAmount` 不重复计入。
- DepositRefund submit 仍只接受 settlement ID、总额、日期、方式、备注、proof IDs；测试即使直接夹带三类字段，服务也只写 settlement 锁定值。
- DepositRefund approve 在一个既有 Prisma 事务中复核三类快照/总额/reservation/余额，CAS 认领外部 DepositRefund，调用 writer，写押金/预收款账本，锁 proof，CAS 完成 settlement，结束 contract、更新 room/history，并写 `CHECKOUT_REFUND_APPROVED` security audit。
- 外部资金流仍只有一条 DepositRefund；没有创建额外 PaymentRefund 或 Task 6 展示记录。

## 金额与状态不变量自审

- 三类合计：`refundAmount = depositRefundAmount + prepaymentRefundAmount + rentRefundAmount`；submit、approve、writer 三层复核，writer 还逐项对比 settlement。
- Bill 聚合：对每个 bill，`newPayable = oldPayable - billRefund >= 0`，`newReceived = oldReceived - billRefund >= 0`，两者始终同额减少；执行前要求 `oldOutstanding = 0` 且 `oldPayable = oldReceived`，写后固定 `outstanding = 0`，不会制造欠租。
- Bill status：新应收和实收都为 0 时 `REFUNDED`；否则为 `PAID`。
- Adjustment：`before = oldPayable`，`amount = billRefund`，`after = newPayable`；`RentBill.adjustmentAmount` 同额减少，保持账单调整恒等关系。
- Allocation：对每个 allocation 聚合当前 reservation，先验证 `currentRefund <= allocatedAmount - reversedAmount`，再写 `newReversed = oldReversed + currentRefund`。
- Reservation：全部 active IDs 以 `status=RESERVED AND depositRefundId IS NULL` CAS；更新数必须等于 active 行数，否则抛中文冲突并由调用方事务回滚。
- Payment：`completedRefund = approvedOrdinary + appliedCheckout + currentCheckout`；等于全部 allocation allocated 总额时 `FULLY_REFUNDED`，大于 0 且未等于时 `PARTIALLY_REFUNDED`；若超过分母则拒绝异常状态。
- Result：`appliedAmount` 来自经三层锁定复核的 settlement rent，受影响 bill/payment IDs 去重并升序返回。

## Atomicity self-review

最终 approve 的同一个 `$transaction` 顺序为：

1. 锁 room/contract、settlement、DepositRefund 和既有 rent bill；
2. 重读并复核 eligibility、三类快照、reservation、押金/预收款余额；
3. CAS 把唯一外部 DepositRefund 认领为 APPROVED；
4. writer 在同一 tx 中完成租金 bill/adjustment/allocation/reservation/payment；
5. 写押金与预收款 REFUND transaction；
6. 锁 proof；
7. CAS 把 settlement 置为 COMPLETED；
8. 结束 contract、更新 room/history、写 security audit。

单元测试模拟 writer/账单写入失败并证明后续步骤不调用。真实 MySQL 任一步失败的数据库级回滚与并发执行计划按计划留给 Task 9 集成测试，本报告不把 mock 顺序测试表述为真实数据库回滚证明。

## Files

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260830090000_checkout_rent_refund/migration.sql`
- `backend/src/payments/payment-schema.spec.ts`
- `backend/src/checkout/checkout-rent-refund-writer.ts`（新增）
- `backend/src/checkout/checkout-rent-refund-writer.spec.ts`（新增）
- `backend/src/checkout/deposit-refunds.service.ts`
- `backend/src/checkout/deposit-refunds.service.spec.ts`
- `.superpowers/sdd/2026-08-30-checkout-rent-refund/task-5-report.md`（新增）

`backend/src/checkout/dto/submit-deposit-refund.dto.ts` 已核对但未修改：实际 DTO 原本就只含 settlement ID、总额、日期、方式、备注和 proof IDs，没有三类客户端拆分字段；为避免无意义改动保持原样。

## Concerns

- 同一 `20260830090000_checkout_rent_refund` migration 尚未部署，按任务要求直接补齐 load-bearing FK；若环境已提前部署该 migration，不能原地修改，应另建补偿 migration。当前任务前提明确为“尚未部署”。
- 真实 MySQL 原子回滚、锁竞争、CAS 并发与 migration 实际执行留 Task 9；本任务完成单元层状态/金额与失败后续不调用证明。
- Task 6 财务流水、详情/报表展示完全未触碰。
- 任务明确禁止派生审查代理；因此未执行 reviewer subagent，改用本地完整 diff、金额/状态不变量、相关回归、全后端、build、lint、Prisma 和 whitespace 自审。
- Codex 内置 `apply_patch` 在该链接 worktree 上触发 Windows ACL helper 错误；既有文件改动使用 `git apply` 统一补丁完成，并由 Prettier、测试、lint、build 与 `git diff --check` 验证。
