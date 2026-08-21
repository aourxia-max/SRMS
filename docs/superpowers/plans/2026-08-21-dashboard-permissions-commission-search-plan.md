# 驾驶舱、权限、提成与房源搜索实施计划

> **执行要求：** 严格按测试驱动方式逐项实施；每一项先观察测试失败，再写最小实现并确认测试通过。不得修改冻结的金额、合同、房态或提成业务口径。

**目标：** 完成今日待办房号弹窗、驾驶舱财务模块权限、楼栋与房源增删权限、合同详情提成维护、中文状态显示，以及按当前承租人搜索房源。

**技术方案：** 保持现有 NestJS + Prisma + Vue 3 + Pinia + Element Plus 架构。后端负责权限强制校验、当前承租人关系过滤和待审批房源摘要；前端仅根据后端安全数据呈现交互，并复用现有提成接口。无数据库 migration。

**技术栈：** NestJS、Prisma、Jest、Vue 3、TypeScript、Element Plus、Vitest。

---

## 任务 1：锁定后端房源权限矩阵

**文件：**

- 修改：`backend/src/properties/properties.controller.spec.ts`
- 修改：`backend/src/properties/properties.controller.ts`

### 步骤 1：编写失败测试

在控制器测试中读取方法上的 `ROLES_KEY` 元数据并验证：

- 新增楼栋、新增房源、删除房源只允许 `SUPER_ADMIN`；
- 编辑楼栋、编辑房源、修改房态仍允许 `SUPER_ADMIN`、`ADMIN`。

### 步骤 2：运行测试并确认失败

```powershell
npm --prefix backend test -- properties.controller.spec.ts --runInBand
```

预期：新增与删除接口仍包含 `ADMIN`，测试失败。

### 步骤 3：最小实现

只收紧三个写接口的 `@Roles()`；不改变编辑接口、DTO 或 Service 业务逻辑。

### 步骤 4：运行测试并确认通过

```powershell
npm --prefix backend test -- properties.controller.spec.ts --runInBand
```

### 步骤 5：提交

```powershell
git add backend/src/properties/properties.controller.ts backend/src/properties/properties.controller.spec.ts
git commit -m "fix: restrict property creation and deletion"
```

## 任务 2：修复按当前承租人搜索房源

**文件：**

- 修改：`backend/src/properties/properties.controller.spec.ts`
- 修改：`backend/src/properties/properties.controller.ts`

### 步骤 1：编写失败测试

扩展现有关键词组合测试，断言 Prisma `where.OR` 同时包含：

- 房源原有编号、登记姓名、登记电话条件；
- `contractMembers.some` 下的承租人姓名与电话；
- `isCurrent: true`；
- 合同 `deletedAt: null`；
- 合同状态仅为 `PENDING_START`、`ACTIVE`、`PENDING_CHECKOUT`。

另加空关键词测试，确认不会添加成员关系过滤。

### 步骤 2：运行测试并确认失败

```powershell
npm --prefix backend test -- properties.controller.spec.ts --runInBand
```

### 步骤 3：最小实现

在房源查询的关键词 `OR` 中加入两条当前合同成员关联条件，返回结构保持不变，不包含证件字段。

### 步骤 4：运行测试并确认通过

```powershell
npm --prefix backend test -- properties.controller.spec.ts --runInBand
```

### 步骤 5：提交

```powershell
git add backend/src/properties/properties.controller.ts backend/src/properties/properties.controller.spec.ts
git commit -m "fix: search rooms by current tenant"
```

## 任务 3：为今日待办提供审批房源摘要

**文件：**

- 修改：`backend/src/dashboard/rent-collection-overview.spec.ts`
- 修改：`backend/src/dashboard/dashboard.service.ts`

### 步骤 1：编写失败测试

构造多类待审批记录，覆盖同一房源多条记录、缺失房源和不同房源，断言：

- `approvalRooms` 按房源去重；
- `count` 正确累计；
- `types` 为去重后的中文业务类型；
- 只包含 `roomId`、`fullHouseNo`、`types`、`count`；
- 普通管理员响应仍不含 `arrearsTotal`、`rentCollectionOverview`。

### 步骤 2：运行测试并确认失败

```powershell
npm --prefix backend test -- rent-collection-overview.spec.ts --runInBand
```

### 步骤 3：最小实现

把三类待审批计数查询调整为只额外选择合同房源的最小字段，汇总生成 `approvalRooms`。保留原 `approvals` 计数和超级管理员财务统计条件。

### 步骤 4：运行测试并确认通过

```powershell
npm --prefix backend test -- rent-collection-overview.spec.ts --runInBand
```

### 步骤 5：提交

```powershell
git add backend/src/dashboard/dashboard.service.ts backend/src/dashboard/rent-collection-overview.spec.ts
git commit -m "feat: expose minimal approval room summaries"
```

## 任务 4：实现驾驶舱待办房号弹窗和财务模块权限

**文件：**

- 新增：`frontend/src/views/dashboard-view.spec.ts`
- 修改：`frontend/src/views/DashboardView.vue`

### 步骤 1：编写失败测试

挂载驾驶舱并模拟接口数据，验证：

- 点击五类待办打开弹窗而非立即跳转；
- 房号按房源去重，并显示类型和数量；
- “查看房源”进入 `/properties/:id`；
- “前往处理”进入原目标路由；
- 缺失房源安全忽略并显示空状态；
- `ADMIN`、`VISITOR` 完全不渲染“本月租金收缴概览”；
- `SUPER_ADMIN` 正常显示该模块。

### 步骤 2：运行测试并确认失败

```powershell
npm --prefix frontend run test:unit -- src/views/dashboard-view.spec.ts
```

### 步骤 3：最小实现

在 `DashboardView.vue` 中：

- 为待办项增加可计算房源列表；
- 新增弹窗状态、去重转换和安全跳转函数；
- 用 `el-dialog` 展示房源；
- 将整个收缴概览卡片包在 `isSuper` 条件中，删除普通角色摘要分支。

### 步骤 4：运行测试并确认通过

```powershell
npm --prefix frontend run test:unit -- src/views/dashboard-view.spec.ts
```

### 步骤 5：提交

```powershell
git add frontend/src/views/DashboardView.vue frontend/src/views/dashboard-view.spec.ts
git commit -m "feat: show dashboard todo rooms securely"
```

## 任务 5：拆分前端房源编辑与增删权限

**文件：**

- 新增：`frontend/src/views/properties-view.spec.ts`
- 修改：`frontend/src/views/PropertiesView.vue`

### 步骤 1：编写失败测试

分别以三个角色挂载房源管理页，验证：

- 超级管理员可见新增楼栋、新增房源、编辑、房态和删除；
- 普通管理员只可见编辑与房态；
- 游客均不可见写操作；
- 搜索请求继续传递经清理的 `keyword`。

### 步骤 2：运行测试并确认失败

```powershell
npm --prefix frontend run test:unit -- src/views/properties-view.spec.ts
```

### 步骤 3：最小实现

将单一 `canManage` 拆成 `canEdit` 与 `canCreateDelete`，只替换对应模板条件，不改变编辑与房态保存流程。

### 步骤 4：运行测试并确认通过

```powershell
npm --prefix frontend run test:unit -- src/views/properties-view.spec.ts
```

### 步骤 5：提交

```powershell
git add frontend/src/views/PropertiesView.vue frontend/src/views/properties-view.spec.ts
git commit -m "fix: align property actions with role permissions"
```

## 任务 6：在合同详情维护租房提成

**文件：**

- 修改：`frontend/src/views/contracts/contract-workspace.spec.ts`
- 修改：`frontend/src/components/contracts/ContractDetailPanel.vue`
- 修改：`frontend/src/views/contracts/ContractsWorkspace.vue`
- 视现有服务结构修改：`frontend/src/services/contracts.ts`

### 步骤 1：编写失败测试

验证：

- 超级管理员无提成时可打开登记弹窗并调用 `POST /commissions`；
- 已有提成时预填数据并调用 `PATCH /commissions/:id`；
- 删除前二次确认并调用 `DELETE /commissions/:id`；
- 成功后重新加载当前合同详情；
- 失败时保留弹窗内容并显示中文错误；
- 普通管理员和游客看不到提成内容与维护入口。

### 步骤 2：运行测试并确认失败

```powershell
npm --prefix frontend run test:unit -- src/views/contracts/contract-workspace.spec.ts
```

### 步骤 3：最小实现

扩展详情面板事件与提成弹窗；工作区负责调用现有接口并刷新选中合同。保持后端提成权限、校验和审计逻辑不变。

### 步骤 4：运行测试并确认通过

```powershell
npm --prefix frontend run test:unit -- src/views/contracts/contract-workspace.spec.ts
```

### 步骤 5：提交

```powershell
git add frontend/src/components/contracts/ContractDetailPanel.vue frontend/src/views/contracts/ContractsWorkspace.vue frontend/src/views/contracts/contract-workspace.spec.ts frontend/src/services/contracts.ts
git commit -m "feat: maintain commission from contract detail"
```

## 任务 7：统一房源用途与承租人状态中文显示

**文件：**

- 修改：`frontend/src/utils/status-labels.ts`
- 修改：`frontend/src/utils/status-labels.spec.ts`
- 修改：`frontend/src/views/RoomDetailView.vue`
- 修改：`frontend/src/views/TenantsView.vue`
- 修改：`frontend/src/views/tenants-view.spec.ts`

### 步骤 1：编写失败测试

为使用用途和承租人状态添加映射测试，并在页面测试中验证已知值显示中文、未知值显示“未知状态”，不显示原始英文枚举。

### 步骤 2：运行测试并确认失败

```powershell
npm --prefix frontend run test:unit -- src/utils/status-labels.spec.ts src/views/tenants-view.spec.ts
```

### 步骤 3：最小实现

在统一工具中加入显式映射函数，房源详情与承租人列表改用函数渲染。编辑表单的枚举值不变。

### 步骤 4：运行测试并确认通过

```powershell
npm --prefix frontend run test:unit -- src/utils/status-labels.spec.ts src/views/tenants-view.spec.ts
```

### 步骤 5：提交

```powershell
git add frontend/src/utils/status-labels.ts frontend/src/utils/status-labels.spec.ts frontend/src/views/RoomDetailView.vue frontend/src/views/TenantsView.vue frontend/src/views/tenants-view.spec.ts
git commit -m "fix: translate property and tenant values"
```

## 任务 8：全量验证、复审与交付

**文件：**

- 视验证结果修改上述相关文件；不得顺带修改范围外业务。

### 步骤 1：运行定向回归测试

```powershell
npm --prefix backend test -- properties.controller.spec.ts rent-collection-overview.spec.ts --runInBand
npm --prefix frontend run test:unit -- src/views/dashboard-view.spec.ts src/views/properties-view.spec.ts src/views/contracts/contract-workspace.spec.ts src/utils/status-labels.spec.ts src/views/tenants-view.spec.ts
```

### 步骤 2：运行完整自动化验证

```powershell
npm --prefix backend run lint:check
npm --prefix backend test -- --runInBand
npm --prefix backend run test:e2e -- --runInBand
npm --prefix backend run build
npm --prefix backend run prisma:validate
npm --prefix frontend run test:unit
npm --prefix frontend run build
```

### 步骤 3：本地测试环境验收

启动现有 Docker 测试环境，分别使用三个角色核对权限矩阵，并手工验证五类待办、承租人姓名/电话搜索和提成增改删。不得改动线上环境数据。

### 步骤 4：代码审查

检查：

- 后端 403 是真正的安全边界；
- 普通角色响应没有新增敏感财务字段；
- 搜索不匹配历史已结束合同；
- 提成保存后数据刷新一致；
- 未引入数据库迁移和范围外业务变更。

### 步骤 5：最终提交

若验证修复产生必要改动，按功能归属提交。确认工作树清洁并记录所有命令结果、提交列表和未解决问题，等待用户授权后再合并或推送。
