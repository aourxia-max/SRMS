# 收款、合同附件与状态体验优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现收款账单勾选自动合计、合同彩色状态标签、合同图片附件安全在线预览，以及合同与房态相关状态全中文显示。

**Architecture:** 保留现有后端接口、数据库枚举和权限模型，新增纯前端金额计算及状态视觉辅助函数。合同附件预览复用受保护的 Blob 下载接口，由合同工作区管理对象地址和预览弹窗，合同详情组件只发出预览意图。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Axios、Vitest、Vue Test Utils、NestJS、Prisma

**Spec:** `docs/superpowers/specs/2026-08-21-payment-contract-attachment-status-ux-design.md`

## Global Constraints

- 不改变冻结金额口径、合同生命周期、房态规则、权限模型和数据库结构。
- 用户手动修改收款金额后，再次改变账单选择时必须重新自动计算；最后一次选择后仍可手动修改。
- 图片预览必须复用现有认证请求，不创建公开附件 URL，不把令牌写入 URL。
- 不新增合同、账单、收款或房态状态；接口和数据库继续使用原英文枚举。
- 不提供 PDF 在线预览；HEIC 等浏览器不支持的图片保留下载。
- 不修改或提交现有无关未跟踪文件和测试数据。

---

### Task 1: 收款账单选择自动合计

**Files:**
- Modify: `frontend/src/views/payments/payment-collection.ts`
- Test: `frontend/src/views/payments/payment-collection.spec.ts`
- Modify: `frontend/src/views/payments/PaymentCollectView.vue`

**Interfaces:**
- Consumes: `RentBill.id`、`RentBill.outstandingAmount`、当前 `selectedBillIds`。
- Produces: `selectedBillsOutstandingAmount(bills, selectedIds): string`，返回两位小数的建议收款金额。

- [ ] **Step 1: 写入失败的金额合计测试**

在 `payment-collection.spec.ts` 导入 `selectedBillsOutstandingAmount`，增加：

```ts
it('按勾选账单自动合计未收金额并保留两位小数', () => {
  expect(selectedBillsOutstandingAmount(bills, [11])).toBe('1000.00')
  expect(selectedBillsOutstandingAmount(bills, [11, 12])).toBe('1800.00')
  expect(selectedBillsOutstandingAmount(bills, [12, 13])).toBe('1700.00')
  expect(selectedBillsOutstandingAmount(bills, [])).toBe('')
})

it('忽略不存在的账单并避免字符串拼接', () => {
  expect(selectedBillsOutstandingAmount(bills, [11, 999])).toBe('1000.00')
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test:unit -- frontend/src/views/payments/payment-collection.spec.ts`

Expected: FAIL，提示 `selectedBillsOutstandingAmount` 未导出。

- [ ] **Step 3: 实现最小金额合计函数**

在 `payment-collection.ts` 增加：

```ts
export function selectedBillsOutstandingAmount(
  bills: Pick<RentBill, 'id' | 'outstandingAmount'>[],
  selectedIds: number[],
) {
  if (!selectedIds.length) return ''
  const selected = new Set(selectedIds)
  return bills
    .filter((bill) => selected.has(bill.id))
    .reduce((sum, bill) => sum + Math.max(0, Number(bill.outstandingAmount) || 0), 0)
    .toFixed(2)
}
```

- [ ] **Step 4: 把账单选择接入自动金额**

在 `PaymentCollectView.vue`：

```ts
import {
  allocationSummary,
  eligibleAdjustmentBillIds,
  isPrefixSelection,
  nextSuggestedPaymentAmount,
  selectedBillsOutstandingAmount,
} from './payment-collection'

function applySelectedBillsAmount(ids: number[]) {
  const original = selectedBillsOutstandingAmount(bills.value, ids)
  const adjustmentAmount = adjustment.enabled ? Math.max(0, Number(adjustment.amount) || 0) : 0
  const suggested = original ? Math.max(0, Number(original) - adjustmentAmount).toFixed(2) : ''
  form.amount = suggested
  autoSuggestedPaymentAmount.value = suggested
}
```

`selectContract()` 加载后保留默认首期选择，并调用 `applySelectedBillsAmount(selectedBillIds.value)`；`toggleBill()` 在权限校验通过、写入 `selectedBillIds` 后调用同一函数。不要监听 `form.amount` 来自动回写，确保用户最后一次手工修改不会立即被覆盖。

- [ ] **Step 5: 运行收款单元测试和前端构建**

Run: `npm --prefix frontend run test:unit -- frontend/src/views/payments/payment-collection.spec.ts`

Expected: PASS。

Run: `npm --prefix frontend run build`

Expected: PASS，无 TypeScript 错误。

- [ ] **Step 6: 提交 Task 1**

```bash
git add frontend/src/views/payments/payment-collection.ts frontend/src/views/payments/payment-collection.spec.ts frontend/src/views/payments/PaymentCollectView.vue
git commit -m "feat: auto-calculate selected payment bills"
```

---

### Task 2: 集中合同状态颜色与安全中文兜底

**Files:**
- Modify: `frontend/src/utils/status-labels.ts`
- Test: `frontend/src/utils/status-labels.spec.ts`

**Interfaces:**
- Consumes: 后端合同状态字符串。
- Produces: `contractStatusLabel(value): string` 和 `contractStatusTagType(value): 'info' | 'warning' | 'success' | 'danger' | 'primary'`。

- [ ] **Step 1: 写入失败的合同标签颜色及未知状态测试**

```ts
import { contractStatusLabel, contractStatusTagType } from './status-labels'

it('为合同状态提供统一中文和颜色', () => {
  expect(contractStatusLabel('DRAFT')).toBe('草稿')
  expect(contractStatusTagType('DRAFT')).toBe('info')
  expect(contractStatusTagType('PENDING_START')).toBe('warning')
  expect(contractStatusTagType('ACTIVE')).toBe('success')
  expect(contractStatusTagType('PENDING_CHECKOUT')).toBe('warning')
  expect(contractStatusTagType('ENDED')).toBe('primary')
  expect(contractStatusTagType('VOIDED')).toBe('danger')
  expect(contractStatusLabel('UNEXPECTED')).toBe('未知状态')
})
```

- [ ] **Step 2: 运行状态测试并确认失败**

Run: `npm --prefix frontend run test:unit -- frontend/src/utils/status-labels.spec.ts`

Expected: FAIL，缺少 `contractStatusTagType`，未知合同状态仍显示英文。

- [ ] **Step 3: 实现集中颜色映射和合同安全兜底**

```ts
export type StatusTagType = 'info' | 'warning' | 'success' | 'danger' | 'primary'

const contractStatusTagTypes: Record<string, StatusTagType> = {
  DRAFT: 'info',
  PENDING_START: 'warning',
  ACTIVE: 'success',
  PENDING_CHECKOUT: 'warning',
  ENDED: 'primary',
  VOIDED: 'danger',
}

export const contractStatusLabel = (value?: string | null) => safeBusinessLabel(contractStatusLabels, value)
export const contractStatusTagType = (value?: string | null): StatusTagType =>
  value ? contractStatusTagTypes[value] ?? 'info' : 'info'
```

保持其他既有映射接口不变，避免影响已使用页面。

- [ ] **Step 4: 运行状态测试**

Run: `npm --prefix frontend run test:unit -- frontend/src/utils/status-labels.spec.ts`

Expected: PASS。

- [ ] **Step 5: 提交 Task 2**

```bash
git add frontend/src/utils/status-labels.ts frontend/src/utils/status-labels.spec.ts
git commit -m "feat: centralize contract status tag colors"
```

---

### Task 3: 合同列表、详情和房态历史统一中文状态

**Files:**
- Modify: `frontend/src/components/contracts/ContractListPanel.vue`
- Modify: `frontend/src/components/contracts/ContractDetailPanel.vue`
- Modify: `frontend/src/views/PropertiesView.vue`
- Test: `frontend/src/views/contracts/contract-workspace.spec.ts`
- Create: `frontend/src/views/properties-status-history.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `contractStatusLabel`、`contractStatusTagType`，现有 `rentBillStatusLabel`、`paymentStatusLabel`、`roomStatusLabel`。
- Produces: 所有指定页面均只显示中文业务状态；合同列表与详情标签颜色一致。

- [ ] **Step 1: 增加失败的合同组件状态测试**

在 `contract-workspace.spec.ts` 中挂载列表和详情，断言：

```ts
expect(wrapper.text()).toContain('履行中')
expect(wrapper.text()).toContain('已逾期')
expect(wrapper.text()).toContain('已确认')
expect(wrapper.text()).not.toContain('ACTIVE')
expect(wrapper.text()).not.toContain('OVERDUE')
expect(wrapper.text()).not.toContain('CONFIRMED')
expect(wrapper.find('[data-test="contract-status-tag"]').classes()).toContain('el-tag--success')
```

列表测试应覆盖 `DRAFT`、`PENDING_START`、`ACTIVE`、`PENDING_CHECKOUT`、`ENDED`、`VOIDED` 的中文文本和 `data-test="contract-status-<id>"` 标签类型。

- [ ] **Step 2: 增加失败的房态历史测试**

创建 `properties-status-history.spec.ts`，模拟 `/properties/rooms/:id/history` 返回：

```ts
[{ fromStatus: 'EMPTY', toStatus: 'PENDING_MOVE_IN', changeReason: null, changedAt: '2026-08-21T10:00:00.000Z' }]
```

触发“历史”后断言页面包含“空置”“待入住”，不包含 `EMPTY` 和 `PENDING_MOVE_IN`。

- [ ] **Step 3: 运行组件测试并确认失败**

Run: `npm --prefix frontend run test:unit -- frontend/src/views/contracts/contract-workspace.spec.ts frontend/src/views/properties-status-history.spec.ts`

Expected: FAIL，当前账单、收款和房态历史仍显示原枚举，列表颜色未统一。

- [ ] **Step 4: 修改合同列表与详情**

`ContractListPanel.vue` 删除本地 `statusLabel`，改为：

```ts
import { contractStatusLabel, contractStatusTagType, contractStatusLabels } from '../../utils/status-labels'
```

筛选项使用 `contractStatusLabels`；状态列使用：

```vue
<el-tag
  :data-test="`contract-status-${row.id}`"
  :type="contractStatusTagType(row.status)"
  effect="light"
>
  {{ contractStatusLabel(row.status) }}
</el-tag>
```

`ContractDetailPanel.vue` 导入 `contractStatusTagType`、`rentBillStatusLabel`、`paymentStatusLabel`，详情头部标签增加 `data-test="contract-status-tag"` 与 `:type="contractStatusTagType(contract.status)"`；租金账单和收款记录状态列用模板调用对应中文函数。

- [ ] **Step 5: 修改房态历史**

`PropertiesView.vue` 导入 `roomStatusLabel`，把历史表格的原状态和新状态列改为：

```vue
<el-table-column label="原状态">
  <template #default="{ row }">{{ roomStatusLabel(row.fromStatus) }}</template>
</el-table-column>
<el-table-column label="新状态">
  <template #default="{ row }">{{ roomStatusLabel(row.toStatus) }}</template>
</el-table-column>
```

- [ ] **Step 6: 运行组件测试与前端构建**

Run: `npm --prefix frontend run test:unit -- frontend/src/views/contracts/contract-workspace.spec.ts frontend/src/views/properties-status-history.spec.ts frontend/src/utils/status-labels.spec.ts`

Expected: PASS。

Run: `npm --prefix frontend run build`

Expected: PASS。

- [ ] **Step 7: 提交 Task 3**

```bash
git add frontend/src/components/contracts/ContractListPanel.vue frontend/src/components/contracts/ContractDetailPanel.vue frontend/src/views/PropertiesView.vue frontend/src/views/contracts/contract-workspace.spec.ts frontend/src/views/properties-status-history.spec.ts
git commit -m "feat: localize contract and room history statuses"
```

---

### Task 4: 合同图片附件安全在线预览

**Files:**
- Modify: `frontend/src/services/contracts.ts`
- Create: `frontend/src/services/contracts-attachment.spec.ts`
- Modify: `frontend/src/components/contracts/ContractDetailPanel.vue`
- Modify: `frontend/src/views/contracts/ContractsWorkspace.vue`
- Test: `frontend/src/views/contracts/contract-workspace.spec.ts`

**Interfaces:**
- Consumes: 现有 `downloadContractFile(contractId, fileId): Promise<Blob>` 和 `ContractFile.mimeType`。
- Produces: `isPreviewableContractImage(file): boolean`；详情组件新增 `preview` 事件；工作区维护 `previewUrl`、`previewName`、`previewOpen`。

- [ ] **Step 1: 写入失败的可预览类型测试**

```ts
import { isPreviewableContractImage } from './contracts'

it('只允许浏览器支持的合同图片在线预览', () => {
  expect(isPreviewableContractImage({ mimeType: 'image/jpeg' })).toBe(true)
  expect(isPreviewableContractImage({ mimeType: 'image/png' })).toBe(true)
  expect(isPreviewableContractImage({ mimeType: 'image/webp' })).toBe(true)
  expect(isPreviewableContractImage({ mimeType: 'image/gif' })).toBe(true)
  expect(isPreviewableContractImage({ mimeType: 'image/heic' })).toBe(false)
  expect(isPreviewableContractImage({ mimeType: 'application/pdf' })).toBe(false)
})
```

- [ ] **Step 2: 写入失败的附件按钮测试**

在 `contract-workspace.spec.ts` 增加 JPEG 与 PDF 两条附件，进入附件页签后断言：JPEG 同时有预览和下载按钮，PDF 只有下载按钮；点击 JPEG 预览按钮发出 `preview` 事件并携带当前文件。

- [ ] **Step 3: 运行测试并确认失败**

Run: `npm --prefix frontend run test:unit -- frontend/src/services/contracts-attachment.spec.ts frontend/src/views/contracts/contract-workspace.spec.ts`

Expected: FAIL，缺少类型判断和预览事件。

- [ ] **Step 4: 实现预览类型判断和详情按钮**

在 `contracts.ts` 增加：

```ts
const previewableContractImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

export function isPreviewableContractImage(file: Pick<ContractFile, 'mimeType'>) {
  return previewableContractImageTypes.has(file.mimeType.toLowerCase())
}
```

`ContractDetailPanel.vue` 新增 `preview: [file: ContractFile]` 事件。附件操作列宽度适配两个按钮，并仅对 `isPreviewableContractImage(row)` 为真的文件展示 `data-test="preview-contract-file-<id>"` 按钮；下载按钮始终保留。

- [ ] **Step 5: 在合同工作区实现 Blob 预览生命周期**

`ContractsWorkspace.vue` 增加：

```ts
const previewOpen = ref(false)
const previewLoading = ref(false)
const previewUrl = ref('')
const previewName = ref('')

function releasePreviewUrl() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
}

async function previewFile(file: ContractFile) {
  if (!selectedContractId.value) return
  releasePreviewUrl()
  previewLoading.value = true
  previewName.value = file.originalName
  previewOpen.value = true
  try {
    const blob = await downloadContractFile(selectedContractId.value, file.id)
    previewUrl.value = URL.createObjectURL(blob)
  } catch (error) {
    previewOpen.value = false
    ElMessage.error(errorMessage(error, '合同附件预览失败，请稍后重试'))
  } finally {
    previewLoading.value = false
  }
}

function closePreview() {
  previewOpen.value = false
  releasePreviewUrl()
}

onBeforeUnmount(releasePreviewUrl)
```

给 `ContractDetailPanel` 绑定 `@preview="previewFile"`，在工作区加入 Element Plus 图片预览弹窗；关闭时调用 `closePreview`，加载中显示骨架或加载状态，图片使用 `previewUrl`，不拼接后端公开地址。

- [ ] **Step 6: 补充对象地址释放测试**

在合同工作区测试中 mock `downloadContractFile`、`URL.createObjectURL` 和 `URL.revokeObjectURL`，验证：预览成功后显示临时地址；关闭、切换附件和卸载时调用 `URL.revokeObjectURL`；请求失败时显示中文错误且不残留预览地址。

- [ ] **Step 7: 运行附件与合同测试**

Run: `npm --prefix frontend run test:unit -- frontend/src/services/contracts-attachment.spec.ts frontend/src/views/contracts/contract-workspace.spec.ts`

Expected: PASS。

- [ ] **Step 8: 提交 Task 4**

```bash
git add frontend/src/services/contracts.ts frontend/src/services/contracts-attachment.spec.ts frontend/src/components/contracts/ContractDetailPanel.vue frontend/src/views/contracts/ContractsWorkspace.vue frontend/src/views/contracts/contract-workspace.spec.ts
git commit -m "feat: preview protected contract images"
```

---

### Task 5: 全量验证与验收记录

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-payment-contract-attachment-status-ux-design.md`

**Interfaces:**
- Consumes: Tasks 1–4 的完整实现和测试。
- Produces: 可追溯的测试结果及已实施状态。

- [ ] **Step 1: 执行前端完整测试**

Run: `npm --prefix frontend run test:unit`

Expected: 所有前端测试 PASS。

- [ ] **Step 2: 执行前端构建**

Run: `npm --prefix frontend run build`

Expected: PASS；仅允许现有 Vite chunk-size 提示，不允许 TypeScript 或构建错误。

- [ ] **Step 3: 执行后端完整验证**

Run: `npm --prefix backend run lint`

Run: `npm --prefix backend run test`

Run: `npm --prefix backend run test:e2e`

Run: `npm --prefix backend run build`

Run: `npm --prefix backend exec prisma validate`

Expected: 全部 PASS。尽管本次预计不改后端，仍执行完整回归以验证接口兼容性。

- [ ] **Step 4: 检查差异和敏感信息**

Run: `git diff --check`

Run: `git status --short`

Expected: 无空白错误；不包含 `.env`、密钥、密码、生产备份或 `deploy/test-data/`。

- [ ] **Step 5: 更新规格实施状态**

把规格文档头部状态从“已确认设计，待实施”改为“已实施并通过自动化验证”，并记录实际测试套件数量；不得在测试没有真实通过时填写通过。

- [ ] **Step 6: 提交验收记录**

```bash
git add docs/superpowers/specs/2026-08-21-payment-contract-attachment-status-ux-design.md
git commit -m "docs: record payment and contract UX verification"
```

- [ ] **Step 7: 最终提交范围审计**

Run: `git log --oneline --decorate -8`

Run: `git diff origin/main...HEAD --stat`

Expected: 只包含本计划、规格及本次功能相关文件；现有用户未跟踪内容保持未提交。
