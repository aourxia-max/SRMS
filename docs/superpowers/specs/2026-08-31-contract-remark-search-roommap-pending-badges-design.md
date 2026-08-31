# 合同备注、合同检索、房态图与统一待审批提醒设计

日期：2026-08-31  
状态：已确认设计，待实施

## 1. 目标

在不修改现有金额口径、审批状态和业务流程的前提下，完成四项易用性改进：

1. 已确认合同的备注可以在合同详情后续补填、修改或清空。
2. 合同变更页面的合同选择项支持输入检索。
3. 驾驶舱楼栋房态图可视区域高度提高 50%。
4. 所有现有审批入口在存在待审批事项时显示红色数量提醒。

本设计只增加维护入口、检索能力、展示高度和审批数量提醒，不新增审批状态，不改变审批权限，不自动处理任何待审批业务。

## 2. 合同备注后续维护

### 2.1 页面交互

- 合同详情“合同概况”中的“合同备注”旁增加“编辑备注”操作。
- 仅管理员和超级管理员显示编辑入口；游客只能查看。
- 点击后打开小型编辑弹窗，回填当前备注。
- 备注最多 500 个字符；允许留空，留空保存表示清除备注。
- 保存成功后关闭弹窗并立即刷新合同详情，不需要重新进入页面。
- 已结束合同允许维护备注；已作废合同保持只读，防止修改已经封存的纠错结果。

### 2.2 后端接口

- 新增 `PATCH /api/contracts/:id/remark`。
- 请求体：`{ "remark": string | null }`。
- 空字符串在服务端去除首尾空白后保存为 `null`。
- 仅 `ADMIN`、`SUPER_ADMIN` 可调用，后端强制校验；游客调用返回无权限。
- 使用数据库事务锁定合同，校验合同存在且状态不是 `VOIDED`，只更新 `remark` 字段。
- 同一事务写入操作日志，记录合同编号、修改前备注、修改后备注、操作人和时间。
- 返回最小结果 `{ id, remark, updatedAt }`，不返回额外财务数据。

## 3. 合同变更合同检索

- 现有合同下拉框改为 `filterable`、`clearable`，用户可直接输入关键词。
- 支持按系统合同编号、完整楼栋房号、当前主承租人姓名检索。
- 选项统一显示：`合同编号｜楼栋房号｜主承租人`。
- 仍然只能从后端返回的现有合同中选择，不允许把任意文本当作合同提交。
- 本轮使用已加载合同列表做本地检索；现有房源规模下无需增加远程搜索接口。
- 选择合同后的优惠、账单和变更记录加载逻辑保持不变。

## 4. 楼栋房态图高度

- 楼栋房态图滚动容器的最大高度由 `430px` 调整为 `645px`，提高 50%。
- 房间卡片、楼层标签、颜色、点击跳转和筛选行为不变。
- 当内容高度不足 645px 时不强制撑满；超过 645px 时继续使用局部滚动。
- 移动端不增加固定最小高度，避免小屏产生过长空白。

## 5. 统一待审批数量

### 5.1 统计口径

新增统一只读接口 `GET /api/approval-tasks/counts`，一次返回当前系统各类待审批数量。所有数量均直接按数据库当前状态计算：

| 键 | 数据来源 | 待审批条件 | 展示入口 |
|---|---|---|---|
| `contractChanges` | `contract_changes` | `approval_status = PENDING` | 左侧“合同变更” |
| `fixedRentRebates` | `pricing_rebates` | `approval_status = PENDING` | 合同顶部“固定月租退差” |
| `contractVoidRequests` | `contract_void_requests` | `status = PENDING` | 合同顶部“合同作废／纠错” |
| `billAdjustments` | `bill_adjustments` | `approval_status = PENDING` | 左侧“收款管理”汇总 |
| `paymentRefunds` | `payment_refunds` | `approval_status = PENDING` | 收款顶部“退款/作废确认” |
| `paymentVoidRequests` | `payment_void_requests` | `approval_status = PENDING` | 收款顶部“退款/作废确认” |
| `checkoutSettlements` | `checkout_settlements` | `status = PENDING` | 退租顶部“退租结算” |
| `depositRefunds` | `deposit_refunds` | `approval_status = PENDING` | 退租顶部“退租退款确认” |

接口同时返回模块汇总：

- `contractsTotal = contractChanges + fixedRentRebates + contractVoidRequests`
- `paymentsTotal = billAdjustments + paymentRefunds + paymentVoidRequests`
- `checkoutsTotal = checkoutSettlements + depositRefunds`
- `total = contractsTotal + paymentsTotal + checkoutsTotal`

示例结构：

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "contractChanges": 0,
    "fixedRentRebates": 0,
    "contractVoidRequests": 0,
    "billAdjustments": 0,
    "paymentRefunds": 0,
    "paymentVoidRequests": 0,
    "checkoutSettlements": 0,
    "depositRefunds": 0,
    "contractsTotal": 0,
    "paymentsTotal": 0,
    "checkoutsTotal": 0,
    "total": 0
  }
}
```

### 5.2 权限与数据最小化

- 接口必须经过 JWT 会话校验。
- 超级管理员和管理员可获取数量；游客返回全零，不暴露后台待审批规模。
- 返回值只有数量，不返回合同、租户、房号、金额或申请详情。
- 红点只用于提醒，不能代替页面和后端现有审批权限；管理员仍不能执行仅限超级管理员的确认操作。

### 5.3 展示规则

- 数量为 0 时不显示红点。
- 数量为 1–99 时显示实际数字；超过 99 显示 `99+`。
- 红点位于导航文字右上角，不遮挡文字，不改变原导航点击区域。
- 左侧导航显示模块汇总：
  - “合同管理”显示 `contractsTotal`。
  - “合同变更”显示 `contractChanges`。
  - “收款管理”显示 `paymentsTotal`。
  - “退租结算”显示 `checkoutsTotal`。
- 模块顶部导航显示具体数量：
  - “固定月租退差”显示 `fixedRentRebates`。
  - “合同作废／纠错”显示 `contractVoidRequests`。
  - “退款/作废确认”显示 `paymentRefunds + paymentVoidRequests`。
  - “退租结算”显示 `checkoutSettlements`。
  - “退租退款确认”显示 `depositRefunds`。
- 账单调整当前没有独立审批导航，因此只计入“收款管理”模块汇总，不新增新的审批页面。

### 5.4 前端状态与刷新

- 新增全局待审批数量 Store，避免各导航组件重复请求和统计。
- 登录恢复完成后加载一次。
- 路由切换时刷新一次。
- 完成提交、确认、驳回、取消等会改变审批状态的操作后主动刷新。
- 页面保持登录时每 60 秒刷新一次，用于看到其他管理员产生或处理的事项。
- 退出登录时清空全部数量并停止定时刷新。
- 刷新失败不阻断当前页面；保留最近一次成功数量，并在下一次触发时重试。

## 6. 组件边界

- 后端新增独立的 `ApprovalTasksModule`、Controller 和 Service，只负责聚合数量，不承载审批动作。
- 前端新增 `approvalTasks` service、Pinia Store 和可复用的 `PendingCountBadge` 组件。
- `App.vue`、合同顶部导航、收款顶部导航和退租顶部导航只消费 Store，不自行访问具体审批接口。
- 合同备注接口继续放在合同模块中，不与统一待办统计耦合。

## 7. 错误处理

- 合同不存在：返回 404 中文提示。
- 已作废合同修改备注：返回 400 或 409 中文提示“已作废合同不能修改备注”。
- 备注超过 500 字：DTO 校验返回中文可理解提示，前端同时限制输入长度。
- 待审批统计失败：页面正常打开，不显示错误的零值覆盖最近成功数据。
- 任一数量不得为负数或小数；前端对异常响应按 0 处理并等待下次刷新。

## 8. 测试与验收

### 8.1 后端

- 合同备注补填、修改、清空。
- 已结束合同允许修改；已作废合同拒绝修改。
- 游客和未登录用户不能修改。
- 修改事务写入正确的前后值操作日志。
- 8 类待审批数据分别计数正确，模块汇总和总数正确。
- 管理员、超级管理员、游客返回值符合权限规则。
- 统计接口不返回房号、承租人、金额等业务明细。

### 8.2 前端

- 合同详情备注弹窗回填、保存、清空和失败提示。
- 合同选择器能按合同编号、房号、承租人检索，且不能提交自由文本。
- 房态图最大高度为 645px，房间卡片尺寸未改变。
- 各导航入口使用正确的具体数量或模块汇总。
- 0 隐藏、1–99 原数显示、100 及以上显示 `99+`。
- 游客不显示红点；退出登录后红点清空。
- 路由切换、审批操作和 60 秒定时刷新行为正确。

### 8.3 完整验证

- 后端全量单元测试。
- 前端全量单元测试。
- 待审批统计和合同备注接口 E2E。
- Lint、Prisma 校验、前后端生产构建。
- 测试环境仅重建 API 和 Web；不重建或清空 MySQL。

## 9. 非目标

- 不新增审批流程、审批状态或审批权限。
- 不建立新的账单调整审批页面。
- 不改变合同金额、租期、承租人、房态或任何财务计算规则。
- 不使用 WebSocket；本轮采用主动刷新加 60 秒轮询。
- 不修改数据库结构，不新增 migration。
