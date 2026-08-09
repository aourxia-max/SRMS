# 合同编号自动生成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建固定月租或阶梯计价合同时，由后端生成 `HT-{全局序号}-{开始日期}-{完整房号}` 格式的唯一合同编号，并移除前端手工编号入口。

**Architecture:** 新增无状态合同编号生成器，负责日期、房号规范化和 40 字符长度保护。合同服务在原事务内先写入临时唯一编号取得自增 ID，再更新最终编号；后续账单和房态历史只使用最终编号。DTO 采用白名单拒绝客户端提交 `contractNo`，历史数据与数据库结构保持不变。

**Tech Stack:** NestJS 11、Prisma 7、MySQL、Jest、Vue 3、TypeScript、Element Plus。

## Global Constraints

- 业务基线继续遵守 SRMS-RB-1.0。
- 编号格式固定为 `HT-{六位合同序号}-{合同开始日期}-{完整房号}`。
- 合同 ID 超过六位时保留完整数字。
- `contract_no` 保持 `VARCHAR(40)` 和唯一约束，不新增 migration。
- 不修改历史合同及账单编号，不改变合同确认、计费、优惠和权限规则。
- 自动编号只在后端生成，客户端不得覆盖。

---

### Task 1: 合同编号生成器

**Files:**
- Create: `backend/src/contracts/contract-number.ts`
- Test: `backend/src/contracts/contract-number.spec.ts`

**Interfaces:**
- Produces: `buildContractNumber(contractId: number, startDate: Date, fullHouseNo: string): string`
- Produces: `buildTemporaryContractNumber(): string`

- [ ] **Step 1: 写失败测试**

覆盖以下手工推导结果：`123` 补零为 `000123`；`1234567` 不截断；UTC 日期输出 `20260804`；房号移除空白、连字符和斜杠；最终字符串不超过 40 个字符且仍以唯一 ID 段开头；连续临时编号不同且不超过 40 字符。

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `npm --prefix backend test -- contract-number.spec.ts --runInBand`

Expected: FAIL，因为 `contract-number.ts` 尚不存在。

- [ ] **Step 3: 实现最小生成逻辑**

```ts
export function buildContractNumber(
  contractId: number,
  startDate: Date,
  fullHouseNo: string,
): string;

export function buildTemporaryContractNumber(): string;
```

房号只保留 Unicode 字母、数字和中文字符；用 `HT-`、补零 ID、`YYYYMMDD` 拼接后，按 `40 - 固定前缀长度` 截取房号。临时编号使用进程唯一的 UUID，并保持 40 字符内。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix backend test -- contract-number.spec.ts --runInBand`

---

### Task 2: 合同创建事务使用最终编号

**Files:**
- Modify: `backend/src/contracts/contracts.service.ts`
- Modify: `backend/src/contracts/contracts.service.spec.ts`

**Interfaces:**
- Consumes: `buildContractNumber`、`buildTemporaryContractNumber`
- Changes: `createFixedContract(input)` 和 `createTieredContract(input)` 不再接收 `contractNo`

- [ ] **Step 1: 写固定月租失败测试**

模拟房源 `fullHouseNo: '1栋601'`、合同 ID `123`，断言合同先以临时编号创建、随后更新为 `HT-000123-20260804-1栋601`，账单编号与房态历史使用最终编号，返回数据也包含最终编号。

- [ ] **Step 2: 运行测试并确认旧代码因仍读取客户端编号而失败**

Run: `npm --prefix backend test -- contracts.service.spec.ts --runInBand`

- [ ] **Step 3: 实现固定月租事务改造并使测试通过**

在同一 Prisma 事务内：查询包含 `fullHouseNo` 的房源；创建临时编号合同；生成并更新最终编号；用最终编号生成账单、历史说明和返回值。

- [ ] **Step 4: 写阶梯合同失败测试并实现同一规则**

断言阶梯合同最终编号、阶梯账单编号和房态历史均不含临时编号。

- [ ] **Step 5: 运行合同服务测试**

Run: `npm --prefix backend test -- contracts.service.spec.ts --runInBand`

Expected: PASS。

---

### Task 3: DTO 白名单与接口边界

**Files:**
- Modify: `backend/src/contracts/dto/create-fixed-contract.dto.ts`
- Create or modify: `backend/test/contracts.e2e-spec.ts`

**Interfaces:**
- `POST /api/contracts/fixed` 和 `POST /api/contracts/tiered` 请求体不含 `contractNo`
- 客户端额外提交 `contractNo` 时返回 400

- [ ] **Step 1: 写失败接口测试**

分别验证缺少 `contractNo` 的合法请求能进入创建服务，以及额外提供 `contractNo` 被全局 `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` 拒绝。

- [ ] **Step 2: 运行接口测试确认失败**

Run: `npm --prefix backend run test:e2e -- contracts.e2e-spec.ts --runInBand`

- [ ] **Step 3: 从 DTO 删除 `contractNo` 并更新服务输入类型**

保留现有日期、金额、房源、租户、阶梯和优惠校验不变。

- [ ] **Step 4: 运行接口测试确认通过**

Run: `npm --prefix backend run test:e2e -- contracts.e2e-spec.ts --runInBand`

---

### Task 4: 前端移除手工合同编号

**Files:**
- Modify: `frontend/src/views/ContractsView.vue`

**Interfaces:**
- 创建请求不再发送 `contractNo`
- 表单显示只读文案“保存后由系统自动生成”

- [ ] **Step 1: 删除表单状态、必填判断和请求载荷中的 `contractNo`**

- [ ] **Step 2: 将原输入框替换为只读说明**

```vue
<el-form-item label="合同编号">
  <el-text type="info">保存后由系统自动生成</el-text>
</el-form-item>
```

- [ ] **Step 3: 构建验证**

Run: `npm --prefix frontend run build`

Expected: PASS，创建成功后现有 `load()` 刷新列表并显示后端编号。

---

### Task 5: 全量验证与本地验收

**Files:**
- Modify only if verification exposes a regression.

- [ ] **Step 1: 后端质量检查**

Run: `npm --prefix backend run lint:check`

Run: `npm --prefix backend test -- --runInBand`

Run: `npm --prefix backend run test:e2e -- --runInBand`

Run: `npm --prefix backend run build`

Run: `npm --prefix backend run prisma:validate`

- [ ] **Step 2: 前端构建**

Run: `npm --prefix frontend run build`

- [ ] **Step 3: 本地 `srms_test` 验收**

重建 API 和 Web 后，在测试环境创建一份不含 `contractNo` 的测试合同，确认合同列表展示新格式、账单编号引用最终合同编号，并确认旧合同编号未变化。

- [ ] **Step 4: 检查变更范围**

Run: `git status --short`

Run: `git diff --check`

确认不包含 `frontend/src/views/DashboardView.vue`、部署 bundle 或 `deploy/test-data/`。
