# 退租按实际退房日期核算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让延迟录入的退租始终按实际退房日期核算租期，并统一修正退租、租金账单、财务中心、驾驶舱和房源详情的欠租与逾期口径。

**Architecture:** 使用现有 `CheckoutSettlement.actualCheckoutDate` 保存可选的发起阶段实际退房日期，不新增数据库字段。新增一个无副作用的共享退租截止日期模块，所有账单出口先取得合同的有效退租截止日期，再以 `periodStart < actualCheckoutDate` 判断账单是否已经进入履行；待退租期间只做查询投影，最终退租继续沿用现有事务化冲销，取消或撤销后自然恢复原合同口径。

**Tech Stack:** NestJS、TypeScript、Prisma/MySQL、Vue 3、Element Plus、Jest、Vitest。

**Spec:** `docs/superpowers/specs/2026-09-09-checkout-actual-date-accounting-design.md`

## Global Constraints

- 退房当天不计租；所有边界统一为 `periodStart < actualCheckoutDate` 才属于已履行账期。
- 账期开始日大于或等于实际退房日期的账单不计原应收、未收、欠租、逾期笔数、逾期金额或房源风险。
- 跨越实际退房日期的当期账单不自动按日折算，仍使用现有“退还租金”流程。
- 发起阶段实际退房日期可选；为空时不得提前停止计租。
- 实际退房日期不得晚于当前合同业务日；待开始合同允许早于合同开始日，已开始合同不允许。
- 待退租期间不提前写入不可逆冲销；只投影“待退租核算”，最终完成时才固化账单状态。
- 不批量修改历史数据，不迁移已完成退租，不改变权限、押金、预收款或退款审计规则。
- 所有日期通过 `contractBusinessDay()` 归一，禁止直接以服务器本地时分秒比较业务日期。
- 后端是金额与状态的唯一可信来源，前端不得复制财务计算。
- 数据库 E2E 只能通过仓库的隔离运行器执行，禁止直接写共享测试库或生产库。

---

### Task 1: 建立统一的退租截止日期领域规则

**Files:**
- Create: `backend/src/checkout/checkout-accounting-cutoff.ts`
- Create: `backend/src/checkout/checkout-accounting-cutoff.spec.ts`

**Interfaces:**
- Produces: `ACTIVE_CHECKOUT_CUTOFF_STATUSES`，值为 `DRAFT | PENDING | APPROVED | REJECTED`。
- Produces: `resolveCheckoutCutoff(settlements): Date | null`，只返回未取消退租单的实际退房日期。
- Produces: `isRentBillPerformed(periodStart, cutoff): boolean`，无截止日期时为 `true`，否则仅 `periodStart < cutoff` 为 `true`。
- Produces: `effectiveRentBillStatus(status, periodStart, cutoff): RentBillStatus | 'PENDING_CHECKOUT_REVIEW'`。

- [ ] **Step 1: 为等于边界、晚于边界、空日期和取消退租写失败测试**

```ts
describe('checkout accounting cutoff', () => {
  const cutoff = new Date('2026-09-01T00:00:00.000Z');

  it('treats checkout day and later bill periods as unperformed', () => {
    expect(isRentBillPerformed(new Date('2026-08-01'), cutoff)).toBe(true);
    expect(isRentBillPerformed(new Date('2026-09-01'), cutoff)).toBe(false);
    expect(isRentBillPerformed(new Date('2026-10-01'), cutoff)).toBe(false);
  });

  it('projects an unperformed overdue bill as pending checkout review', () => {
    expect(effectiveRentBillStatus('OVERDUE', cutoff, cutoff)).toBe(
      'PENDING_CHECKOUT_REVIEW',
    );
  });

  it('ignores cancelled and completed settlements as temporary cutoffs', () => {
    expect(resolveCheckoutCutoff([{ status: 'CANCELLED', actualCheckoutDate: cutoff }])).toBeNull();
    expect(resolveCheckoutCutoff([{ status: 'COMPLETED', actualCheckoutDate: cutoff }])).toBeNull();
  });
});
```

- [ ] **Step 2: 运行领域测试并确认因模块不存在而失败**

Run: `npm --prefix backend test -- --runInBand --runTestsByPath src/checkout/checkout-accounting-cutoff.spec.ts`

Expected: FAIL，提示无法解析 `checkout-accounting-cutoff` 或导出函数不存在。

- [ ] **Step 3: 实现纯函数模块**

```ts
import type { CheckoutSettlementStatus, RentBillStatus } from '@prisma/client';

export const ACTIVE_CHECKOUT_CUTOFF_STATUSES: CheckoutSettlementStatus[] = [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
];

type CutoffSettlement = {
  status: CheckoutSettlementStatus;
  actualCheckoutDate: Date | null;
};

export function resolveCheckoutCutoff(rows: CutoffSettlement[]): Date | null {
  return (
    rows.find(
      (row) =>
        ACTIVE_CHECKOUT_CUTOFF_STATUSES.includes(row.status) &&
        row.actualCheckoutDate,
    )?.actualCheckoutDate ?? null
  );
}

export function isRentBillPerformed(periodStart: Date, cutoff: Date | null) {
  return cutoff === null || periodStart.getTime() < cutoff.getTime();
}

export function effectiveRentBillStatus(
  status: RentBillStatus,
  periodStart: Date,
  cutoff: Date | null,
): RentBillStatus | 'PENDING_CHECKOUT_REVIEW' {
  if (['VOIDED', 'REFUNDED'].includes(status)) return status;
  return isRentBillPerformed(periodStart, cutoff)
    ? status
    : 'PENDING_CHECKOUT_REVIEW';
}
```

- [ ] **Step 4: 增加多条未取消退租、空日期和终态账单测试并运行**

Run: `npm --prefix backend test -- --runInBand --runTestsByPath src/checkout/checkout-accounting-cutoff.spec.ts`

Expected: PASS；确认 `VOIDED/REFUNDED` 保留终态；边界外的 `PENDING/PARTIAL/OVERDUE/PAID` 均投影为“待退租核算”，因为已收账单仍可能等待退还租金。

- [ ] **Step 5: 提交领域规则**

```bash
git add backend/src/checkout/checkout-accounting-cutoff.ts backend/src/checkout/checkout-accounting-cutoff.spec.ts
git commit -m "feat: define checkout accounting cutoff"
```

---

### Task 2: 在发起退租时录入实际退房日期并按日期获取快照

**Files:**
- Create: `backend/src/checkout/dto/checkout-finance-snapshot-query.dto.ts`
- Modify: `backend/src/checkout/dto/initiate-checkout.dto.ts`
- Modify: `backend/src/checkout/checkout.controller.ts`
- Modify: `backend/src/checkout/checkout.controller.spec.ts`
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`

**Interfaces:**
- Consumes: `isRentBillPerformed()` from Task 1.
- Produces: `InitiateCheckoutDto.actualCheckoutDate?: string`。
- Produces: `CheckoutFinanceSnapshotQueryDto.actualCheckoutDate?: string`。
- Changes: `getFinanceSnapshot(contractId: number, actualCheckoutDate?: string, now?: Date)`。

- [ ] **Step 1: 写发起日期保存和边界验证失败测试**

```ts
it('stores an optional historical actual checkout date at initiation', async () => {
  await service.initiate(8, {
    checkoutType: '提前退租',
    plannedCheckoutDate: '2026-09-01',
    actualCheckoutDate: '2026-09-01',
    handoverDate: '2026-09-01',
    inspectionAt: '2026-09-01',
    checkoutReason: '租户已退房，补录申请',
    targetRoomStatus: 'EMPTY',
  }, user);
  expect(tx.checkoutSettlement.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        actualCheckoutDate: new Date('2026-09-01'),
      }),
    }),
  );
});

it('rejects an actual checkout date after the business day', async () => {
  await expect(service.initiate(8, futureDto, user)).rejects.toThrow(
    '实际退房日期不能晚于当前日期',
  );
});
```

- [ ] **Step 2: 写快照相等边界失败测试**

```ts
it('excludes a bill starting on the actual checkout date from arrears', async () => {
  const result = await service.getFinanceSnapshot(8, '2026-09-01');
  expect(result.rentOutstanding).toBe('0.00');
  expect(result.futureBillCount).toBe(1);
});
```

- [ ] **Step 3: 运行后端专项测试并确认失败原因是字段和口径尚未实现**

Run: `npm --prefix backend test -- --runInBand --runTestsByPath src/checkout/checkout.controller.spec.ts src/checkout/checkout.service.spec.ts`

Expected: FAIL，字段未传递、快照仍把 `periodStart === actualCheckoutDate` 算入当前欠租。

- [ ] **Step 4: 增加 DTO、控制器查询参数和服务校验**

```ts
export class CheckoutFinanceSnapshotQueryDto {
  @IsOptional()
  @IsDateString()
  actualCheckoutDate?: string;
}

export class InitiateCheckoutDto {
  @IsOptional()
  @IsDateString()
  actualCheckoutDate?: string;
  @IsString() @Length(1, 50) checkoutType!: string;
  @IsDateString() plannedCheckoutDate!: string;
  @IsDateString() handoverDate!: string;
  @IsDateString() inspectionAt!: string;
  @IsString() @Length(1, 500) checkoutReason!: string;
  @IsEnum(RoomStatus) targetRoomStatus!: RoomStatus;
}
```

控制器必须传递查询值：

```ts
async financeSnapshot(
  @Param('contractId', ParseIntPipe) contractId: number,
  @Query() query: CheckoutFinanceSnapshotQueryDto,
) {
  return {
    code: 200,
    message: 'success',
    data: await this.checkout.getFinanceSnapshot(
      contractId,
      query.actualCheckoutDate,
    ),
  };
}
```

- [ ] **Step 5: 使用业务日校验并保存日期，快照改用严格小于边界**

```ts
const actual = dto.actualCheckoutDate
  ? contractBusinessDay(new Date(dto.actualCheckoutDate))
  : null;
const today = contractBusinessDay();
if (actual && actual > today)
  throw new BadRequestException('实际退房日期不能晚于当前日期');
if (actual && contract.status !== 'PENDING_START' && actual < contract.startDate)
  throw new BadRequestException('实际退房日期不能早于合同开始日期');
```

`getFinanceSnapshot` 仅将 `isRentBillPerformed(bill.periodStart, cutoff)` 的有效租金账单计入欠租，其余计入未来账单数量。

- [ ] **Step 6: 运行专项测试、DTO 校验测试和 lint**

Run: `npm --prefix backend test -- --runInBand --runTestsByPath src/checkout/checkout.controller.spec.ts src/checkout/checkout.service.spec.ts`

Run: `npm --prefix backend run lint`

Expected: PASS；无 `any`、无日期字符串直接比较。

- [ ] **Step 7: 提交发起与快照接口**

```bash
git add backend/src/checkout/dto backend/src/checkout/checkout.controller.ts backend/src/checkout/checkout.controller.spec.ts backend/src/checkout/checkout.service.ts backend/src/checkout/checkout.service.spec.ts
git commit -m "feat: capture actual date when checkout starts"
```

---

### Task 3: 更新发起退租页面和快照刷新交互

**Files:**
- Modify: `frontend/src/services/checkout.ts`
- Modify: `frontend/src/views/checkout/checkout-types.ts`
- Modify: `frontend/src/views/checkout/CheckoutInitiatePanel.vue`
- Modify: `frontend/src/views/checkout/CheckoutWorkspace.vue`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`

**Interfaces:**
- Consumes: Task 2 的可选 `actualCheckoutDate` 快照参数和发起字段。
- Produces: `CheckoutInitiatePanel` emit `actualDateChange: [actualCheckoutDate: string]`。
- Changes: `checkoutApi.financeSnapshot(contractId, actualCheckoutDate?)`。

- [ ] **Step 1: 写可选字段、刷新和自动带入的失败测试**

```ts
it('refreshes the finance snapshot with the entered actual checkout date', async () => {
  const wrapper = mount(CheckoutWorkspace, testOptions());
  await selectContract(wrapper, 8);
  await wrapper.get('[data-test="initiate-actual-checkout-date"]').setValue('2026-09-01');
  expect(checkoutApi.financeSnapshot).toHaveBeenLastCalledWith(8, '2026-09-01');
});

it('submits the optional actual checkout date', async () => {
  // fill the initiate form and click submit
  expect(checkoutApi.initiate).toHaveBeenCalledWith(
    8,
    expect.objectContaining({ actualCheckoutDate: '2026-09-01' }),
  );
});
```

- [ ] **Step 2: 运行前端专项测试并确认找不到新控件或新参数**

Run: `npm --prefix frontend test -- --run src/views/checkout/checkout-workspace.spec.ts`

Expected: FAIL，`initiate-actual-checkout-date` 不存在或 API 仍只收到合同 ID。

- [ ] **Step 3: 增加可选输入框和明确说明**

```vue
<label class="form-field">
  <span>实际退房日期</span>
  <input
    data-test="initiate-actual-checkout-date"
    v-model="form.actualCheckoutDate"
    type="date"
    lang="zh-CN"
    :max="today"
    @change="emit('actualDateChange', form.actualCheckoutDate)"
  />
  <small>已经退房后补录时填写；尚未退房可留空</small>
</label>
```

表单初值为 `actualCheckoutDate: ''`；发起成功后的结算详情使用后端返回值，结算面板现有 `isoDate(settlement.actualCheckoutDate)` 自动带入。

- [ ] **Step 4: 修改快照 API 与工作区刷新，处理过期请求**

```ts
financeSnapshot: async (contractId: number, actualCheckoutDate?: string) =>
  data(await http.get(
    `/checkout-settlements/contract/${contractId}/finance-snapshot`,
    { params: actualCheckoutDate ? { actualCheckoutDate } : undefined },
  )),
```

工作区保存当前合同 ID；日期变化时重新请求。使用递增请求序号，只接收最后一次响应，防止快速改日期时旧快照覆盖新快照。

- [ ] **Step 5: 运行前端专项测试、完整前端测试和构建**

Run: `npm --prefix frontend test -- --run src/views/checkout/checkout-workspace.spec.ts`

Run: `npm --prefix frontend test -- --run`

Run: `npm --prefix frontend run build`

Expected: PASS；日期清空后 API 恢复无截止日期快照。

- [ ] **Step 6: 提交前端交互**

```bash
git add frontend/src/services/checkout.ts frontend/src/views/checkout/checkout-types.ts frontend/src/views/checkout/CheckoutInitiatePanel.vue frontend/src/views/checkout/CheckoutWorkspace.vue frontend/src/views/checkout/checkout-workspace.spec.ts
git commit -m "feat: enter actual date when initiating checkout"
```

---

### Task 4: 统一退租预览、欠租和最终账单边界

**Files:**
- Modify: `backend/src/checkout/checkout.service.ts`
- Modify: `backend/src/checkout/checkout.service.spec.ts`
- Modify: `backend/src/checkout/checkout-future-bill-normalization.ts`
- Modify: `backend/src/checkout/checkout-future-bill-normalization.spec.ts`
- Modify: `backend/src/checkout/checkout-approved-cancellation.ts`
- Modify: `backend/src/checkout/checkout-approved-cancellation.spec.ts`
- Modify: `backend/src/checkout/checkout-completed-reversal.ts`
- Modify: `backend/src/checkout/checkout-completed-reversal.spec.ts`
- Modify: `backend/src/checkout/checkout-rent-refund-allocation.spec.ts`

**Interfaces:**
- Consumes: `isRentBillPerformed()` from Task 1.
- Changes: future/unperformed SQL and Prisma filters from `periodStart > actualCheckoutDate` to `periodStart >= actualCheckoutDate`。
- Preserves: current-period rent refund eligibility when `periodStart < actualCheckoutDate && periodEnd >= actualCheckoutDate`。

- [ ] **Step 1: 为账期开始日等于退房日写退租预览和确认失败测试**

```ts
it('does not declare a checkout-day bill as arrears', async () => {
  const bill = rentBill({
    periodStart: new Date('2026-09-01'),
    periodEnd: new Date('2026-09-30'),
    outstandingAmount: decimal('1600.00'),
    status: 'OVERDUE',
  });
  const result = await service.preview(5, settlementDto('2026-09-01'));
  expect(result.rentOutstanding).toBe('0.00');
});
```

- [ ] **Step 2: 为等于边界的未来账单冲销和撤销恢复写失败测试**

```ts
expect(tx.rentBill.findMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: expect.objectContaining({
      periodStart: { gte: new Date('2026-09-01') },
    }),
  }),
);
```

撤销测试必须证明该账单恢复后按原到期日得到 `PENDING/PARTIAL/OVERDUE/PAID`，而不是永久保持 `VOIDED`。

- [ ] **Step 3: 运行退租边界专项测试并确认等号场景失败**

Run: `npm --prefix backend test -- --runInBand --runTestsByPath src/checkout/checkout.service.spec.ts src/checkout/checkout-future-bill-normalization.spec.ts src/checkout/checkout-approved-cancellation.spec.ts src/checkout/checkout-completed-reversal.spec.ts src/checkout/checkout-rent-refund-allocation.spec.ts`

Expected: FAIL，现有 `<=` 或 `>` 将退房日账单归入错误一侧。

- [ ] **Step 4: 用共享谓词替换内存计算，用 `gte` 修正数据库范围**

```ts
const eligibleBills = settlement.contract.bills.filter(
  (bill) =>
    isRentBillPerformed(bill.periodStart, actual) &&
    !['VOIDED', 'REFUNDED'].includes(bill.status),
);
```

所有未来账单锁定、冲销和恢复查询使用：

```ts
periodStart: { gte: input.actualCheckoutDate }
```

同步修正原生 SQL 中的 `>` 为 `>=`；不得只改 Prisma 查询而漏掉锁定 SQL。

- [ ] **Step 5: 增加预览后日期变化的冲突保护测试**

预览/提交/确认分别读取最新日期；若已预留退还租金或欠租项目与新日期不匹配，返回：

```ts
throw new ConflictException(
  '实际退房日期或账单已变化，请重新预估结算金额',
);
```

- [ ] **Step 6: 运行全部退租单元测试与 lint**

Run: `npm --prefix backend test -- --runInBand --runTestsByPath src/checkout/*.spec.ts`

Run: `npm --prefix backend run lint`

Expected: PASS；已有退款、押金抵扣、补收款、取消和撤销测试不退化。

- [ ] **Step 7: 提交退租核心口径**

```bash
git add backend/src/checkout
git commit -m "fix: calculate checkout through the day before move-out"
```

---

### Task 5: 统一租金账单、财务中心、驾驶舱和房源风险展示

**Files:**
- Modify: `backend/src/rent-bills/rent-bills.service.ts`
- Modify: `backend/src/rent-bills/rent-bills.service.spec.ts`
- Modify: `backend/src/finance/finance.service.ts`
- Modify: `backend/src/finance/finance.service.spec.ts`
- Modify: `backend/src/dashboard/dashboard.service.ts`
- Modify: `backend/src/dashboard/rent-collection-overview.spec.ts`
- Modify: `backend/src/dashboard/dashboard-room-card-rent.spec.ts`
- Modify: `backend/src/properties/room-details.service.ts`
- Modify: `backend/src/properties/room-details.service.spec.ts`
- Modify: `frontend/src/services/rentBillDisplay.ts`
- Modify: `frontend/src/services/rentBillDisplay.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `resolveCheckoutCutoff()`、`isRentBillPerformed()`、`effectiveRentBillStatus()`。
- Produces: API 虚拟展示状态 `PENDING_CHECKOUT_REVIEW`，中文“待退租核算”；不写入 Prisma enum 或数据库。

- [ ] **Step 1: 分别写四个后端出口的相等边界失败测试**

每个测试都构造：底层账单状态 `OVERDUE`、未收 `1600`、`periodStart` 与有效退租单 `actualCheckoutDate` 同为 `2026-09-01`。

```ts
expect(rentBillList.summary.overdueCount).toBe(0);
expect(rentBillList.summary.outstanding).toBe('0.00');
expect(rentBillList.items[0].status).toBe('PENDING_CHECKOUT_REVIEW');
expect(finance.total.originalReceivable.toFixed(2)).toBe('0.00');
expect(dashboard.arrears).toEqual([]);
expect(roomDetail.riskLabels).not.toContain('有逾期账单');
```

- [ ] **Step 2: 运行四个服务测试并确认当前均错误计入**

Run: `npm --prefix backend test -- --runInBand --runTestsByPath src/rent-bills/rent-bills.service.spec.ts src/finance/finance.service.spec.ts src/dashboard/rent-collection-overview.spec.ts src/dashboard/dashboard-room-card-rent.spec.ts src/properties/room-details.service.spec.ts`

Expected: FAIL，至少逾期笔数、财务应收、驾驶舱欠租或房源风险仍包含该账单。

- [ ] **Step 3: 查询合同的有效退租日期并在内存聚合前统一投影**

所有相关账单查询的合同 include 增加：

```ts
checkoutSettlements: {
  where: { status: { in: ACTIVE_CHECKOUT_CUTOFF_STATUSES } },
  select: { status: true, actualCheckoutDate: true },
  orderBy: { id: 'desc' },
},
```

映射时统一使用：

```ts
const cutoff = resolveCheckoutCutoff(bill.contract.checkoutSettlements);
const performed = isRentBillPerformed(bill.periodStart, cutoff);
const displayStatus = effectiveRentBillStatus(
  bill.status,
  bill.periodStart,
  cutoff,
);
```

原应收、净应收、未收、提醒、欠租和风险只消费 `performed === true` 的账单。已经真实分配到未履行账期的有效收款必须继续计入有效实收和现金流水，直到退款确认或收款回冲实际发生；不得因填写退房日期而提前减少现金。租金账单列表仍显示未履行账单，但返回虚拟状态；状态筛选和 `total` 必须在投影后计算，避免“逾期筛选显示 0 条但总数不为 0”。

- [ ] **Step 4: 防止逾期落库任务重新标记待退租核算账单**

把 `reconcileOverdueBills` 改为先读取候选账单及有效退租日期，只对已履行候选 ID 执行受限更新：

```ts
const eligibleIds = candidates
  .filter((bill) =>
    isRentBillPerformed(
      bill.periodStart,
      resolveCheckoutCutoff(bill.contract.checkoutSettlements),
    ),
  )
  .map((bill) => bill.id);
if (eligibleIds.length)
  await this.prisma.db.rentBill.updateMany({
    where: { id: { in: eligibleIds }, status: { in: ['PENDING', 'PARTIAL'] } },
    data: { status: 'OVERDUE' },
  });
```

已有底层 `OVERDUE` 不做破坏性回写；查询层投影负责显示“待退租核算”。

- [ ] **Step 5: 增加中文状态并验证前端显示**

```ts
PENDING_CHECKOUT_REVIEW: { label: '待退租核算', type: 'warning' },
```

Run: `npm --prefix frontend test -- --run src/services/rentBillDisplay.spec.ts`

Expected: PASS，页面不再显示英文或“逾期”。

- [ ] **Step 6: 增加取消退租恢复统计测试**

同一账单在有效退租单存在时不计逾期；将退租单改为 `CANCELLED` 后重新调用服务，账单按当前业务日重新进入逾期、财务和风险统计。

- [ ] **Step 7: 运行专项、完整后端测试、前端测试和构建**

Run: `npm --prefix backend test -- --runInBand --runTestsByPath src/rent-bills/rent-bills.service.spec.ts src/finance/finance.service.spec.ts src/dashboard/rent-collection-overview.spec.ts src/dashboard/dashboard-room-card-rent.spec.ts src/properties/room-details.service.spec.ts`

Run: `npm --prefix backend test -- --runInBand`

Run: `npm --prefix frontend test -- --run`

Run: `npm --prefix backend run build`

Run: `npm --prefix frontend run build`

Expected: PASS；所有汇总对同一账单得出一致结果。

- [ ] **Step 8: 提交跨模块统一口径**

```bash
git add backend/src/rent-bills backend/src/finance backend/src/dashboard backend/src/properties frontend/src/services/rentBillDisplay.ts frontend/src/services/rentBillDisplay.spec.ts
git commit -m "fix: exclude unperformed checkout bills from arrears"
```

---

### Task 6: 增加真实退租回归场景并完成安全验证

**Files:**
- Create: `backend/test/checkout-actual-date-accounting.e2e-spec.ts`
- Modify: `frontend/src/views/checkout/checkout-workspace.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–5 的 API、共享截止规则和虚拟状态。
- Produces: 延迟补录、取消恢复、结算改期的端到端回归证明。

- [ ] **Step 1: 创建独立 E2E 套件和明确的隔离 fixture**

新套件必须先调用 `runAfterDisposableE2eDatabaseGuard()` 再动态导入 `AppModule`，并沿用现有 JWT guard override。fixture 明确定义：

```ts
type AccountingFixtureOptions = {
  contractStatus: 'ACTIVE' | 'PENDING_START';
  contractStart: string;
  billPeriodStart: string;
  billPeriodEnd: string;
  billDueDate: string;
  billStatus: 'PENDING' | 'PARTIAL' | 'OVERDUE' | 'PAID';
  payableAmount: string;
  receivedAmount: string;
  outstandingAmount: string;
};

async function createAccountingFixture(
  label: string,
  options: AccountingFixtureOptions,
): Promise<{ contractId: number; billId: number }> {
  return prisma.db.$transaction(async (tx) => {
    const tag = `${suitePrefix}-${label}`;
    const building = await tx.building.create({
      data: {
        buildingNo: tag.slice(0, 20),
        buildingName: `退租日期核算-${label}`,
        floorCount: 1,
        remark: '隔离 E2E 数据',
      },
    });
    const room = await tx.room.create({
      data: {
        buildingId: building.id,
        houseNo: '101',
        fullHouseNo: `${tag.slice(0, 20)}栋101`,
        floorNo: 1,
        roomType: 'RESIDENTIAL',
        area: new Prisma.Decimal('50.00'),
        usageType: 'RESIDENCE',
        roomStatus:
          options.contractStatus === 'ACTIVE' ? 'RENTED' : 'PENDING_MOVE_IN',
        remark: '隔离 E2E 数据',
      },
    });
    const tenant = await tx.tenant.create({
      data: { name: `退租日期租户-${label}`, remark: '隔离 E2E 数据' },
    });
    const contract = await tx.contract.create({
      data: {
        contractNo: `${tag}-C`.slice(0, 120),
        externalContractNo: `${tag}-EXT`.slice(0, 80),
        roomId: room.id,
        startDate: new Date(`${options.contractStart}T00:00:00.000Z`),
        endDate: new Date('2027-12-31T00:00:00.000Z'),
        monthlyRent: new Prisma.Decimal(options.payableAmount),
        pricingMode: 'FIXED',
        paymentCycleMonths: 1,
        depositRequired: new Prisma.Decimal(0),
        status: options.contractStatus,
        activatedAt:
          options.contractStatus === 'ACTIVE'
            ? new Date(`${options.contractStart}T00:00:00.000Z`)
            : null,
        remark: '隔离 E2E 数据',
        members: {
          create: {
            tenantId: tenant.id,
            memberRole: 'PRIMARY',
            isCurrent: true,
          },
        },
      },
    });
    const bill = await tx.rentBill.create({
      data: {
        billNo: `${tag}-B`.slice(0, 40),
        contractId: contract.id,
        periodSeq: 1,
        periodStart: new Date(`${options.billPeriodStart}T00:00:00.000Z`),
        periodEnd: new Date(`${options.billPeriodEnd}T00:00:00.000Z`),
        dueDate: new Date(`${options.billDueDate}T00:00:00.000Z`),
        unitMonthlyRent: new Prisma.Decimal(options.payableAmount),
        baseRentAmount: new Prisma.Decimal(options.payableAmount),
        payableAmount: new Prisma.Decimal(options.payableAmount),
        receivedAmount: new Prisma.Decimal(options.receivedAmount),
        outstandingAmount: new Prisma.Decimal(options.outstandingAmount),
        status: options.billStatus,
      },
    });
    cleanupScope.buildingIds.push(building.id);
    cleanupScope.roomIds.push(room.id);
    cleanupScope.tenantIds.push(tenant.id);
    cleanupScope.contractIds.push(contract.id);
    cleanupScope.billIds.push(bill.id);
    return { contractId: contract.id, billId: bill.id };
  });
}
```

本套件不创建退款凭证、押金或预收款。`afterAll` 按账单、退租单、房态历史、合同成员、合同、承租人、房源、楼栋的逆依赖顺序删除，并断言带 `suitePrefix` 的楼栋、合同和账单数量均为 0。

- [ ] **Step 2: 写延迟补录等于账期开始日的 E2E 测试**

```ts
it('uses the entered move-out date instead of the later operation date', async () => {
  const fixture = await createAccountingFixture('equal-boundary', {
    contractStatus: 'ACTIVE',
    contractStart: '2026-08-01',
    billPeriodStart: '2026-09-01',
    billPeriodEnd: '2026-09-30',
    billDueDate: '2026-09-01',
    billStatus: 'OVERDUE',
    payableAmount: '1600.00',
    receivedAmount: '0.00',
    outstandingAmount: '1600.00',
  });
  await request(app.getHttpServer())
    .post(`/api/checkout-settlements/contract/${fixture.contractId}/initiate`)
    .send({
      checkoutType: '提前退租',
      plannedCheckoutDate: '2026-09-01',
      actualCheckoutDate: '2026-09-01',
      handoverDate: '2026-09-01',
      inspectionAt: '2026-09-01',
      checkoutReason: '实际已退房后补录',
      targetRoomStatus: 'EMPTY',
    })
    .expect(201);
  const bills = await request(app.getHttpServer())
    .get('/rent-bills?status=OVERDUE')
    .set(superAdminAuth)
    .expect(200);
  expect(bills.body.data.items).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ contract: { id: contractId } }),
    ]),
  );
  expect(bills.body.data.summary.overdueCount).toBe(0);
});
```

测试数据必须使用固定业务日期或相对当前隔离测试日期构造，不得依赖真实墙钟偶然通过。

- [ ] **Step 3: 增加跨期、日期修改和取消恢复 E2E**

- 跨期：`periodStart < actualCheckoutDate <= periodEnd` 仍进入当期结算。
- 改期：修改实际日期后旧预览提交失败，重新预览成功。
- 取消：取消退租后同一未收账单重新按合同原租期显示逾期。
- 待开始：实际日期早于合同开始日时所有租金账单均不计欠租。

- [ ] **Step 4: 先运行隔离纯测试和静态检查**

Run: `npm --prefix backend test -- --runInBand`

Run: `npm --prefix frontend test -- --run`

Run: `npm --prefix backend run lint`

Run: `npm --prefix backend run build`

Run: `npm --prefix frontend run build`

Run: `npm --prefix backend exec prisma validate -- --config test/prisma-e2e.config.ts`

Expected: 全部 PASS；任何失败都先修复，不得通过跳过测试或放宽断言绕过。

- [ ] **Step 5: 经明确数据库授权后运行公共隔离 E2E**

Run: `npm --prefix backend run test:e2e`

Expected: runner 创建唯一 `srms_e2e_*` 数据库、迁移、执行串行 E2E、删除该库，并确认共享数据库指纹未变化。不得在命令行打印连接串或密码。

- [ ] **Step 6: 独立确认临时库清理和共享指纹**

使用现有隔离运行器报告与只读校验确认：精确临时库不存在、全部 `srms_e2e_*` 为 0、共享测试库指纹与运行前一致。若清理或指纹校验失败，本任务不得标记完成。

- [ ] **Step 7: 检查最终差异和中文文案**

Run: `git diff --check 21a3e4e..HEAD`

Run: `rg -n "PENDING_CHECKOUT_REVIEW|实际退房日期不能|待退租核算" backend/src frontend/src`

Expected: 无空白错误；用户可见的新状态和错误均有中文映射。

- [ ] **Step 8: 提交端到端回归测试**

```bash
git add backend/test/checkout-actual-date-accounting.e2e-spec.ts frontend/src/views/checkout/checkout-workspace.spec.ts
git commit -m "test: cover delayed checkout accounting"
```

---

## Completion Criteria

- 9 月 1 日退房、9 月 3 日补录时，9 月 1 日开始的账单在所有页面均不算欠租或逾期。
- 发起阶段不填实际日期时不提前停止计租；填写后快照立即按该日期刷新。
- 结算改期会重新计算，旧预览不能提交。
- 完成、取消、已完成撤销和合同作废/纠错不产生重复冲销或永久丢失账单状态。
- 后端单元测试、前端测试、构建、lint、Prisma 校验和隔离 E2E 全绿。
- E2E 结束后临时数据库为 0，共享测试数据指纹不变，未接触生产数据库。
