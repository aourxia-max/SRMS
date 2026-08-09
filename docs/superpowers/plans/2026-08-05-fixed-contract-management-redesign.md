# 固定月租合同管理重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按合同工作流原型重建固定月租合同管理闭环，关闭阶梯业务，并提供经过备份门槛保护的历史阶梯合同完整清理工具。

**Architecture:** 合同页面拆为列表、表单、详情和固定月租退差四个独立面板，共享一个合同工作区状态。后端用独立草稿表承载未完整数据，确认时在事务中生成正式合同、账单、附件关联、提成和房态历史；阶梯入口由后端强制关闭。历史删除使用独立 CLI，先预检外键和备份，再按依赖清单在事务中删除。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Pinia、NestJS、Prisma 7、MySQL 8、Jest、Vitest、Docker Compose。

## Global Constraints

- 业务基线以本次已确认规格和同步后的 SRMS-RB-1.0 为准。
- 新合同只允许固定月租，不再创建 `TIERED_RETROACTIVE`。
- 固定金额优惠、比例优惠、免租和尾期固定 30 天口径保持不变。
- 合同编号继续使用 `HTYYYYMMDDNNNN | 楼栋房号 | 住户姓名`。
- 历史阶梯合同及全部关联业务、财务数据必须先备份、预检，再经显式确认执行事务删除。
- 权限必须由后端强制校验；租房提成仅超级管理员可见、可写。
- 日期选择和提示全部为简体中文。
- 不覆盖 `frontend/src/views/DashboardView.vue`、`.superpowers/`、`deploy/test-data/` 等现有用户改动。

---

### Task 1: 冻结需求与数据库设计变更记录

**Files:**
- Modify: `docs/requirements-freeze-v1.md`
- Modify: `docs/database-design.md`
- Create: `docs/requirement-changes/2026-08-05-remove-tiered-contracts.md`
- Test: `docs/superpowers/specs/2026-08-05-fixed-contract-management-redesign.md`

**Interfaces:**
- Consumes: 已确认规格中的固定月租、历史完整删除和权限约束。
- Produces: 后续代码和验收采用的唯一文字业务基线。

- [ ] **Step 1: 写需求差异检查命令并确认旧条款存在**

Run:

```powershell
rg -n "自定义阶梯|阶梯退差|TIERED_RETROACTIVE|contract_files|external_contract_no" docs/requirements-freeze-v1.md docs/database-design.md
```

Expected: 输出旧的阶梯支持条款及尚未完全落地的数据表设计。

- [ ] **Step 2: 写正式变更记录**

记录必须明确：

```markdown
- 变更编号：SRMS-RB-1.0-CR-20260805-01
- 新合同仅允许固定月租。
- 停止新增阶梯合同和阶梯达档退差。
- 固定月租手工退差保留。
- 历史阶梯合同及关联数据按受控清理流程完整删除。
- 金额口径、账单快照、收款、退款、押金和退租规则不变。
```

- [ ] **Step 3: 更新冻结需求和数据库设计**

删除“继续支持新阶梯业务”的现行表述，保留历史兼容枚举说明；补充 `contract_drafts`、`contract_files`、`external_contract_no`、编号长度和清理安全门槛。

- [ ] **Step 4: 运行文档自检**

Run:

```powershell
rg -n "TBD|TODO|待定|自定义阶梯计价、免租|支持固定月租、自定义阶梯" docs/requirements-freeze-v1.md docs/database-design.md docs/requirement-changes/2026-08-05-remove-tiered-contracts.md
```

Expected: 无占位符；不存在把阶梯计价描述为当前可创建能力的条款。

- [ ] **Step 5: 提交**

```powershell
git add docs/requirements-freeze-v1.md docs/database-design.md docs/requirement-changes/2026-08-05-remove-tiered-contracts.md
git commit -m "docs: retire tiered contract workflows"
```

---

### Task 2: 数据库模型与迁移

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260805100000_fixed_contract_management_redesign/migration.sql`
- Test: `backend/src/contracts/contract-schema.spec.ts`

**Interfaces:**
- Consumes: Prisma `Contract`、`FileAsset`、`User` 及现有 `ContractCommission`。
- Produces: `ContractDraft`、`ContractFile`、`Contract.externalContractNo`，以及扩容后的编号字段。

- [ ] **Step 1: 写失败的结构测试**

测试读取 `schema.prisma` 并断言：

```ts
expect(schema).toContain('model ContractDraft');
expect(schema).toContain('model ContractFile');
expect(schema).toContain('externalContractNo');
expect(schema).toContain('@db.VarChar(120)');
```

- [ ] **Step 2: 运行结构测试确认失败**

Run:

```powershell
npm --prefix backend test -- --runInBand src/contracts/contract-schema.spec.ts
```

Expected: FAIL，提示缺少草稿、合同附件或扩容字段。

- [ ] **Step 3: 增加 Prisma 模型**

核心接口固定为：

```prisma
model ContractDraft {
  id          Int       @id @default(autoincrement()) @db.UnsignedInt
  payload     Json
  status      String    @default("DRAFT") @db.VarChar(20)
  createdBy   Int       @map("created_by") @db.UnsignedInt
  confirmedAt DateTime? @map("confirmed_at") @db.DateTime(3)
  createdAt   DateTime  @default(now()) @map("created_at") @db.DateTime(3)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.DateTime(3)
  creator     User      @relation(fields: [createdBy], references: [id], onDelete: Restrict)
  @@index([createdBy, status, updatedAt])
  @@map("contract_drafts")
}

model ContractFile {
  contractId Int       @map("contract_id") @db.UnsignedInt
  fileAssetId Int      @map("file_asset_id") @db.UnsignedInt
  createdAt  DateTime  @default(now()) @map("created_at") @db.DateTime(3)
  contract   Contract  @relation(fields: [contractId], references: [id], onDelete: Restrict)
  fileAsset  FileAsset @relation(fields: [fileAssetId], references: [id], onDelete: Restrict)
  @@id([contractId, fileAssetId])
  @@map("contract_files")
}
```

`Contract.contractNo` 改为 `VARCHAR(120)`，`RentBill.billNo` 改为 `VARCHAR(140)`，并新增 `externalContractNo VARCHAR(80) NULL`。

同时补齐 Prisma 反向关系：`User.contractDrafts`、`Contract.files`、`FileAsset.contractFiles`，并复用现有 `FileCategory.CONTRACT` 作为合同附件类别，不新增含义重复的枚举值。

- [ ] **Step 4: 编写显式 SQL migration**

Migration 只创建/扩容结构，不含历史删除语句；添加表、索引、外键和列时使用与现有库一致的 `utf8mb4`。

- [ ] **Step 5: 运行结构验证**

Run:

```powershell
npm --prefix backend run prisma:validate
npm --prefix backend run prisma:generate
npm --prefix backend test -- --runInBand src/contracts/contract-schema.spec.ts
```

Expected: 全部通过。

- [ ] **Step 6: 提交**

```powershell
git add backend/prisma/schema.prisma backend/prisma/migrations/20260805100000_fixed_contract_management_redesign/migration.sql backend/src/contracts/contract-schema.spec.ts
git commit -m "feat: add fixed contract draft schema"
```

---

### Task 3: 固定合同请求模型与草稿服务

**Files:**
- Create: `backend/src/contracts/dto/save-contract-draft.dto.ts`
- Modify: `backend/src/contracts/dto/create-fixed-contract.dto.ts`
- Create: `backend/src/contracts/contract-drafts.service.ts`
- Create: `backend/src/contracts/contract-drafts.service.spec.ts`
- Modify: `backend/src/contracts/contracts.controller.ts`
- Modify: `backend/src/contracts/contracts.module.ts`

**Interfaces:**
- Produces: `ContractDraftPayload`、`save(userId, dto)`、`get(id, user)`、`update(id, user, dto)`、`markConfirmed(id, tx)`。
- HTTP: `POST /api/contracts/drafts`、`GET /api/contracts/drafts/:id`、`PATCH /api/contracts/drafts/:id`。

- [ ] **Step 1: 写失败的 DTO 和服务测试**

覆盖：草稿允许缺少正式必填字段；管理员只能编辑自己的草稿；超级管理员可读取全部草稿；已确认草稿拒绝再次编辑。

```ts
await expect(service.update(7, admin, dto)).rejects.toThrow('无权编辑该草稿');
await expect(service.update(8, owner, dto)).rejects.toThrow('草稿已确认');
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --prefix backend test -- --runInBand src/contracts/contract-drafts.service.spec.ts
```

Expected: FAIL，模块或方法不存在。

- [ ] **Step 3: 定义草稿载荷**

```ts
export type ContractDraftPayload = {
  externalContractNo?: string;
  roomId?: number;
  primaryTenantId?: number;
  secondaryTenantIds?: number[];
  startDate?: string;
  endDate?: string;
  plannedMoveInDate?: string;
  monthlyRent?: string;
  depositRequired?: string;
  paymentCycleMonths?: number;
  concessions?: ConcessionDto[];
  fileAssetIds?: number[];
  remark?: string;
  commission?: { recipientName: string; amount: string };
};
```

DTO 对已提供字段做类型、长度和非负校验，但不强制草稿完整。

- [ ] **Step 4: 实现草稿服务与控制器**

所有草稿接口使用 `JwtAuthGuard + RolesGuard`，只允许 `SUPER_ADMIN`、`ADMIN`。服务写入 `payload` 前，普通管理员必须删除并拒绝 `commission` 字段。

- [ ] **Step 5: 运行专项测试**

Run:

```powershell
npm --prefix backend test -- --runInBand src/contracts/contract-drafts.service.spec.ts
npm --prefix backend run lint:check
```

Expected: PASS，Lint 无错误。

- [ ] **Step 6: 提交**

```powershell
git add backend/src/contracts/dto/save-contract-draft.dto.ts backend/src/contracts/dto/create-fixed-contract.dto.ts backend/src/contracts/contract-drafts.service.ts backend/src/contracts/contract-drafts.service.spec.ts backend/src/contracts/contracts.controller.ts backend/src/contracts/contracts.module.ts
git commit -m "feat: add fixed contract drafts"
```

---

### Task 4: 正式确认事务与账单预览

**Files:**
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/contracts/contracts.service.spec.ts`
- Modify: `backend/src/contracts/contract-number.ts`
- Modify: `backend/src/contracts/contract-number.spec.ts`
- Modify: `backend/src/contracts/contracts.controller.ts`
- Create: `backend/src/contracts/dto/preview-fixed-contract.dto.ts`

**Interfaces:**
- Produces: `previewFixedContract(dto)`、`confirmDraft(id, user)`、扩展后的 `createFixedContract(input, user)`。
- HTTP: `POST /api/contracts/fixed/preview`、`POST /api/contracts/drafts/:id/confirm`、`POST /api/contracts/fixed`。

- [ ] **Step 1: 写失败的确认事务测试**

覆盖：完整校验、计划入住日期范围、冲突合同、正式编号、账单编号、附件关联、提成权限、房态更新、草稿只确认一次和事务回滚。

```ts
expect(tx.rentBill.createMany).toHaveBeenCalled();
expect(tx.room.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ roomStatus: 'PENDING_MOVE_IN' }),
}));
expect(tx.contractDraft.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ status: 'CONFIRMED' }),
}));
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --prefix backend test -- --runInBand src/contracts/contracts.service.spec.ts
```

Expected: FAIL，缺少预览或草稿确认行为。

- [ ] **Step 3: 扩展正式合同 DTO**

增加 `externalContractNo?`、`plannedMoveInDate?`、`fileAssetIds?`、`remark?`、`commission?`；正式确认保持房源、主承租人、日期、月租、押金和周期必填。

- [ ] **Step 4: 实现固定合同预览**

复用 `buildBillingPeriods`、`billAmount`、优惠计算函数，返回：

```ts
type FixedContractPreview = {
  billCount: number;
  totalBaseRent: string;
  totalDiscount: string;
  totalPayable: string;
  bills: Array<{ sequence: number; startDate: string; endDate: string; payableAmount: string }>;
};
```

- [ ] **Step 5: 实现统一确认事务**

直接确认和草稿确认调用同一私有方法 `confirmFixedContract(input, user, draftId?)`。普通管理员提交 `commission` 返回 403；合同编号生成器不再截断完整编号，依赖 Task 2 扩容字段。

- [ ] **Step 6: 运行专项和回归测试**

Run:

```powershell
npm --prefix backend test -- --runInBand src/contracts/contracts.service.spec.ts src/contracts/contract-number.spec.ts src/contracts/billing-calculator.spec.ts
```

Expected: PASS。

- [ ] **Step 7: 提交**

```powershell
git add backend/src/contracts/contracts.service.ts backend/src/contracts/contracts.service.spec.ts backend/src/contracts/contract-number.ts backend/src/contracts/contract-number.spec.ts backend/src/contracts/contracts.controller.ts backend/src/contracts/dto/create-fixed-contract.dto.ts backend/src/contracts/dto/preview-fixed-contract.dto.ts
git commit -m "feat: confirm fixed contracts transactionally"
```

---

### Task 5: 合同附件与提成权限

**Files:**
- Modify: `backend/src/files/files.service.ts`
- Modify: `backend/src/files/files.service.spec.ts`
- Modify: `backend/src/contracts/contracts.controller.ts`
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/finance/commissions.service.ts`
- Test: `backend/test/contracts.e2e-spec.ts`

**Interfaces:**
- Produces: `saveContractFile(file, user)`、`downloadContractFile(contractId, fileId)`、`listContractFiles(contractId)`。
- HTTP: `POST /api/contracts/files`、`GET /api/contracts/:id/files`、`GET /api/contracts/:id/files/:fileId/download`。

- [ ] **Step 1: 写失败的附件和权限测试**

覆盖 PDF/JPEG/PNG/WebP 签名、大小上限、未关联附件禁止下载、普通管理员看不到合同提成、超级管理员可见。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --prefix backend test -- --runInBand src/files/files.service.spec.ts
npm --prefix backend run test:e2e -- --runInBand test/contracts.e2e-spec.ts
```

Expected: FAIL，合同附件接口或权限过滤不存在。

- [ ] **Step 3: 实现合同附件存储**

存储目录固定为 `uploads/contract-files`，`FileAsset.category` 使用 `CONTRACT_FILE`。上传只创建文件资产；正式确认时验证 `uploadedBy` 或超级管理员权限并写入 `contract_files`。

- [ ] **Step 4: 实现提成输出过滤**

合同列表和详情根据 `AuthUser.role` 决定是否包含 `commissions`；不能只依赖前端隐藏。

- [ ] **Step 5: 运行测试并提交**

Run:

```powershell
npm --prefix backend test -- --runInBand src/files/files.service.spec.ts
npm --prefix backend run test:e2e -- --runInBand test/contracts.e2e-spec.ts
npm --prefix backend run lint:check
```

```powershell
git add backend/src/files backend/src/contracts backend/src/finance/commissions.service.ts
git commit -m "feat: secure contract files and commissions"
```

---

### Task 6: 停用阶梯接口并保留固定月租退差

**Files:**
- Modify: `backend/src/contracts/contracts.controller.ts`
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/pricing-rebates/dto/submit-pricing-rebate.dto.ts`
- Modify: `backend/src/pricing-rebates/pricing-rebates.service.ts`
- Modify: `backend/src/pricing-rebates/pricing-rebates.service.spec.ts`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/router/index.ts`

**Interfaces:**
- Produces: 新阶梯合同固定返回 410；退差提交只接受 `FIXED_RENT_MANUAL` 和固定月租合同。

- [ ] **Step 1: 写失败的停用测试**

```ts
await expect(service.createTieredContract(input)).rejects.toThrow('阶梯合同功能已停用');
await expect(rebates.submit(tieredDto, admin)).rejects.toThrow('阶梯退差功能已停用');
await expect(rebates.submit(fixedDto, admin)).resolves.toBeDefined();
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --prefix backend test -- --runInBand src/contracts/contracts.service.spec.ts src/pricing-rebates/pricing-rebates.service.spec.ts
```

Expected: 至少阶梯创建和阶梯退差仍可用，测试失败。

- [ ] **Step 3: 后端强制停用**

保留旧路由以返回明确错误，避免客户端误判 404；DTO 不再允许 `TIER_MILESTONE`，服务再次检查合同 `pricingMode === 'FIXED'`。

- [ ] **Step 4: 删除旧导航和独立阶梯页面路由**

从 `App.vue` 删除“阶梯退差”，从 router 删除独立 `/pricing-rebates` 页面；固定月租退差由合同工作区内部面板调用现有固定退差接口。

- [ ] **Step 5: 运行测试并提交**

Run:

```powershell
npm --prefix backend test -- --runInBand src/contracts/contracts.service.spec.ts src/pricing-rebates/pricing-rebates.service.spec.ts
npm --prefix frontend run build
```

```powershell
git add backend/src/contracts backend/src/pricing-rebates frontend/src/App.vue frontend/src/router/index.ts
git commit -m "feat: retire tiered contract operations"
```

---

### Task 7: 历史阶梯合同清理 CLI

**Files:**
- Create: `backend/src/maintenance/tiered-contract-cleanup.service.ts`
- Create: `backend/src/maintenance/tiered-contract-cleanup.service.spec.ts`
- Create: `backend/src/maintenance/tiered-contract-cleanup.cli.ts`
- Create: `backend/src/maintenance/maintenance.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/package.json`
- Create: `docs/runbooks/tiered-contract-cleanup.md`

**Interfaces:**
- Produces: `preflight(): CleanupReport`、`execute(input: CleanupAuthorization): CleanupResult`。
- CLI: `npm --prefix backend run cleanup:tiered -- --mode=preflight` 和 `--mode=execute`。

- [ ] **Step 1: 写失败的预检、授权和回滚测试**

```ts
await expect(service.execute({ environment: 'production', backupNo: '', confirmation: '' }))
  .rejects.toThrow('缺少有效备份');
expect(await service.preflight()).toEqual(expect.objectContaining({
  contractIds: expect.any(Array), tableCounts: expect.any(Object), unknownDependencies: [],
}));
```

覆盖未知外键阻断、非成功备份阻断、确认短语不匹配、事务失败回滚、固定合同不受影响、房态重算和孤儿文件保护。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --prefix backend test -- --runInBand src/maintenance/tiered-contract-cleanup.service.spec.ts
```

Expected: FAIL，清理服务不存在。

- [ ] **Step 3: 实现只读预检**

`CleanupReport` 必须包含合同编号清单、每张表数量、受影响房源、附件数量、外键清单和未知依赖。预检不执行任何写操作。

- [ ] **Step 4: 实现执行授权门槛**

生产执行要求：

```ts
type CleanupAuthorization = {
  environment: 'test' | 'production';
  backupNo: string;
  confirmation: 'DELETE_ALL_TIERED_CONTRACT_HISTORY';
};
```

服务从 `system_backups` 验证备份成功、校验和存在且未过期；测试环境同样要求成功备份。

- [ ] **Step 5: 实现事务删除和房态恢复**

用静态依赖清单决定删除顺序，并通过 `INFORMATION_SCHEMA.KEY_COLUMN_USAGE` 检查未知依赖。所有数据库删除和房态恢复在单个 `$transaction` 中完成；物理附件仅在事务提交后删除无引用文件，并把删除失败记录为人工清理项。

- [ ] **Step 6: 添加 CLI 和运行手册**

CLI 默认 `preflight`；`execute` 必须同时提供环境、备份编号和完整确认短语。日志不得输出密码、JWT 或数据库连接串。

- [ ] **Step 7: 测试环境只运行预检，不执行删除**

Run:

```powershell
npm --prefix backend run cleanup:tiered -- --mode=preflight --environment=test
```

Expected: 输出清单并以 0 退出；本任务阶段不执行破坏性删除。

- [ ] **Step 8: 提交**

```powershell
git add backend/src/maintenance backend/src/app.module.ts backend/package.json docs/runbooks/tiered-contract-cleanup.md
git commit -m "feat: add guarded tiered history cleanup"
```

---

### Task 8: 合同工作区前端结构与视觉

**Files:**
- Rewrite: `frontend/src/views/ContractsView.vue`
- Create: `frontend/src/components/contracts/ContractTopNav.vue`
- Create: `frontend/src/components/contracts/ContractListPanel.vue`
- Create: `frontend/src/components/contracts/ContractFormPanel.vue`
- Create: `frontend/src/components/contracts/ContractSummaryPanel.vue`
- Create: `frontend/src/components/contracts/ContractDetailPanel.vue`
- Create: `frontend/src/components/contracts/FixedRentRebatePanel.vue`
- Create: `frontend/src/services/contracts.ts`
- Create: `frontend/src/types/contracts.ts`
- Create: `frontend/src/views/contracts/contract-workspace.spec.ts`

**Interfaces:**
- Consumes: Task 3—6 的草稿、预览、确认、附件、详情和固定退差接口。
- Produces: 原型风格的四页签合同工作区。

- [ ] **Step 1: 写失败的组件测试**

覆盖顶部四项导航、无阶梯文字、必填红星、普通管理员无提成、未选合同时详情提示、草稿载荷和确认载荷。

```ts
expect(wrapper.text()).toContain('合同列表');
expect(wrapper.text()).toContain('固定月租退差');
expect(wrapper.text()).not.toContain('自定义弹性阶梯');
expect(wrapper.findAll('.is-required').length).toBeGreaterThan(0);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --prefix frontend run test:unit -- src/views/contracts/contract-workspace.spec.ts
```

Expected: FAIL，组件不存在或旧页面仍显示阶梯计价。

- [ ] **Step 3: 实现 API 类型和服务**

集中定义 `ContractFormModel`、`ContractSummary`、`ContractDetail` 和 API 方法，禁止组件直接拼接散乱 URL。

- [ ] **Step 4: 实现顶部导航和合同列表**

导航样式复制原型的胶囊、吸顶、激活态；列表支持合同号/纸质编号/房源/承租人搜索、状态和房源筛选，并保留状态到组件内工作区。

- [ ] **Step 5: 实现固定月租表单和摘要**

使用原型两栏网格、卡片、22px 页标题、16px 卡片标题、14px 表单文字、统一 38px 控件高度。必填红星由 Element Plus `rules` 驱动，不手写装饰性星号。

- [ ] **Step 6: 实现草稿、预览、附件和确认交互**

草稿失败保留表单；预览请求使用 300ms 防抖；确认成功切换到详情；错误自动滚动到首个无效字段。所有日期选择器设置中文 locale。

- [ ] **Step 7: 实现合同详情和固定月租退差**

详情标签为合同概况、租金账单、收款记录、合同成员、附件和变更记录。固定月租退差复用现有 API，但只显示固定合同和可关联账单。

- [ ] **Step 8: 运行前端测试和构建**

Run:

```powershell
npm --prefix frontend run test:unit
npm --prefix frontend run build
```

Expected: 全部测试通过，生产构建成功；允许现有大 chunk 警告，但不得出现 TypeScript 错误。

- [ ] **Step 9: 提交**

```powershell
git add frontend/src/views/ContractsView.vue frontend/src/components/contracts frontend/src/services/contracts.ts frontend/src/types/contracts.ts frontend/src/views/contracts/contract-workspace.spec.ts
git commit -m "feat: redesign fixed contract workspace"
```

---

### Task 9: 导航、响应式与跨模块回归

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/style.css`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/router/payments-routing.spec.ts`
- Create: `frontend/src/router/contracts-routing.spec.ts`
- Modify: `frontend/src/views/DashboardView.vue` only if the existing user change can be preserved without overlap

**Interfaces:**
- Consumes: 合同工作区内部页签状态和既有全局侧边栏。
- Produces: 无阶梯入口、移动端可用、旧合同链接可正确落到详情页。

- [ ] **Step 1: 写失败的路由测试**

断言 `/contracts` 可接受 `tab`、`contractId` 查询参数；旧 `/pricing-rebates` 重定向到 `/contracts?tab=fixed-rebate`；导航不含“阶梯退差”。

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npm --prefix frontend run test:unit -- src/router/contracts-routing.spec.ts
```

- [ ] **Step 3: 实现路由兼容与响应式样式**

桌面宽度保持原型两栏；小于 1100px 时摘要移到表单下方；小于 760px 时表单单列、顶部导航横向滚动，操作按钮保持可点击。

- [ ] **Step 4: 处理 Dashboard 文案**

仅将已有“阶梯退差待审批”文案改为“固定月租退差待审批”，保留用户当前 Dashboard 的其他未提交修改；如发生重叠则停止并报告。

- [ ] **Step 5: 运行回归并提交**

Run:

```powershell
npm --prefix frontend run test:unit
npm --prefix frontend run build
```

```powershell
git add frontend/src/App.vue frontend/src/style.css frontend/src/router/index.ts frontend/src/router/contracts-routing.spec.ts frontend/src/router/payments-routing.spec.ts
git commit -m "fix: align navigation with fixed contracts"
```

如安全修改了 Dashboard，再单独暂存该文件并核对 diff 后提交，不得带入无关改动。

---

### Task 10: 全量验证、测试环境与验收记录

**Files:**
- Create: `docs/fixed-contract-management-acceptance.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: 所有前述任务。
- Produces: 可复现的测试结果、测试环境和线上删除前置清单。

- [ ] **Step 1: 执行数据库验证**

Run:

```powershell
npm --prefix backend run prisma:validate
npm --prefix backend run prisma:generate
```

Expected: schema valid，客户端生成成功。

- [ ] **Step 2: 执行后端验证**

Run:

```powershell
npm --prefix backend run lint:check
npm --prefix backend run build
npm --prefix backend test -- --runInBand
```

Expected: 0 个失败测试、0 个 Lint 错误、构建成功。

- [ ] **Step 3: 执行接口测试**

加载 `deploy/.env.test`，构造本地测试 `DATABASE_URL` 后运行：

```powershell
npm --prefix backend run test:e2e -- --runInBand
```

Expected: 登录、合同草稿、确认、附件、固定退差、阶梯拒绝和权限测试全部通过。

- [ ] **Step 4: 执行前端验证**

Run:

```powershell
npm --prefix frontend run test:unit
npm --prefix frontend run build
```

Expected: Vitest 全部通过，构建成功。

- [ ] **Step 5: 重建测试环境并应用结构 migration**

Run:

```powershell
docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.yml up -d --build api web
docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.yml ps
```

Expected: mysql、api、web 均 healthy/running，测试入口为 `http://localhost:15173/contracts`。

- [ ] **Step 6: 创建测试专用合同并浏览器验收**

验证草稿、确认、合同编号、账单预览、附件、提成权限、合同详情、固定月租退差、顶部导航、中文日期和移动布局。测试数据名称加“测试专用”，不混入生产数据。

- [ ] **Step 7: 运行历史清理预检**

只运行 `preflight`，记录待删除数量；没有新的单独授权和成功备份时不得运行 `execute`。

- [ ] **Step 8: 更新验收文档和 README**

记录修改文件、测试命令、准确结果、测试地址、未执行的生产历史删除及上线前置条件。

- [ ] **Step 9: 最终提交**

```powershell
git add README.md docs/fixed-contract-management-acceptance.md
git commit -m "docs: record fixed contract management acceptance"
```
