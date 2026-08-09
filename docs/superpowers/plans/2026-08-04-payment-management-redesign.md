# 收款管理工作流重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 按已确认原型实现登记收款、收款详情、退款／作废确认三个真实页面，并补齐凭证、收据、优惠联动、严格分配、退款优惠决策和超级管理员修改收款的后端闭环。

**Architecture:** 保留现有 `payments`、`bill-adjustments`、`payment-refunds` 与 `payment-void-requests` 业务边界，在 `PaymentsModule` 内增加详情查询、收据、凭证关联和统一审核查询能力。登记收款及可选优惠在一个 Prisma 事务中提交；退款、作废和修改仍以追加记录和安全审计保留历史。前端拆成共享收款布局与三个路由页面，所有高风险权限同时由后端守卫和服务层校验。

**Tech Stack:** NestJS 11、Prisma 7、MySQL、Jest、Supertest、Vue 3、TypeScript、Pinia、Vue Router、Element Plus、Vitest、Vue Test Utils。

## 全局约束

- 业务口径只服从 SRMS-RB-1.0、冻结需求、数据库设计和已确认设计文档；原型仅决定页面结构、视觉和交互。
- 不修改冻结金额、账单、预收款、优惠、退款和作废口径，不重算历史业务金额。
- 普通管理员不能跳过更早欠租；超级管理员手工分配必须填写原因并记录前后快照。
- 一笔收款只有一个不可复用的收据编号；待审优惠只能打印临时收款凭证。
- 所有日期控件、枚举、状态和错误消息使用中文；危险操作不用浏览器原生 `alert` 或 `prompt`。
- 保留 `/payments` 旧入口并重定向到 `/payments/collect`；既有深链统一更新但保持兼容。
- 不提交或覆盖用户当前对 `frontend/src/views/DashboardView.vue` 的未提交修改，也不纳入部署 bundle 和 `deploy/test-data/`。

---

### Task 1：补齐收款数据结构并安全迁移

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_payment_management_redesign/migration.sql`
- Test: `backend/src/payments/payment-schema.spec.ts`

**Interfaces:**
- Add enum `PaymentAllocationType { AUTO_OLDEST_FIRST MANUAL_SUPER_ADMIN PREPAYMENT_AUTO }`
- Add enum `RefundAdjustmentDecision { REVERSE KEEP }`
- Add model `PaymentFile`
- Add model `PaymentRefundAdjustmentDecision`
- Add `PaymentAllocation.allocationOrder Int` and `allocationType PaymentAllocationType`

- [ ] **Step 1: 编写失败的 Prisma 元数据测试**

断言生成客户端暴露两个新枚举，并通过 Prisma DMMF 验证 `PaymentFile`、`PaymentRefundAdjustmentDecision`、`allocationOrder` 和 `allocationType` 存在。

- [ ] **Step 2: 运行测试并确认因模型缺失而失败**

Run: `npm --prefix backend test -- payment-schema.spec.ts --runInBand`

- [ ] **Step 3: 修改 schema 与关系**

`PaymentFile` 关联 `Payment`、`FileAsset` 与上传用户，包含 `purpose`、`createdAt`、`lockedAt`；`PaymentRefundAdjustmentDecision` 关联退款、原优惠和可选逆向优惠，包含决策、保留原因、决策人和时间。给 `Payment`、`PaymentRefund`、`BillAdjustment`、`FileAsset`、`User` 增加对应 relation。

- [ ] **Step 4: 编写兼容迁移**

迁移先创建枚举和新表，再给历史 `payment_allocations` 增加带默认值的 `allocation_order` 与 `allocation_type`，用每笔收款内 `allocated_at,id` 的稳定顺序回填序号；不修改任何历史金额或收据号。

- [ ] **Step 5: 生成客户端并验证**

Run: `npm --prefix backend run prisma:generate`

Run: `npm --prefix backend run prisma:validate`

Run: `npm --prefix backend test -- payment-schema.spec.ts --runInBand`

- [ ] **Step 6: 提交本任务**

```bash
git add backend/prisma backend/src/payments/payment-schema.spec.ts
git commit -m "feat: add payment workflow data model"
```

---

### Task 2：建立收款输入、分配规则与服务层权限边界

**Files:**
- Modify: `backend/src/payments/dto/record-payment.dto.ts`
- Create: `backend/src/payments/dto/record-payment-adjustment.dto.ts`
- Create: `backend/src/payments/dto/payment-list-query.dto.ts`
- Modify: `backend/src/payments/payment-allocation.ts`
- Modify: `backend/src/payments/payment-allocation.spec.ts`
- Create: `backend/src/payments/payment-policy.ts`
- Test: `backend/src/payments/payment-policy.spec.ts`

**Interfaces:**
- `RecordPaymentDto`: existing fields plus `selectedBillIds?: number[]`, `manualAllocationReason?: string`, `adjustments?: RecordPaymentAdjustmentDto[]`, `proofFileIds?: number[]`
- `RecordPaymentAdjustmentDto`: `rentBillId`, `adjustmentType`, `amount`, `reason`; direction is fixed to `DECREASE`
- `PaymentListQueryDto`: optional `contractId`, `roomKeyword`, `tenantKeyword`, `receiptNo`, `dateFrom`, `dateTo`
- `resolveAllocationPlan(bills, amount, selectedBillIds, userRole, reason)` returns ordered bill allocations, prepayment amount and allocation type

- [ ] **Step 1: 扩充分配失败测试**

覆盖最早欠租连续分配、最后一期部分付款、超额转预收款、普通管理员跳期拒绝、超级管理员无原因拒绝、超级管理员有原因可手工分配，以及重复或非本合同账单拒绝。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix backend test -- payment-allocation.spec.ts payment-policy.spec.ts --runInBand`

- [ ] **Step 3: 实现纯规则函数和 DTO 白名单校验**

金额计算统一使用分为单位或 Prisma Decimal，禁止 JavaScript 浮点直接累计；返回顺序必须稳定，可供数据库写入 `allocationOrder`。

- [ ] **Step 4: 运行单元测试**

Run: `npm --prefix backend test -- payment-allocation.spec.ts payment-policy.spec.ts --runInBand`

- [ ] **Step 5: 提交本任务**

```bash
git add backend/src/payments
git commit -m "feat: enforce payment allocation policy"
```

---

### Task 3：实现收款、优惠和凭证的单事务登记

**Files:**
- Modify: `backend/src/files/files.service.ts`
- Create: `backend/src/payments/dto/upload-payment-proof.dto.ts`
- Modify: `backend/src/payments/payments.service.ts`
- Modify: `backend/src/payments/payments.controller.ts`
- Modify: `backend/src/payments/payments.module.ts`
- Test: `backend/src/payments/payments.service.spec.ts`
- Test: `backend/test/payments.e2e-spec.ts`

**Interfaces:**
- `POST /api/payments/proof-files` multipart field `file`, roles `ADMIN|SUPER_ADMIN`, returns staged `FileAsset`
- `POST /api/payments` creates payment and optional adjustments atomically
- Success data includes `{ id, receiptNo, receiptType: 'PROVISIONAL'|'FORMAL', adjustmentIds }`
- `GET /api/payments/:paymentId/files/:fileId` verifies payment/file relation before download

- [ ] **Step 1: 写服务失败测试**

模拟事务并覆盖：合法自动分配、部分付款、多账期、预收款、分配顺序字段、支付与优惠一次提交、待审优惠不提前改变应收、凭证只能关联上传者未锁定的 `PAYMENT_PROOF`、任一步异常全部回滚、超级管理员手工分配写安全审计。

- [ ] **Step 2: 写接口失败测试**

覆盖访客和未登录禁止登记/上传、JPG/PNG/WebP 魔数校验、超限文件拒绝、越权下载拒绝、响应使用 `{ code, message, data }`。

- [ ] **Step 3: 运行定向测试并确认失败**

Run: `npm --prefix backend test -- payments.service.spec.ts --runInBand`

Run: `npm --prefix backend run test:e2e -- payments.e2e-spec.ts --runInBand`

- [ ] **Step 4: 实现暂存凭证**

复用 `FileAsset`、系统上传上限和魔数检查，新增 `uploads/payment-proofs` 存储目录；只接受 JPG、PNG、WebP。绑定收款时创建 `PaymentFile` 并锁定资产，避免重复关联。

- [ ] **Step 5: 改造 `PaymentsService.record`**

在单个 Prisma 事务中校验合同和账单、执行分配、创建收款/收据号、分配、预收款、待审优惠、凭证关联、合同快照/账单状态和日志。普通管理员及超级管理员权限在 controller 和 service 两层验证。

- [ ] **Step 6: 跑测试并提交**

Run: `npm --prefix backend test -- payments.service.spec.ts --runInBand`

Run: `npm --prefix backend run test:e2e -- payments.e2e-spec.ts --runInBand`

```bash
git add backend/src/files backend/src/payments backend/test/payments.e2e-spec.ts
git commit -m "feat: record payments with adjustments and proofs"
```

---

### Task 4：实现收款详情、筛选和收据数据

**Files:**
- Create: `backend/src/payments/payment-presenter.ts`
- Test: `backend/src/payments/payment-presenter.spec.ts`
- Modify: `backend/src/payments/payments.service.ts`
- Modify: `backend/src/payments/payments.controller.ts`
- Modify: `backend/test/payments.e2e-spec.ts`

**Interfaces:**
- `GET /api/payments` accepts `PaymentListQueryDto` and returns masked role-appropriate list
- `GET /api/payments/:id` returns status, contract/room/tenant, allocations, adjustments, prepayment, proof, receipt and operation log
- `GET /api/payments/:id/receipt` returns printable structured data and `receiptType`
- Without `id`, frontend selects first item from date-desc list; API does not invent an implicit id

- [ ] **Step 1: 写失败测试**

覆盖合同、完整房号、租户、收据号和日期区间筛选；详情聚合正确；待审优惠为 `PROVISIONAL`、批准或驳回后为 `FORMAL`、作废后为 `VOIDED`；收据包含中文大写金额；访客字段脱敏。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix backend test -- payment-presenter.spec.ts payments.service.spec.ts --runInBand`

Run: `npm --prefix backend run test:e2e -- payments.e2e-spec.ts --runInBand`

- [ ] **Step 3: 实现只读查询与 presenter**

查询使用 Prisma include/select 一次聚合必要关系；金额统一序列化为两位小数字符串；操作日志包含登记、手工分配、修改、优惠审批、退款、作废、打印与下载记录。

- [ ] **Step 4: 运行测试并提交**

Run: `npm --prefix backend test -- payment-presenter.spec.ts payments.service.spec.ts --runInBand`

Run: `npm --prefix backend run test:e2e -- payments.e2e-spec.ts --runInBand`

```bash
git add backend/src/payments backend/test/payments.e2e-spec.ts
git commit -m "feat: expose payment details and receipts"
```

---

### Task 5：实现超级管理员修改已确认收款

**Files:**
- Create: `backend/src/payments/dto/edit-payment.dto.ts`
- Modify: `backend/src/payments/payments.service.ts`
- Modify: `backend/src/payments/payments.controller.ts`
- Modify: `backend/src/payments/payments.service.spec.ts`
- Modify: `backend/test/payments.e2e-spec.ts`

**Interfaces:**
- `PATCH /api/payments/:id`, role `SUPER_ADMIN`
- Editable: `paymentDate`, `paymentMethod`, `externalReference`, `remark`, `amount`, `selectedBillIds`, `manualAllocationReason`
- Required: `editReason`
- Immutable: `receiptNo`, `contractId`

- [ ] **Step 1: 写失败测试**

覆盖管理员/访客 403、缺少原因 400、收据号和合同不可提交、待处理/已确认退款或待处理作废时阻止、已作废或全额退款时阻止；合法修改在一个事务内重建分配和预收款、重算账单/合同快照，并写入完整前后值与原因。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix backend test -- payments.service.spec.ts --runInBand`

Run: `npm --prefix backend run test:e2e -- payments.e2e-spec.ts --runInBand`

- [ ] **Step 3: 实现事务修改与追加审计**

先逆转该支付当前有效分配和预收款，再按新金额和新顺序重建；全过程锁定支付、合同和账单。`payments.edit_reason` 保存最近原因，`security_audit_logs` 追加不可删除事件。

- [ ] **Step 4: 运行测试并提交**

Run: `npm --prefix backend test -- payments.service.spec.ts --runInBand`

Run: `npm --prefix backend run test:e2e -- payments.e2e-spec.ts --runInBand`

```bash
git add backend/src/payments backend/test/payments.e2e-spec.ts
git commit -m "feat: allow audited payment correction"
```

---

### Task 6：补齐退款优惠决策与统一审核队列

**Files:**
- Create: `backend/src/payments/dto/approve-refund.dto.ts`
- Create: `backend/src/payments/dto/payment-review-query.dto.ts`
- Create: `backend/src/payments/payment-reviews.service.ts`
- Create: `backend/src/payments/payment-reviews.controller.ts`
- Modify: `backend/src/payments/refunds.service.ts`
- Modify: `backend/src/payments/refunds.controller.ts`
- Modify: `backend/src/payments/void-requests.service.ts`
- Modify: `backend/src/payments/payments.module.ts`
- Test: `backend/src/payments/refunds.service.spec.ts`
- Test: `backend/src/payments/payment-reviews.service.spec.ts`
- Test: `backend/test/payment-reviews.e2e-spec.ts`

**Interfaces:**
- `GET /api/payment-reviews?type&status&contractId&roomKeyword&tenantKeyword&dateFrom&dateTo`
- `GET /api/payment-reviews/:type/:id`
- `POST /api/payment-refunds/:id/approve` body `{ adjustmentDecisions: [{ billAdjustmentId, decision, keepReason? }] }`
- Existing refund/void reject endpoints remain; reject reason required

- [ ] **Step 1: 写失败测试**

覆盖统一队列筛选和默认待审排序；部分退款涉及优惠时默认撤销；`KEEP` 仅超级管理员且原因必填；逐条决策永久保存；撤销优惠创建逆向调整并关联；超额和重复审批拒绝；整笔作废逆转全部分配、预收款和绑定优惠但不删除原记录。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix backend test -- refunds.service.spec.ts payment-reviews.service.spec.ts --runInBand`

Run: `npm --prefix backend run test:e2e -- payment-reviews.e2e-spec.ts --runInBand`

- [ ] **Step 3: 实现审核查询和审批事务**

审批接口锁定申请、原收款、分配、预收款及关联调整；确保幂等状态转换。管理员可提交和查看，超级管理员可确认/驳回，访客只得到脱敏只读信息。

- [ ] **Step 4: 运行测试并提交**

Run: `npm --prefix backend test -- refunds.service.spec.ts payment-reviews.service.spec.ts --runInBand`

Run: `npm --prefix backend run test:e2e -- payment-reviews.e2e-spec.ts --runInBand`

```bash
git add backend/src/payments backend/test/payment-reviews.e2e-spec.ts
git commit -m "feat: add payment review workflow"
```

---

### Task 7：建立前端收款路由、共享布局和测试环境

**Files:**
- Modify: `frontend/package.json`
- Modify: `package-lock.json`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/test/setup.ts`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/views/SessionView.vue`
- Modify: `frontend/src/views/RoomDetailView.vue`
- Create: `frontend/src/components/payments/PaymentWorkspace.vue`
- Create: `frontend/src/components/payments/PaymentTopNav.vue`
- Create: `frontend/src/types/payments.ts`
- Create: `frontend/src/services/payments.ts`
- Test: `frontend/src/router/payments-routing.spec.ts`

**Interfaces:**
- `/payments` redirects to `/payments/collect` preserving `contractId`
- `/payments/collect`, `/payments/detail/:id?`, `/payments/reviews` require authentication
- Shared tabs use actual `router-link` navigation and active route state

- [ ] **Step 1: 添加 Vitest、Vue Test Utils 和 happy-dom**

Add dev dependencies `vitest`, `@vue/test-utils`, `happy-dom` and script `test:unit: vitest run`.

- [ ] **Step 2: 写失败的路由测试**

验证旧入口重定向和 query 保留、三个子路由、刷新/前进后退可恢复当前标签、未登录仍由既有守卫跳转登录。

- [ ] **Step 3: 运行测试确认失败**

Run: `npm --prefix frontend run test:unit -- payments-routing.spec.ts`

- [ ] **Step 4: 实现共享路由与布局**

更新侧栏和现有深链指向登记页；不得改动 `DashboardView.vue` 未提交内容，如必须更新首页链接，单独通过最小补丁与用户改动合并并在提交前检查差异。

- [ ] **Step 5: 运行测试和构建并提交**

Run: `npm --prefix frontend run test:unit -- payments-routing.spec.ts`

Run: `npm --prefix frontend run build`

```bash
git add frontend/package.json package-lock.json frontend/vitest.config.ts frontend/src/test frontend/src/router frontend/src/App.vue frontend/src/views/SessionView.vue frontend/src/views/RoomDetailView.vue frontend/src/components/payments frontend/src/types/payments.ts frontend/src/services/payments.ts
git commit -m "feat: add payment workspace routes"
```

---

### Task 8：实现登记收款页面

**Files:**
- Create: `frontend/src/views/payments/PaymentCollectView.vue`
- Create: `frontend/src/composables/usePaymentCollection.ts`
- Create: `frontend/src/components/payments/BillSelectionTable.vue`
- Create: `frontend/src/components/payments/PaymentAdjustmentForm.vue`
- Create: `frontend/src/components/payments/PaymentProofUpload.vue`
- Create: `frontend/src/components/payments/PaymentSummaryPanel.vue`
- Test: `frontend/src/views/payments/PaymentCollectView.spec.ts`

**Interfaces:**
- Query `contractId` preselects a contract when authorized
- Submit chooses button copy by adjustment presence and routes to `/payments/detail/{id}` on success

- [ ] **Step 1: 写失败的交互测试**

覆盖合同选择、默认连续账期、普通管理员不能跳期、超级管理员手动分配原因、实时金额摘要、部分付款、预收款、优惠字段、凭证上传、中文日期、提交中防重复、成功跳转和失败保留表单。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test:unit -- PaymentCollectView.spec.ts`

- [ ] **Step 3: 按原型实现双栏高密度页面**

左侧按合同/账单/优惠/付款分组，右侧使用粘性摘要；窄屏折叠单栏。所有接口异常通过 Element Plus 消息显示后端中文 message。

- [ ] **Step 4: 运行测试和构建并提交**

Run: `npm --prefix frontend run test:unit -- PaymentCollectView.spec.ts`

Run: `npm --prefix frontend run build`

```bash
git add frontend/src/views/payments/PaymentCollectView.vue frontend/src/composables/usePaymentCollection.ts frontend/src/components/payments
git commit -m "feat: build payment collection page"
```

---

### Task 9：实现收款详情、收据和超级管理员修改

**Files:**
- Create: `frontend/src/views/payments/PaymentDetailView.vue`
- Create: `frontend/src/components/payments/PaymentSearchFilters.vue`
- Create: `frontend/src/components/payments/PaymentReceipt.vue`
- Create: `frontend/src/components/payments/EditPaymentDialog.vue`
- Create: `frontend/src/components/payments/RefundRequestDialog.vue`
- Create: `frontend/src/components/payments/VoidRequestDialog.vue`
- Create: `frontend/src/styles/payment-print.css`
- Test: `frontend/src/views/payments/PaymentDetailView.spec.ts`

**Interfaces:**
- Detail route id selects exact payment; missing id selects latest permitted result
- Printing uses a dedicated receipt region and `window.print()`; no fake downloaded PDF
- Only `SUPER_ADMIN` sees edit action, but API remains final authority

- [ ] **Step 1: 写失败的交互测试**

覆盖筛选、无 id 默认最新、详情指标/分配/优惠/预收款/凭证/操作记录、预览和下载、临时/正式/作废收据、打印、退款/作废申请，以及超级管理员修改原因和影响摘要。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test:unit -- PaymentDetailView.spec.ts`

- [ ] **Step 3: 实现详情页及危险操作确认**

使用 `ElMessageBox` 二次确认和结构化影响摘要；禁止 `window.alert`/`prompt`。修改成功后重新加载详情，保留同一收据号。

- [ ] **Step 4: 运行测试和构建并提交**

Run: `npm --prefix frontend run test:unit -- PaymentDetailView.spec.ts`

Run: `npm --prefix frontend run build`

```bash
git add frontend/src/views/payments/PaymentDetailView.vue frontend/src/components/payments frontend/src/styles/payment-print.css
git commit -m "feat: build payment detail and receipt page"
```

---

### Task 10：实现退款／作废确认页面

**Files:**
- Create: `frontend/src/views/payments/PaymentReviewsView.vue`
- Create: `frontend/src/components/payments/PaymentReviewQueue.vue`
- Create: `frontend/src/components/payments/PaymentReviewDetail.vue`
- Create: `frontend/src/components/payments/RefundAdjustmentDecision.vue`
- Test: `frontend/src/views/payments/PaymentReviewsView.spec.ts`

**Interfaces:**
- Queue filters mirror backend `PaymentReviewQueryDto`
- Super admin approve payload contains every affected adjustment decision
- `KEEP` requires a non-empty reason; `REVERSE` is preselected

- [ ] **Step 1: 写失败的交互与权限测试**

覆盖队列筛选、默认待审优先、退款和作废影响详情、默认撤销优惠、保留原因校验、确认/驳回二次确认、管理员只读审批区、访客脱敏只读。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix frontend run test:unit -- PaymentReviewsView.spec.ts`

- [ ] **Step 3: 按原型实现队列和详情双栏布局**

操作后刷新队列并保持筛选条件；审批按钮显示明确金额、账期和预收款影响。

- [ ] **Step 4: 运行测试和构建并提交**

Run: `npm --prefix frontend run test:unit -- PaymentReviewsView.spec.ts`

Run: `npm --prefix frontend run build`

```bash
git add frontend/src/views/payments/PaymentReviewsView.vue frontend/src/components/payments
git commit -m "feat: build payment review page"
```

---

### Task 11：回归、数据库迁移和本地完整验收

**Files:**
- Create: `docs/task-payment-management-acceptance.md`
- Modify only files required to fix regressions exposed by verification

- [ ] **Step 1: 后端静态检查、单元测试和构建**

Run: `npm --prefix backend run lint:check`

Run: `npm --prefix backend test -- --runInBand`

Run: `npm --prefix backend run build`

Run: `npm --prefix backend run prisma:validate`

- [ ] **Step 2: 后端接口测试**

Run: `npm --prefix backend run test:e2e -- --runInBand`

- [ ] **Step 3: 前端单元测试和构建**

Run: `npm --prefix frontend run test:unit`

Run: `npm --prefix frontend run build`

- [ ] **Step 4: 在本地 `srms_test` 执行 migration**

先备份/确认目标数据库名称确为测试库，再运行 migration deploy；验证历史分配行的默认类型和顺序、历史金额/收据未变化、新表外键和索引有效。

- [ ] **Step 5: 浏览器完整验收**

使用测试专用合同依次验证：无优惠收款、收款并提交优惠、临时凭证、优惠批准后的正式收据、凭证预览下载、部分退款（撤销/保留优惠）、作废、超级管理员修改、三角色权限、刷新与前进后退。验收后清理或明确标记测试数据。

- [ ] **Step 6: 检查变更边界**

Run: `git status --short`

Run: `git diff --check`

确认没有纳入用户未提交的 `DashboardView.vue` 变更、部署 bundle、`deploy/test-data/` 或未完成的合同编号工作树内容。

- [ ] **Step 7: 写验收记录并提交**

记录修改文件、功能、命令及真实结果、手工验收数据、已知限制和部署前检查项。

```bash
git add docs/task-payment-management-acceptance.md
git commit -m "docs: record payment workflow acceptance"
```

## 完成定义

- 数据迁移在测试库成功，历史金额与收据号不变。
- 后端权限不能通过直接调用接口绕过。
- 登记收款与可选优惠真正原子提交，失败不会留下半成品。
- 临时凭证、正式收据、凭证文件、退款、作废和修改审计形成完整可追溯链。
- 三个真实子路由、顶部导航、筛选、刷新和浏览器历史均可用。
- 后端 lint、单元测试、e2e、构建、Prisma 校验以及前端单元测试、构建全部通过。
- 不部署生产环境；只有用户后续明确要求上线时才执行生产部署。
