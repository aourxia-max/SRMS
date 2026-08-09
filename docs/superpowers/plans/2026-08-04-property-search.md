# Property Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated server-side room search to property management and an eight-result quick-search entry on the dashboard.

**Architecture:** Extend `GET /api/properties/rooms` with a validated query DTO and construct one Prisma `where` object combining keyword OR matching with building/status AND filters. Property management loads complete filtered results with a 300 ms debounce; the dashboard reuses the same endpoint with `limit=8` and routes selections to room details or all results.

**Tech Stack:** NestJS, Prisma/MySQL, class-validator/class-transformer, Jest, Vue 3, TypeScript, Element Plus, Vite, Docker Compose.

## Global Constraints

- Search fields are exactly `fullHouseNo`, `houseNo`, `ownerName`, and `ownerPhone`; remarks are excluded.
- `deletedAt: null` is mandatory for every room search.
- Keyword fields use OR; keyword, `buildingId`, and `status` combine with AND.
- `keyword` is optional and at most 100 characters; `buildingId` is a positive integer; `status` is `RoomStatus`; `limit` is an integer from 1 to 20.
- Dashboard quick search uses `limit=8` and never renders phone numbers.
- All requests remain protected by the existing JWT guard.
- Do not change room edit/delete/status permissions, database schema, or production environment.

---

### Task 1: Validated backend room-search query

**Files:**
- Create: `backend/src/properties/dto/list-rooms-query.dto.ts`
- Create: `backend/src/properties/dto/list-rooms-query.dto.spec.ts`
- Modify: `backend/src/properties/properties.controller.ts`
- Modify: `backend/src/properties/properties.controller.spec.ts`

**Interfaces:**
- Consumes: HTTP query values `keyword?: string`, `buildingId?: number`, `status?: RoomStatus`, `limit?: number`.
- Produces: `PropertiesController.rooms(query: ListRoomsQueryDto)` and the existing `{ code, message, data }` response shape.

- [ ] **Step 1: Write failing DTO tests**

Use `plainToInstance` and `validate` to assert numeric strings transform correctly, whitespace around `keyword` is trimmed, valid status passes, and invalid `buildingId=0`, `limit=21`, or 101-character keywords fail.

```ts
const dto = plainToInstance(ListRoomsQueryDto, {
  keyword: '  1栋601  ',
  buildingId: '2',
  status: 'RENTED',
  limit: '8',
})
expect(await validate(dto)).toHaveLength(0)
expect(dto).toMatchObject({ keyword: '1栋601', buildingId: 2, status: 'RENTED', limit: 8 })
```

- [ ] **Step 2: Run DTO tests and verify RED**

Run:

```powershell
npm test -- --runInBand src/properties/dto/list-rooms-query.dto.spec.ts
```

Expected: FAIL because `ListRoomsQueryDto` does not exist.

- [ ] **Step 3: Implement the DTO**

Use `@Transform` for keyword trimming, `@Type(() => Number)` for numeric query values, `@IsEnum(RoomStatus)`, `@IsInt`, `@Min(1)`, `@Max(20)`, `@IsString`, `@MaxLength(100)`, and `@IsOptional`.

- [ ] **Step 4: Run DTO tests and verify GREEN**

Run the Step 2 command. Expected: all DTO cases pass.

- [ ] **Step 5: Write failing controller search tests**

Add tests for:

```ts
await controller.rooms({ keyword: '601', buildingId: 2, status: 'RENTED', limit: 8 })
```

Assert `room.findMany` receives:

```ts
{
  where: {
    deletedAt: null,
    buildingId: 2,
    roomStatus: 'RENTED',
    OR: [
      { fullHouseNo: { contains: '601' } },
      { houseNo: { contains: '601' } },
      { ownerName: { contains: '601' } },
      { ownerPhone: { contains: '601' } },
    ],
  },
  include: { building: true },
  orderBy: [{ buildingId: 'asc' }, { floorNo: 'asc' }, { houseNo: 'asc' }],
  take: 8,
}
```

Add a second test that an empty query has only `deletedAt: null` and no `take`.

- [ ] **Step 6: Run controller tests and verify RED**

Run:

```powershell
npm test -- --runInBand src/properties/properties.controller.spec.ts
```

Expected: FAIL because `rooms` does not accept or apply query filters.

- [ ] **Step 7: Implement controller filtering**

Import `Query` and `ListRoomsQueryDto`, construct a typed Prisma `RoomWhereInput`, and pass optional `take: query.limit`. Keep the existing include and order.

- [ ] **Step 8: Verify backend task**

Run:

```powershell
npm test -- --runInBand src/properties/dto/list-rooms-query.dto.spec.ts src/properties/properties.controller.spec.ts
npm run lint:check
npm run build
npx prisma validate
```

Expected: tests, lint check, build, and schema validation pass.

- [ ] **Step 9: Commit backend search**

```powershell
git add backend/src/properties/dto/list-rooms-query.dto.ts backend/src/properties/dto/list-rooms-query.dto.spec.ts backend/src/properties/properties.controller.ts backend/src/properties/properties.controller.spec.ts
git commit -m "feat: add authenticated room search"
```

### Task 2: Property-management search and combined filters

**Files:**
- Modify: `frontend/src/views/PropertiesView.vue`

**Interfaces:**
- Consumes: `GET /properties/rooms` with `keyword`, `buildingId`, and `status` query parameters; optional route query `q`.
- Produces: debounced search input, server-filtered table, and current-result count.

- [ ] **Step 1: Run a failing source-contract check**

```powershell
$source = Get-Content -Encoding utf8 src/views/PropertiesView.vue -Raw
if ($source -notmatch 'searchKeyword') { throw '缺少搜索状态' }
if ($source -notmatch 'route.query.q') { throw '缺少关键词恢复' }
if ($source -notmatch '搜索房号、姓名或电话') { throw '缺少搜索框' }
```

Expected: FAIL because none of these contracts exist.

- [ ] **Step 2: Split building and room loading**

Create `loadBuildings()` and `loadRooms()`. `loadRooms()` passes current `searchKeyword`, `buildingFilter`, and `statusFilter` as query parameters and replaces `rooms` only after a successful response.

- [ ] **Step 3: Add debounced search state**

Initialize `searchKeyword` from `String(route.query.q || '')`. Use a component-local timeout and a 300 ms `scheduleRoomSearch()` function. Clear the timeout in `onBeforeUnmount`. Building/status changes call `loadRooms()` immediately.

- [ ] **Step 4: Update property-management UI**

Add a clearable input with placeholder “搜索房号、姓名或电话”. Replace client-side `rooms.filter(...)` with `rooms`. Change the count text to “找到 {{ rooms.length }} 套房源”. Preserve existing buttons and permissions.

- [ ] **Step 5: Verify frontend contract and build**

Re-run Step 1, then:

```powershell
npm run build
```

Expected: source contract, TypeScript checking, and Vite build pass. The existing bundle-size warning may remain informational.

- [ ] **Step 6: Commit property-management UI**

```powershell
git add frontend/src/views/PropertiesView.vue
git commit -m "feat: add property management search"
```

### Task 3: Dashboard quick room search

**Files:**
- Modify: `frontend/src/views/DashboardView.vue`

**Interfaces:**
- Consumes: `GET /properties/rooms?keyword=<value>&limit=8`.
- Produces: dashboard autocomplete suggestions, room-detail navigation, and `/properties?q=<keyword>` navigation.

- [ ] **Step 1: Run a failing source-contract check**

```powershell
$source = Get-Content -Encoding utf8 src/views/DashboardView.vue -Raw
if ($source -notmatch 'quickSearch') { throw '缺少首页快速搜索状态' }
if ($source -notmatch 'limit: 8') { throw '缺少八条限制' }
if ($source -notmatch "path: '/properties', query: \{ q:") { throw '缺少查看全部跳转' }
```

Expected: FAIL because dashboard quick search is absent.

- [ ] **Step 2: Implement suggestion loading**

Add `quickSearch`, an incrementing request sequence, and an Element Plus autocomplete callback. Empty input returns `[]` without a request. Non-empty input requests `limit: 8`; only the latest request may call the suggestion callback.

- [ ] **Step 3: Implement selection behavior**

Room suggestions route to `{ name: 'room-detail', params: { id } }`. Append a synthetic “查看全部结果” suggestion that routes to `{ path: '/properties', query: { q: quickSearch } }`. Do not render `ownerPhone` in the suggestion template.

- [ ] **Step 4: Add dashboard UI and styling**

Place the autocomplete in `.head-actions`, show full room number, building, Chinese status, and owner/tenant name. Add responsive width rules without changing the existing month/building controls.

- [ ] **Step 5: Verify dashboard contract and build**

Re-run Step 1 and run `npm run build`. Expected: source contract and build pass.

- [ ] **Step 6: Commit dashboard quick search**

```powershell
git add frontend/src/views/DashboardView.vue
git commit -m "feat: add dashboard room quick search"
```

### Task 4: Full verification and local test-environment acceptance

**Files:**
- Modify only if a scoped verification failure requires correction: files from Tasks 1-3.

**Interfaces:**
- Consumes: completed backend and frontend changes.
- Produces: updated local `srms_test` environment and acceptance evidence.

- [ ] **Step 1: Run full repository verification**

Backend:

```powershell
npm test -- --runInBand
npm run lint:check
npm run build
npx prisma validate
```

Frontend:

```powershell
npm run build
```

- [ ] **Step 2: Rebuild isolated test services**

```powershell
docker compose -p srms_test --env-file deploy/.env -f deploy/docker-compose.yml up -d --build api web
docker compose -p srms_test --env-file deploy/.env -f deploy/docker-compose.yml ps
```

- [ ] **Step 3: Verify API behavior**

Authenticate against local API without printing credentials or tokens. Verify:

- `keyword=601&limit=8` returns no more than eight rooms;
- name and phone keywords match expected sanitized test data;
- `buildingId` and `status` narrow results;
- unauthenticated request returns HTTP 401.

- [ ] **Step 4: Browser acceptance**

At `http://localhost:15173/`, verify dashboard suggestions, room-detail selection, and “查看全部结果”. On `/properties`, verify the keyword is retained, result count is shown, and building/status filters combine with it.

- [ ] **Step 5: Report repository status**

Run `git status --short`. Keep pre-existing room-edit changes, `deploy/srms-production-fe530c2.bundle`, and `deploy/test-data/` outside search commits.
