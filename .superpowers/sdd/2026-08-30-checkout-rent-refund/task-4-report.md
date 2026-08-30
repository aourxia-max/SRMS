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

## Review fix round 1 (2026-08-30)

### Review findings closed

- approve 的事务外读取降为不可变 `contractId` identity；事务进入后先锁合同，再重读 settlement/status/items/reservations。最终状态推进改为 `status = PENDING` 的 `updateMany` CAS，`count != 1` 返回中文冲突并由真实 Prisma 事务回滚此前写入。
- `DepositRefundsService.submit` 与 `approve` 在任何 deposit/refund/contract/room 写入前拒绝正额 `rentRefundableAmount`，直到 Task 5 合并回冲实现。
- 移除 `RENT_REFUND` 时不再把历史 item 改为 0：仅释放 RESERVED、把 settlement 快照锁为 0；详情和 submit 返回在快照为 0 且没有有效 RESERVED 时隐藏历史 item。再次添加仍复用唯一 item，RELEASED allocation 的 ID 与金额保持不变。
- 普通退款与收款作废中，有效退租预留 guard 被放在既有退租补收欠租 guard 前；两者同时命中时优先返回指定的占用文案，且仍位于写入前和同一事务内。
- 测试补强锁 SQL 参数、PENDING/RESERVED 条件、三服务锁定/重读/guard/写入顺序、多 PENDING 普通退款、多 allocation、正额 approve 保持 RESERVED、删除/改额/重提、押金退款绕过。
- 本轮未实现 APPLIED、bill adjustment 或最终回冲。

### RED

- 聚焦命令：`npm --prefix backend test -- --runInBand checkout-rent-refund-reservations.spec.ts checkout.service.spec.ts deposit-refunds.service.spec.ts refunds.service.spec.ts void-requests.service.spec.ts`。
- 首次运行 11 个失败，其中 1 个是测试 SQL 解析器把子查询表误识别为顶层锁表；只修正测试解析器后得到纯 RED：6 suites 中 4 failed / 2 passed，109 tests 中 10 failed / 99 passed。10 个失败分别覆盖旧快照 approve、押金 submit/approve 绕过、历史 item 删除/重提/详情、退款/作废提示优先级与锁顺序/参数。
- CAS 零行分支在实现后用可逆 mutation 再验证：临时移除 `count != 1` guard，执行 `npm --prefix backend test -- --runInBand checkout.service.spec.ts --testNamePattern "pending-status CAS"`，得到 1 failed / 1 passed / 40 skipped；随后无条件恢复生产 guard，并以 `rg` 确认存在。该测试证明零行 CAS 缺失会被捕获。

### GREEN and gates

- 修复后聚焦：6 suites / 110 tests 全部通过。
- Task 4 原目标加扩展命令（reservation/allocation/calculation/preview/controller/supplemental/refund/void/checkout/deposit）：10 suites / 107 tests 全部通过。
- Fresh 全后端：`npm --prefix backend test -- --runInBand`，82 suites / 572 tests 全部通过。
- `npm --prefix backend run build`：通过。
- `npm --prefix backend run lint:check`：通过。
- `npm run db:validate`：Prisma schema valid。
- `git diff --check`：在追加本报告后再次执行并通过。

### Files changed in review fix

- `backend/src/checkout/checkout-rent-refund-reservations.spec.ts`
- `backend/src/checkout/checkout.service.ts`
- `backend/src/checkout/checkout.service.spec.ts`
- `backend/src/checkout/deposit-refunds.service.ts`
- `backend/src/checkout/deposit-refunds.service.spec.ts`
- `backend/src/payments/refunds.service.ts`
- `backend/src/payments/refunds.service.spec.ts`
- `backend/src/payments/void-requests.service.ts`
- `backend/src/payments/void-requests.service.spec.ts`

### Review self-check and concerns

- approve 事务内在合同锁前没有 consistency read；锁后重读决定 eligibility，末端 CAS 防止状态推进丢失。CAS 失败前的单元测试可证明没有提交成功结果，但真实 MySQL 的执行计划与事务回滚仍须 Task 9 集成测试覆盖，本文不把 mock 测试表述为数据库级证明。
- 押金退款拒绝位于任何 deposit/refund/contract/room 写入前；正额 approve 成功路径保持 RESERVED，不写 APPLIED。
- 上一版“删除时保留 0 元历史 item”的 concern 已由本轮修复取代：历史 item 金额不再被覆盖，DTO 按锁定快照与有效 RESERVED 隐藏；仍未增加 item version/active schema。
- 链接 worktree 的 `apply_patch` Windows ACL helper 限制仍存在；本轮既有文件补丁继续使用统一 `git apply`，并由格式化、测试和差异检查验证。
