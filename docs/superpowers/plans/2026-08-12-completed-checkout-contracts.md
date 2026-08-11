# 已退租合同列表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在退租结算工作区新增只读的“已退租合同”页签，安全查询已经完成结算并结束的合同。

**Architecture:** 后端在 `CheckoutService` 增加受限查询方法，数据库查询强制同时限定结算单 `COMPLETED` 与合同 `ENDED`，并在服务端完成关键词、分页及金额序列化。前端复用退租工作区和详情读取接口，新增独立列表面板；页面只负责查询和跳转，绝不提供任何历史修改操作。

**Tech Stack:** NestJS、Prisma/MySQL、Vue 3、TypeScript、Vitest、Jest。

## Global Constraints

- 只返回结算状态 `COMPLETED` 且合同状态 `ENDED` 的记录。
- 搜索仅支持合同编号、楼栋房号、租户姓名；使用服务端筛选。
- 不新增数据库表、枚举、合同状态或房态；不修改任何历史数据。
- 所有接口沿用 JWT 与角色守卫，响应统一为 `{ code, message, data }`。
- 详情只读，不增加编辑、删除、重算、退款或恢复合同操作。
- 金额始终以两位小数字符串返回，前端按人民币格式显示。

---

### Task 1: 已退租合同后端只读查询接口

**Files:**
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.controller.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`

**Interfaces:**
- Consumes: `GET /checkout-settlements/completed-contracts?keyword=&page=&pageSize=`。
- Produces: `CheckoutService.listCompletedContracts(query)`，返回 `{ items, page, pageSize, total }`；每项包含 `settlementId`、`contractNo`、`roomFullHouseNo`、`tenantName`、`actualCheckoutDate`、`settlementNo`、`refundAmount`、`completedAt`。

- [ ] **Step 1: 写入后端失败测试**

在 `checkout.service.spec.ts` 写入三个独立测试：

```ts
it('lists only completed settlements whose contracts are ended', async () => {
  const result = await service.listCompletedContracts({ page: 1, pageSize: 20 })
  expect(result.items).toEqual([expect.objectContaining({ settlementId: 9, refundAmount: '0.00' })])
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { status: 'COMPLETED', contract: { status: 'ENDED' } },
  }))
})

it('searches a completed contract by contract number, room number, or tenant name', async () => {
  await service.listCompletedContracts({ keyword: '2栋301', page: 1, pageSize: 20 })
  expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ OR: expect.any(Array) }),
  }))
})

it('serializes positive combined refunds and zero refunds with two decimals', async () => {
  await expect(service.listCompletedContracts({ page: 1, pageSize: 20 })).resolves.toMatchObject({
    items: [
      { refundAmount: '1300.00' },
      { refundAmount: '0.00' },
    ],
  })
})
```

- [ ] **Step 2: 运行失败测试**

Run: `npm run test -- --runInBand src/checkout/checkout.service.spec.ts`

Expected: FAIL，原因是 `listCompletedContracts` 尚不存在。

- [ ] **Step 3: 实现最小服务查询和控制器路由**

在 `CheckoutService` 实现以下签名：

```ts
async listCompletedContracts(query: { keyword?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
  const keyword = query.keyword?.trim()
  const where = {
    status: 'COMPLETED' as const,
    contract: {
      is: {
        status: 'ENDED' as const,
        ...(keyword
          ? {
              OR: [
                { contractNo: { contains: keyword } },
                { room: { is: { fullHouseNo: { contains: keyword } } } },
                { room: { is: { roomNo: { contains: keyword } } } },
                { members: { some: { isCurrent: true, tenant: { is: { name: { contains: keyword } } } } } },
              ],
            }
          : {}),
      },
    },
  }
  // 查询 completed settlement、contract、room、当前主租户、APPROVED refund 和最终房态历史；完成时间取最终房态历史 changedAt。
}
```

控制器在 `@Get(':id')` 之前增加精确路由：

```ts
@Get('completed-contracts')
async completedContracts(@Query() query: CompletedCheckoutContractsQueryDto) {
  return { code: 200, message: 'success', data: await this.checkout.listCompletedContracts(query) }
}
```

新增一个局部 DTO 文件 `backend/src/checkout/dto/completed-checkout-contracts-query.dto.ts`，用 `@Type(() => Number)`、`@IsOptional()`、`@IsInt()`、`@Min(1)` 约束 `page`、`pageSize`，并对 `keyword` 进行长度限制。

- [ ] **Step 4: 运行后端测试和构建**

Run: `npm run test -- --runInBand src/checkout/checkout.service.spec.ts && npm run build`

Expected: PASS。

- [ ] **Step 5: 提交后端查询接口**

```bash
git add backend/src/checkout/checkout.service.ts backend/src/checkout/checkout.controller.ts backend/src/checkout/dto/completed-checkout-contracts-query.dto.ts backend/src/checkout/checkout.service.spec.ts
git commit -m "feat: list completed checkout contracts"
```

### Task 2: 第四页签与已退租合同只读列表

**Files:**
- Create: `frontend/src/views/checkout/CompletedCheckoutContractsPanel.vue`
- Modify: `frontend/src/views/checkout/CheckoutTopNav.vue`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue`
- Modify: `frontend/src/views/checkout/checkout-types.ts`
- Modify: `frontend/src/services/checkout.ts`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`

**Interfaces:**
- Consumes: `checkoutApi.completedContracts({ keyword, page, pageSize })`。
- Produces: `CompletedCheckoutContractsPanel` 的 `select` 事件，事件参数为 `settlementId: number`。
- `CheckoutTab` 扩展为 `'initiate' | 'settlement' | 'refund' | 'completed'`。

- [ ] **Step 1: 写入前端失败测试**

在 `checkout-workspace.spec.ts` 追加：

```ts
it('renders the fourth completed-contracts tab and loads only read-only history', async () => {
  const wrapper = mount(CheckoutWorkspace, { global: { plugins: [createPinia()] } })
  await wrapper.get('[data-test="checkout-tab-completed"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('已退租合同')
  expect(wrapper.text()).toContain('HT202608010001')
  expect(wrapper.find('[data-test="completed-contract-edit"]').exists()).toBe(false)
})

it('sends the keyword search and opens an existing checkout detail in read-only mode', async () => {
  const wrapper = mount(CompletedCheckoutContractsPanel, { props: { result: completedResult } })
  await wrapper.get('[data-test="completed-contract-search"]').setValue('李四')
  await wrapper.get('[data-test="completed-contract-search-submit"]').trigger('click')
  expect(wrapper.emitted('search')).toEqual([['李四']])
  await wrapper.get('[data-test="completed-contract-detail-9"]').trigger('click')
  expect(wrapper.emitted('select')).toEqual([[9]])
})
```

- [ ] **Step 2: 运行失败测试**

Run: `npm --prefix frontend run test:unit -- src/views/checkout/checkout-workspace.spec.ts`

Expected: FAIL，原因是第四页签、`CompletedCheckoutContractsPanel` 与 API 封装尚不存在。

- [ ] **Step 3: 实现最小只读列表面板和工作区接入**

在 `checkout-types.ts` 新增：

```ts
export type CompletedCheckoutContract = {
  settlementId: number
  settlementNo: string
  contractNo: string
  roomFullHouseNo: string
  tenantName: string
  actualCheckoutDate: string | null
  refundAmount: string
  completedAt: string
}
export type CompletedCheckoutContractsResult = {
  items: CompletedCheckoutContract[]
  page: number
  pageSize: number
  total: number
}
```

在 `checkout.ts` 增加 GET API；在导航组件增加 `data-test="checkout-tab-completed"`；在工作区中仅在切换到 `completed` 时加载数据。面板显示规格约定的七个字段、关键词搜索、空态、分页以及“查看详情”按钮。

点击详情时，工作区调用既有 `checkoutApi.detail(settlementId)`，在只读详情区展示结算项目、退款凭证、合同/房源信息与房态结果；不挂接 `submit`、`approve`、`returnToDraft`、`completeZero`、`approveRefund` 事件。

- [ ] **Step 4: 运行前端测试和构建**

Run: `npm --prefix frontend run test:unit && npm --prefix frontend run build`

Expected: PASS；仅允许保留既有 Vite 大 chunk 提示。

- [ ] **Step 5: 提交前端只读页签**

```bash
git add frontend/src/views/checkout/CompletedCheckoutContractsPanel.vue frontend/src/views/checkout/CheckoutTopNav.vue frontend/src/views/checkout/CheckoutWorkspace.vue frontend/src/views/checkout/checkout-types.ts frontend/src/services/checkout.ts frontend/src/views/checkout/checkout-workspace.spec.ts
git commit -m "feat: add completed checkout contracts tab"
```

### Task 3: 端到端回归、验收记录与复审

**Files:**
- Modify: `docs/checkout-settlement-redesign-acceptance.md`

**Interfaces:**
- Consumes: 已完成的后端分页接口和前端只读列表。
- Produces: 更新后的验收记录，明确无数据变更和手工验收步骤。

- [ ] **Step 1: 写入验收记录的失败检查项**

在验收记录草稿中明确以下不可缺少的手工检查项：

```markdown
- 已退租合同页签不显示未完成结算或待退租合同。
- 搜索合同编号、楼栋房号、租户姓名均只缩小已退租结果。
- 查看详情没有编辑、删除、确认、退款或恢复合同按钮。
```

- [ ] **Step 2: 运行完整自动化回归**

Run:

```bash
npm --prefix backend run test -- --runInBand
npm --prefix backend run build
npm --prefix frontend run test:unit
npm --prefix frontend run build
```

Expected: 全部 PASS。全库后端 Lint 若仍仅报告既有 `backend/src/contracts/contract-schema.spec.ts` 的 12 条 Prettier 格式错误，记录为既有问题且不修改该文件。

- [ ] **Step 3: 更新验收记录**

在 `docs/checkout-settlement-redesign-acceptance.md` 增加“已退租合同列表”章节，记录：只读条件、搜索字段、详情范围、自动化测试结果、手工验收步骤，以及“未在测试数据库创建业务数据”的事实。

- [ ] **Step 4: 差异与权限复核**

Run:

```bash
git diff --check
rg -n "编辑|删除|重新结算|恢复合同" frontend/src/views/checkout/CompletedCheckoutContractsPanel.vue
```

Expected: 无空白错误；列表面板不包含修改历史记录的操作入口。

- [ ] **Step 5: 提交验收记录并请求独立复审**

```bash
git add docs/checkout-settlement-redesign-acceptance.md
git commit -m "docs: record completed checkout contracts acceptance"
```

请求独立复审时重点检查：后端是否强制 `COMPLETED + ENDED`，关键词是否不会绕过条件，前端详情是否严格只读，及既有三步退租流程是否未被改变。
