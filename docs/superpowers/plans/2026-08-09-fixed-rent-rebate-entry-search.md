# 固定月租退差入口与合同搜索实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户从符合资格的合同详情一键进入该合同退差表单，并能按合同编号、楼栋房号或主租户姓名搜索所有符合退差条件的合同。

**Architecture:** 在现有合同前端服务中集中定义“履行中 + 固定月租”的资格判断和本地搜索函数，详情入口、退差页面和工作区全部复用同一规则。合同工作区继续使用现有 `tab` 与 `contractId` 查询参数保存页面上下文，不新增后端接口或数据结构。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Vue Router、Vitest、Vue Test Utils

## Global Constraints

- 以 SRMS-RB-1.0 和已确认的固定合同需求变更为业务基线。
- 只有状态为 `ACTIVE` 且计价方式为 `FIXED` 的合同可以发起固定月租退差。
- 合同详情中不符合资格时隐藏入口，不创建新的业务状态或例外规则。
- 搜索范围仅为合同编号、楼栋房号和主租户姓名，且仅返回符合退差资格的合同。
- 退差仍归属于合同，房源通过合同关联获得；不新增房源级退差数据。
- 后端现有身份、角色、合同状态和计价方式校验不得削弱。
- 所有用户可见文案使用简体中文，日期控件保持中文格式。

---

### Task 1: 集中退差资格与搜索规则

**Files:**
- Modify: `frontend/src/services/contracts.ts`
- Test: `frontend/src/views/contracts/contract-workspace.spec.ts`

**Interfaces:**
- Consumes: `ContractListItem`，其中 `members` 的主租户角色为 `PRIMARY`。
- Produces: `isFixedRentRebateEligible(contract): boolean`、`fixedRentRebateContractLabel(contract): string`、`filterFixedRentRebateContracts(contracts, keyword): ContractListItem[]`。

- [ ] **Step 1: 写资格与三字段搜索的失败测试**

在 `contract-workspace.spec.ts` 从 `services/contracts` 导入三个新函数，并添加：

```ts
it('只把履行中的固定月租合同认定为可退差', () => {
  expect(isFixedRentRebateEligible(activeContract())).toBe(true)
  expect(isFixedRentRebateEligible({ ...activeContract(), status: 'PENDING_START' })).toBe(false)
  expect(isFixedRentRebateEligible({ ...activeContract(), pricingMode: 'TIERED_RETROACTIVE' })).toBe(false)
  expect(isFixedRentRebateEligible(null)).toBe(false)
})

it.each([
  ['合同编号', '050012'],
  ['楼栋房号', '1栋301'],
  ['主租户姓名', '张三'],
])('按%s搜索符合退差条件的合同', (_field, keyword) => {
  const eligible = activeContract()
  const ineligible = { ...activeContract(), id: 13, contractNo: 'HT-OTHER', status: 'PENDING_START' }
  expect(filterFixedRentRebateContracts([eligible, ineligible], keyword).map((item) => item.id)).toEqual([12])
})

it('搜索会忽略首尾空格和英文字母大小写，并为结果生成完整标签', () => {
  const eligible = activeContract()
  expect(filterFixedRentRebateContracts([eligible], '  ht2026  ')).toEqual([eligible])
  expect(fixedRentRebateContractLabel(eligible)).toContain('HT202608050012')
  expect(fixedRentRebateContractLabel(eligible)).toContain('1栋301')
  expect(fixedRentRebateContractLabel(eligible)).toContain('张三')
})
```

- [ ] **Step 2: 运行测试确认红灯**

Run:

```powershell
npm --prefix frontend run test -- --run src/views/contracts/contract-workspace.spec.ts
```

Expected: FAIL，提示三个导出函数不存在。

- [ ] **Step 3: 在合同服务中实现最小共享规则**

在 `frontend/src/services/contracts.ts` 添加：

```ts
export function isFixedRentRebateEligible(
  contract?: Pick<ContractListItem, 'status' | 'pricingMode'> | null,
) {
  return contract?.status === 'ACTIVE' && contract.pricingMode === 'FIXED'
}

export function fixedRentRebateContractLabel(contract: ContractListItem) {
  const room = contract.room?.fullHouseNo || `房源${contract.roomId}`
  const tenant = contract.members?.find((item) => item.memberRole === 'PRIMARY')?.tenant.name || '未记录租户'
  return `${contract.contractNo}｜${room}｜${tenant}`
}

export function filterFixedRentRebateContracts(contracts: ContractListItem[], keyword: string) {
  const normalized = keyword.trim().toLocaleLowerCase('zh-CN')
  return contracts.filter((contract) => {
    if (!isFixedRentRebateEligible(contract)) return false
    if (!normalized) return true
    return fixedRentRebateContractLabel(contract).toLocaleLowerCase('zh-CN').includes(normalized)
  })
}
```

- [ ] **Step 4: 重跑定向测试确认绿灯**

Run:

```powershell
npm --prefix frontend run test -- --run src/views/contracts/contract-workspace.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 提交共享规则**

```powershell
git add frontend/src/services/contracts.ts frontend/src/views/contracts/contract-workspace.spec.ts
git commit -m "feat: centralize fixed rebate eligibility"
```

---

### Task 2: 合同详情入口按资格显示并携带当前合同

**Files:**
- Modify: `frontend/src/components/contracts/ContractDetailPanel.vue`
- Modify: `frontend/src/views/contracts/ContractsWorkspace.vue`
- Test: `frontend/src/views/contracts/contract-workspace.spec.ts`
- Test: `frontend/src/router/contracts-routing.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `isFixedRentRebateEligible`。
- Produces: `ContractDetailPanel` 的 `rebate` 事件携带当前合同编号；`openFixedRentRebate(contractId: number)` 负责选择合同、切换页签并同步查询参数。

- [ ] **Step 1: 写入口可见性与事件参数的失败测试**

在 `contract-workspace.spec.ts` 添加：

```ts
it('仅在履行中的固定月租合同详情显示退差入口并携带合同编号', async () => {
  const wrapper = mount(ContractDetailPanel, {
    props: { contract: activeContract(), role: 'ADMIN' },
    global: { plugins: [ElementPlus] },
  })
  const button = wrapper.find('[data-test="open-fixed-rent-rebate"]')
  expect(button.exists()).toBe(true)
  await button.trigger('click')
  expect(wrapper.emitted('rebate')).toEqual([[12]])

  await wrapper.setProps({ contract: { ...activeContract(), status: 'PENDING_START' } })
  expect(wrapper.find('[data-test="open-fixed-rent-rebate"]').exists()).toBe(false)

  await wrapper.setProps({ contract: { ...activeContract(), pricingMode: 'TIERED_RETROACTIVE' } })
  expect(wrapper.find('[data-test="open-fixed-rent-rebate"]').exists()).toBe(false)
})
```

- [ ] **Step 2: 写工作区详情跳转的失败测试**

在 `contracts-routing.spec.ts` 的合同服务模拟中补充 Task 1 三个函数，然后添加：

```ts
it('从合同详情发起退差时保留当前合同并写入可恢复地址', async () => {
  const { router, wrapper } = await mountWorkspace('/contracts?tab=detail&contractId=12')
  await wrapper.get('[data-test="open-fixed-rent-rebate"]').trigger('click')
  await flushPromises()

  expect(wrapper.get('.contract-top-nav button.active').text()).toBe('固定月租退差')
  expect(router.currentRoute.value.query).toEqual({ tab: 'fixed-rebate', contractId: '12' })
  expect(wrapper.text()).toContain('HT202608050012')
})
```

- [ ] **Step 3: 运行两个测试文件确认红灯**

```powershell
npm --prefix frontend run test -- --run src/views/contracts/contract-workspace.spec.ts src/router/contracts-routing.spec.ts
```

Expected: FAIL，现有按钮对所有合同显示，事件不携带合同编号。

- [ ] **Step 4: 实现详情入口资格判断和事件参数**

在 `ContractDetailPanel.vue`：

```ts
import { isFixedRentRebateEligible } from '../../services/contracts'

const emit = defineEmits<{ back: []; rebate: [contractId: number]; download: [file: ContractFile] }>()
```

按钮替换为：

```vue
<el-button
  v-if="isFixedRentRebateEligible(contract)"
  data-test="open-fixed-rent-rebate"
  type="primary"
  plain
  @click="emit('rebate', contract.id)"
>
  固定月租退差
</el-button>
```

- [ ] **Step 5: 在工作区接收合同编号并复用安全选择流程**

在 `ContractsWorkspace.vue` 添加：

```ts
async function openFixedRentRebate(contractId: number) {
  await selectRebateContract(contractId)
}
```

并把详情组件事件改为：

```vue
@rebate="openFixedRentRebate"
```

`selectRebateContract` 继续执行资格复核、载入当前合同数据、切换 `fixed-rebate` 页签并由 `writeWorkspaceRoute` 写入 `contractId`。

- [ ] **Step 6: 重跑定向测试确认绿灯**

```powershell
npm --prefix frontend run test -- --run src/views/contracts/contract-workspace.spec.ts src/router/contracts-routing.spec.ts
```

Expected: PASS。

- [ ] **Step 7: 提交详情入口与上下文跳转**

```powershell
git add frontend/src/components/contracts/ContractDetailPanel.vue frontend/src/views/contracts/ContractsWorkspace.vue frontend/src/views/contracts/contract-workspace.spec.ts frontend/src/router/contracts-routing.spec.ts
git commit -m "feat: open rebate from eligible contract detail"
```

---

### Task 3: 固定月租退差页增加合同搜索

**Files:**
- Modify: `frontend/src/components/contracts/FixedRentRebatePanel.vue`
- Modify: `frontend/src/views/contracts/contract-workspace.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `filterFixedRentRebateContracts` 与 `fixedRentRebateContractLabel`。
- Produces: 常驻的合同搜索选择框；选择结果继续通过现有 `'select-contract': [id: number]` 事件交给工作区加载。

- [ ] **Step 1: 写搜索界面和结果范围的失败测试**

在 `contract-workspace.spec.ts` 添加：

```ts
it('退差页按合同编号、房号或租户搜索且不展示无资格合同', () => {
  const eligible = activeContract()
  const second = {
    ...activeContract(), id: 14, contractNo: 'HT202608050014 | 2栋602 | 李四', roomId: 22,
    room: { id: 22, fullHouseNo: '2栋602' },
    members: [{ memberRole: 'PRIMARY', tenant: { id: 31, name: '李四' } }],
  }
  const ineligible = { ...activeContract(), id: 15, contractNo: 'HT-NOT-ELIGIBLE', status: 'PENDING_START' }
  const wrapper = mount(FixedRentRebatePanel, {
    props: { contracts: [eligible, second, ineligible], contract: eligible, role: 'ADMIN' },
    global: { plugins: [ElementPlus] },
  })

  const search = wrapper.get('[data-test="fixed-rebate-contract-search"]')
  expect(search.attributes('placeholder')).toBe('搜索合同编号、楼栋房号或租户姓名')
  expect(wrapper.text()).toContain('2栋602')
  expect(wrapper.text()).toContain('李四')
  expect(wrapper.text()).not.toContain('HT-NOT-ELIGIBLE')
})

it('合同搜索无结果时显示明确中文提示', () => {
  expect(filterFixedRentRebateContracts([activeContract()], '不存在的合同')).toEqual([])
})
```

- [ ] **Step 2: 运行测试确认红灯**

```powershell
npm --prefix frontend run test -- --run src/views/contracts/contract-workspace.spec.ts
```

Expected: FAIL，页面不存在常驻搜索控件，结果标签缺少租户姓名。

- [ ] **Step 3: 实现常驻可搜索合同选择框**

在 `FixedRentRebatePanel.vue`：

```ts
import { computed, reactive, ref, watch } from 'vue'
import {
  buildFixedRentRebatePayload,
  filterFixedRentRebateContracts,
  fixedRentRebateContractLabel,
  isFixedRentRebateEligible,
  uploadPricingRebateProof,
} from '../../services/contracts'

const contractKeyword = ref('')
const searchContractId = ref<number | null>(null)
const eligibleContracts = computed(() => filterFixedRentRebateContracts(props.contracts, contractKeyword.value))
const eligibleContract = computed(() => isFixedRentRebateEligible(props.contract) ? props.contract : null)

watch(() => props.contract?.id, (id) => {
  searchContractId.value = id ?? null
}, { immediate: true })

function selectSearchContract(id?: number) {
  if (id) emit('select-contract', id)
}
```

在 `<section>` 顶部、空状态和表单之前增加：

```vue
<div class="contract-search-card">
  <span>搜索可退差合同</span>
  <el-select
    v-model="searchContractId"
    data-test="fixed-rebate-contract-search"
    filterable
    clearable
    :filter-method="(value: string) => { contractKeyword = value }"
    placeholder="搜索合同编号、楼栋房号或租户姓名"
    no-match-text="未找到符合退差条件的合同"
    @change="selectSearchContract"
  >
    <el-option
      v-for="item in eligibleContracts"
      :key="item.id"
      :value="item.id"
      :label="fixedRentRebateContractLabel(item)"
    />
  </el-select>
</div>
```

删除原空状态中只显示合同编号和房号的旧选择框，保留“返回合同列表”按钮。补充 `.contract-search-card` 样式，使搜索框在桌面和手机宽度下均占满可用空间。

- [ ] **Step 4: 重跑定向测试确认绿灯**

```powershell
npm --prefix frontend run test -- --run src/views/contracts/contract-workspace.spec.ts src/router/contracts-routing.spec.ts
```

Expected: PASS。

- [ ] **Step 5: 执行完整前端回归**

```powershell
npm --prefix frontend run test -- --run
npm --prefix frontend run build
npm run lint
```

Expected: 所有测试通过；Vue 类型检查和 Vite 构建通过；Lint 通过。允许保留项目既有的大文件分包提示，但不得新增错误。

- [ ] **Step 6: 检查差异和冻结范围**

```powershell
git diff --check
git status --short
rg -n "阶梯|TIERED_RETROACTIVE" frontend/src/components/contracts frontend/src/views/contracts
```

Expected: 无空白错误；只包含本计划文件；可达页面没有新增阶梯功能入口。测试夹具中的历史兼容值可以存在。

- [ ] **Step 7: 提交搜索功能**

```powershell
git add frontend/src/components/contracts/FixedRentRebatePanel.vue frontend/src/views/contracts/contract-workspace.spec.ts
git commit -m "feat: search eligible fixed rebate contracts"
```

---

## 最终验收

- [ ] 从履行中的固定月租合同详情点击一次进入当前合同退差表单。
- [ ] 待开始、待退租、已终止、已到期、已作废或非固定月租合同不显示入口。
- [ ] 搜索合同编号、楼栋房号、主租户姓名均能找到符合条件的合同。
- [ ] 不符合退差条件的合同不会出现在搜索结果或可提交状态。
- [ ] 刷新 `contracts?tab=fixed-rebate&contractId=<id>` 能恢复当前合同。
- [ ] 前端完整测试、构建和根目录 Lint 全部通过。
