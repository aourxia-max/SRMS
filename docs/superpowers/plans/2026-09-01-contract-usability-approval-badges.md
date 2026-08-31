# Contract Usability and Approval Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow safe post-confirmation contract remark maintenance, searchable contract selection, a 50% taller room-status map, and consistent pending-approval badges across every existing approval entry.

**Architecture:** Add a read-only backend aggregation module that returns eight authoritative pending counts and module totals, then consume it through one Pinia store and one reusable badge component. Keep contract remark mutation in the contracts module with row locking and operation-log auditing; keep contract search and room-map sizing as focused frontend changes.

**Tech Stack:** NestJS 11, Prisma 7/MySQL 8.4, Vue 3, Pinia, Element Plus, Vitest, Jest, Supertest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-31-contract-remark-search-roommap-pending-badges-design.md`

## Global Constraints

- Do not change frozen money calculations, approval states, approval transitions, role permissions, or database structure.
- Add no Prisma migration.
- All new user-visible copy and validation errors must be Chinese.
- Approval badges are informational only; backend guards remain the authority for every action.
- `ADMIN` and `SUPER_ADMIN` receive counts; `VISITOR` receives zero counts.
- Zero hides the badge, 1–99 shows the exact number, and values above 99 show `99+`.
- The room-map scroll container changes from `430px` to exactly `645px`; room-card dimensions do not change.
- Contract remarks accept `null` or a trimmed string no longer than 500 characters; blank input clears the remark.
- Ended contracts remain editable for remarks; `VOIDED` contracts remain read-only.
- Never print, copy, or commit credentials from `deploy/.env.test`; never touch a production database.
- Before real-MySQL E2E, create and validate a complete backup of the local test database.

---

### Task 1: Backend pending-approval count aggregation

**Files:**
- Create: `backend/src/approval-tasks/approval-task-counts.ts`
- Create: `backend/src/approval-tasks/approval-tasks.service.ts`
- Create: `backend/src/approval-tasks/approval-tasks.service.spec.ts`
- Create: `backend/src/approval-tasks/approval-tasks.controller.ts`
- Create: `backend/src/approval-tasks/approval-tasks.controller.spec.ts`
- Create: `backend/src/approval-tasks/approval-tasks.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `ApprovalTaskCounts`, `emptyApprovalTaskCounts()`, and `ApprovalTasksService.counts(user: AuthUser): Promise<ApprovalTaskCounts>`.
- Produces: authenticated `GET /api/approval-tasks/counts` returning `{ code, message, data }`.
- Consumed by: Task 2 frontend service and Store.

- [ ] **Step 1: Write the count-service failing tests**

Create a Prisma mock with eight `count` functions and assert exact filters and totals:

```ts
it('returns eight pending counts and exact module totals for an administrator', async () => {
  contractChange.count.mockResolvedValue(2)
  pricingRebate.count.mockResolvedValue(3)
  contractVoidRequest.count.mockResolvedValue(4)
  billAdjustment.count.mockResolvedValue(5)
  paymentRefund.count.mockResolvedValue(6)
  paymentVoidRequest.count.mockResolvedValue(7)
  checkoutSettlement.count.mockResolvedValue(8)
  depositRefund.count.mockResolvedValue(9)

  await expect(service.counts(admin)).resolves.toEqual({
    contractChanges: 2,
    fixedRentRebates: 3,
    contractVoidRequests: 4,
    billAdjustments: 5,
    paymentRefunds: 6,
    paymentVoidRequests: 7,
    checkoutSettlements: 8,
    depositRefunds: 9,
    contractsTotal: 9,
    paymentsTotal: 18,
    checkoutsTotal: 17,
    total: 44,
  })
})

it('returns all zeroes to a visitor without querying approval tables', async () => {
  await expect(service.counts(visitor)).resolves.toEqual(emptyApprovalTaskCounts())
  expect(contractChange.count).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the service test and verify RED**

Run:

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/approval-tasks/approval-tasks.service.spec.ts
```

Expected: FAIL because the module and service do not exist.

- [ ] **Step 3: Implement the count type and service**

Use one `Promise.all` with these exact filters:

```ts
const values = await Promise.all([
  db.contractChange.count({ where: { approvalStatus: 'PENDING' } }),
  db.pricingRebate.count({ where: { approvalStatus: 'PENDING' } }),
  db.contractVoidRequest.count({ where: { status: 'PENDING' } }),
  db.billAdjustment.count({ where: { approvalStatus: 'PENDING' } }),
  db.paymentRefund.count({ where: { approvalStatus: 'PENDING' } }),
  db.paymentVoidRequest.count({ where: { approvalStatus: 'PENDING' } }),
  db.checkoutSettlement.count({ where: { status: 'PENDING' } }),
  db.depositRefund.count({ where: { approvalStatus: 'PENDING' } }),
])
```

Map the values to named fields and calculate totals from those named fields. Return `emptyApprovalTaskCounts()` before any query when `user.role === UserRole.VISITOR`.

- [ ] **Step 4: Write controller metadata and response tests**

Assert the controller uses `JwtAuthGuard`, calls `counts(user)`, and wraps the result:

```ts
await expect(controller.counts(admin)).resolves.toEqual({
  code: 200,
  message: 'success',
  data: counts,
})
```

- [ ] **Step 5: Implement controller, module, and app registration**

```ts
@Controller('approval-tasks')
@UseGuards(JwtAuthGuard)
export class ApprovalTasksController {
  constructor(private readonly approvalTasks: ApprovalTasksService) {}

  @Get('counts')
  async counts(@CurrentUser() user: AuthUser) {
    return { code: 200, message: 'success', data: await this.approvalTasks.counts(user) }
  }
}
```

Register `ApprovalTasksModule` in `AppModule`; do not add a migration.

- [ ] **Step 6: Run focused tests and commit**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/approval-tasks/approval-tasks.service.spec.ts src/approval-tasks/approval-tasks.controller.spec.ts
git add backend/src/approval-tasks backend/src/app.module.ts
git commit -m "feat: aggregate pending approval counts"
```

Expected: all focused tests PASS.

---

### Task 2: Frontend approval-count service, Store, and badge component

**Files:**
- Create: `frontend/src/services/approval-tasks.ts`
- Create: `frontend/src/stores/approval-tasks.ts`
- Create: `frontend/src/stores/approval-tasks.spec.ts`
- Create: `frontend/src/components/PendingCountBadge.vue`
- Create: `frontend/src/components/pending-count-badge.spec.ts`

**Interfaces:**
- Consumes: Task 1 `GET /approval-tasks/counts` response.
- Produces: `ApprovalTaskCounts` TypeScript type and `getApprovalTaskCounts()`.
- Produces: `useApprovalTasksStore()` with `counts`, `refresh()`, `reset()`, `startPolling()`, and `stopPolling()`.
- Produces: `<PendingCountBadge :count="number" />`.

- [ ] **Step 1: Write failing Store tests**

Cover a successful load, stale-response protection, failure preservation, reset, and polling cleanup:

```ts
it('keeps the latest successful counts when a later refresh fails', async () => {
  api.mockResolvedValueOnce(sampleCounts).mockRejectedValueOnce(new Error('offline'))
  await store.refresh()
  await store.refresh()
  expect(store.counts).toEqual(sampleCounts)
})

it('clears counts and stops polling on reset', () => {
  store.startPolling()
  store.reset()
  expect(store.counts.total).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
```

- [ ] **Step 2: Run Store tests and verify RED**

```powershell
npm --prefix frontend run test:unit -- src/stores/approval-tasks.spec.ts
```

Expected: FAIL because the Store does not exist.

- [ ] **Step 3: Implement service and Store**

Use a monotonic request generation so an older response cannot overwrite a newer one. `startPolling()` must first clear any existing timer, then use `window.setInterval(() => void refresh(), 60_000)`. `reset()` must call `stopPolling()` and assign all-zero counts.

- [ ] **Step 4: Write failing badge-component tests**

```ts
expect(mountBadge(0).find('[data-test="pending-count-badge"]').exists()).toBe(false)
expect(mountBadge(7).text()).toBe('7')
expect(mountBadge(100).text()).toBe('99+')
```

- [ ] **Step 5: Implement the reusable badge**

Render a visually compact red circle/pill with `aria-label="待处理 N 项"`; do not render for invalid, non-positive, or visitor-zero values.

- [ ] **Step 6: Run tests and commit**

```powershell
npm --prefix frontend run test:unit -- src/stores/approval-tasks.spec.ts src/components/pending-count-badge.spec.ts
git add frontend/src/services/approval-tasks.ts frontend/src/stores/approval-tasks.ts frontend/src/stores/approval-tasks.spec.ts frontend/src/components/PendingCountBadge.vue frontend/src/components/pending-count-badge.spec.ts
git commit -m "feat: add shared pending approval badge state"
```

---

### Task 3: Display counts in the shell and module top navigation

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/components/contracts/ContractTopNav.vue`
- Modify: `frontend/src/components/contracts/contract-top-nav.spec.ts`
- Modify: `frontend/src/components/payments/PaymentTopNav.vue`
- Modify: `frontend/src/components/payments/payment-top-nav.spec.ts`
- Modify: `frontend/src/views/checkout/CheckoutTopNav.vue`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`
- Create: `frontend/src/approval-navigation-badges.spec.ts`

**Interfaces:**
- Consumes: Task 2 `useApprovalTasksStore()` and `PendingCountBadge`.
- Produces: sidebar aggregate badges and exact top-navigation badges.

- [ ] **Step 1: Write failing navigation tests**

Mount with a test Pinia and preloaded counts. Assert:

```ts
expect(contractNav.get('[data-test="badge-fixed-rebate"]').text()).toBe('3')
expect(contractNav.get('[data-test="badge-void-correction"]').text()).toBe('4')
expect(paymentNav.get('[data-test="badge-payment-reviews"]').text()).toBe('13')
expect(checkoutNav.get('[data-test="badge-checkout-settlement"]').text()).toBe('8')
expect(checkoutNav.get('[data-test="badge-checkout-refund"]').text()).toBe('9')
```

Also assert the sidebar maps `contractsTotal`, `contractChanges`, `paymentsTotal`, and `checkoutsTotal` to the four specified entries, and a visitor sees no badges.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm --prefix frontend run test:unit -- src/approval-navigation-badges.spec.ts src/components/contracts/contract-top-nav.spec.ts src/components/payments/payment-top-nav.spec.ts src/views/checkout/checkout-workspace.spec.ts
```

- [ ] **Step 3: Integrate Store lifecycle into `App.vue`**

Start polling only while a user is authenticated, restart it after a later login, stop it on logout, and refresh on route changes:

```ts
watch(
  () => session.user?.id,
  (userId) => {
    if (!userId) {
      approvalTasks.reset()
      return
    }
    void approvalTasks.refresh()
    approvalTasks.startPolling()
  },
  { immediate: true },
)

watch(
  () => route.fullPath,
  () => {
    if (session.user?.id) void approvalTasks.refresh()
  },
)

onBeforeUnmount(() => approvalTasks.stopPolling())
```

Render aggregate badges in the exact four sidebar entries. Keep collapsed-mode icons usable and position the badge at the link's top-right edge.

- [ ] **Step 4: Integrate exact counts into top navigation**

- Contract: `fixedRentRebates`, `contractVoidRequests`.
- Payment: `paymentRefunds + paymentVoidRequests`.
- Checkout: `checkoutSettlements`, `depositRefunds`.

Use a relatively positioned text wrapper so badges do not alter the click target or obscure labels.

- [ ] **Step 5: Run navigation tests and commit**

```powershell
npm --prefix frontend run test:unit -- src/approval-navigation-badges.spec.ts src/components/contracts/contract-top-nav.spec.ts src/components/payments/payment-top-nav.spec.ts src/views/checkout/checkout-workspace.spec.ts
git add frontend/src/App.vue frontend/src/components/contracts/ContractTopNav.vue frontend/src/components/contracts/contract-top-nav.spec.ts frontend/src/components/payments/PaymentTopNav.vue frontend/src/components/payments/payment-top-nav.spec.ts frontend/src/views/checkout/CheckoutTopNav.vue frontend/src/views/checkout/checkout-workspace.spec.ts frontend/src/approval-navigation-badges.spec.ts
git commit -m "feat: show approval counts in navigation"
```

---

### Task 4: Refresh badges immediately after approval-state mutations

**Files:**
- Modify: `frontend/src/views/ContractChangesView.vue`
- Modify: `frontend/src/views/contracts/ContractsWorkspace.vue`
- Modify: `frontend/src/components/contracts/voids/ContractVoidPanel.vue`
- Modify: `frontend/src/views/payments/PaymentReviewsView.vue`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue`
- Modify: existing focused specs beside those components

**Interfaces:**
- Consumes: Task 2 `useApprovalTasksStore().refresh()`.
- Produces: immediate count refresh after successful submit, approve, reject, cancel, return-to-draft, or completion actions.

- [ ] **Step 1: Add failing mutation-refresh assertions**

For each workflow, mock `approvalTasks.refresh` and assert it is called only after a successful mutation. Representative assertion:

```ts
await wrapper.get('[data-test="approve-change"]').trigger('click')
await flushPromises()
expect(http.post).toHaveBeenCalled()
expect(refreshApprovalCounts).toHaveBeenCalledTimes(1)
```

Add stable `data-test` attributes where the current markup lacks them.

- [ ] **Step 2: Run the focused tests and verify RED**

Run only the changed component specs and confirm the missing refresh calls fail.

- [ ] **Step 3: Add refresh calls after successful state changes**

Call `void approvalTasks.refresh()` only after the business API and local data reload succeed. Do not place it in `finally`, because failed actions must not replace correct counts.

- [ ] **Step 4: Run focused tests and commit**

```powershell
npm --prefix frontend run test:unit -- src/views/contract-change-tenant-search.spec.ts src/views/contracts/contract-workspace.spec.ts src/components/contracts/voids/contract-void-panel.spec.ts src/views/payments/payment-review.spec.ts src/views/checkout/checkout-workspace.spec.ts
git add frontend/src/views/ContractChangesView.vue frontend/src/views/contracts/ContractsWorkspace.vue frontend/src/components/contracts/voids/ContractVoidPanel.vue frontend/src/views/payments/PaymentReviewsView.vue frontend/src/views/checkout/CheckoutWorkspace.vue frontend/src/views frontend/src/components/contracts/voids
git commit -m "feat: refresh approval badges after workflow actions"
```

Review staged paths before committing so unrelated frontend files are not included.

---

### Task 5: Backend contract-remark mutation and audit

**Files:**
- Create: `backend/src/contracts/dto/update-contract-remark.dto.ts`
- Create: `backend/src/contracts/dto/update-contract-remark.dto.spec.ts`
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/contracts/contracts.service.spec.ts`
- Modify: `backend/src/contracts/contracts.controller.ts`
- Modify: `backend/src/contracts/contracts.controller.spec.ts`

**Interfaces:**
- Produces: `ContractsService.updateRemark(contractId, dto, user)`.
- Produces: `PATCH /api/contracts/:id/remark` for `ADMIN` and `SUPER_ADMIN`.
- Consumed by: Task 6 frontend contract service.

- [ ] **Step 1: Write DTO and service failing tests**

Test trimming, clearing, ended-contract support, voided-contract rejection, transaction ordering, and operation log:

```ts
await expect(service.updateRemark(7, { remark: '  补充说明  ' }, admin)).resolves.toMatchObject({
  id: 7,
  remark: '补充说明',
})
expect(tx.operationLog.create).toHaveBeenCalledWith({
  data: expect.objectContaining({
    module: 'CONTRACT',
    action: 'UPDATE_CONTRACT_REMARK',
    entityType: 'CONTRACT',
    entityId: 7,
    beforeData: { remark: null },
    afterData: { remark: '补充说明' },
    operatorId: admin.id,
    operatorRole: admin.role,
  }),
})
```

For blank input, expect `remark: null`. For `status: 'VOIDED'`, expect the existing `assertContractNotVoided` Chinese error and no update/log writes.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/contracts/dto/update-contract-remark.dto.spec.ts src/contracts/contracts.service.spec.ts src/contracts/contracts.controller.spec.ts
```

- [ ] **Step 3: Implement DTO and transactional service**

The DTO must accept `string | null`, use `@IsOptional()`, `@IsString()`, and `@MaxLength(500)`. The service must:

1. lock the contract row with `FOR UPDATE`;
2. reload `id`, `contractNo`, `status`, and `remark`;
3. reject `VOIDED` via `assertContractNotVoided`;
4. trim and normalize blank to `null`;
5. update only `remark`;
6. write one operation log in the same transaction;
7. return `{ id, remark, updatedAt }`.

- [ ] **Step 4: Implement controller route and role metadata**

```ts
@Patch(':id/remark')
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
async updateRemark(
  @Param('id', ParseIntPipe) id: number,
  @Body() dto: UpdateContractRemarkDto,
  @CurrentUser() user: AuthUser,
) {
  return { code: 200, message: 'success', data: await this.contracts.updateRemark(id, dto, user) }
}
```

- [ ] **Step 5: Run tests and commit**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/contracts/dto/update-contract-remark.dto.spec.ts src/contracts/contracts.service.spec.ts src/contracts/contracts.controller.spec.ts
git add backend/src/contracts/dto/update-contract-remark.dto.ts backend/src/contracts/dto/update-contract-remark.dto.spec.ts backend/src/contracts/contracts.service.ts backend/src/contracts/contracts.service.spec.ts backend/src/contracts/contracts.controller.ts backend/src/contracts/contracts.controller.spec.ts
git commit -m "feat: allow audited contract remark updates"
```

---

### Task 6: Contract-detail remark editor

**Files:**
- Modify: `frontend/src/services/contracts.ts`
- Modify: `frontend/src/components/contracts/ContractDetailPanel.vue`
- Create: `frontend/src/components/contracts/contract-detail-remark.spec.ts`
- Modify: `frontend/src/views/contracts/ContractsWorkspace.vue`

**Interfaces:**
- Consumes: Task 5 `PATCH /contracts/:id/remark`.
- Produces: `updateContractRemark(id: number, remark: string | null)`.
- Produces: `remarkChanged` event so `ContractsWorkspace` reloads the selected detail.

- [ ] **Step 1: Write failing editor tests**

Cover role/status visibility, value prefill, trimming, clearing, length cap, success reload event, and Chinese failure:

```ts
expect(adminWrapper.get('[data-test="edit-contract-remark"]').exists()).toBe(true)
expect(visitorWrapper.find('[data-test="edit-contract-remark"]').exists()).toBe(false)
expect(voidedWrapper.find('[data-test="edit-contract-remark"]').exists()).toBe(false)

await adminWrapper.get('[data-test="save-contract-remark"]').trigger('click')
expect(updateContractRemark).toHaveBeenCalledWith(7, '补充说明')
expect(adminWrapper.emitted('remarkChanged')).toHaveLength(1)
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm --prefix frontend run test:unit -- src/components/contracts/contract-detail-remark.spec.ts
```

- [ ] **Step 3: Implement service and dialog**

Place “编辑备注” beside the contract remark inside “合同概况”. Use `maxlength="500"`, `show-word-limit`, `type="textarea"`, and disable save while the request is running. Send `null` for blank input.

- [ ] **Step 4: Reload detail after success and commit**

Wire `@remark-changed="reloadSelectedContract"` in `ContractsWorkspace`.

```powershell
npm --prefix frontend run test:unit -- src/components/contracts/contract-detail-remark.spec.ts src/views/contracts/contract-workspace.spec.ts
git add frontend/src/services/contracts.ts frontend/src/components/contracts/ContractDetailPanel.vue frontend/src/components/contracts/contract-detail-remark.spec.ts frontend/src/views/contracts/ContractsWorkspace.vue
git commit -m "feat: edit contract remarks from contract detail"
```

---

### Task 7: Searchable contract selection in contract changes

**Files:**
- Create: `frontend/src/views/contract-change-contract-option.ts`
- Create: `frontend/src/views/contract-change-contract-option.spec.ts`
- Modify: `frontend/src/views/ContractChangesView.vue`
- Modify: `frontend/src/views/contract-change-tenant-search.spec.ts`

**Interfaces:**
- Produces: `contractChangeOptionLabel(contract)` returning `合同编号｜房号｜主承租人`.
- Consumes: existing `/contracts` list, which already includes room and current primary member.

- [ ] **Step 1: Write failing label/search tests**

```ts
expect(contractChangeOptionLabel(contract)).toBe('HT202608050001｜2栋301｜李四')
expect(contractChangeOptionLabel({ ...contract, members: [] })).toBe('HT202608050001｜2栋301｜未记录承租人')
```

Mount `ContractChangesView` and assert the contract `ElSelect` is `filterable`, `clearable`, has the Chinese placeholder, and options contain all three searchable text parts.

- [ ] **Step 2: Run tests and verify RED**

```powershell
npm --prefix frontend run test:unit -- src/views/contract-change-contract-option.spec.ts src/views/contract-change-tenant-search.spec.ts
```

- [ ] **Step 3: Implement local filtering labels**

Use:

```vue
<el-select
  data-test="change-contract-select"
  v-model="selectedContractId"
  filterable
  clearable
  placeholder="输入合同编号、房号或承租人姓名搜索"
  @change="selectContract"
>
```

Keep `:value="contract.id"`; never allow free text to become an ID.

- [ ] **Step 4: Run tests and commit**

```powershell
npm --prefix frontend run test:unit -- src/views/contract-change-contract-option.spec.ts src/views/contract-change-tenant-search.spec.ts
git add frontend/src/views/contract-change-contract-option.ts frontend/src/views/contract-change-contract-option.spec.ts frontend/src/views/ContractChangesView.vue frontend/src/views/contract-change-tenant-search.spec.ts
git commit -m "feat: search contracts in contract changes"
```

---

### Task 8: Increase the room-map visible height by 50%

**Files:**
- Modify: `frontend/src/views/DashboardView.vue`
- Create: `frontend/src/views/dashboard-room-map-height.spec.ts`

**Interfaces:**
- Produces: `.building-map { max-height: 645px; }`.
- Preserves: `.floor-name` and `.room-cell` `min-height: 76px`.

- [ ] **Step 1: Write the failing rendered-style test**

Mount the real `DashboardView` with its data services stubbed at the network boundary, attach it to `document.body`, and assert the user-visible layout through computed styles rather than reading source text:

```ts
const map = wrapper.get('[data-test="building-map"]').element
const room = wrapper.get('[data-test="room-cell"]').element

expect(getComputedStyle(map).maxHeight).toBe('645px')
expect(getComputedStyle(map).minHeight).not.toBe('645px')
expect(getComputedStyle(room).minHeight).toBe('76px')
```

- [ ] **Step 2: Run test and verify RED**

```powershell
npm --prefix frontend run test:unit -- src/views/dashboard-room-map-height.spec.ts
```

- [ ] **Step 3: Change only the map maximum height**

Add stable `data-test` attributes to the existing map and room cells, then replace `max-height:430px` with `max-height:645px`; do not alter room cell sizing, color, filtering, routing, or overflow.

- [ ] **Step 4: Run test and commit**

```powershell
npm --prefix frontend run test:unit -- src/views/dashboard-room-map-height.spec.ts
git add frontend/src/views/DashboardView.vue frontend/src/views/dashboard-room-map-height.spec.ts
git commit -m "style: enlarge dashboard room map viewport"
```

---

### Task 9: Integration, security, E2E, and test-environment delivery

**Files:**
- Create: `backend/test/approval-tasks-contract-remark.e2e-spec.ts`
- Create: `docs/contract-usability-approval-badges-acceptance.md`
- Modify only if verification finds a scoped defect: files introduced or changed in Tasks 1–8

**Interfaces:**
- Verifies all interfaces produced by Tasks 1–8 together.
- Produces an acceptance record with exact commands, counts, backup evidence, and environment status.

- [ ] **Step 1: Write E2E authorization and response-shape tests**

Cover:

```ts
await request(app.getHttpServer()).get('/api/approval-tasks/counts').expect(401)
await request(asAdmin).get('/api/approval-tasks/counts').expect(200).expect(({ body }) => {
  expect(Object.keys(body.data).sort()).toEqual(expectedCountKeys.sort())
  expect(JSON.stringify(body.data)).not.toMatch(/tenant|room|amount|contractNo/i)
})
await request(asVisitor).patch(`/api/contracts/${contractId}/remark`).send({ remark: 'x' }).expect(403)
await request(asAdmin).patch(`/api/contracts/${contractId}/remark`).send({ remark: '  验收备注  ' }).expect(200)
```

Create uniquely prefixed fixtures and remove them in `afterAll`. Do not mutate pre-existing contracts.

- [ ] **Step 2: Create and validate a fresh local test-database backup**

Use the running `srms_test-mysql-1` container's existing environment variables internally. Validate non-zero bytes, `CREATE TABLE` records, `Dump completed`, SHA-256, and Git ignore status. Do not output credentials.

- [ ] **Step 3: Run focused and full verification**

```powershell
npm --prefix backend test -- --runInBand
npm --prefix frontend run test:unit
npm run lint
npm run db:validate
npm run build
```

Load `deploy/.env.test` into the E2E process without printing values, construct a host-only `DATABASE_URL` for `127.0.0.1:13306`, then run:

```powershell
npm --prefix backend run test:e2e -- --runInBand --runTestsByPath test/approval-tasks-contract-remark.e2e-spec.ts test/payments.e2e-spec.ts test/checkout-rent-refund.e2e-spec.ts
```

Expected: all commands exit 0 and E2E fixture-residue checks return zero.

- [ ] **Step 4: Review security and scope**

Verify from code and tests:

- remark mutation is unavailable to visitors and voided contracts;
- approval counts contain no detail fields;
- badges do not grant approval actions;
- no migration or schema change exists;
- no credential file is staged;
- `git diff --check` passes.

- [ ] **Step 5: Update only API and Web in the test environment**

Record the MySQL container ID, run:

```powershell
docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.yml up -d --build --no-deps api web
```

Then verify API and Web return HTTP 200 and the MySQL container ID is unchanged and healthy. Do not run `down`, `DROP`, volume deletion, or MySQL rebuild commands.

- [ ] **Step 6: Write acceptance record and commit**

Record exact test totals, the non-secret backup path/checksum, local commit, API/Web health, unchanged MySQL container ID, and the existing Vite chunk-size warning if it remains.

```powershell
git add backend/test/approval-tasks-contract-remark.e2e-spec.ts docs/contract-usability-approval-badges-acceptance.md
git commit -m "test: verify contract usability and approval badges"
```

- [ ] **Step 7: Finish the branch**

Use `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`. Offer local merge, push/PR, keep branch, or discard; never push or deploy production without explicit user authorization.
