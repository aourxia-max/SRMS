# 物业办事事项可见范围 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为物业办事事项增加“所有人可见 / 仅指定人员可见”，默认所有人可见；创建人和超级管理员始终可见，并在所有查询、关联入口、驾驶舱和附件接口中阻止越权读取。

**Architecture:** 在 `PropertyAffair` 上保存可见范围枚举，以独立的 `PropertyAffairViewer` 关联表保存指定人员。后端使用一个共享的 Prisma 可见性条件作为唯一权限来源，所有读写和附件入口先按当前用户过滤；前端仅负责选择和展示，不作为安全边界。

**Tech Stack:** NestJS、Prisma、MySQL、Vue 3、TypeScript、Element Plus、Vitest、Jest

**Spec:** `docs/superpowers/specs/2026-09-14-property-affair-visibility-design.md`

## Global Constraints

- 保留当前分支中与本需求无关的修改和未跟踪文件，不做清理、重置或覆盖。
- 历史事项通过数据库默认值自动视为 `ALL`，不改写历史业务数据。
- “所有人”仅指当前已有权限进入物业办事模块的用户；游客仍不能进入。
- `RESTRICTED` 必须至少选择一名在职普通管理员或超级管理员；创建人不必重复选择。
- 创建人始终可见；所有超级管理员始终可见；被选人员按现有角色权限操作，不新增只读角色。
- 被停用的指定人员立即失去访问能力；永久删除用户时清理关联表记录。
- 未授权访问统一返回“事项不存在或无权查看”，不得泄露事项是否存在。
- 可见范围变更必须进入现有操作日志，记录变更前后范围和明确选择的人员编号。
- 不增加提醒、审批、通用 ACL、访客访问或新的事项操作权限。
- 只允许更新本机测试环境；生产部署和 GitHub 推送必须另行获得用户明确授权。

---

## File Map

### Backend data and contracts

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260914090000_property_affair_visibility/migration.sql`
- Modify: `backend/src/property-affairs/property-affairs-schema.spec.ts`
- Modify: `backend/src/property-affairs/dto/create-property-affair.dto.ts`
- Modify: `backend/src/property-affairs/dto/update-property-affair.dto.ts`
- Modify: `backend/src/property-affairs/property-affair-dto.spec.ts`
- Modify: `backend/src/property-affairs/property-affair-presenter.ts`

### Backend authorization and endpoints

- Create: `backend/src/property-affairs/property-affair-visibility.ts`
- Create: `backend/src/property-affairs/property-affair-visibility.spec.ts`
- Modify: `backend/src/property-affairs/property-affairs.service.ts`
- Modify: `backend/src/property-affairs/property-affairs.controller.ts`
- Modify: `backend/src/property-affairs/property-affairs.service.spec.ts`
- Modify: `backend/src/property-affairs/property-affairs.controller.spec.ts`
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/property-affairs-dashboard.spec.ts`
- Modify: `backend/src/property-affairs/property-affairs.e2e-support.spec.ts`

### Frontend

- Modify: `frontend/src/types/property-affairs.ts`
- Modify: `frontend/src/services/property-affairs.ts`
- Modify: `frontend/src/components/property-affairs/PropertyAffairForm.vue`
- Modify: `frontend/src/views/PropertyAffairFormView.vue`
- Modify: `frontend/src/views/PropertyAffairDetailView.vue`
- Modify: `frontend/src/views/property-affair-form.spec.ts`
- Modify: `frontend/src/views/property-affair-detail.spec.ts`
- Modify: `frontend/src/views/property-affairs-list.spec.ts`
- Modify: `frontend/src/views/property-affairs-dashboard.spec.ts`
- Modify: `frontend/src/components/property-affairs/related-property-affairs.spec.ts`
- Modify: `frontend/src/services/property-affairs.spec.ts`

### Verification and release

- Verify: `deploy/.env.test` is consumed in-place and never printed, copied, or committed.
- Verify: existing test-database backup scripts/runbook before applying the migration.

---

## Task 1: Add the normalized visibility data model

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260914090000_property_affair_visibility/migration.sql`
- Modify: `backend/src/property-affairs/property-affairs-schema.spec.ts`

**Consumes:** existing `PropertyAffair`, `User`, and MySQL tables.

**Produces:** `PropertyAffairVisibilityScope`, `PropertyAffair.visibilityScope`, and `PropertyAffairViewer`.

- [ ] **Step 1: Add failing schema assertions**

  Assert that the Prisma schema contains the enum, the defaulted affair field, the relation table, composite key, and indexes:

  ```ts
  expect(schema).toContain('enum PropertyAffairVisibilityScope')
  expect(schema).toContain('visibilityScope PropertyAffairVisibilityScope @default(ALL)')
  expect(schema).toContain('model PropertyAffairViewer')
  expect(schema).toContain('@@id([affairId, userId])')
  ```

- [ ] **Step 2: Run the schema test and confirm RED**

  Run: `npm --prefix backend test -- --runInBand src/property-affairs/property-affairs-schema.spec.ts`

  Expected: failure because the visibility enum and relation do not exist.

- [ ] **Step 3: Add the Prisma models**

  Add:

  ```prisma
  enum PropertyAffairVisibilityScope {
    ALL
    RESTRICTED
  }

  model PropertyAffairViewer {
    affairId Int      @map("affair_id") @db.UnsignedInt
    userId   Int      @map("user_id") @db.UnsignedInt
    createdAt DateTime @default(now()) @map("created_at") @db.DateTime(3)
    affair   PropertyAffair @relation(fields: [affairId], references: [id], onDelete: Cascade)
    user     User           @relation(fields: [userId], references: [id], onDelete: Cascade)

    @@id([affairId, userId])
    @@index([userId, affairId])
    @@map("property_affair_viewers")
  }
  ```

  Add `visibilityScope` and `viewers` to `PropertyAffair`, and `propertyAffairViewerEntries` to `User`.

- [ ] **Step 4: Create an additive migration**

  The SQL must add `visibility_scope` with default `ALL`, create the viewer table and foreign keys, and avoid updating or deleting existing affair rows.

- [ ] **Step 5: Validate Prisma and confirm GREEN**

  Run:

  ```text
  npm --prefix backend run prisma:validate
  npm --prefix backend test -- --runInBand src/property-affairs/property-affairs-schema.spec.ts
  ```

  Expected: both pass.

- [ ] **Step 6: Commit Task 1**

  ```text
  git add backend/prisma/schema.prisma backend/prisma/migrations/20260914090000_property_affair_visibility/migration.sql backend/src/property-affairs/property-affairs-schema.spec.ts
  git commit -m "feat(property-affairs): add visibility data model"
  ```

---

## Task 2: Define DTO validation and response serialization

**Files:**

- Modify: `backend/src/property-affairs/dto/create-property-affair.dto.ts`
- Modify: `backend/src/property-affairs/dto/update-property-affair.dto.ts`
- Modify: `backend/src/property-affairs/property-affair-dto.spec.ts`
- Modify: `backend/src/property-affairs/property-affair-presenter.ts`
- Modify: `backend/src/property-affairs/property-affairs.service.spec.ts`

**Consumes:** `PropertyAffairVisibilityScope`, active user records, existing affair presenter.

**Produces:** request fields `visibilityScope`, `viewerUserIds`; response fields `visibilityScope`, `viewers`.

- [ ] **Step 1: Add failing DTO tests**

  Cover:

  - omitted scope defaults to `ALL` in service processing;
  - `ALL` accepts no viewer IDs and normalizes any omitted list to `[]`;
  - `RESTRICTED` with no viewer IDs fails validation;
  - viewer IDs must be unique positive integers;
  - update can change scope and replace the complete viewer list.

- [ ] **Step 2: Run DTO tests and confirm RED**

  Run: `npm --prefix backend test -- --runInBand src/property-affairs/property-affair-dto.spec.ts`

  Expected: failure because the new fields and conditional validation do not exist.

- [ ] **Step 3: Implement request types and conditional validation**

  Add exact request properties:

  ```ts
  visibilityScope?: PropertyAffairVisibilityScope
  viewerUserIds?: number[]
  ```

  Use class-validator decorators plus a DTO-level invariant or service validator so `RESTRICTED` requires at least one unique ID and `ALL` persists no explicit viewer rows.

- [ ] **Step 4: Extend the presenter include and output**

  Add viewer users to `propertyAffairInclude` using a narrow select:

  ```ts
  viewers: {
    include: {
      user: { select: { id: true, displayName: true, role: true, status: true } },
    },
    orderBy: { user: { displayName: 'asc' } },
  }
  ```

  Serialize only explicitly selected viewers as:

  ```ts
  viewers: Array<{ id: number; displayName: string }>
  ```

- [ ] **Step 5: Add presenter assertions and confirm GREEN**

  Run:

  ```text
  npm --prefix backend test -- --runInBand src/property-affairs/property-affair-dto.spec.ts src/property-affairs/property-affairs.service.spec.ts
  ```

- [ ] **Step 6: Commit Task 2**

  ```text
  git add backend/src/property-affairs/dto backend/src/property-affairs/property-affair-presenter.ts backend/src/property-affairs/property-affair-dto.spec.ts backend/src/property-affairs/property-affairs.service.spec.ts
  git commit -m "feat(property-affairs): validate visibility payloads"
  ```

---

## Task 3: Add one shared backend visibility policy

**Files:**

- Create: `backend/src/property-affairs/property-affair-visibility.ts`
- Create: `backend/src/property-affairs/property-affair-visibility.spec.ts`

**Consumes:** `AuthUser`, `UserRole`, `Prisma.PropertyAffairWhereInput`.

**Produces:** `propertyAffairVisibilityWhere(user)` and `propertyAffairVisibilitySql(user)`.

- [ ] **Step 1: Write failing policy tests**

  Assert exact behavior:

  - super admin receives an unrestricted Prisma condition;
  - ordinary admin matches `ALL`, `createdBy`, or an explicit active viewer row;
  - the SQL fragment used by the dashboard has the same three branches;
  - no visitor branch is introduced.

- [ ] **Step 2: Run policy tests and confirm RED**

  Run: `npm --prefix backend test -- --runInBand src/property-affairs/property-affair-visibility.spec.ts`

- [ ] **Step 3: Implement the Prisma condition**

  ```ts
  export function propertyAffairVisibilityWhere(user: AuthUser): Prisma.PropertyAffairWhereInput {
    if (user.role === UserRole.SUPER_ADMIN) return {}
    return {
      OR: [
        { visibilityScope: PropertyAffairVisibilityScope.ALL },
        { createdBy: user.id },
        { viewers: { some: { userId: user.id, user: { status: UserStatus.ACTIVE } } } },
      ],
    }
  }
  ```

  Build the dashboard SQL fragment with `Prisma.sql` and bound parameters; never concatenate a user ID into SQL text.

- [ ] **Step 4: Run policy tests and confirm GREEN**

  Run: `npm --prefix backend test -- --runInBand src/property-affairs/property-affair-visibility.spec.ts`

- [ ] **Step 5: Commit Task 3**

  ```text
  git add backend/src/property-affairs/property-affair-visibility.ts backend/src/property-affairs/property-affair-visibility.spec.ts
  git commit -m "feat(property-affairs): centralize visibility policy"
  ```

---

## Task 4: Enforce visibility on queries, categories, dashboard, and mutations

**Files:**

- Modify: `backend/src/property-affairs/property-affairs.service.ts`
- Modify: `backend/src/property-affairs/property-affairs.controller.ts`
- Modify: `backend/src/property-affairs/property-affairs.service.spec.ts`
- Modify: `backend/src/property-affairs/property-affairs.controller.spec.ts`
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/property-affairs-dashboard.spec.ts`

**Consumes:** shared policy from Task 3 and current authenticated `AuthUser`.

**Produces:** visibility-safe list, search, detail, categories, recycle bin, dashboard, create, update, progress, delete, restore, and permanent delete operations.

- [ ] **Step 1: Add failing service tests for all read surfaces**

  Cover ordinary admin, creator, selected viewer, unselected user, disabled viewer, and super admin for:

  - `list(query, user)` and keyword/filter searches;
  - `listRecycleBin(query, user)`;
  - `get(id, user, includeDeleted?)`;
  - `categories(user)`, ensuring a category used only by a hidden item is not leaked;
  - `dashboardItems(limit, user)`.

- [ ] **Step 2: Add failing mutation tests**

  Assert unselected ordinary admins cannot update, append progress, soft-delete, restore, or permanently delete by guessing an ID. Assert selected viewers retain current operation permissions and super admins remain unrestricted.

- [ ] **Step 3: Run service and dashboard tests and confirm RED**

  Run:

  ```text
  npm --prefix backend test -- --runInBand src/property-affairs/property-affairs.service.spec.ts src/dashboard/property-affairs-dashboard.spec.ts
  ```

- [ ] **Step 4: Thread `AuthUser` through controller and dashboard calls**

  Change signatures to:

  ```ts
  list(query: ListPropertyAffairsQueryDto, user: AuthUser)
  listRecycleBin(query: ListPropertyAffairsQueryDto, user: AuthUser)
  get(id: number, user: AuthUser, includeDeleted?: boolean)
  categories(user: AuthUser)
  dashboardItems(limit: number, user: AuthUser)
  ```

  Update `DashboardService` to pass its authenticated user.

- [ ] **Step 5: Apply the policy to every service query**

  Combine existing business filters and visibility using `AND`. For ID-based mutations, load the item with `{ id, ...propertyAffairVisibilityWhere(user) }`; throw `NotFoundException('事项不存在或无权查看')` on no match.

- [ ] **Step 6: Persist viewers transactionally on create/update**

  - Resolve only active `ADMIN` or `SUPER_ADMIN` IDs.
  - Reject missing/inactive/visitor IDs with a Chinese validation message.
  - Store zero viewer rows for `ALL`.
  - Replace viewer rows inside the same transaction for `RESTRICTED` updates.
  - Preserve optimistic locking and increment version exactly once.

- [ ] **Step 7: Record visibility changes in the existing operation log**

  Store before/after scope and explicit viewer user IDs/names in the log detail without changing other audit behavior.

- [ ] **Step 8: Run backend tests and confirm GREEN**

  Run:

  ```text
  npm --prefix backend test -- --runInBand src/property-affairs/property-affairs.service.spec.ts src/property-affairs/property-affairs.controller.spec.ts src/dashboard/property-affairs-dashboard.spec.ts
  ```

- [ ] **Step 9: Commit Task 4**

  ```text
  git add backend/src/property-affairs backend/src/dashboard/dashboard.service.ts backend/src/dashboard/property-affairs-dashboard.spec.ts
  git commit -m "feat(property-affairs): enforce affair visibility"
  ```

---

## Task 5: Close attachment and direct-access leakage paths

**Files:**

- Modify: `backend/src/property-affairs/property-affairs.controller.ts`
- Modify: `backend/src/property-affairs/property-affairs.service.ts`
- Modify: `backend/src/property-affairs/property-affairs.controller.spec.ts`
- Modify: `backend/src/property-affairs/property-affairs.e2e-support.spec.ts`

**Consumes:** authenticated user and `assertVisible(id, user, includeDeleted?)` service method.

**Produces:** protected upload, preview, download, unlink, and guessed-ID behavior.

- [ ] **Step 1: Add failing controller tests for every file endpoint**

  Verify that preview and download now receive `@CurrentUser`, call the visibility guard before reading bytes, and return the same non-disclosing Chinese error as detail access.

- [ ] **Step 2: Add failing E2E support scenarios**

  Build three users and two restricted affairs, then assert:

  - an unselected admin receives no list/search/dashboard/related result;
  - guessed detail and file URLs fail;
  - creator and selected viewer can access;
  - super admin can access all;
  - disabled selected user loses access on the next request.

- [ ] **Step 3: Run focused tests and confirm RED**

  Run:

  ```text
  npm --prefix backend test -- --runInBand src/property-affairs/property-affairs.controller.spec.ts src/property-affairs/property-affairs.e2e-support.spec.ts
  ```

- [ ] **Step 4: Guard all attachment operations**

  Before delegating to `FilesService`, call the shared service access check for upload, preview, download, and unlink. Do not move authorization into storage-path logic.

- [ ] **Step 5: Run focused tests and confirm GREEN**

  Run the command from Step 3 again.

- [ ] **Step 6: Commit Task 5**

  ```text
  git add backend/src/property-affairs/property-affairs.controller.ts backend/src/property-affairs/property-affairs.service.ts backend/src/property-affairs/property-affairs.controller.spec.ts backend/src/property-affairs/property-affairs.e2e-support.spec.ts
  git commit -m "fix(property-affairs): protect restricted affair files"
  ```

---

## Task 6: Add frontend visibility selection and display

**Files:**

- Modify: `frontend/src/types/property-affairs.ts`
- Modify: `frontend/src/services/property-affairs.ts`
- Modify: `frontend/src/components/property-affairs/PropertyAffairForm.vue`
- Modify: `frontend/src/views/PropertyAffairFormView.vue`
- Modify: `frontend/src/views/PropertyAffairDetailView.vue`
- Modify: `frontend/src/views/property-affair-form.spec.ts`
- Modify: `frontend/src/views/property-affair-detail.spec.ts`
- Modify: `frontend/src/services/property-affairs.spec.ts`

**Consumes:** existing `responsible-users` options and backend visibility payloads.

**Produces:** default-all form, multi-select restricted viewers, request serialization, and detail display.

- [ ] **Step 1: Add failing type/service tests**

  Add exact frontend contracts:

  ```ts
  export type PropertyAffairVisibilityScope = 'ALL' | 'RESTRICTED'
  export type PropertyAffairViewer = { id: number; displayName: string }
  ```

  Extend summaries/details and create/update payloads with `visibilityScope` and `viewerUserIds`/`viewers` as appropriate.

- [ ] **Step 2: Add failing form tests**

  Verify:

  - a new form defaults to “所有人可见”;
  - choosing “仅指定人员可见” reveals a filterable multiple selector;
  - restricted mode with no selection shows “请至少选择一名可见人员” and does not submit;
  - switching back to all clears explicit viewer IDs;
  - edit mode hydrates scope and selected viewers;
  - submit includes normalized `visibilityScope` and `viewerUserIds`.

- [ ] **Step 3: Add failing detail tests**

  Assert detail shows “所有人可见” or the explicit selected names. Do not list the implicit creator/super-admin fallback users.

- [ ] **Step 4: Run frontend focused tests and confirm RED**

  Run:

  ```text
  npm --prefix frontend run test:unit -- src/services/property-affairs.spec.ts src/views/property-affair-form.spec.ts src/views/property-affair-detail.spec.ts
  ```

- [ ] **Step 5: Implement the form controls**

  In `PropertyAffairForm.vue`, add a “可见范围” section with:

  - radio options “所有人可见” and “仅指定人员可见”;
  - `el-select` with `multiple`, `filterable`, and active administrator options;
  - concise help text: “创建人和超级管理员始终可以查看”。

  Reuse `responsibleUsers` as selectable candidates because that endpoint already returns active administrators and super administrators.

- [ ] **Step 6: Serialize payloads and render detail**

  Ensure create/update requests send only IDs, and detail uses returned viewer names.

- [ ] **Step 7: Run focused tests and confirm GREEN**

  Run the command from Step 4 again.

- [ ] **Step 8: Commit Task 6**

  ```text
  git add frontend/src/types/property-affairs.ts frontend/src/services/property-affairs.ts frontend/src/components/property-affairs/PropertyAffairForm.vue frontend/src/views/PropertyAffairFormView.vue frontend/src/views/PropertyAffairDetailView.vue frontend/src/views/property-affair-form.spec.ts frontend/src/views/property-affair-detail.spec.ts frontend/src/services/property-affairs.spec.ts
  git commit -m "feat(property-affairs): add visibility controls"
  ```

---

## Task 7: Verify list, related-entry, and dashboard behavior in the frontend

**Files:**

- Modify: `frontend/src/views/property-affairs-list.spec.ts`
- Modify: `frontend/src/views/property-affairs-dashboard.spec.ts`
- Modify: `frontend/src/components/property-affairs/related-property-affairs.spec.ts`

**Consumes:** backend-filtered API results.

**Produces:** regression coverage proving all frontend entry points tolerate and respect filtered results.

- [ ] **Step 1: Add regression tests**

  Cover empty and filtered responses for:

  - main property-affairs list and recycle bin;
  - dashboard property-affair card;
  - room, tenant, contract, and building related-affair panels;
  - pagination totals after backend visibility filtering.

- [ ] **Step 2: Run tests and confirm current behavior**

  Run:

  ```text
  npm --prefix frontend run test:unit -- src/views/property-affairs-list.spec.ts src/views/property-affairs-dashboard.spec.ts src/components/property-affairs/related-property-affairs.spec.ts
  ```

  Expected: tests either pass without production changes or identify an assumption that hidden records are still present.

- [ ] **Step 3: Apply only necessary frontend corrections**

  Remove any client-side total/count assumptions. Do not duplicate backend authorization or cache hidden affairs locally.

- [ ] **Step 4: Run tests and confirm GREEN**

  Run the command from Step 2 again.

- [ ] **Step 5: Commit Task 7**

  ```text
  git add frontend/src/views/property-affairs-list.spec.ts frontend/src/views/property-affairs-dashboard.spec.ts frontend/src/components/property-affairs/related-property-affairs.spec.ts
  git commit -m "test(property-affairs): cover visibility entry points"
  ```

---

## Task 8: Full verification and test-environment update

**Files:**

- Verify all modified files.
- Do not modify or display secrets from `deploy/.env.test`.

**Consumes:** completed Tasks 1–7.

**Produces:** verified build, migrated local test database, and feature visible at `http://localhost:15173/`.

- [ ] **Step 1: Run generated-client and schema checks**

  Run:

  ```text
  npm --prefix backend run prisma:generate
  npm --prefix backend run prisma:validate
  npm run db:validate
  ```

- [ ] **Step 2: Run full backend and frontend tests**

  Run:

  ```text
  npm test
  npm --prefix frontend run test:unit
  ```

- [ ] **Step 3: Run lint and production builds**

  Run:

  ```text
  npm run lint
  npm run build
  ```

- [ ] **Step 4: Back up and verify the local test database**

  Use the repository’s existing test backup procedure against only the database configured by `deploy/.env.test`. Verify that the dump is non-empty and can be parsed before applying the migration. Never echo connection strings, passwords, or secret values.

- [ ] **Step 5: Apply migrations to the local test database**

  Run Prisma migrate deploy through the existing Docker/test-environment command path using `deploy/.env.test` as input. Confirm that `20260914090000_property_affair_visibility` is applied.

- [ ] **Step 6: Run isolated E2E tests**

  Run: `npm --prefix backend run test:e2e`

  Expected: all visibility, attachment, dashboard, and existing property-affair workflows pass against the isolated local test database.

- [ ] **Step 7: Rebuild only test API and web services**

  Run:

  ```text
  docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.yml up -d --build --no-deps api web
  ```

- [ ] **Step 8: Perform role-based browser acceptance**

  Verify in the test environment:

  1. Create an all-visible affair as an ordinary administrator.
  2. Create a restricted affair selecting two users.
  3. Confirm creator, both selected users, and a super administrator can open it.
  4. Confirm an unselected administrator cannot see it in list, search, dashboard, related panels, or recycle bin.
  5. Confirm guessed detail, preview, download, update, progress, and delete requests are rejected.
  6. Change selected users and confirm access changes immediately.
  7. Disable a selected user and confirm access is removed.
  8. Confirm historical affairs still show as all-visible.

- [ ] **Step 9: Inspect repository state and commit any final test-only corrections**

  Run `git status --short`, ensure no environment file, database dump, uploaded attachment, or unrelated user file is staged, then commit only verified feature files if corrections were necessary.

- [ ] **Step 10: Report completion without pushing or deploying production**

  Report test commands and results, test-environment URL, migration name, and any retained limitations. Stop before GitHub push or production deployment unless the user explicitly authorizes those actions.

---

## Final Acceptance Matrix

| Scenario | Creator | Selected admin | Unselected admin | Super admin |
|---|---:|---:|---:|---:|
| `ALL` affair | Visible | Visible | Visible | Visible |
| `RESTRICTED` affair | Visible | Visible | Hidden | Visible |
| Disabled selected user | N/A | Hidden | Hidden | Visible |
| Direct detail/file URL without visibility | N/A | N/A | “事项不存在或无权查看” | Visible |
| Existing historical affair | Visible | Visible | Visible | Visible |

The implementation is complete only when the same matrix holds for list, search, detail, categories, dashboard, related panels, recycle bin, restore/permanent delete, progress, and all attachment operations.
