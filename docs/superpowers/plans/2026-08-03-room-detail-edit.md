# 房源详情页编辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在房源详情页为管理员增加房源基础信息编辑能力，复用现有后端更新接口并保持房态流程独立。

**Architecture:** 后端继续使用现有 `PATCH /properties/rooms/:id`、DTO 校验和管理员角色守卫；前端在 `RoomDetailView.vue` 增加管理员可见的编辑弹窗，保存后重新加载详情。测试覆盖控制器更新请求和前端生产构建。

**Tech Stack:** NestJS、Prisma、Jest、Vue 3、Element Plus、Pinia、TypeScript。

## Global Constraints

- 不修改 Prisma schema 或迁移。
- 房态不放进编辑弹窗，继续通过房态变更流程维护。
- 后端必须继续强制要求 `ADMIN` 或 `SUPER_ADMIN`。
- 不编辑合同、租户、财务和收款信息。

---

### Task 1: 后端更新接口回归测试

**Files:**
- Modify: `backend/src/properties/properties.controller.spec.ts`
- Inspect: `backend/src/properties/properties.controller.ts`

**Interfaces:**
- Consumes: `PropertiesController.updateRoom(id, dto)` and existing mocked Prisma client.
- Produces: regression coverage proving the detail-page payload reaches the existing update path and recalculates `fullHouseNo`.

- [ ] **Step 1: Write the failing test**

Add a test that calls `updateRoom(11, { houseNo: '414-415', floorNo: 4, area: 88.42, roomType: 'RESIDENTIAL', decorationStatus: 'UNKNOWN', usageType: 'RESIDENCE', remark: '414、415打通合并' })` and asserts `prisma.db.room.update` receives the payload plus `fullHouseNo: '1栋414-415'` and returns the included building.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run `npm --prefix backend test -- properties.controller.spec.ts --runInBand`.
Expected: the new assertion fails if the test setup does not yet provide the detail-edit payload contract.

- [ ] **Step 3: Keep the existing backend implementation minimal**

Confirm `UpdateRoomDto` accepts all fields listed in the design and `PropertiesController.updateRoom` remains guarded by `JwtAuthGuard`, `RolesGuard`, and `@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)`. Only adjust the DTO or controller if the focused test exposes a real contract gap; do not add a second update endpoint.

- [ ] **Step 4: Run the focused backend test**

Run `npm --prefix backend test -- properties.controller.spec.ts --runInBand` and require all tests to pass.

- [ ] **Step 5: Commit the backend regression coverage**

Run `git add backend/src/properties/properties.controller.spec.ts backend/src/properties/properties.controller.ts backend/src/properties/dto/update-room.dto.ts` then `git commit -m "test: cover room detail editing contract"`.

### Task 2: 房源详情页编辑弹窗

**Files:**
- Modify: `frontend/src/views/RoomDetailView.vue`
- Inspect: `frontend/src/stores/auth.ts`, `frontend/src/types/auth.ts`, `frontend/src/views/PropertiesView.vue`

**Interfaces:**
- Consumes: loaded `detail.room`, `authStore.user.role`, and `http.patch('/properties/rooms/:id', payload)`.
- Produces: `editing` state, prefilled form, role-gated “编辑房源” button, and refresh-after-save behavior.

- [ ] **Step 1: Add a frontend test seam before implementation**

Use the existing repository frontend validation seam (Vue type-check plus production build) and add no new test framework. Define the form payload in the component with the exact fields `houseNo`, `floorNo`, `area`, `roomType`, `decorationStatus`, `usageType`, `ownerName`, `ownerPhone`, `ownerRemark`, and `remark`; the build should fail if any field is typed inconsistently with the loaded room.

- [ ] **Step 2: Run the frontend validation before implementation**

Run `npm --prefix frontend run build` to establish the current baseline and ensure the existing application compiles before the component change.

- [ ] **Step 3: Implement the edit state and role gate**

Add `editDialog`, `editSaving`, and a reactive form. Use the existing auth store role values so the button is visible only when `['ADMIN', 'SUPER_ADMIN'].includes(authStore.user?.role)`. Add `openEdit()` to copy current room fields into the form without exposing room status.

- [ ] **Step 4: Implement save and refresh**

Submit only the approved fields with `http.patch('/properties/rooms/${route.params.id}', formPayload)`, show a success message, close the dialog, and call the existing `load()` function. On failure, keep the dialog open and show the existing Element Plus error message pattern.

- [ ] **Step 5: Add the Chinese Element Plus form**

Render inputs/selects for the approved fields, with Chinese labels and the same enum labels/options used by `PropertiesView.vue`. Add cancel/save actions and disable save while `editSaving` is true. Keep the current status tag and status history display unchanged.

- [ ] **Step 6: Run frontend validation**

Run `npm --prefix frontend run build`; expected result is a successful Vue type-check and Vite production build.

- [ ] **Step 7: Commit the frontend feature**

Run `git add frontend/src/views/RoomDetailView.vue` then `git commit -m "feat: edit room details from detail page"`.

### Task 3: Full verification and handoff

**Files:**
- Modify: none expected
- Inspect: `git status`, existing backend and frontend test scripts

**Interfaces:**
- Consumes: committed backend and frontend changes.
- Produces: verified local build/test state and a concise manual acceptance checklist.

- [ ] **Step 1: Run backend lint and unit tests**

Run `npm --prefix backend run lint` and `npm --prefix backend test -- --runInBand`; both must exit successfully.

- [ ] **Step 2: Run backend e2e tests**

Run `npm --prefix backend run test:e2e -- --runInBand`; all existing interface tests must pass.

- [ ] **Step 3: Run frontend production build**

Run `npm --prefix frontend run build`; the build must exit successfully.

- [ ] **Step 4: Verify repository state**

Run `git diff --check` and `git status --short`; there must be no whitespace errors and only intentional committed changes.

- [ ] **Step 5: Report manual acceptance**

Open `https://www.hetfw.cn/properties/:id` as an administrator, edit a non-sensitive room field, save, refresh, and confirm the value persists. Confirm a non-admin account sees the detail but not the edit button.
