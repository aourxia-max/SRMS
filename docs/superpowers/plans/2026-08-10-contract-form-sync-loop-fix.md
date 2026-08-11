# Contract Form Sync Loop Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复新增合同选择房源后父子表单双向深度监听形成的无限更新循环，并验证全前端没有其他同类反馈结构。

**Architecture:** 保留 `ContractFormPanel` 的本地响应式表单和现有 `v-model` 接口，在父传子与子传父两条同步路径之间增加稳定内容快照。内容相同时不再重复写回；父页面真实重置或恢复草稿时仍更新本地表单。用真实父组件反馈方式的组件测试复现并锁定行为。

**Tech Stack:** Vue 3.5、TypeScript、Element Plus、Vue Test Utils、Vitest、Vite。

## Global Constraints

- 仅修改前端合同表单同步和对应测试，不修改后端、数据库、合同字段、账单计算或权限。
- 使用 SRMS-RB-1.0 及已确认的固定合同需求变更作为业务基线。
- 必须先观察回归测试失败，再写生产代码。
- 全前端相似模式扫描只修复能够证明会形成反馈循环的代码，不进行无关重构。
- 测试环境先验收，GitHub 合并后再更新线上环境。

---

### Task 1: 用真实父子反馈复现表单无限更新

**Files:**
- Modify: `frontend/src/views/contracts/contract-workspace.spec.ts`
- Test: `frontend/src/views/contracts/contract-workspace.spec.ts`

**Interfaces:**
- Consumes: `ContractFormPanel` 的 `modelValue`、`update:modelValue`、`rooms`、`tenants`、`role` 属性与事件。
- Produces: 选择房源、父页面重置和草稿恢复的回归测试。

- [ ] **Step 1: 补充 Vue 测试依赖导入和父组件反馈挂载工具**

在测试文件中增加：

```ts
import { nextTick } from 'vue'
import { emptyContractForm, type ContractDetail, type ContractFormModel } from '../../types/contracts'

const rooms = [
  { id: 8, fullHouseNo: '1栋301', roomStatus: 'VACANT' },
  { id: 22, fullHouseNo: '2栋602', roomStatus: 'PENDING_MOVE_IN' },
]

function mountContractFormWithParentFeedback(initial: ContractFormModel) {
  let updateCount = 0
  let wrapper: ReturnType<typeof mount>
  const onUpdate = async (value: ContractFormModel) => {
    updateCount += 1
    await wrapper.setProps({ modelValue: value })
  }
  wrapper = mount(ContractFormPanel, {
    props: {
      role: 'SUPER_ADMIN',
      modelValue: initial,
      rooms,
      tenants: [],
      'onUpdate:modelValue': onUpdate,
    },
    global: { plugins: [ElementPlus] },
  })
  return { wrapper, updateCount: () => updateCount }
}
```

- [ ] **Step 2: 写入选择房源不会循环的失败测试**

```ts
it('选择房源只向父页面发送一次有效更新且不会形成反馈循环', async () => {
  const form = { ...emptyContractForm(), roomId: null }
  const { wrapper, updateCount } = mountContractFormWithParentFeedback(form)
  const roomSelect = wrapper.findAllComponents(ElSelect)[0]

  await roomSelect.vm.$emit('update:modelValue', 8)
  await flushPromises()
  await nextTick()

  expect(updateCount()).toBe(1)
  expect(wrapper.props('modelValue').roomId).toBe(8)
  expect(roomSelect.props('modelValue')).toBe(8)
})
```

- [ ] **Step 3: 写入父页面重置和草稿恢复测试**

```ts
it('父页面重置或恢复草稿时只同步到子表单而不反向重复发送', async () => {
  const { wrapper, updateCount } = mountContractFormWithParentFeedback(completeForm())
  const roomSelect = wrapper.findAllComponents(ElSelect)[0]

  await wrapper.setProps({ modelValue: emptyContractForm() })
  await flushPromises()
  expect(roomSelect.props('modelValue')).toBeNull()
  expect(updateCount()).toBe(0)

  const restored = { ...completeForm(), roomId: 22 }
  await wrapper.setProps({ modelValue: restored })
  await flushPromises()
  expect(roomSelect.props('modelValue')).toBe(22)
  expect(updateCount()).toBe(0)
})
```

- [ ] **Step 4: 运行专项测试并确认 RED**

Run:

```bash
npm --prefix frontend run test:unit -- src/views/contracts/contract-workspace.spec.ts
```

Expected: 新增测试因递归更新、重复 `update:modelValue` 或更新次数大于 1 而失败；既有测试保持通过。

- [ ] **Step 5: 提交 RED 测试**

```bash
git add frontend/src/views/contracts/contract-workspace.spec.ts
git commit -m "test: reproduce contract form sync loop"
```

---

### Task 2: 为合同表单增加稳定快照同步保护

**Files:**
- Modify: `frontend/src/components/contracts/ContractFormPanel.vue`
- Test: `frontend/src/views/contracts/contract-workspace.spec.ts`

**Interfaces:**
- Consumes: `copyForm(source: ContractFormModel): ContractFormModel`。
- Produces: `contractFormSnapshot(source: ContractFormModel): string`，以及不会反馈循环的 `modelValue` 双向同步行为。

- [ ] **Step 1: 在组件中增加稳定表单快照**

紧接 `copyForm` 后增加：

```ts
const contractFormSnapshot = (source: ContractFormModel) => JSON.stringify(copyForm(source))
```

- [ ] **Step 2: 用最近快照保护父传子和子传父监听**

将现有两组监听替换为：

```ts
let lastSynchronizedSnapshot = contractFormSnapshot(form)

watch(() => props.modelValue, (next) => {
  const nextForm = copyForm(next)
  const nextSnapshot = contractFormSnapshot(nextForm)
  const currentSnapshot = contractFormSnapshot(form)
  lastSynchronizedSnapshot = nextSnapshot
  if (nextSnapshot !== currentSnapshot) Object.assign(form, nextForm)
}, { deep: true })

watch(form, () => {
  const nextForm = copyForm(form)
  const nextSnapshot = contractFormSnapshot(nextForm)
  if (nextSnapshot === lastSynchronizedSnapshot) return
  lastSynchronizedSnapshot = nextSnapshot
  emit('update:modelValue', nextForm)
}, { deep: true })
```

- [ ] **Step 3: 运行专项测试并确认 GREEN**

Run:

```bash
npm --prefix frontend run test:unit -- src/views/contracts/contract-workspace.spec.ts
```

Expected: 合同工作区测试全部通过，新增两项同步测试通过且没有 Vue 递归更新警告。

- [ ] **Step 4: 扫描同类模式**

Run:

```bash
rg -n -U "watch\\([\\s\\S]{0,500}deep:\\s*true|update:modelValue" frontend/src -g "*.vue" -g "*.ts"
```

Expected: `ContractFormPanel.vue` 仍是唯一使用完整表单双向深度同步的组件，且两条路径均由快照保护；其他命中为单次用户事件。

- [ ] **Step 5: 提交最小修复**

```bash
git add frontend/src/components/contracts/ContractFormPanel.vue
git commit -m "fix: prevent contract form sync loop"
```

---

### Task 3: 完整验证和测试环境更新

**Files:**
- Verify: `frontend/src/components/contracts/ContractFormPanel.vue`
- Verify: `frontend/src/views/contracts/contract-workspace.spec.ts`
- Verify: `frontend/src/views/contracts/ContractsWorkspace.vue`

**Interfaces:**
- Consumes: Task 2 完成的快照保护。
- Produces: 可交付的测试、构建和测试环境验收证据。

- [ ] **Step 1: 运行前端全量测试**

Run:

```bash
npm --prefix frontend run test:unit
```

Expected: 所有前端测试通过，无递归更新或未处理 Promise 警告。

- [ ] **Step 2: 运行前端生产构建**

Run:

```bash
npm --prefix frontend run build
```

Expected: `vue-tsc -b` 和 Vite 构建成功；允许既有的大于 500 kB 分块提示。

- [ ] **Step 3: 检查差异范围和格式**

Run:

```bash
git diff --check
git status --short
git diff --name-only HEAD~2..HEAD
```

Expected: 生产代码仅修改 `ContractFormPanel.vue`，测试仅修改 `contract-workspace.spec.ts`，另含已确认的规格与计划文档。

- [ ] **Step 4: 更新本地测试环境前端**

使用排除 `node_modules` 和 `dist` 的临时构建上下文构建 `srms_test-web`，然后仅重建 `srms_test-web-1`：

```powershell
docker build -t srms_test-web C:/Users/Admin/.codex/visualizations/2026/07/22/019f8870-d121-7dc0-b73f-4e10f601ee80/contract-form-sync-build-20260810
docker compose -p srms_test --env-file deploy/.env.test -f deploy/docker-compose.yml up -d --no-deps --no-build --force-recreate web
```

Expected: `http://localhost:15173/` 返回 200；API 和 MySQL 容器启动时间不变。

- [ ] **Step 5: 验证测试环境**

验证流程：登录 → 合同管理 → 新增合同 → 选择房源 → 继续选择承租人、日期和月租 → 取消 → 再次新增 → 恢复草稿。

Expected: 页面无卡顿、无刷新、表单值正确保存和重置。

---

### Task 4: GitHub 与线上交付

**Files:**
- Publish: `docs/superpowers/specs/2026-08-10-contract-form-sync-loop-fix-design.md`
- Publish: `docs/superpowers/plans/2026-08-10-contract-form-sync-loop-fix.md`
- Publish: `frontend/src/components/contracts/ContractFormPanel.vue`
- Publish: `frontend/src/views/contracts/contract-workspace.spec.ts`

**Interfaces:**
- Consumes: Task 3 的全量验证和测试环境验收结果。
- Produces: 合并到 `main` 的修复提交及更新后的线上前端。

- [ ] **Step 1: 发布功能分支并创建草稿合并请求**

```bash
git push -u origin codex/contract-form-sync-fix
gh pr create --draft --base main --head codex/contract-form-sync-fix --title "修复新增合同选择房源卡死"
```

- [ ] **Step 2: 核对合并请求**

确认只包含规格、计划、一个生产组件和一个测试文件；确认无冲突后压缩合并到 `main`。

- [ ] **Step 3: 更新线上前端**

服务器在保留本地修改后获取 `main`，只重新构建并替换 `srms_prod-web-1`，不重启 API 或 MySQL。

- [ ] **Step 4: 公网验收**

验证 `https://www.hetfw.cn/`、`/api/health`、线上静态资源摘要，以及新增合同房源选择流程。

Expected: 网站和健康接口返回 200；选择房源不再卡死。
