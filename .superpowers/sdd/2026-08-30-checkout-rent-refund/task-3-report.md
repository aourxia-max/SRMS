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
