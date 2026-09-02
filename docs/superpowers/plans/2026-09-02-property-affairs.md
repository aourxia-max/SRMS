# Property Affairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone “物业办事” module that records editable property-management matters, append-only progress, mixed business links, attachments, recycle-bin recovery, dashboard summaries, and reverse links from room, tenant, and contract contexts.

**Architecture:** Add normalized Prisma storage and a dedicated NestJS `PropertyAffairsModule`; keep property-affair writes isolated from contracts, rooms, tenants, and finance, and use snapshot labels for links so historical matters survive target deactivation or deletion. Expose one typed Vue service and focused list/form/detail components, then integrate read-only summaries into the existing dashboard and business-detail screens.

**Tech Stack:** NestJS 11, Prisma 7/MySQL 8.4, Vue 3, Vue Router, Element Plus, Axios, Jest, Supertest, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-02-property-affairs-design.md`

## Global Constraints

- `SUPER_ADMIN` and `ADMIN` may access and mutate property affairs; `VISITOR` must see no entry, no data, and receive backend 403 responses.
- All administrators may create, edit, append progress, change status, soft-delete, and restore every affair; only `SUPER_ADMIN` may permanently delete.
- Statuses are exactly `PENDING`, `IN_PROGRESS`, `COMPLETED`, and `CANCELLED`; priorities are exactly `NORMAL`, `IMPORTANT`, and `URGENT`.
- A completed or cancelled affair may reopen only to `IN_PROGRESS`; every status transition creates an append-only progress row.
- One affair may link zero or more buildings, rooms, tenants, and contracts at the same time.
- Property-affair operations must never update room status, contract state, tenant state, bills, payments, deposits, refunds, checkout rows, or finance totals.
- Do not add due dates, reminders, approval flows, fees, notifications, or progress-level attachments.
- Main content is editable; existing progress rows are never edited or deleted except as part of authorized permanent deletion of the whole affair.
- Dashboard shows at most eight non-deleted unfinished affairs ordered urgent, important, normal, then `updatedAt DESC`, `id DESC`.
- Images and PDFs are previewable; `.docx` and `.xlsx` are downloadable. Do not claim browser preview for Word or Excel.
- All new user-visible copy, validation messages, enum labels, and errors must be Chinese.
- Use optimistic locking for main edits, progress/status changes, soft-delete, and restore; stale versions return HTTP 409 and preserve frontend input.
- Database migration adds only property-affair structures and the `PROPERTY_AFFAIR` file category; it must not update or rebuild existing business data.
- Never print, copy, or commit credentials from `deploy/.env.test`; never connect to or mutate production during implementation tests.
- Before applying the migration to the local test MySQL database, create and verify a complete backup.

---

### Task 1: Prisma schema and migration contract

**Files:**
- Create: `backend/src/property-affairs/property-affairs-schema.spec.ts`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260902110000_property_affairs/migration.sql`

**Interfaces:**
- Produces: Prisma enums `PropertyAffairStatus`, `PropertyAffairPriority` and `FileCategory.PROPERTY_AFFAIR`.
- Produces: Prisma models `PropertyAffair`, `PropertyAffairDailySequence`, `PropertyAffairBuilding`, `PropertyAffairRoom`, `PropertyAffairTenant`, `PropertyAffairContract`, `PropertyAffairProgress`, and `PropertyAffairFile`.
- Consumed by: every backend task after Task 1.

- [ ] **Step 1: Write the failing schema contract test**

Use the existing schema-contract style from `backend/src/contracts/contract-void-schema.spec.ts`:

```ts
it('declares normalized property-affair storage without mutating business tables', () => {
  const schema = readFileSync(schemaPath, 'utf8')
  expect(schema).toContain('enum PropertyAffairStatus')
  expect(schema).toContain('enum PropertyAffairPriority')
  expect(schema).toContain('PROPERTY_AFFAIR')
  for (const name of ['PropertyAffair', 'PropertyAffairDailySequence', 'PropertyAffairBuilding', 'PropertyAffairRoom', 'PropertyAffairTenant', 'PropertyAffairContract', 'PropertyAffairProgress', 'PropertyAffairFile']) {
    expect(modelBlock(schema, name)).not.toBe('')
  }
  const migration = readFileSync(migrationPath, 'utf8')
  expect(migration).toMatch(/CREATE TABLE `property_affairs`/)
  expect(migration).toMatch(/CREATE TABLE `property_affair_progresses`/)
  expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE)\s+`?(?:rooms|contracts|tenants|rent_bills|payments)`?/im)
})
```

- [ ] **Step 2: Run the schema test and verify RED**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/property-affairs/property-affairs-schema.spec.ts
```

Expected: FAIL because the models and migration do not exist.

- [ ] **Step 3: Add the exact Prisma models**

Use a main model with `affairNo`, editable fields, lifecycle timestamps, soft-delete fields, and `version Int @default(1)`. Each of the four target-link models stores `targetId` plus `targetLabel`; only `affairId` has a foreign key. This deliberately avoids blocking later deletion of a room, tenant, contract, or building while preserving the historical label.

```prisma
model PropertyAffair {
  id                  Int                    @id @default(autoincrement()) @db.UnsignedInt
  affairNo            String                 @unique @map("affair_no") @db.VarChar(32)
  title               String                 @db.VarChar(200)
  category            String?                @db.VarChar(80)
  priority            PropertyAffairPriority @default(NORMAL)
  status              PropertyAffairStatus   @default(PENDING)
  content             String                 @db.Text
  responsibleUserId   Int?                   @map("responsible_user_id") @db.UnsignedInt
  responsibleSnapshot String?                @map("responsible_snapshot") @db.VarChar(50)
  externalHandlerName String?                 @map("external_handler_name") @db.VarChar(100)
  externalPhone       String?                 @map("external_phone") @db.VarChar(50)
  externalContact     String?                 @map("external_contact") @db.VarChar(200)
  completedAt         DateTime?               @map("completed_at") @db.DateTime(3)
  cancelledAt         DateTime?               @map("cancelled_at") @db.DateTime(3)
  createdBy           Int                     @map("created_by") @db.UnsignedInt
  updatedBy           Int                     @map("updated_by") @db.UnsignedInt
  deletedAt           DateTime?               @map("deleted_at") @db.DateTime(3)
  deletedBy           Int?                    @map("deleted_by") @db.UnsignedInt
  version             Int                     @default(1)
  createdAt           DateTime                @default(now()) @map("created_at") @db.DateTime(3)
  updatedAt           DateTime                @updatedAt @map("updated_at") @db.DateTime(3)
  buildings           PropertyAffairBuilding[]
  rooms               PropertyAffairRoom[]
  tenants             PropertyAffairTenant[]
  contracts           PropertyAffairContract[]
  progresses          PropertyAffairProgress[]
  files               PropertyAffairFile[]

  @@index([status, deletedAt, updatedAt])
  @@index([priority, updatedAt])
  @@index([responsibleUserId, status])
  @@index([category, updatedAt])
  @@map("property_affairs")
}
```

Define the daily sequence with `dateKey String @id @db.Char(8)` and `currentValue Int`; define each target link with an auto-increment ID, `affairId`, unsigned target ID, `targetLabel`, `createdAt`, a relation to `PropertyAffair` using `onDelete: Cascade`, and `@@unique([affairId, targetId])`. Define progress with content, nullable `statusBefore/statusAfter`, creator snapshot and created time. Define the file join with the same composite-ID pattern as `TenantFile`, and add `propertyAffairFiles PropertyAffairFile[]` to `FileAsset`.

- [ ] **Step 4: Create a no-data-rewrite migration**

The SQL must:

1. Extend the complete existing `file_assets.category` enum with `PROPERTY_AFFAIR` without dropping existing values.
2. Create the eight new tables and their indexes.
3. Add foreign keys only from child tables to `property_affairs` and from `property_affair_files.file_asset_id` to `file_assets`.
4. Contain no `UPDATE`, `DELETE`, or `TRUNCATE` against existing business tables.

- [ ] **Step 5: Validate and commit**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/property-affairs/property-affairs-schema.spec.ts
npm --prefix backend run prisma:validate
npm --prefix backend run prisma:generate
git add backend/prisma/schema.prisma backend/prisma/migrations/20260902110000_property_affairs/migration.sql backend/src/property-affairs/property-affairs-schema.spec.ts
git commit -m "feat: add property affairs schema"
```

Expected: schema test PASS; Prisma validation and generation succeed.

---

### Task 2: DTO validation and lifecycle policy

**Files:**
- Create: `backend/src/property-affairs/property-affair-policy.ts`
- Create: `backend/src/property-affairs/property-affair-policy.spec.ts`
- Create: `backend/src/property-affairs/dto/property-affair-relations.dto.ts`
- Create: `backend/src/property-affairs/dto/create-property-affair.dto.ts`
- Create: `backend/src/property-affairs/dto/update-property-affair.dto.ts`
- Create: `backend/src/property-affairs/dto/append-property-affair-progress.dto.ts`
- Create: `backend/src/property-affairs/dto/property-affair-version.dto.ts`
- Create: `backend/src/property-affairs/dto/list-property-affairs-query.dto.ts`
- Create: `backend/src/property-affairs/dto/property-affair-dto.spec.ts`

**Interfaces:**
- Produces: `assertPropertyAffairTransition(from, to): void`.
- Produces: DTOs consumed by the controller and service in Tasks 3–6, including `PropertyAffairVersionDto` for delete and restore actions.
- Produces relation shape `{ buildingIds: number[]; roomIds: number[]; tenantIds: number[]; contractIds: number[] }`.

- [ ] **Step 1: Write failing transition tests**

```ts
it.each([
  ['PENDING', 'IN_PROGRESS'], ['PENDING', 'COMPLETED'], ['PENDING', 'CANCELLED'],
  ['IN_PROGRESS', 'COMPLETED'], ['IN_PROGRESS', 'CANCELLED'],
  ['COMPLETED', 'IN_PROGRESS'], ['CANCELLED', 'IN_PROGRESS'],
] as const)('allows %s -> %s', (from, to) => {
  expect(() => assertPropertyAffairTransition(from, to)).not.toThrow()
})

it.each([
  ['COMPLETED', 'PENDING'], ['CANCELLED', 'PENDING'], ['COMPLETED', 'CANCELLED'],
] as const)('rejects %s -> %s with Chinese copy', (from, to) => {
  expect(() => assertPropertyAffairTransition(from, to)).toThrow('事项状态不能这样变更')
})
```

- [ ] **Step 2: Run policy tests and verify RED**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/property-affairs/property-affair-policy.spec.ts
```

- [ ] **Step 3: Implement the explicit transition map**

```ts
const transitions: Record<PropertyAffairStatus, readonly PropertyAffairStatus[]> = {
  PENDING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: ['IN_PROGRESS'],
}
```

Treat `from === to` as a no-op, not an error.

- [ ] **Step 4: Write DTO tests**

Verify trimming, limits, enum validation, positive unique relation IDs, required title/content, and required positive `version` on update/progress/delete flows:

```ts
const errors = await validate(plainToInstance(CreatePropertyAffairDto, {
  title: '  ', content: '', priority: 'URGENT', roomIds: [1, 1],
}))
expect(errors.map((item) => item.property)).toEqual(expect.arrayContaining(['title', 'content', 'roomIds']))
```

- [ ] **Step 5: Implement DTOs with exact limits**

- Title: required, trimmed, 1–200.
- Category: optional, trimmed, blank becomes `undefined`, maximum 80.
- Content: required, trimmed, 1–5000.
- External handler: 100; phone: 50; other contact: 200.
- Progress content: required, trimmed, 1–2000.
- Search keyword: 100; page 1+; pageSize 1–100.
- Relation arrays default to empty arrays, accept unique positive integers only.
- `status`, `priority`, `responsibleUserId`, relation filters, and `version` use typed validation.

Use this shared body DTO for soft-delete, restore, and permanent-delete:

```ts
export class PropertyAffairVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number
}
```

- [ ] **Step 6: Run tests and commit**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/property-affairs/property-affair-policy.spec.ts src/property-affairs/dto/property-affair-dto.spec.ts
git add backend/src/property-affairs/property-affair-policy.ts backend/src/property-affairs/property-affair-policy.spec.ts backend/src/property-affairs/dto
git commit -m "feat: define property affair validation rules"
```

---

### Task 3: Core list, detail, create, and optimistic update service

**Files:**
- Create: `backend/src/property-affairs/property-affair-presenter.ts`
- Create: `backend/src/property-affairs/property-affairs.service.ts`
- Create: `backend/src/property-affairs/property-affairs.service.spec.ts`

**Interfaces:**
- Produces: `PropertyAffairsService.list(query)`, `get(id, includeDeleted?)`, `categories()`, `responsibleUsers()`, `create(dto, user)`, and `update(id, dto, user)`.
- Produces: response summaries with Chinese-ready enum codes, relation snapshots, file summaries, progress rows, and numeric `version`.
- Consumed by: controllers, dashboard integration, and frontend API tasks.

- [ ] **Step 1: Write failing create and sequence tests**

Test that creation validates every related object, validates the responsible user as active `ADMIN` or `SUPER_ADMIN`, creates all links and the initial “事项已创建” progress in one transaction, and writes `OperationLog`.

```ts
expect(created.affairNo).toBe('WY202609020001')
expect(tx.propertyAffairProgress.create).toHaveBeenCalledWith({
  data: expect.objectContaining({ content: '事项已创建', statusAfter: 'PENDING', createdBy: admin.id }),
})
expect(tx.operationLog.create).toHaveBeenCalledWith({
  data: expect.objectContaining({ module: 'PROPERTY_AFFAIRS', action: 'CREATE', entityNo: 'WY202609020001' }),
})
```

The number generator must use this transaction-safe MySQL pattern:

```ts
await tx.$executeRaw`INSERT INTO property_affair_daily_sequences (date_key, current_value)
  VALUES (${dateKey}, 1)
  ON DUPLICATE KEY UPDATE current_value = current_value + 1`
const [row] = await tx.$queryRaw<Array<{ currentValue: number }>>`
  SELECT current_value AS currentValue
  FROM property_affair_daily_sequences WHERE date_key = ${dateKey} FOR UPDATE`
return `WY${dateKey}${String(row.currentValue).padStart(4, '0')}`
```

- [ ] **Step 2: Run the focused service test and verify RED**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/property-affairs/property-affairs.service.spec.ts
```

- [ ] **Step 3: Implement relation validation and atomic replacement**

Create a private `resolveRelations(dto, db)` that uses four batched `findMany` calls and returns snapshot rows. Compare requested IDs with returned IDs and throw messages such as `房源 102 不存在` before writing anything. Replace link rows within the same update transaction using `deleteMany` then `createMany`; never update target business tables.

- [ ] **Step 4: Write failing list and detail tests**

Cover keyword search, category/priority/status/responsible filters, each target-ID filter, pagination, exclusion of `deletedAt != null`, and default order `updatedAt DESC, id DESC`. Verify detail returns progress newest-first, attachment summaries, and current-or-snapshot relation labels.

```ts
expect(db.propertyAffair.findMany).toHaveBeenCalledWith(expect.objectContaining({
  where: expect.objectContaining({ deletedAt: null, rooms: { some: { roomId: 88 } } }),
  orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
}))
```

- [ ] **Step 5: Write failing optimistic-update tests**

Assert the update first executes `updateMany({ where: { id, version, deletedAt: null }, data: { ..., version: { increment: 1 } } })`; count zero returns 409 with `内容已被其他管理员更新，请刷新后重试`. If status changes, assert transition validation, lifecycle timestamps, and an automatic progress row. If status is unchanged, do not create a status progress row.

- [ ] **Step 6: Implement list, detail, create, update, categories, and responsible users**

`responsibleUsers()` returns only `{ id, displayName, role }` for active, non-deleted `ADMIN` and `SUPER_ADMIN`. `categories()` returns built-ins `公共维修`, `证件资料`, `沟通协调` followed by distinct nonblank historical categories with duplicates removed.

Main-field updates remain allowed while the affair is completed or cancelled. Every successful update writes an `OperationLog` with action `UPDATE`, before/after snapshots, affair number, operator ID, and operator role.

- [ ] **Step 7: Run tests and commit**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/property-affairs/property-affairs.service.spec.ts
git add backend/src/property-affairs/property-affair-presenter.ts backend/src/property-affairs/property-affairs.service.ts backend/src/property-affairs/property-affairs.service.spec.ts
git commit -m "feat: implement property affair core service"
```

---

### Task 4: Progress, lifecycle, recycle bin, restore, and permanent deletion

**Files:**
- Modify: `backend/src/property-affairs/property-affairs.service.ts`
- Modify: `backend/src/property-affairs/property-affairs.service.spec.ts`
- Use: `backend/src/system/security-audit-chain.service.ts`

**Interfaces:**
- Produces: `appendProgress(id, dto, user)`, `softDelete(id, version, user)`, `restore(id, version, user)`, and `permanentDelete(id, version, user)`.
- `permanentDelete` consumes `SecurityAuditChainService.appendInTransaction()`.
- Consumed by: Task 6 controller endpoints.

- [ ] **Step 1: Write failing progress and reopen tests**

```ts
await service.appendProgress(7, { version: 3, content: '已联系维修单位', nextStatus: 'IN_PROGRESS' }, admin)
expect(tx.propertyAffairProgress.create).toHaveBeenCalledWith({ data: expect.objectContaining({
  affairId: 7, content: '已联系维修单位', statusBefore: 'PENDING', statusAfter: 'IN_PROGRESS', createdBy: admin.id,
}) })
expect(tx.propertyAffair.updateMany).toHaveBeenCalledWith(expect.objectContaining({
  where: { id: 7, version: 3, deletedAt: null }, data: expect.objectContaining({ status: 'IN_PROGRESS', version: { increment: 1 } }),
}))
```

Also test `COMPLETED -> IN_PROGRESS` clears current `completedAt` but does not delete the earlier completed progress row.

- [ ] **Step 2: Implement append-only progress**

Lock by optimistic version, validate transition, append progress exactly once, update lifecycle timestamps, increment version, set `updatedBy`, and write an `OperationLog` in one transaction. Provide no update or delete method for progress rows.

- [ ] **Step 3: Write failing recycle-bin tests**

Cover soft-delete by both administrator roles, exclusion from ordinary list/detail, recycle list ordering by `deletedAt DESC`, restoration preserving links/progress/files, and stale-version conflicts.

```ts
expect(tx.propertyAffair.updateMany).toHaveBeenCalledWith({
  where: { id: 7, version: 4, deletedAt: null },
  data: expect.objectContaining({ deletedAt: expect.any(Date), deletedBy: admin.id, version: { increment: 1 } }),
})
```

- [ ] **Step 4: Implement soft-delete and restore**

Restore sets only `deletedAt: null`, `deletedBy: null`, `updatedBy`, and increments version. It must not change status, completed/cancelled timestamps, relations, progress, or files. Soft-delete and restore each write an `OperationLog` in the same transaction.

- [ ] **Step 5: Write failing permanent-delete tests**

Assert an ordinary administrator receives 403 before transaction work. For a super administrator, assert the service writes a tamper-evident event before deleting joins/progress/main row:

```ts
expect(auditChain.appendInTransaction).toHaveBeenCalledWith(tx, expect.objectContaining({
  eventType: 'PROPERTY_AFFAIR_PERMANENT_DELETE', entityType: 'PROPERTY_AFFAIR', entityId: 7,
  operatorId: superAdmin.id, eventData: expect.objectContaining({ affairNo: 'WY202609020001' }),
}))
```

- [ ] **Step 6: Implement permanent deletion and commit**

Write both an ordinary `OperationLog` and the tamper-evident security event, then delete file joins, progress, four target-link tables, and the main row in one transaction. Return the released `fileAssetId[]` so Task 5 can clean only now-unreferenced physical files after commit.

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/property-affairs/property-affairs.service.spec.ts
git add backend/src/property-affairs/property-affairs.service.ts backend/src/property-affairs/property-affairs.service.spec.ts
git commit -m "feat: add property affair lifecycle and recycle bin"
```

---

### Task 5: Property-affair attachments and preview

**Files:**
- Modify: `backend/src/files/files.service.ts`
- Modify: `backend/src/files/files.service.spec.ts`
- Modify: `backend/src/property-affairs/property-affairs.service.ts`
- Modify: `backend/src/property-affairs/property-affairs.service.spec.ts`

**Interfaces:**
- Produces: `FilesService.saveAndLinkPropertyAffairFile(affairId, file, user)`, `listPropertyAffairFiles(affairId)`, `readPropertyAffairFile(affairId, fileId)`, `unlinkPropertyAffairFile(affairId, fileId, user)`, and `cleanupReleasedPropertyAffairFiles(fileIds)`.
- Consumed by: Task 6 controller and Task 8 frontend detail page.

- [ ] **Step 1: Write failing MIME and authorization tests**

Accept only:

- `image/jpeg` with `.jpg` or `.jpeg`
- `image/png` with `.png`
- `image/webp` with `.webp`
- `application/pdf` with `.pdf`
- DOCX MIME with `.docx` and ZIP magic `PK`
- XLSX MIME with `.xlsx` and ZIP magic `PK`

Reject executable content renamed as an accepted extension, unsupported `.doc`/`.xls`, over-limit files, visitors, missing/deleted affairs, and cross-affair file IDs.

- [ ] **Step 2: Run attachment tests and verify RED**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/files/files.service.spec.ts
```

- [ ] **Step 3: Implement isolated storage and compensation cleanup**

Store files under `uploads/property-affairs`, use `FileCategory.PROPERTY_AFFAIR`, compute SHA-256, and write the file with `flag: 'wx'`. If database creation or linking fails, retry physical-file cleanup three times using the existing contract-file compensation pattern.

- [ ] **Step 4: Implement list, read, unlink, and released-file cleanup**

- `readPropertyAffairFile` returns `{ asset, content }` only when the join belongs to the requested affair.
- Unlink requires `ADMIN` or `SUPER_ADMIN`, removes the join transactionally, and deletes the `FileAsset` plus physical file only when no remaining relation references it.
- Permanent-delete cleanup receives IDs from Task 4 and applies the same no-other-reference check.
- Image/PDF preview and download use the same authorized read method; only controller headers differ.
- Upload and unlink each write an `OperationLog` with module `PROPERTY_AFFAIRS`, the affair number, operator, and affected original filename.

- [ ] **Step 5: Verify and commit**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/files/files.service.spec.ts src/property-affairs/property-affairs.service.spec.ts
git add backend/src/files/files.service.ts backend/src/files/files.service.spec.ts backend/src/property-affairs/property-affairs.service.ts backend/src/property-affairs/property-affairs.service.spec.ts
git commit -m "feat: support property affair attachments"
```

---

### Task 6: Backend controller, role guards, dashboard summary, and E2E

**Files:**
- Create: `backend/src/property-affairs/property-affairs.controller.ts`
- Create: `backend/src/property-affairs/property-affairs.controller.spec.ts`
- Create: `backend/src/property-affairs/property-affairs.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/dashboard/dashboard.module.ts`
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Create: `backend/src/dashboard/property-affairs-dashboard.spec.ts`
- Create: `backend/test/property-affairs.e2e-spec.ts`

**Interfaces:**
- Produces authenticated `/api/property-affairs` CRUD, progress, recycle-bin, attachment, preview, and download routes.
- Produces `DashboardService.summary(...).propertyAffairs` for administrators and an empty array for visitors.
- Consumed by: all frontend tasks.

- [ ] **Step 1: Write controller metadata tests**

Assert controller-wide `JwtAuthGuard` plus `RolesGuard` and `@Roles(SUPER_ADMIN, ADMIN)`. Assert `permanentDelete` additionally declares only `SUPER_ADMIN`. Response envelopes are always `{ code: 200, message: 'success', data }`.

- [ ] **Step 2: Implement routes in collision-safe order**

Declare static routes before `:id`:

```ts
@Get() list(...)
@Get('categories') categories()
@Get('responsible-users') responsibleUsers()
@Get('recycle-bin') recycleBin(...)
@Get(':id') get(...)
@Post() create(...)
@Patch(':id') update(...)
@Post(':id/progress') appendProgress(...)
@Delete(':id') softDelete(...)
@Post(':id/restore') restore(...)
@Delete(':id/permanent') permanentDelete(...)
@Post(':id/files') upload(...)
@Get(':id/files/:fileId/preview') preview(...)
@Get(':id/files/:fileId/download') download(...)
@Delete(':id/files/:fileId') unlink(...)
```

Preview must set `Content-Disposition: inline`; download must set `attachment`. Never return a filesystem path or storage key.
After `permanentDelete` commits, the controller passes its returned `fileAssetId[]` to `FilesService.cleanupReleasedPropertyAffairFiles`; cleanup failure is logged for retry and must not falsely report that the database deletion rolled back.

- [ ] **Step 3: Register modules and write dashboard RED tests**

Import `FilesModule` and `SystemModule` into `PropertyAffairsModule`, export `PropertyAffairsService`, import that module into `DashboardModule`, and inject the service into `DashboardService`. Tests must prove only administrator roles call `dashboardItems(8)`.

- [ ] **Step 4: Implement exact dashboard ordering**

Use a MySQL ID query with explicit priority order, then load summaries in that ID order:

```sql
SELECT id FROM property_affairs
WHERE deleted_at IS NULL AND status IN ('PENDING','IN_PROGRESS')
ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'IMPORTANT' THEN 1 ELSE 2 END,
         updated_at DESC, id DESC
LIMIT 8
```

Do not reuse alphabetical enum ordering.

- [ ] **Step 5: Write role and workflow E2E tests**

Cover:

1. Super/admin list, create, edit, append progress, delete, and restore.
2. Admin permanent-delete 403; super permanent-delete success.
3. Visitor every property-affair endpoint 403 and dashboard contains no affair data.
4. Mixed target links and reverse filters `roomId`, `tenantId`, `contractId`, `buildingId`.
5. Stale update/progress/delete returns 409.
6. Soft-deleted affair absent from list, dashboard, and reverse filters; restored affair reappears.
7. Existing room/contract/tenant rows and finance totals are identical before and after property-affair operations.

- [ ] **Step 6: Run backend verification and commit**

```powershell
npm --prefix backend test -- --runInBand --runTestsByPath src/property-affairs/property-affairs.controller.spec.ts src/dashboard/property-affairs-dashboard.spec.ts
npm --prefix backend run build
git add backend/src/property-affairs backend/src/app.module.ts backend/src/dashboard backend/test/property-affairs.e2e-spec.ts
git commit -m "feat: expose property affair workflows"
```

Do not run real-MySQL E2E until Task 10 backup and migration safeguards are satisfied.

---

### Task 7: Frontend types, API, labels, protected routes, and navigation

**Files:**
- Create: `frontend/src/types/property-affairs.ts`
- Create: `frontend/src/services/property-affairs.ts`
- Create: `frontend/src/services/property-affairs.spec.ts`
- Create: `frontend/src/utils/property-affair-labels.ts`
- Create: `frontend/src/utils/property-affair-labels.spec.ts`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/App.vue`
- Create: `frontend/src/property-affair-access.spec.ts`

**Interfaces:**
- Produces: `PropertyAffairStatus`, `PropertyAffairPriority`, `PropertyAffairSummary`, `PropertyAffairDetail`, `PropertyAffairFormModel`, `PropertyAffairProgress`, `PropertyAffairFile`, and relation types.
- Produces API functions `listPropertyAffairs`, `getPropertyAffair`, `createPropertyAffair`, `updatePropertyAffair`, `appendPropertyAffairProgress`, `softDeletePropertyAffair`, `restorePropertyAffair`, `permanentlyDeletePropertyAffair`, and file helpers.
- Produces label functions with no raw enum fallback on known codes.

- [ ] **Step 1: Write failing service and label tests**

```ts
expect(propertyAffairStatusLabel('IN_PROGRESS')).toBe('办理中')
expect(propertyAffairPriorityLabel('URGENT')).toBe('紧急')
await updatePropertyAffair(7, { version: 3, title: '走廊照明维修' })
expect(http.patch).toHaveBeenCalledWith('/property-affairs/7', expect.objectContaining({ version: 3 }))
```

Test error extraction preserves backend Chinese string arrays by joining them with `；`.

- [ ] **Step 2: Implement typed service functions**

Use the existing `http` Axios instance. Preview helpers request `blob`; upload helpers use `FormData`. The list response type is `{ items, total, page, pageSize }`.

- [ ] **Step 3: Write failing access tests**

Assert:

- `SUPER_ADMIN` and `ADMIN` see “物业办事”.
- `VISITOR` does not see it.
- A visitor navigating directly to `/property-affairs` is redirected to `{ name: 'session' }`.
- Administrator routes preserve an intended redirect after login.

- [ ] **Step 4: Add protected routes and sidebar entry**

Add route meta `roles: ['SUPER_ADMIN', 'ADMIN']` for:

- `/property-affairs`
- `/property-affairs/new`
- `/property-affairs/recycle-bin`
- `/property-affairs/:id`
- `/property-affairs/:id/edit`

Update the global guard:

```ts
const roles = to.meta.roles as string[] | undefined
if (roles && !roles.includes(session.user?.role ?? '')) return { name: 'session' }
```

Add `property-affairs: '物业办事'` to page names and a sidebar entry visible only when `isAdmin`.

- [ ] **Step 5: Run tests and commit**

```powershell
npm --prefix frontend run test:unit -- src/services/property-affairs.spec.ts src/utils/property-affair-labels.spec.ts src/property-affair-access.spec.ts
git add frontend/src/types/property-affairs.ts frontend/src/services/property-affairs.ts frontend/src/services/property-affairs.spec.ts frontend/src/utils/property-affair-labels.ts frontend/src/utils/property-affair-labels.spec.ts frontend/src/router/index.ts frontend/src/App.vue frontend/src/property-affair-access.spec.ts
git commit -m "feat: add property affair frontend foundation"
```

---

### Task 8: Property-affair list, form, detail, timeline, and recycle bin

**Files:**
- Create: `frontend/src/views/PropertyAffairsView.vue`
- Create: `frontend/src/views/PropertyAffairFormView.vue`
- Create: `frontend/src/views/PropertyAffairDetailView.vue`
- Create: `frontend/src/components/property-affairs/PropertyAffairForm.vue`
- Create: `frontend/src/components/property-affairs/PropertyAffairRelationPicker.vue`
- Create: `frontend/src/components/property-affairs/PropertyAffairTimeline.vue`
- Create: `frontend/src/views/property-affairs-list.spec.ts`
- Create: `frontend/src/views/property-affair-form.spec.ts`
- Create: `frontend/src/views/property-affair-detail.spec.ts`

**Interfaces:**
- Consumes: Task 7 types and service functions.
- Produces: complete administrator UI for normal list, recycle bin, create, edit, detail, progress, status, attachment, restore, and permanent delete.
- Consumed by: Task 9 reverse-link components.

- [ ] **Step 1: Write failing list and recycle-bin tests**

Assert filters emit exact API params, search resets to page 1, default order comes from backend, zero-state copy is Chinese, and the permanent-delete button is rendered only for `SUPER_ADMIN`.

```ts
await wrapper.get('[data-test="search-affairs"]').trigger('click')
expect(api.listPropertyAffairs).toHaveBeenLastCalledWith(expect.objectContaining({
  keyword: '照明', priority: 'URGENT', page: 1,
}))
```

- [ ] **Step 2: Implement list and recycle-bin modes**

Use one view with a route-derived `recycleMode`. Show summary cards, keyword, category, priority, status, responsible-user and target filters. Normal rows offer view/edit/delete; recycle rows offer restore and super-only permanent delete. Refresh the current page after each mutation and step back one page if its final row disappears.

- [ ] **Step 3: Write failing form and relation-picker tests**

Cover built-in plus historical category options, free category input, required title/content, mixed multi-select target IDs, current data hydration, owner options restricted to active admins, and optimistic version submission.

- [ ] **Step 4: Implement form behavior**

For create with selected local attachments:

1. Create the affair.
2. Upload each attachment to the created ID.
3. If any upload fails, keep the created affair, report the failed filenames in Chinese, and route to detail so the user can retry; never silently report full success.

For edit, submit only main fields, relation arrays, and `version`. On HTTP 409 keep the form values and show `内容已被其他管理员更新，请刷新后重试`.

- [ ] **Step 5: Write failing detail/timeline tests**

Cover Chinese status/priority, relation links, immutable timeline, progress plus status transition, completed/cancelled reopen, image/PDF preview, DOCX/XLSX download, soft-delete confirmation, and version refresh after each write.

- [ ] **Step 6: Implement detail and timeline**

Use `URL.createObjectURL` for authorized preview blobs and always call `URL.revokeObjectURL` when the preview closes or component unmounts. The timeline provides no edit/delete buttons. On every successful mutation, reload detail instead of manually guessing the new version.

- [ ] **Step 7: Run tests and commit**

```powershell
npm --prefix frontend run test:unit -- src/views/property-affairs-list.spec.ts src/views/property-affair-form.spec.ts src/views/property-affair-detail.spec.ts
npm --prefix frontend run build
git add frontend/src/views/PropertyAffairsView.vue frontend/src/views/PropertyAffairFormView.vue frontend/src/views/PropertyAffairDetailView.vue frontend/src/components/property-affairs frontend/src/views/property-affairs-list.spec.ts frontend/src/views/property-affair-form.spec.ts frontend/src/views/property-affair-detail.spec.ts
git commit -m "feat: build property affair management screens"
```

---

### Task 9: Dashboard and room, tenant, contract reverse links

**Files:**
- Create: `frontend/src/components/property-affairs/PropertyAffairsDashboardList.vue`
- Create: `frontend/src/components/property-affairs/RelatedPropertyAffairs.vue`
- Modify: `frontend/src/views/DashboardView.vue`
- Modify: `frontend/src/views/RoomDetailView.vue`
- Modify: `frontend/src/components/contracts/ContractDetailPanel.vue`
- Modify: `frontend/src/views/TenantsView.vue`
- Create: `frontend/src/views/TenantDetailView.vue`
- Modify: `frontend/src/router/index.ts`
- Create: `frontend/src/views/property-affairs-dashboard.spec.ts`
- Create: `frontend/src/components/property-affairs/related-property-affairs.spec.ts`
- Create: `frontend/src/views/tenant-detail-property-affairs.spec.ts`

**Interfaces:**
- Consumes: `DashboardService.summary().propertyAffairs` and Task 7 list API target filters.
- Produces: dashboard list and reusable `<RelatedPropertyAffairs room-id tenant-id contract-id />`.

- [ ] **Step 1: Write failing dashboard component tests**

Assert no component is rendered for `VISITOR`; admins see at most eight rows in backend order; each row displays title, relation summary, responsible person, status, priority, and updated time; click routes to `/property-affairs/:id`.

- [ ] **Step 2: Implement dashboard list**

Consume the existing `/dashboard` response rather than issuing a duplicate affairs request. Do not add the module to “今日待办”; render it as its own list section according to the approved design.

- [ ] **Step 3: Write failing related-component tests**

```ts
mount(RelatedPropertyAffairs, { props: { roomId: 88 } })
expect(api.listPropertyAffairs).toHaveBeenCalledWith({ roomId: 88, page: 1, pageSize: 5 })
expect(wrapper.text()).not.toContain('???')
```

Verify visitors make no request, soft-deleted items never appear, “查看全部” routes to the list with the same target query, and rows route to affair detail.

- [ ] **Step 4: Integrate room and contract contexts**

- Add `<RelatedPropertyAffairs :room-id="room.id" />` near the room contract/history sections.
- Add `<RelatedPropertyAffairs :contract-id="contract.id" />` near the bottom of `ContractDetailPanel`.
- Render both only for `ADMIN` or `SUPER_ADMIN`.

- [ ] **Step 5: Add a focused tenant detail page**

The current project has no tenant detail route. Add `/tenants/:id` with administrator role meta, load existing `GET /tenants/:id`, display the already-masked fields, and include `<RelatedPropertyAffairs :tenant-id="tenant.id" />`. Add “查看详情” to each tenant row; do not expose the sensitive-ID endpoint automatically.

- [ ] **Step 6: Run integration tests and commit**

```powershell
npm --prefix frontend run test:unit -- src/views/property-affairs-dashboard.spec.ts src/components/property-affairs/related-property-affairs.spec.ts src/views/tenant-detail-property-affairs.spec.ts
npm --prefix frontend run build
git add frontend/src/components/property-affairs/PropertyAffairsDashboardList.vue frontend/src/components/property-affairs/RelatedPropertyAffairs.vue frontend/src/views/DashboardView.vue frontend/src/views/RoomDetailView.vue frontend/src/components/contracts/ContractDetailPanel.vue frontend/src/views/TenantsView.vue frontend/src/views/TenantDetailView.vue frontend/src/router/index.ts frontend/src/views/property-affairs-dashboard.spec.ts frontend/src/components/property-affairs/related-property-affairs.spec.ts frontend/src/views/tenant-detail-property-affairs.spec.ts
git commit -m "feat: surface property affairs in business contexts"
```

---

### Task 10: Full verification, migration rehearsal, and test-environment readiness

**Files:**
- Modify only if a verified failure requires it: files introduced or listed in Tasks 1–9.
- Create: `docs/superpowers/verification/2026-09-02-property-affairs.md`

**Interfaces:**
- Consumes: the complete property-affairs implementation.
- Produces: reproducible verification evidence and a release decision; does not deploy production.

- [ ] **Step 1: Run static and unit verification**

```powershell
npm --prefix backend run prisma:validate
npm --prefix backend run prisma:generate
npm --prefix backend run lint:check
npm --prefix backend test -- --runInBand
npm --prefix backend run build
npm --prefix frontend run test:unit
npm --prefix frontend run build
```

Expected: every command exits 0. If a command fails, add a focused failing regression test before fixing the code, rerun the focused test, then rerun this complete set.

- [ ] **Step 2: Back up and verify the local test database**

Use only the already-authorized local `deploy/.env.test` as process input. Do not print it. Create a timestamped logical backup of the local test schema, verify the dump file is nonempty, and run a parse/list check before applying the migration. Record only backup filename, byte size, checksum, and verification result; record no secrets.

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupName = "pre-property-affairs-$stamp.sql"
$backupDir = 'deploy/test-data/backups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.test.yml exec -T mysql sh -lc "mysqldump --single-transaction --quick --routines --triggers --no-tablespaces -uroot -p`"`$MYSQL_ROOT_PASSWORD`" `"`$MYSQL_DATABASE`" > /tmp/$backupName && test -s /tmp/$backupName && tail -n 5 /tmp/$backupName | grep -q 'Dump completed'"
$mysqlContainer = (docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.test.yml ps -q mysql).Trim()
if (-not $mysqlContainer) { throw '未找到本机测试 MySQL 容器' }
$backupPath = Join-Path $backupDir $backupName
docker cp "${mysqlContainer}:/tmp/$backupName" $backupPath
$backupFile = Get-Item -LiteralPath $backupPath
if ($backupFile.Length -le 0) { throw '测试库备份为空' }
$backupHash = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash
Write-Output "备份文件=$backupName 字节数=$($backupFile.Length) SHA256=$backupHash 校验=通过"
```

Expected: container-side completion marker passes; the copied dump is nonempty; only filename, byte count, checksum, and `校验=通过` are printed.

- [ ] **Step 3: Apply migration to local test MySQL and run E2E**

```powershell
docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.test.yml exec -T api npx prisma migrate deploy
$importedNames = [System.Collections.Generic.List[string]]::new()
Get-Content -LiteralPath deploy/.env.test | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
  $name, $value = $_ -split '=', 2
  $name = $name.Trim()
  if (-not $name) { return }
  $value = $value.Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) { $value = $value.Substring(1, $value.Length - 2) }
  Set-Item -LiteralPath "Env:$name" -Value $value
  $importedNames.Add($name)
}
try {
  npm --prefix backend run test:e2e -- --runInBand property-affairs.e2e-spec.ts
  if ($LASTEXITCODE -ne 0) { throw "物业办事 E2E 失败，退出码 $LASTEXITCODE" }
} finally {
  foreach ($name in $importedNames) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
}
```

Expected: migration applies without data rewrite; E2E passes.

- [ ] **Step 4: Run business isolation comparisons**

Before and after a full property-affair lifecycle, capture and compare:

- room count and room status distribution
- contract count and status distribution
- tenant count and status distribution
- rent-bill payable/received/outstanding totals
- payment valid amount total
- deposit balance total
- checkout settlement counts and statuses
- finance overview response

All values must remain exactly equal. Only property-affair tables, file assets in category `PROPERTY_AFFAIR`, and audit logs may change.

- [ ] **Step 5: Perform browser acceptance in the local test environment**

Verify with `SUPER_ADMIN`, `ADMIN`, and `VISITOR` accounts:

1. Menu and direct-route permissions.
2. Create/edit mixed links and free category.
3. Append progress, complete, reopen, cancel, and reopen.
4. Attachment upload, preview, download, unlink.
5. Soft-delete, restore, and super-only permanent delete.
6. Dashboard ordering and eight-row limit.
7. Room, tenant, and contract reverse display.
8. Two-browser stale edit conflict with retained form input.
9. All labels and errors are Chinese.

- [ ] **Step 6: Write verification evidence and commit**

The verification document must list each command, exit result, E2E scenarios, migration backup checksum, business-isolation comparison, browser-role matrix, and any remaining risk. It must not contain environment values, passwords, tokens, private keys, or connection strings.

```powershell
git add docs/superpowers/verification/2026-09-02-property-affairs.md
git commit -m "test: verify property affair workflows"
git status --short
```

Expected: verification commit succeeds; only known pre-existing unrelated untracked files remain. Stop here for user review before merging, pushing, deploying, or changing production.
