# 租金账单主功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在“租赁财务”下交付可查询、可分页、可查看详情的租金账单主功能，并严格复用现有账单快照与权限边界。

**Architecture:** 后端新增独立 `rent-bills` 查询模块，使用 Prisma 从 `rent_bills` 关联合同、房源、当前主承租人、调整、收款分配和预收款流水；前端新增 `RentBillsView.vue`，通过一个列表接口和一个详情接口驱动原型中的汇总卡、筛选表格和右侧抽屉。导航和路由只增加入口，写操作继续跳转现有收款/合同模块。

**Tech Stack:** NestJS、Prisma、MySQL、Vue 3、TypeScript、Element Plus、Axios、Jest、Vitest。

## Global Constraints

- 账单金额必须沿用 `RentBill` 快照字段，不重新计算历史账单。
- `VOIDED` 和 `REFUNDED` 账单可追溯展示，但不得计入经营汇总。
- 所有接口必须使用 JWT 守卫；账单金额和权限不能信任前端传值。
- 页面日期、状态和提示文案使用中文；不开发收款、优惠、退款、退租等重复写操作。

### Task 1: 后端查询服务与 DTO

**Files:**
- Create: `backend/src/rent-bills/rent-bills.service.ts`
- Create: `backend/src/rent-bills/rent-bills.controller.ts`
- Create: `backend/src/rent-bills/dto/list-rent-bills.dto.ts`
- Create: `backend/src/rent-bills/rent-bills.service.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces `RentBillsService.list(dto)` returning `{ items, page, pageSize, total, summary }`.
- Produces `RentBillsService.detail(id)` returning bill snapshot plus contract/room/tenant/adjustments/allocations/prepayment data.

- [ ] **Step 1: Write failing service tests** for month/status/building/keyword filters, pagination, summary exclusion of `VOIDED`/`REFUNDED`, and detail relations.
- [ ] **Step 2: Run `npm --prefix backend test -- --runInBand rent-bills.service.spec.ts`** and verify failures identify missing service methods.
- [ ] **Step 3: Add DTO validation** for `YYYY-MM`, supported status enum, positive page, and `pageSize` in `10|20|50|100`; normalize empty filters.
- [ ] **Step 4: Implement Prisma queries** using `rentBill.findMany`, `count`, and aggregate-safe summary logic. Join `contract.room`, current primary member/tenant, `adjustments`, `allocations`, and `prepaymentTransactions`; use `contains` keyword matching across bill number, contract number, room number, and tenant name.
- [ ] **Step 5: Add controller routes** `GET /rent-bills` and `GET /rent-bills/:id` with `JwtAuthGuard` and `RolesGuard`, returning `{ code, message, data }`; map Prisma not-found to 404 through Nest defaults.
- [ ] **Step 6: Register `RentBillsModule` in `backend/src/app.module.ts`** and run service tests to verify behavior.
- [ ] **Step 7: Commit** `feat: add rent bill query api`.

### Task 2: 后端接口测试与敏感字段回归

**Files:**
- Create: `backend/src/rent-bills/rent-bills.controller.spec.ts`
- Modify: `backend/test/app.e2e-spec.ts`

- [ ] **Step 1: Write failing controller tests** for response envelope and 401 guard behavior.
- [ ] **Step 2: Run the focused controller test** and verify it fails before the controller is wired.
- [ ] **Step 3: Add tests** that assert ordinary admin and super admin can read, unknown bill returns 404, and serialized output excludes ID number, full phone, account details, and file URLs.
- [ ] **Step 4: Run focused Jest tests** and then the backend e2e suite with `.env.test`.
- [ ] **Step 5: Commit** `test: cover rent bill api permissions`.

### Task 3: 前端路由、导航与 API 类型

**Files:**
- Create: `frontend/src/views/RentBillsView.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/services/http.ts`

- [ ] **Step 1: Add a failing Vitest route/navigation test** for `/rent-bills` and the “租金账单” nav label.
- [ ] **Step 2: Run the focused frontend test** and confirm the route is absent.
- [ ] **Step 3: Register `RentBillsView` at `/rent-bills`** with `requiresAuth: true`; add page name and the nav item under “租赁财务” before “收款管理”.
- [ ] **Step 4: Add typed list/detail API helpers** that preserve the `{ code, message, data }` envelope and query params.
- [ ] **Step 5: Run the focused test** and commit `feat: add rent bill navigation`.

### Task 4: 实现原型页面和详情抽屉

**Files:**
- Modify: `frontend/src/views/RentBillsView.vue`
- Create or modify: `frontend/src/views/__tests__/RentBillsView.spec.ts`

- [ ] **Step 1: Write failing component tests** for default current-month query, summary cards, Chinese status labels/colors, table rows, pagination, and opening/closing detail drawer.
- [ ] **Step 2: Implement page structure** matching the approved prototype: four summary cards, keyword/building/status/month filters, table, empty/loading/error states, and pagination.
- [ ] **Step 3: Implement status map**: `PAID` green, `PARTIAL` orange, `OVERDUE` red, `PENDING` gray, and subdued `VOIDED`/`REFUNDED`.
- [ ] **Step 4: Implement detail drawer** with room, tenant, period, amount reconciliation, adjustments, allocations, and prepayment sections. Display pending adjustments separately from confirmed discounts.
- [ ] **Step 5: Implement safe links**: “登记收款” routes to `/payments/collect?rentBillId=<id>`; “查看合同” routes to the contract route; no direct amount mutations.
- [ ] **Step 6: Run component tests, then `npm --prefix frontend run build`** and commit `feat: build rent bill workspace`.

### Task 5: 集成验证与验收文档

**Files:**
- Create: `docs/task-rent-bills-acceptance.md`
- Modify: `README.md`

- [ ] **Step 1: Run backend lint, build, unit tests, Prisma validation, and e2e tests** using the project’s existing commands.
- [ ] **Step 2: Run frontend unit tests, lint (if configured), and build**.
- [ ] **Step 3: Manually verify** login → “租金账单” → filters → detail drawer → “登记收款” route using the test environment without mutating production data.
- [ ] **Step 4: Record test counts, known Vite/audit warnings, and manual verification steps** in `docs/task-rent-bills-acceptance.md`.
- [ ] **Step 5: Update README progress** and commit `docs: record rent bill acceptance`.

## Verification Commands

```powershell
npm --prefix backend run lint
npm --prefix backend run build
npm --prefix backend test -- --runInBand
npm --prefix backend run prisma:validate
npm --prefix backend run test:e2e -- --runInBand
npm --prefix frontend run test:unit
npm --prefix frontend run build
```
