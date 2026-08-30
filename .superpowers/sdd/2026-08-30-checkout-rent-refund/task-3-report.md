# Task 3 Report: checkout rent refund preview and amount summary

## Status

完成。实现仅覆盖只读预览、提交 DTO/项目校验和金额汇总；没有创建或释放 `RESERVED` 记录，没有执行租金回冲，也没有修改最终退款状态流转。

## TDD RED 证据

### 1. 结算金额、DTO、提交与预览

命令：

```bash
npm --prefix backend test -- --runInBand checkout-calculation.spec.ts checkout.service.spec.ts checkout.controller.spec.ts
```

第一次运行暴露测试环境缺少 `reflect-metadata`，先仅修正测试初始化后，以同一命令重新确认业务 RED。

关键输出：

```text
Test Suites: 3 failed, 3 total
Tests:       7 failed, 32 passed, 39 total
```

预期失败原因：

- `calculateCheckoutAmounts` 缺少 `rentRefundableAmount`，`totalRefundAmount` 未加租金退款；
- DTO 运行时枚举拒绝 `RENT_REFUND`；
- submit/preview 仍把 `RENT_REFUND` 当验房扣款，错误要求 `inspectionRecordRef`；
- 同一结算单两个租金退款项未得到规格中文错误；
- 预览尚未返回候选明细、最大可退额和中文超额错误。

### 2. 错误 Prisma 枚举归属前置修复

命令：

```bash
npm --prefix backend test -- --runInBand payment-schema.spec.ts
```

关键输出：

```text
Test Suites: 1 failed, 1 total
Tests:       3 failed, 7 passed, 10 total
```

预期失败原因：

- 运行时 `PaymentAllocationType` 错误包含 `RENT_REFUND`；
- 运行时 `CheckoutSettlementItemType` 缺少 `RENT_REFUND`；
- Prisma 生成 SQL 的 `checkout_settlement_items.item_type` 不包含 `RENT_REFUND`。

控制器裁定迁移尚未应用，因此在同一个 `20260830090000_checkout_rent_refund` 迁移中修正枚举归属，不新增第二迁移。

## GREEN 实现

### Prisma 枚举与迁移

- 从 `PaymentAllocationType` 移除错误新增的 `RENT_REFUND`；
- 向 `CheckoutSettlementItemType` 增加 `RENT_REFUND`；
- 从尚未部署的迁移移除 `payment_allocations.allocation_type` ALTER；
- 在同一迁移中增加 `checkout_settlement_items.item_type` ALTER；
- 重新生成 Prisma Client；
- `payment-schema.spec.ts` 同时验证正确运行时枚举、错误枚举不存在和生成 SQL。

### DTO 与提交校验

- `RENT_REFUND` 可不带 `rentBillId` 和 `inspectionRecordRef`；
- 金额必须是字符串形式的有限正数，零、负数、`Infinity`、`NaN` 均被拒绝；
- description 先 trim，再校验 1..500；
- preview 和 submit 都拒绝重复租金退款项，中文提示为 `同一退租结算只能添加一项退还租金`；
- submit 仍只保存结算项目，不创建预留。

### 金额与只读预览

- `calculateCheckoutAmounts` 增加可选 `rentRefundAmount` 和输出 `rentRefundableAmount`；
- 租金退款不参与欠租或验房扣款抵扣，单独加入 `totalRefundAmount`；
- 预览候选查询仅读取 RENT 收款分配和 RENT 账单；
- 每个候选可用额为 `allocatedAmount - reversedAmount - PENDING 普通退款占用 - RESERVED 退租预留`，最低归零；
- 复用 `allocateCheckoutRentRefund` 生成建议明细；
- 返回 `rentRefundableAmount`、`maxRentRefundAmount`、`rentRefundAllocations` 和新 `totalRefundAmount`；
- 0 可用额错误：`当前合同没有可回冲的已缴租金。`；
- 非零超额错误：`退还租金不能超过当前可回冲金额 ¥X.XX。`；
- 预览测试显式断言没有调用 allocation create 或 payment allocation update。

## GREEN 与最终验证

首次联合 GREEN：

```bash
npm --prefix backend test -- --runInBand checkout-calculation.spec.ts checkout.service.spec.ts checkout.controller.spec.ts checkout-preview.service.spec.ts payment-schema.spec.ts
```

结果：5 suites passed，50 tests passed。

边界收敛后的最终摘要套件：

```bash
npm --prefix backend test -- --runInBand checkout-calculation.spec.ts checkout.service.spec.ts checkout.controller.spec.ts
```

结果：3 suites passed，39 tests passed。

关联套件：

```bash
npm --prefix backend test -- --runInBand checkout-preview.service.spec.ts checkout-rent-refund-allocation.spec.ts payment-schema.spec.ts
```

结果：3 suites passed，18 tests passed。

其他验证：

- `npm run db:validate`：schema valid；
- `npm --prefix backend run prisma:generate`：Prisma Client v7.8.0 generated；
- `npm run lint`：exit 0；
- `npm --prefix backend run build`：exit 0；
- `git diff --check`：exit 0，仅有 Git 的 LF/CRLF 工作副本提示，无 whitespace error。

## 修改文件

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260830090000_checkout_rent_refund/migration.sql`
- `backend/src/payments/payment-schema.spec.ts`
- `backend/src/checkout/checkout-calculation.ts`
- `backend/src/checkout/checkout-calculation.spec.ts`
- `backend/src/checkout/dto/submit-checkout-settlement.dto.ts`
- `backend/src/checkout/checkout.service.ts`
- `backend/src/checkout/checkout.service.spec.ts`
- `backend/src/checkout/checkout.controller.spec.ts`
- `backend/src/checkout/checkout-preview.service.spec.ts`

## 自审

- 金额变异检查：漏加租金退款、把租金退款计入扣款、漏减任一 reversed/PENDING/RESERVED 占用都会使聚焦断言失败；
- 查询契约检查：测试断言 Prisma where/select 完整结构，mock 返回镜像该 select 的全部字段；
- 写入边界检查：preview 没有 transaction、create、update 或 reservation mutation；
- 中文化检查：领域英文错误被 `BadRequestException` 中文提示转换，未暴露枚举或英文错误；
- 范围检查：自审时撤回了对 approve 锁定金额和 detail 展示的提前接入，留给 Task 4+；
- 重复项与负数在入口校验，实际 submit 的单个 `RENT_REFUND` 不要求账单/验房编号。

## Concerns

- 预览是无锁只读快照，普通退款/作废/其他退租提交可在预览后改变余额；事务锁定与 `RESERVED` 写入按任务边界留给 Task 4。
- 同一历史迁移被修改的前提是控制器明确确认尚未应用到测试或生产；若外部环境已经应用，应停止部署并改用后续迁移。
- 内置 `apply_patch` 在该 worktree 因 Windows ACL 的 `apply deny-read ACLs` 失败；经控制器已知的最小回退，统一 diff 通过 `git apply` 仅写入上述明确文件。
- 无当前阻塞。

## Review fix round 1（2026-08-30）

### 修复范围与根因

本轮仅处理复审开放的四项 Important 发现：

1. 候选加载器只接收 `contractId`，因此当前结算已有的 `RESERVED` 也被再次扣减；预览重开时会虚降可退上限。
2. 纯 allocator 的最小计划类型没有账单展示字段，服务响应也未在外层补回 `billNo`。
3. `RENT_REFUND` 未禁止携带 `rentBillId` / `inspectionRecordRef`，内部调用可绕过管理员仅填金额与说明的契约。
4. 旧金额正则未绑定 `DECIMAL(14,2)`，会接受亚分金额和超长整数；服务入口也需要在构造 Decimal/持久化之前防御绕过 DTO 的输入。

没有新增或释放 `RESERVED`，没有改审批/回冲状态流转，没有改 Prisma schema 或迁移。

### RED

先扩展 `checkout.service.spec.ts` 与 `checkout.controller.spec.ts`：

- 同一候选同时模拟当前结算自有预留和其他结算预留，手工断言前者不扣、后者仍扣；
- 断言预览明细返回具体 `billNo`；
- 分别覆盖 preview 夹带其他合同账单 ID、submit 夹带验房编号，且写入 mock 不被调用；
- 覆盖 number、零、负数、`0.001`、13 位整数、科学计数、Infinity、NaN，并验证最大值 `999999999999.99`。

命令：

```bash
npm --prefix backend test -- --runInBand checkout.service.spec.ts checkout.controller.spec.ts
```

关键输出：`2 suites failed`，`12 failed, 32 passed, 44 total`。失败分别证明：

- max 可退额错误为 695/750，而手工余额应为 1070，且响应缺少 `billNo`；
- preview/submit 对夹带关联字段错误地 resolved；
- service 接受 `0.001`；
- DTO 接受 `0.001` 与 `1000000000000.00`，其他错误也没有规格中文信息。

### GREEN 实现

- `loadRentRefundCandidates(contractId, currentSettlementId)` 查询预留所属的 `checkoutSettlementId`，汇总时排除当前结算的 RESERVED，仅扣其他结算预留。
- 候选查询读取 `rentBill.billNo`；服务定义带 `billNo` 的预览候选外层类型，并在 allocator 返回后按 `paymentAllocationId` 补入响应，未修改纯 allocator 的最小输入/输出接口。
- preview 和 submit 在任何写入前拒绝 `RENT_REFUND` 携带账单或验房关联，统一中文为 `退还租金不能关联租金账单或验房记录`。
- DTO 与服务共用 `CHECKOUT_SETTLEMENT_AMOUNT_PATTERN` / `CHECKOUT_SETTLEMENT_AMOUNT_MESSAGE`：只接受普通十进制字符串、1..12 位整数、可选 1..2 位小数且实际值大于零；拒绝 number、科学计数、非有限值、亚分及超范围值。

定向 GREEN：

```bash
npm --prefix backend test -- --runInBand checkout.service.spec.ts -t "previews rent refund allocations from the unoccupied balance without writing"
npm --prefix backend test -- --runInBand checkout.service.spec.ts -t "rejects a rent refund carrying"
npm --prefix backend test -- --runInBand checkout.service.spec.ts checkout.controller.spec.ts
```

关键输出依次为：`1 passed`（30 skipped）、`2 passed`（29 skipped）、`2 suites passed / 44 tests passed`。

### 最终验证

```bash
npm --prefix backend test -- --runInBand checkout-calculation.spec.ts checkout.service.spec.ts checkout.controller.spec.ts checkout-preview.service.spec.ts payment-schema.spec.ts
npm --prefix backend test -- --runInBand checkout-rent-refund-allocation.spec.ts checkout.controller.spec.ts payment-schema.spec.ts
npm run lint
npm --prefix backend run build
npm run db:validate
git diff --check
```

结果：

- 5 个联合套件全部通过，58 tests passed；
- allocator / DTO-controller / schema 聚焦套件全部通过，30 tests passed；
- lint exit 0；
- backend build exit 0；
- Prisma schema valid；
- `git diff --check` exit 0（仅 LF/CRLF 工作副本提示，无 whitespace error）。

### 本轮修改文件

- `backend/src/checkout/checkout.service.ts`
- `backend/src/checkout/checkout.service.spec.ts`
- `backend/src/checkout/checkout.controller.spec.ts`
- `backend/src/checkout/dto/submit-checkout-settlement.dto.ts`
- `.superpowers/sdd/2026-08-30-checkout-rent-refund/task-3-report.md`

### 本轮自审与 concerns

- 自有预留与其他预留使用不同 settlement ID，预期金额由测试内逐项手算；若错误扣回自有预留或漏扣其他预留，max 与两笔明细都会失败。
- `billNo` 只存在于服务预览候选和响应映射，不污染 allocator 领域类型。
- 非法关联在 preview 查询候选前、submit 删除/更新前失败；测试明确断言无相应读取或写入。
- 金额校验先于 `Prisma.Decimal` 构造与持久化，内部绕过 DTO 仍得到稳定中文错误，不会下沉为数据库异常。
- 仍然保留原 concern：预览为无锁只读快照；并发锁与 RESERVED 写入属于 Task 4，不在本轮扩展。
- 未改 schema，因此本轮无需生成新 migration；仍按要求执行 `db:validate`。
- 无新增阻塞。
