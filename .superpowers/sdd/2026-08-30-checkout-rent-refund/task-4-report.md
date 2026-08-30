# Task 4 Report — 事务预留、释放与逆转保护

## Status

COMPLETE — Task 4 已实现并验证；未实现 `APPLIED` 或最终财务回冲。

## TDD evidence

### Baseline

- Command: `npm --prefix backend test -- --runInBand checkout-rent-refund-reservations.spec.ts checkout-supplemental-balance.spec.ts refunds.service.spec.ts void-requests.service.spec.ts checkout.service.spec.ts`
- Result: 6 suites passed, 92 tests passed（新增 reservations spec 尚不存在时 Jest 共匹配 6 个既有套件）。

### RED

- 先新增预留生命周期、稳定锁顺序、重提自身排除、PENDING 普通退款/作废占用、失败零部分预留、幂等释放、退款/作废 guard、reject/return/cancel 释放和 approve 篡改校验测试。
- 首次 RED：4 suites failed / 3 passed；7 tests failed / 92 passed。失败原因均为预期的缺失功能：模块不存在、submit 未预留、状态流转未释放、approve 未校验、退款/作废未 guard。
- 自审 RED 1：2 tests failed，证明普通退款/作废锁顺序与含租金退款的零额完成绕过尚未保护。
- 自审 RED 2：1 test failed，证明详情中的 `rentRefundableAmount` 尚未规范为两位小数字符串。

### GREEN

- Task 4 目标套件：7 suites passed, 105 tests passed。
- 扩展相关回归：11 suites passed, 129 tests passed，包含 allocation、calculation、checkout preview/controller、supplemental、refund/void 和 checkout service。
- 最终 fresh 全后端测试：82 suites passed, 563 tests passed, 0 failures。
- `npm --prefix backend run build`: exit 0。
- `npm --prefix backend run lint:check`: exit 0。
- `npm run db:validate`: exit 0，Prisma schema valid。

## Implementation

- 新增共享 reservations 模块，read-only preview 与 locked submit 复用同一候选余额公式：原分配减已回冲、PENDING 普通退款、其他结算 RESERVED；存在 PENDING 作废申请时该收款候选为零。
- locked submit 使用参数化 `Prisma.sql`，按稳定 ID 顺序锁定租金账单、收款、收款分配、PENDING 普通退款分配、PENDING 作废申请和 RESERVED 退租预留。
- submit 在原事务内后端重算；先把当前结算旧 RESERVED 变为 RELEASED 并写 `releasedAt`，再用 `createMany` 创建全新 RESERVED 行，不复用 RELEASED 行。
- preview 保持只读，并继续排除当前结算自己的 RESERVED；其他结算 RESERVED 仍扣减。
- reject、returnToDraft、cancel 幂等释放当前结算 RESERVED。
- approve 在任何财务写入前校验 RESERVED 总额、item 类型/金额、payment/rentBill 引用与锁定 `rentRefundableAmount` 一致；验证通过时保持 RESERVED，不执行回冲。
- 普通退款 submit 与收款作废 submit 在各自 Prisma 事务中调用 guard；命中有效预留时返回指定中文错误。
- `completeZeroRefund` 现同时要求 `rentRefundableAmount` 为零，防止 Task 5 实现前绕过 RESERVED 流程完成结算。
- 详情接口将锁定 `rentRefundableAmount` 规范为两位小数字符串。

## Files

- `backend/src/checkout/checkout-rent-refund-reservations.ts`（新增）
- `backend/src/checkout/checkout-rent-refund-reservations.spec.ts`（新增）
- `backend/src/checkout/checkout.service.ts`
- `backend/src/checkout/checkout.service.spec.ts`
- `backend/src/payments/refunds.service.ts`
- `backend/src/payments/refunds.service.spec.ts`
- `backend/src/payments/void-requests.service.ts`
- `backend/src/payments/void-requests.service.spec.ts`

## Self-review

- 所有 helper 接收现有 `Prisma.TransactionClient`，内部未开启新事务。
- 所有 `FOR UPDATE` SQL 都使用 `Prisma.sql` 参数化用户/业务 ID，且查询包含稳定 `ORDER BY ... id`。
- 合同锁作为退款、作废与退租 submit 的共同串行化入口；guard/候选重读均在同一事务内。
- 作废占用只查询 `approvalStatus = PENDING`；历史 REJECTED/CANCELLED 不阻塞。
- reservation 创建发生在完整计划生成后；不足时 `createMany` 不调用，真实数据库事务会回滚此前 item/snapshot 写入。
- 未新增 `APPLIED` 写入、bill adjustment、payment allocation reversedAmount 或 deposit refund 回冲逻辑。

## Concerns

- 当前模型把 reservation 外键以 `onDelete: Restrict` 指向 `CheckoutSettlementItem`，且 item 没有版本/归档字段。为保留 RELEASED 审计行，重提复用同一个 `RENT_REFUND` item，但每次 reservation 行均全新；若重提取消租金退款，保留一个金额为 0 的历史 item。若产品后续要求 item 级完整版本审计，建议单独增加 item 版本/active 字段，而不是删除 RELEASED 行。
- Codex 内置 `apply_patch` 在该链接 worktree 上读取既有文件时触发 Windows ACL helper 错误；既有文件改动改用 `git apply` 统一补丁完成，随后全部由 Prettier、lint、build、测试和 `git diff --check` 验证。
