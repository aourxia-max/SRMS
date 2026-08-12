# 退租结算取消与工单归档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让退租结算卡片区只保留可处理工单，并允许草稿、待确认、已驳回工单取消退租且恢复合同和房态。

**Architecture:** 后端在 CheckoutService 内新增事务型 cancel 方法，控制器提供受角色守卫保护的 POST 接口，默认列表服务端过滤可处理状态。前端在 checkoutApi 增加 cancel 调用，CheckoutWorkspace 负责刷新数据，CheckoutSettlementPanel 负责二次确认和按钮渲染。

**Tech Stack:** NestJS, Prisma, Vue 3, Vitest, Jest.

## Global Constraints

- 不新增枚举、表或 migration，使用既有 `CheckoutSettlementStatus.CANCELLED`。
- 不物理删除结算单、结算项目、合同、账单、房态历史或财务流水。
- 只允许 `DRAFT`、`PENDING`、`REJECTED` 取消；`APPROVED`、`COMPLETED` 必须后端拒绝。
- 取消不要求填写原因，但前端必须二次确认。
- `GET /checkout-settlements` 默认只返回 `DRAFT`、`PENDING`、`REJECTED`。

---

### Task 1: Backend Cancellation

**Files:**

- Modify: `backend/src/checkout/checkout.service.spec.ts`
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.controller.ts`

**Interfaces:**

- Produces: `CheckoutService.cancel(id: number, user: AuthUser)`
- Produces: `POST /checkout-settlements/:id/cancel`

- [x] **Step 1: Write failing tests**

Add tests for successful draft cancellation, approved cancellation rejection, and actionable list filtering.

- [x] **Step 2: Run test to verify it fails**

Run: `npm --prefix backend run test -- --runInBand src/checkout/checkout.service.spec.ts`
Expected: FAIL because `service.cancel` is missing and `list()` lacks status filter.

- [ ] **Step 3: Implement backend**

Add `cancel()` to restore contract and room in one transaction, using the original `RoomStatusHistory.fromStatus`.

- [ ] **Step 4: Verify backend**

Run the focused backend test and build.

### Task 2: Frontend Cancellation

**Files:**

- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`
- Modify: `frontend/src/services/checkout.ts`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue`
- Modify: `frontend/src/views/checkout/CheckoutSettlementPanel.vue`
- Modify: `frontend/src/views/checkout/checkout-types.ts`

**Interfaces:**

- Consumes: `checkoutApi.cancel(id)`
- Produces: `cancel` event from `CheckoutSettlementPanel`

- [x] **Step 1: Write failing tests**

Add tests for filtering approved cards, rejected card cancel confirmation, and workspace API reload.

- [x] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:unit -- src/views/checkout/checkout-workspace.spec.ts`
Expected: FAIL because approved cards still render and cancel button/API are missing.

- [ ] **Step 3: Implement frontend**

Add API, filter actionable cards, render cancel action, confirm before emitting, and reload after cancellation.

- [ ] **Step 4: Verify frontend**

Run focused frontend test and frontend build.

### Task 3: Final Verification

**Files:**

- Modify: `docs/superpowers/specs/2026-08-12-checkout-settlement-cancellation-and-archive-design.md`
- Create/Modify report if needed under `.superpowers/sdd`.

- [ ] **Step 1: Run focused tests**

Run backend and frontend focused tests.

- [ ] **Step 2: Run builds**

Run backend and frontend builds.

- [ ] **Step 3: Run lint/diff checks**

Run available lint checks and `git diff --check`.

- [ ] **Step 4: Commit scoped changes**

Commit only files related to this feature.
