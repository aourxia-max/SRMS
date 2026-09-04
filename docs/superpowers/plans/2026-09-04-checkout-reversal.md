# 已退租合同分页与撤销退租 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让“已退租合同”支持规范分页，并允许超级管理员在房源尚未被后续有效合同占用时撤销已完成退租；撤销必须在一个事务中恢复合同、房态和所有由该退租产生的系统账本影响。

**Architecture:** 保持既有“退租结算单 + 追加账本记录”的设计。后端新增只面向已完成结算单的撤销服务，复用未来账单反核销、租金退款预留等现有可逆操作；对已经确认的合并退款和押金抵扣新增反向账本记录，绝不物理删除历史资金记录。前端在第四页签提供页码/每页数量和仅超级管理员可见的撤销入口；成功后刷新列表、详情和驾驶舱相关数据。

**Tech Stack:** NestJS、Prisma/MySQL、Vue 3、TypeScript、Jest、Vitest。

**Spec:** `docs/superpowers/specs/2026-09-04-checkout-reversal-design.md`（已确认）

## 全局约束

- “撤销退租”仅允许 `SUPER_ADMIN` 调用；普通管理员和游客不得看到入口，且后端必须返回 403。
- 唯一业务阻断条件是：同一房源存在除目标合同外、仍有效且会占用房间的后续合同（`PENDING`、`ACTIVE`、`PENDING_CHECKOUT`）。不能以退款已确认、扣款已入账、未来账单已核销或结算已完成为理由拒绝。
- 操作不要求填写原因，但必须写安全审计记录，包含结算单、合同、房源、操作者、操作时间、恢复项目数和金额。
- 所有变更必须在一次数据库事务中完成，并先按既有锁顺序锁定房源、目标合同、结算单、退款、相关账单及资金流水；并发重复提交必须只有一次成功，另一次返回“状态已变化，请刷新后重试”。
- 不删除结算单、退款单、房态历史、账单调整或资金流水。结算单和退款单标记为“已取消”，并通过反向账本记录恢复余额；被撤销结算单自然不再出现在“已退租合同”列表。
- 撤销后合同状态按照原合同起止日期和操作日自动计算：未到开始日为 `PENDING`（待开始），开始日至结束日为 `ACTIVE`（履行中），超过结束日为 `ENDED`（已结束）。房态恢复为发起退租前的状态；若合同因原租期已结束而恢复为已结束，房态仍恢复为退租前房态，以保证只撤销本次误操作、不会凭空改写原始业务判断。
- 任何前端判断都不是安全边界。所有状态、占用和余额校验以后端重新读取并加锁的数据为准。

## 文件结构

- 修改 `backend/src/checkout/checkout.service.ts`：提供已完成结算单撤销编排、合同状态计算和列表分页参数约束。
- 新增 `backend/src/checkout/checkout-completed-reversal.ts`：封装已完成退租的锁定、资金反向账本、退款取消、房态恢复和审计明细。
- 修改 `backend/src/checkout/checkout-approved-cancellation.ts`：将可复用的账单/押金抵扣反向操作抽为可被“取消已确认退租”和“撤销已完成退租”共同调用的低层函数，保留当前已确认退款的安全拒绝规则给旧取消接口。
- 修改 `backend/src/checkout/checkout-rent-refund-writer.ts`、`backend/src/checkout/checkout-rent-refund-reservations.ts`：提供已确认租金退款的反向写入和预留状态恢复，保留所有原流水。
- 修改 `backend/src/checkout/deposit-refunds.service.ts`：仅抽取共享的退款资金写入/反写帮助函数，不改变原“确认退款”接口权限与流程。
- 修改 `backend/src/checkout/checkout.controller.ts`：增加严格的超级管理员撤销接口。
- 修改 `frontend/src/services/checkout.ts`：增加撤销 API。
- 修改 `frontend/src/views/checkout/CheckoutWorkspace.vue`：维护每页数量、撤销确认、权限和成功后的全量刷新。
- 修改 `frontend/src/views/checkout/CompletedCheckoutContractsPanel.vue`：补全分页控件、每页 20/50/100 条和撤销按钮。
- 修改 `frontend/src/views/checkout/checkout-types.ts`：补充撤销结果或列表操作所需的类型。
- 修改对应 Jest/Vitest 测试文件；如 Prisma schema 或迁移确有新增审计字段需求，再单独添加迁移。优先复用 `security_audit_logs`，避免无必要的数据表变更。

---

### Task 1: 锁定分页契约并补齐前端分页交互

**Files:**
- Modify: `backend/src/checkout/dto/completed-checkout-contracts-query.dto.ts`
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`
- Modify: `frontend/src/views/checkout/CompletedCheckoutContractsPanel.vue`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`

- [ ] 先在 `checkout.service.spec.ts` 增加 `listCompletedContracts` 测试：只返回 `COMPLETED + ENDED`，按 `updatedAt DESC, id DESC` 排序；关键字能匹配合同号、完整房号和当前主租户；默认第一页 20 条；请求第 2 页保留关键字；非法页码归一到 1；`pageSize` 仅接受 20、50、100，其他值统一回退为 20。
- [ ] 运行 `npm --prefix backend test -- checkout.service.spec.ts`，确认新增测试先失败于页大小白名单或分页结果断言。
- [ ] DTO 保留正整数与最大值校验；在服务端把缺省或非允许页大小归一为 20，避免前端以外的调用传入 1 或任意值。保留现有 `COMPLETED + ENDED` 过滤、三字段搜索和最新编辑排序。
- [ ] 先在 `checkout-workspace.spec.ts` 为面板新增断言：选择每页 50/100 时发出页大小事件并回到第 1 页；搜索后回到第 1 页；上一页/页码/下一页发出正确页码且边界禁用。
- [ ] 扩展 `CompletedCheckoutContractsPanel.vue` emits 为 `page-size-change`，使用 Element Plus `el-pagination` 或与现有页面一致的可访问分页控件显示总数、页码、上一页/下一页和每页 20/50/100。搜索框保持“合同编号、楼栋房号、租户姓名”。在 `CheckoutWorkspace.vue` 中让 `loadCompletedContracts(page, keyword, pageSize)` 显式传页大小，切换页大小和搜索均从第 1 页加载。
- [ ] 运行 `npm --prefix backend test -- checkout.service.spec.ts` 与 `npm --prefix frontend test -- checkout-workspace.spec.ts`，确认通过。
- [ ] Commit: `feat(checkout): improve completed contract pagination`

### Task 2: 为完成退租定义可审计的反向账本操作

**Files:**
- Modify: `backend/src/checkout/checkout-approved-cancellation.ts`
- Modify: `backend/src/checkout/checkout-rent-refund-reservations.ts`
- Modify: `backend/src/checkout/checkout-rent-refund-writer.ts`
- Modify: `backend/src/checkout/deposit-refunds.service.ts`
- Create: `backend/src/checkout/checkout-completed-reversal.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`

- [ ] 先为三条已完成路径写失败测试：无退款完成、已确认押金/预收款退款完成、含“退还租金”完成。每条测试都断言撤销后：原结算单为 `CANCELLED`，原退款申请为 `CANCELLED`（如有），合同余额恢复到完成退租前，未来账单的应收/未收与状态恢复，退还租金的付款分配不再处于已反冲状态，且历史原流水仍存在、另有反向流水。
- [ ] 从 `checkout-approved-cancellation.ts` 提取“反转押金抵扣 + 恢复被抵扣欠租账单”“反转未来账单核销”“作废未实收补收账单”所需的内部帮助函数。原 `cancel` 行为保持不变：若退款已确认，旧取消接口仍明确拒绝。
- [ ] 在 `checkout-rent-refund-writer.ts` 添加只由撤销退租调用的反向函数：锁定此次 `DepositRefund` 对应的租金退款分配、创建与原反冲金额相等的反向分配/流水或恢复原分配的可退款余额（使用当前模块已有的写法），将结算预留从已消费状态转为 `RELEASED`。禁止修改其他收款、其他退款或其他结算单的数据。
- [ ] 为已确认退款增加受控的系统回滚帮助函数：锁定该退款、押金流水和预收款流水；创建 `DepositTransactionType.REVERSAL`（及预收款表已有的反向交易类型/记录）来把余额恢复为退款前；将原退款更新为 `CANCELLED` 并保留原 `approvedBy/approvedAt`，`cancelledReason` 固定为“撤销已完成退租”。不得调用面向人工取消的 `DepositRefundsService.cancel`，因为该接口只处理待审批退款。
- [ ] 新建 `checkout-completed-reversal.ts`，输入为事务、结算单、操作者和统一 `occurredAt`。按固定顺序执行：锁定结算相关退款/流水/账单 → 反向已确认退款 → 反向租金退款 → 反向押金抵扣 → 恢复未来账单 → 作废无实收补收账单 → 释放残留预留。返回每类恢复金额和记录 ID，供审计与测试断言。
- [ ] 为异常路径补测试：退款或付款分配已被其他待审批/已处理业务占用、原流水与余额不一致、补收账单已有实收时，整个事务失败且不留下半条反向记录。
- [ ] 运行 `npm --prefix backend test -- checkout.service.spec.ts`，确认全绿。
- [ ] Commit: `feat(checkout): add reversible completed checkout accounting`

### Task 3: 实现超级管理员“撤销退租”后端接口与房态恢复

**Files:**
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.controller.ts`
- Modify: `backend/src/checkout/checkout.controller.spec.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`

- [ ] 先添加 controller 测试：`POST /checkout-settlements/:id/revoke-completed` 只有 `SUPER_ADMIN` 可调用；`ADMIN` 与游客得到 403；路由不能与 `:id` 详情路由冲突。
- [ ] 先添加 service 失败测试：结算单非 `COMPLETED`、目标合同非 `ENDED`、不存在初始退租房态历史、或房间已有另一份 `PENDING`/`ACTIVE`/`PENDING_CHECKOUT` 合同，均拒绝且不改数据。特别覆盖“后续合同房源占用”提示中文且可理解。
- [ ] 在 `CheckoutService.revokeCompleted(id, user)` 开启 `ReadCommitted` 事务，复用 `lockRoomAndTargetContract`，显式 `FOR UPDATE` 锁定结算单和同房间有效合同。后续占用的判定为同房源、合同 ID 不等于目标合同且状态属于 `PENDING`、`ACTIVE`、`PENDING_CHECKOUT`；不按创建时间猜测，避免任何当前占房合同被误覆盖。
- [ ] 读取该结算单发起退租时的第一条 `RoomStatusHistory`（`businessType=CHECKOUT`、`businessId=settlement.id`、`toStatus=PENDING_CHECKOUT`），用其 `fromStatus` 作为恢复房态；找不到即终止，绝不默认空置。
- [ ] 调用 Task 2 的反向账本模块；计算合同恢复状态（以服务器操作日与 `startDate/endDate` 比较）；更新合同、房源状态和 `statusChangedAt`；新写一条房态历史，`changeReason='撤销已完成退租'`、`businessType='CHECKOUT_REVERSAL'`、`businessId=settlement.id`，不得删除原历史。
- [ ] 把结算单由 `COMPLETED` 原子更新为 `CANCELLED`，并新增 `securityAuditLog`：事件 `COMPLETED_CHECKOUT_REVOKED`，记录恢复前后合同/房态、退款/押金/预收款/租金退款/账单恢复金额、冲突校验结果与操作者。使用 `updateMany` 状态条件保证重复提交的幂等失败。
- [ ] 完成 service 成功测试：在原租期前、中、后分别得到 `PENDING`、`ACTIVE`、`ENDED`；房态恢复；已退租列表不再出现；每种资金分支各恢复一次且总额不重复；连续两次调用只有第一次成功；异常回滚不留残留数据。
- [ ] 运行 `npm --prefix backend test -- checkout.controller.spec.ts checkout.service.spec.ts`，确认通过。
- [ ] Commit: `feat(checkout): allow super admins to revoke completed checkout`

### Task 4: 前端撤销入口、确认交互与刷新

**Files:**
- Modify: `frontend/src/services/checkout.ts`
- Modify: `frontend/src/views/checkout/checkout-types.ts`
- Modify: `frontend/src/views/checkout/CompletedCheckoutContractsPanel.vue`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`

- [ ] 先写 Vitest：超级管理员在每条已退租合同上能看到“撤销退租”，普通管理员和游客看不到；点击时必须弹出无原因输入的二次确认；取消不发请求；确认后调用新 API；成功后关闭已退租详情、重新加载当前列表页并刷新退租工单/退款待办；失败时只显示后端中文错误且不移除当前行。
- [ ] 在 `checkoutApi` 增加 `revokeCompleted(id)`，为结果定义最小明确类型（结算单 ID、合同状态、房态、恢复摘要）而不使用 `Record<string, unknown>`。
- [ ] 向面板传入 `canRevokeCompleted`，新增危险样式但不使用红色链接冒充普通“查看详情”。点击 emit `revoke`；页面层使用项目既有确认组件，文案明确说明“会恢复系统中的合同、房态、押金余额和本次退租产生的账本记录；现实中已付给租户的款项不会自动追回”。
- [ ] 成功后清空完成详情、刷新第四页签和必要的初始化/退款列表；如果当前页因删除最后一条而超出总页数，则回退到最后有效页重新加载。保持 URL 中的 `settlementId` 不再指向已取消记录。
- [ ] 运行 `npm --prefix frontend test -- checkout-workspace.spec.ts`，确认通过。
- [ ] Commit: `feat(checkout): add completed checkout revoke controls`

### Task 5: 全量回归、构建与手工验收

**Files:**
- Modify: 必要时仅调整本计划涉及的测试夹具或中文文案。

- [ ] 执行后端定向与完整测试：`npm --prefix backend test -- checkout.service.spec.ts checkout.controller.spec.ts deposit-refunds.service.spec.ts`，再执行项目既有的后端完整测试命令。
- [ ] 执行前端定向与完整测试：`npm --prefix frontend test -- checkout-workspace.spec.ts`，再执行项目既有的前端完整测试命令和 `npm --prefix frontend run build`。
- [ ] 使用本机测试环境做三组 E2E：零退款退租撤销、含押金/预收款退款撤销、含退还租金与押金抵扣撤销。每组核对合同状态、房态、押金余额、预收款余额、租金账单、付款分配、财务中心汇总、已退租列表和审计日志。
- [ ] E2E 覆盖阻断：为已退租房源新建后续有效合同后，撤销必须失败且全部数据不变；撤销接口以普通管理员身份请求返回 403；重复点击只发生一次回滚。
- [ ] 执行 `git diff --check`、`git status --short`，确认没有泄露测试环境配置、数据库备份、附件或无关文件。
- [ ] Commit: `test(checkout): cover completed checkout reversal`

## 验收标准

1. 已退租合同页支持按合同编号、楼栋房号、租户姓名搜索，按最新编辑时间倒序，支持每页 20/50/100 条和正常翻页。
2. 只有超级管理员看得到并能调用“撤销退租”；若房源被另一份有效合同占用，前后端均拒绝。
3. 成功撤销后，合同状态按原租期自动恢复、房态恢复至发起退租前状态、结算单及退款申请变为已取消、记录从已退租列表消失。
4. 押金退款、预收款退款、押金抵扣、未来账单核销、退还租金与补收账单的系统影响均通过反向记录恢复；没有双扣、重复回滚、余额错账或物理删除。
5. 全流程失败或重复提交时保持原子性、可审计性和中文可理解的错误提示。
