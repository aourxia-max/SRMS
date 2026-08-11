# 退租结算重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按退租原型重建三页签退租工作区，并将合同结束改为合并退款或零额最终确认后的受控动作。

**Architecture:** 保留 `CheckoutSettlement` 和 `DepositRefund` 主表。结算确认只锁定结算快照和未来未收账单；合并退款的总额从锁定结算单推导，确认时分别写入押金与预收款流水；零额走独立最终确认接口。前端拆为工作区、三个页签面板和集中 API/展示工具。

**Tech Stack:** NestJS、Prisma/MySQL、Vue 3、TypeScript、Element Plus、Vitest、Jest。

## Global Constraints

- 以 `docs/superpowers/specs/2026-08-11-checkout-settlement-redesign-design.md` 为业务基线。
- 不删除或回填历史结算、退款、账单、押金、预收款数据。
- 后端强制 `ADMIN`/`SUPER_ADMIN` 权限；最终确认仅 `SUPER_ADMIN`。
- 所有用户错误返回中文；所有金额使用 `Prisma.Decimal`。
- 先写失败测试并确认 RED，再写最小实现；每项独立提交。

---

### Task 1: 固化结算确认后的待退房生命周期

**Files:**
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`

**Consumes:** `CheckoutSettlement.status=APPROVED`、合同/房源 `PENDING_CHECKOUT`。
**Produces:** `approve(id, user)` 只锁定结算，不结束合同和房源。

- [ ] **Step 1: 写失败测试**

```ts
it('keeps contract and room pending checkout after settlement approval', async () => {
  // fixture: approved settlement has zero refundable amounts
  await service.approve(1, superAdmin)
  expect(contractUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ENDED' } }))
  expect(roomUpdate).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 运行 RED**

Run: `npm --prefix backend test -- checkout.service.spec.ts`

Expected: FAIL because `completeWithoutDepositRefund` currently ends the contract.

- [ ] **Step 3: 最小实现**

删除 `approve()` 中调用 `completeWithoutDepositRefund` 的分支；保留结算单更新为 `APPROVED`、未来未收账单作废和金额快照。

- [ ] **Step 4: 运行 GREEN**

Run: `npm --prefix backend test -- checkout.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add backend/src/checkout/checkout.service.ts backend/src/checkout/checkout.service.spec.ts
git commit -m "fix: keep checkout pending until final confirmation"
```

### Task 2: 实现零额最终确认 API

**Files:**
- Modify: `backend/src/checkout/checkout.controller.ts`
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`

**Consumes:** 已确认结算单；`depositRefundableAmount=0`、`prepaymentRefundableAmount=0`、`finalReceivable=0`。
**Produces:** `POST /checkout-settlements/:id/complete-zero-refund`，仅超管可调用。

- [ ] **Step 1: 写失败测试**

```ts
it('completes a zero-refund settlement and releases the room', async () => {
  await service.completeZeroRefund(1, superAdmin)
  expect(settlementUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'COMPLETED' } }))
  expect(contractUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ENDED' } }))
})

it('rejects zero completion when any refund or receivable amount is non-zero', async () => {
  await expect(service.completeZeroRefund(1, superAdmin)).rejects.toThrow('零额最终确认条件不满足')
})
```

- [ ] **Step 2: 运行 RED**

Run: `npm --prefix backend test -- checkout.service.spec.ts`

Expected: FAIL because `completeZeroRefund` and route do not exist.

- [ ] **Step 3: 最小实现**

新增 service 方法，在单一 `$transaction` 中重新读取结算、合同、房源；要求 `APPROVED/PENDING_CHECKOUT` 和三项金额均为零，再写 `COMPLETED`、`ENDED`、目标房态、房态历史。Controller 使用 `@Roles(UserRole.SUPER_ADMIN)`。

- [ ] **Step 4: 运行 GREEN**

Run: `npm --prefix backend test -- checkout.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add backend/src/checkout/checkout.controller.ts backend/src/checkout/checkout.service.ts backend/src/checkout/checkout.service.spec.ts
git commit -m "feat: finalize zero-refund checkouts"
```

### Task 3: 将押金与预收款合并为一笔退款

**Files:**
- Modify: `backend/src/checkout/deposit-refunds.service.ts`
- Modify: `backend/src/checkout/deposit-refunds.service.spec.ts`
- Modify: `backend/src/checkout/dto/submit-deposit-refund.dto.ts`

**Consumes:** 已确认结算的 `depositRefundableAmount`、`prepaymentRefundableAmount`；`DepositRefund.refundAmount` 为总额。
**Produces:** 合并退款提交/确认；确认时写两种退款流水。

- [ ] **Step 1: 写失败测试**

```ts
it('accepts only the locked deposit plus prepayment refund total', async () => {
  await expect(service.submit({ refundAmount: '1300.00', proofFileIds: [1] }, admin)).resolves.toBeDefined()
  await expect(service.submit({ refundAmount: '1299.99', proofFileIds: [1] }, admin)).rejects.toThrow('退款金额必须等于结算单锁定的合计应退金额')
})

it('writes deposit and prepayment refund transactions when the refund is approved', async () => {
  await service.approve(1, superAdmin)
  expect(depositTransactionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ transactionType: 'REFUND', amount: '800' }) }))
  expect(prepaymentTransactionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ transactionType: 'REFUND', amount: '500' }) }))
})
```

- [ ] **Step 2: 运行 RED**

Run: `npm --prefix backend test -- deposit-refunds.service.spec.ts`

Expected: FAIL because service requires prepayment balance to be zero and only accepts deposit amount.

- [ ] **Step 3: 最小实现**

将提交和确认校验总额改为两项应退金额之和；确认事务中按结算单冻结金额创建 `DepositTransaction(REFUND)` 与 `PrepaymentTransaction(REFUND)`，各自余额为零，锁定附件后再结束结算、合同和房源。金额为零不允许走该接口，强制走 Task 2。

- [ ] **Step 4: 运行 GREEN**

Run: `npm --prefix backend test -- deposit-refunds.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add backend/src/checkout/deposit-refunds.service.ts backend/src/checkout/deposit-refunds.service.spec.ts backend/src/checkout/dto/submit-deposit-refund.dto.ts
git commit -m "feat: support combined checkout refunds"
```

### Task 4: 补齐退租 API 视图数据与接口测试

**Files:**
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`
- Modify/Create: `backend/test/checkout.e2e-spec.ts`

**Consumes:** 结算、合同、房源、账单、押金、预收款和退款记录。
**Produces:** 列表/详情所需的合同、房源、结算项目、退款和可读财务快照。

- [ ] **Step 1: 写失败测试**

```ts
it('returns settlement detail with contract room, items and locked refund components', async () => {
  const detail = await request(app.getHttpServer()).get('/checkout-settlements/1').set(auth)
  expect(detail.body.data).toMatchObject({ depositRefundableAmount: '800.00', prepaymentRefundableAmount: '500.00' })
})
```

- [ ] **Step 2: 运行 RED**

Run: `npm --prefix backend test:e2e -- checkout.e2e-spec.ts`

Expected: FAIL because detail route/data projection is absent.

- [ ] **Step 3: 最小实现**

增加受 JWT 保护的结算详情读取端点；返回的金额序列化为字符串，不返回敏感租户字段；查询仅加载退租页面实际使用的关联。

- [ ] **Step 4: 运行 GREEN**

Run: `npm --prefix backend test:e2e -- checkout.e2e-spec.ts`

Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add backend/src/checkout backend/test/checkout.e2e-spec.ts
git commit -m "feat: expose checkout workspace detail"
```

### Task 5: 建立前端退租工作区骨架与展示工具

**Files:**
- Create: `frontend/src/views/checkout/CheckoutTopNav.vue`
- Create: `frontend/src/views/checkout/checkout-types.ts`
- Create: `frontend/src/views/checkout/checkout-presentation.ts`
- Create: `frontend/src/services/checkout.ts`
- Create: `frontend/src/views/checkout/checkout-workspace.spec.ts`
- Modify: `frontend/src/views/CheckoutView.vue`

**Consumes:** `/checkout-settlements`、`/contracts`、`/deposits`、`/deposit-refunds`。
**Produces:** 三页签、中文状态/金额/日期展示、集中 API。

- [ ] **Step 1: 写失败测试**

```ts
it('renders the three checkout workflow tabs in Chinese', () => {
  mount(CheckoutTopNav, { props: { activeTab: 'initiate' } })
  expect(screen.getByText('1 发起退租')).toBeTruthy()
  expect(screen.getByText('2 退租结算')).toBeTruthy()
  expect(screen.getByText('3 押金退还确认')).toBeTruthy()
})
```

- [ ] **Step 2: 运行 RED**

Run: `npm --prefix frontend run test:unit -- src/views/checkout/checkout-workspace.spec.ts`

Expected: FAIL because components and services do not exist.

- [ ] **Step 3: 最小实现**

创建三页签导航与 `CheckoutWorkspace` 容器；将旧单文件 `CheckoutView` 变为入口。集中定义 `CheckoutSettlement`、退款汇总和 `errorMessage()`，所有接口错误显示中文服务端消息。

- [ ] **Step 4: 运行 GREEN**

Run: `npm --prefix frontend run test:unit -- src/views/checkout/checkout-workspace.spec.ts`

Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add frontend/src/views/CheckoutView.vue frontend/src/views/checkout frontend/src/services/checkout.ts
git commit -m "feat: add checkout workspace shell"
```

### Task 6: 实现原型同款发起与结算页

**Files:**
- Create: `frontend/src/views/checkout/CheckoutInitiatePanel.vue`
- Create: `frontend/src/views/checkout/CheckoutSettlementPanel.vue`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue`

**Consumes:** 集中 checkout API、活动合同与结算详情。
**Produces:** 带红星字段、财务快照、状态横幅、时间线、结算项目、汇总和审批操作。

- [ ] **Step 1: 写失败测试**

```ts
it('marks required initiate fields and prevents a missing checkout reason', async () => {
  const wrapper = mount(CheckoutInitiatePanel, { props: { contracts: [activeContract] } })
  await wrapper.get('button[data-test="initiate-submit"]').trigger('click')
  expect(wrapper.text()).toContain('请填写退租原因')
})

it('shows an approved settlement as pending final confirmation', () => {
  expect(renderSettlement(approvedSettlement).text()).toContain('等待最终退款确认')
})
```

- [ ] **Step 2: 运行 RED**

Run: `npm --prefix frontend run test:unit -- src/views/checkout/checkout-workspace.spec.ts`

Expected: FAIL because panels and status presentation are absent.

- [ ] **Step 3: 最小实现**

实现原型的两栏卡片、必填红星、中文日期格式、结算项目可编辑表格、只读结算摘要、超管确认/驳回按钮。确认结算成功后切换到退款页，不在前端把合同标记结束。

- [ ] **Step 4: 运行 GREEN**

Run: `npm --prefix frontend run test:unit -- src/views/checkout/checkout-workspace.spec.ts`

Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add frontend/src/views/checkout
git commit -m "feat: redesign checkout initiation and settlement"
```

### Task 7: 实现合并退款与零额最终确认页

**Files:**
- Create: `frontend/src/views/checkout/CheckoutRefundPanel.vue`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`

**Consumes:** 合并退款 API、零额最终确认 API、附件上传接口。
**Produces:** 合计只读、凭证上传、零额确认、最终状态卡片。

- [ ] **Step 1: 写失败测试**

```ts
it('disables refund submission until a positive total has date method and proof', () => {
  const wrapper = mount(CheckoutRefundPanel, { props: { settlement: refundableSettlement } })
  expect(wrapper.get('button[data-test="refund-submit"]').attributes('disabled')).toBeDefined()
})

it('shows zero-refund final confirmation without a proof upload', () => {
  expect(renderRefund(zeroSettlement).text()).toContain('无需退款确认')
  expect(renderRefund(zeroSettlement).get('button[data-test="zero-complete"]')).toBeTruthy()
})
```

- [ ] **Step 2: 运行 RED**

Run: `npm --prefix frontend run test:unit -- src/views/checkout/checkout-workspace.spec.ts`

Expected: FAIL because refund panel and zero completion action are absent.

- [ ] **Step 3: 最小实现**

总额仅由 `depositRefundableAmount + prepaymentRefundableAmount` 推导；正数退款上传真实图片、填写中文日期/方式后提交；零额仅给超管显示最终确认按钮。所有操作显示服务端中文错误。

- [ ] **Step 4: 运行 GREEN**

Run: `npm --prefix frontend run test:unit -- src/views/checkout/checkout-workspace.spec.ts`

Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add frontend/src/views/checkout
git commit -m "feat: finalize combined checkout refunds"
```

### Task 8: 端到端验证与测试环境验收

**Files:**
- Modify: `README.md`
- Create: `docs/checkout-settlement-redesign-acceptance.md`

- [ ] **Step 1: 运行完整验证**

```bash
npm --prefix backend test
npm --prefix backend run lint:check
npm --prefix backend run build
npm --prefix frontend run test:unit
npm --prefix frontend run build
```

- [ ] **Step 2: 测试环境验证**

在 `srms_test` 创建标记为“测试专用”的活动合同，依次验收：有退款合并确认、零额最终确认、非超管拒绝、重复确认拒绝、房态历史和未来未收账单作废。不得操作生产数据。

- [ ] **Step 3: 写验收记录并提交**

```bash
git add README.md docs/checkout-settlement-redesign-acceptance.md
git commit -m "docs: record checkout redesign acceptance"
```
