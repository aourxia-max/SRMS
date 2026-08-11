# 收款详情生命周期标签 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在收款详情顶部与票据类型并排展示已生效的更正、部分退款、全额退款和作废标签。

**Architecture:** 新建一个无副作用的前端状态标签计算函数，输入现有详情接口中的票据类型、收款状态和更正原因，输出用于渲染的标签数组。收款详情页调用该函数并循环渲染，不新增后端接口或修改审批逻辑。

**Tech Stack:** Vue 3、TypeScript、Vitest、Element Plus。

## Global Constraints

- 仅展示已生效状态；待审批、已驳回和已取消申请不得显示完成标签。
- 不修改收款、更正、退款、作废、审批、权限或账务冲回规则。
- 全额退款显示“已退款”，部分退款显示“部分退款”。
- 标签与现有“正式票据/临时票据”并排展示。

---

### Task 1: 生命周期标签计算函数

**Files:**
- Create: `frontend/src/views/payments/payment-lifecycle-tags.ts`
- Test: `frontend/src/views/payments/payment-lifecycle-tags.spec.ts`

**Interfaces:**
- Produces: `paymentLifecycleTags(input: { receiptType: string; status: string; editReason?: string | null }): Array<{ text: string; type: 'success' | 'warning' | 'info' | 'danger' }>`。
- Consumes: 收款详情接口现有的 `receiptType`、`status` 和 `editReason` 字段。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { paymentLifecycleTags } from './payment-lifecycle-tags'

describe('paymentLifecycleTags', () => {
  it('marks a corrected and voided receipt with both completed states', () => {
    expect(paymentLifecycleTags({
      receiptType: 'FORMAL', status: 'VOIDED', editReason: '更正收款方式',
    })).toEqual([
      { text: '正式票据', type: 'success' },
      { text: '已更正', type: 'info' },
      { text: '已作废', type: 'danger' },
    ])
  })

  it('distinguishes partial and full refunds without showing pending requests', () => {
    expect(paymentLifecycleTags({ receiptType: 'FORMAL', status: 'PARTIALLY_REFUNDED' }))
      .toContainEqual({ text: '部分退款', type: 'warning' })
    expect(paymentLifecycleTags({ receiptType: 'FORMAL', status: 'FULLY_REFUNDED' }))
      .toContainEqual({ text: '已退款', type: 'danger' })
    expect(paymentLifecycleTags({ receiptType: 'FORMAL', status: 'CONFIRMED' }))
      .toEqual([{ text: '正式票据', type: 'success' }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix frontend run test:unit -- src/views/payments/payment-lifecycle-tags.spec.ts`

Expected: FAIL because `payment-lifecycle-tags.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type PaymentLifecycleTag = {
  text: string
  type: 'success' | 'warning' | 'info' | 'danger'
}

export function paymentLifecycleTags(input: {
  receiptType: string
  status: string
  editReason?: string | null
}): PaymentLifecycleTag[] {
  const tags: PaymentLifecycleTag[] = [{
    text: input.receiptType === 'FORMAL' ? '正式票据' : '临时票据',
    type: input.receiptType === 'FORMAL' ? 'success' : 'warning',
  }]
  if (input.editReason?.trim()) tags.push({ text: '已更正', type: 'info' })
  if (input.status === 'PARTIALLY_REFUNDED') tags.push({ text: '部分退款', type: 'warning' })
  if (input.status === 'FULLY_REFUNDED') tags.push({ text: '已退款', type: 'danger' })
  if (input.status === 'VOIDED') tags.push({ text: '已作废', type: 'danger' })
  return tags
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix frontend run test:unit -- src/views/payments/payment-lifecycle-tags.spec.ts`

Expected: PASS, 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/payments/payment-lifecycle-tags.ts frontend/src/views/payments/payment-lifecycle-tags.spec.ts
git commit -m "feat: add payment lifecycle status tags"
```

### Task 2: 在收款详情页渲染标签

**Files:**
- Modify: `frontend/src/views/payments/PaymentDetailView.vue:1-60`
- Test: `frontend/src/views/payments/payment-lifecycle-tags.spec.ts`

**Interfaces:**
- Consumes: `paymentLifecycleTags` from `frontend/src/views/payments/payment-lifecycle-tags.ts` and current `PaymentDetail` object.
- Produces: 顶部标签行，始终显示票据类型，并只显示已生效的生命周期标签。

- [ ] **Step 1: Extend the failing test with a rendered tag contract**

```ts
it('returns no completed refund or void tag for a confirmed receipt', () => {
  const tags = paymentLifecycleTags({ receiptType: 'FORMAL', status: 'CONFIRMED', editReason: null })
  expect(tags.map((tag) => tag.text)).toEqual(['正式票据'])
})
```

- [ ] **Step 2: Run test to verify the current page cannot consume the tag list**

Run: `npm --prefix frontend run build`

Expected before integration: the page still contains a single inline receipt-type tag and does not import `paymentLifecycleTags`; record this baseline in the task log before changing the template.

- [ ] **Step 3: Integrate the tag function in the page**

```ts
import { paymentLifecycleTags } from './payment-lifecycle-tags'

const lifecycleTags = computed(() => detail.value
  ? paymentLifecycleTags(detail.value)
  : [])
```

Replace the single top `el-tag` with:

```vue
<div class="receipt-tags">
  <el-tag v-for="tag in lifecycleTags" :key="tag.text" :type="tag.type">
    {{ tag.text }}
  </el-tag>
</div>
```

Add `.receipt-tags { display:flex; flex-wrap:wrap; gap:8px; }` to the scoped style block. Do not render tags from `refunds` or `voidRequests`; those collections include non-approved applications and must not decide completed state.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
npm --prefix frontend run test:unit -- src/views/payments/payment-lifecycle-tags.spec.ts
npm --prefix frontend run test:unit
npm --prefix frontend run build
```

Expected: focused tests pass; complete frontend suite passes; TypeScript and Vite build succeed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/payments/PaymentDetailView.vue frontend/src/views/payments/payment-lifecycle-tags.spec.ts
git commit -m "feat: show completed payment lifecycle tags"
```