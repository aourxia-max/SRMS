# Dashboard Monthly Move Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add monthly confirmed-rental and completed-checkout counts to the dashboard rent overview, move that overview above the room map, and visually separate vacant and rented room colors.

**Architecture:** Extend the existing authenticated `GET /api/dashboard` response with two database aggregate counts. Keep all counting and building filtering in `DashboardService`; `DashboardView.vue` only renders returned values and reorders existing cards. Reuse the existing natural-month helper and existing role-based financial visibility.

**Tech Stack:** NestJS, Prisma/MySQL, Jest, Vue 3, TypeScript, Element Plus, Vite, Docker Compose.

## Global Constraints

- SRMS-RB-1.0 remains the sole business baseline; do not change contract, checkout, amount, permission, or status workflows.
- `monthlyMoveInCount` counts non-draft contracts whose `startDate` is in the current natural month.
- `monthlyCheckoutCount` counts `COMPLETED` checkout settlements whose `actualCheckoutDate` is in the current natural month.
- Both counts follow the optional dashboard `buildingId` filter and are visible to every authenticated dashboard role.
- Financial amounts and collection rate remain visible only to `SUPER_ADMIN`.
- The rent overview must appear above the room map.
- Vacant rooms remain green/teal; rented rooms use a clearly contrasting blue in both legend and room cells.
- Do not add new database columns, migrations, routes, charts, drill-down pages, or production deployment.

---

### Task 1: Backend monthly movement aggregates

**Files:**
- Modify: `backend/src/dashboard/rent-collection-overview.spec.ts`
- Modify: `backend/src/dashboard/dashboard.service.ts`

**Interfaces:**
- Consumes: `currentMonthPeriod(now): { from: string; to: string }`, optional `buildingId` from `DashboardService.summary`.
- Produces: dashboard response fields `monthlyMoveInCount: number` and `monthlyCheckoutCount: number`.

- [ ] **Step 1: Write failing service tests**

Add focused tests that construct mocked Prisma delegates and call:

```ts
await service.summary({ id: 1, role: 'SUPER_ADMIN' }, 2)
```

Assert the contract aggregate receives:

```ts
expect(prisma.db.contract.count).toHaveBeenCalledWith({
  where: {
    status: { not: 'DRAFT' },
    startDate: { gte: expect.any(Date), lte: expect.any(Date) },
    room: { buildingId: 2 },
  },
})
```

Assert the checkout aggregate receives:

```ts
expect(prisma.db.checkoutSettlement.count).toHaveBeenCalledWith({
  where: {
    status: 'COMPLETED',
    actualCheckoutDate: { gte: expect.any(Date), lte: expect.any(Date) },
    contract: { room: { buildingId: 2 } },
  },
})
```

Return `3` and `2` from the mocks and assert the response contains both exact counts. Add a second assertion that omitted `buildingId` omits nested room filters. Update the existing administrator permission fixture with the two new count delegates.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- --runInBand src/dashboard/rent-collection-overview.spec.ts
```

Expected: FAIL because `contract.count` / `checkoutSettlement.count` are not called and response fields are absent.

- [ ] **Step 3: Implement the aggregate queries**

In `DashboardService.summary`, convert `monthPeriod.from` and `monthPeriod.to` to Date values once, then append these queries to the existing `Promise.all`:

```ts
this.prisma.db.contract.count({
  where: {
    status: { not: 'DRAFT' },
    startDate: { gte: monthFrom, lte: monthTo },
    ...(buildingId ? { room: { buildingId } } : {}),
  },
})

this.prisma.db.checkoutSettlement.count({
  where: {
    status: 'COMPLETED',
    actualCheckoutDate: { gte: monthFrom, lte: monthTo },
    ...(buildingId ? { contract: { room: { buildingId } } } : {}),
  },
})
```

Add both numeric results to the common dashboard response, outside the `SUPER_ADMIN` financial branch.

- [ ] **Step 4: Run focused and complete backend verification**

Run:

```powershell
npm test -- --runInBand src/dashboard/rent-collection-overview.spec.ts
npm test -- --runInBand
npm run lint
npm run build
npx prisma validate
```

Expected: all tests, lint, build, and schema validation pass.

- [ ] **Step 5: Commit backend change**

```powershell
git add backend/src/dashboard/dashboard.service.ts backend/src/dashboard/rent-collection-overview.spec.ts
git commit -m "feat: add monthly rental movement metrics"
```

### Task 2: Dashboard layout, metrics, and room-status contrast

**Files:**
- Modify: `frontend/src/views/DashboardView.vue`
- Verify: `frontend/package.json` (`build` is the available frontend verification command; no frontend unit-test runner is configured)

**Interfaces:**
- Consumes: `data.monthlyMoveInCount` and `data.monthlyCheckoutCount` from Task 1.
- Produces: rent overview above room map, six-item super-admin overview, four-item safe overview, contrasting vacant/rented colors.

- [ ] **Step 1: Capture the pre-change source contract and verify it fails**

Run this read-only PowerShell contract check before editing:

```powershell
$source = Get-Content -Encoding utf8 src/views/DashboardView.vue -Raw
if ($source.IndexOf('本月租金收缴概览') -gt $source.IndexOf('楼栋房态图')) { throw '租金概览仍位于房态图下方' }
if ($source -notmatch 'monthlyMoveInCount') { throw '缺少本月新增租房指标' }
if ($source -notmatch 'monthlyCheckoutCount') { throw '缺少本月退租指标' }
```

Expected: command fails on the first missing contract. No test file is added because this frontend currently has no configured unit-test runner.

- [ ] **Step 2: Record the RED result**

Confirm the source-contract command fails because the count fields are absent and the overview appears after the room map.

- [ ] **Step 3: Reorder cards and render counts**

Move the entire existing rent overview `<el-card>` before the room-map card without duplicating it. Extend the super-admin `.collection-metrics` with:

```vue
<div class="collection-metric move-in">
  <span>本月新增租房</span>
  <b>{{ data.monthlyMoveInCount || 0 }}</b>
  <small>合同开始日期在本月</small>
</div>
<div class="collection-metric checkout-count">
  <span>本月实际退租</span>
  <b>{{ data.monthlyCheckoutCount || 0 }}</b>
  <small>已完成退租结算</small>
</div>
```

Add the same two operational count items to `.collection-safe-summary`. Keep all money and rate markup within the existing `isSuper` branch.

- [ ] **Step 4: Strengthen status-color contrast and responsive layout**

Set EMPTY to teal/green and RENTED to blue in `statusMeta`; use a purple tone for PENDING_MOVE_IN so it remains distinct. Update CSS so `.empty` and `.rented` have different background, border, and foreground hue families. Change `.collection-metrics` to three columns on normal desktop so six metrics form two balanced rows, then collapse to two and one columns at narrower breakpoints.

- [ ] **Step 5: Run frontend verification**

Run:

```powershell
npm run build
```

Re-run the Step 1 source-contract command, then run the build. Expected: source contract and Vite type/build checks pass; the existing large-chunk warning may remain informational. If `npm run lint` is absent from `frontend/package.json`, record it as not configured instead of treating it as a failure.

- [ ] **Step 6: Commit frontend change**

```powershell
git add frontend/src/views/DashboardView.vue
git commit -m "feat: improve dashboard monthly overview"
```

### Task 3: Local test-environment deployment and acceptance

**Files:**
- Modify only if test results require a scoped correction: files from Tasks 1-2.

**Interfaces:**
- Consumes: completed backend and frontend images.
- Produces: updated local `srms_test` environment on ports 13000 and 15173.

- [ ] **Step 1: Rebuild the isolated test environment**

Run:

```powershell
docker compose -p srms_test --env-file deploy/.env -f deploy/docker-compose.yml up -d --build api web
```

- [ ] **Step 2: Verify container and API health**

Run:

```powershell
docker compose -p srms_test --env-file deploy/.env -f deploy/docker-compose.yml ps
Invoke-WebRequest http://localhost:13000/api/health -UseBasicParsing
```

Expected: MySQL and API are healthy; web is running; health endpoint returns HTTP 200.

- [ ] **Step 3: Verify the authenticated dashboard response**

Log in to the local test API and confirm `monthlyMoveInCount` and `monthlyCheckoutCount` are numeric fields. Do not print access tokens or passwords in logs.

- [ ] **Step 4: Perform browser acceptance**

At `http://localhost:15173/`, verify:

- rent overview is above the room map;
- both monthly movement counts are visible;
- vacant and rented legend colors and room cards are clearly distinct;
- building selection refreshes both counts;
- financial values remain restricted to the existing role branch.

- [ ] **Step 5: Final repository verification**

Run `git status --short` and report unrelated pre-existing changes separately. Do not add the production bundle or test-data directory to the feature commits.
