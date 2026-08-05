# 租金账单主功能设计

## 目标

在左侧导航“租赁财务”下新增“租金账单”主功能，按已确认原型提供账单汇总、筛选、分页、账单详情抽屉和关联操作入口。功能只读取并展示现有合同生成的 `rent_bills` 快照，不改变 SRMS-RB-1.0 的计价、优惠、收款、退款、作废或退租规则。

## 范围

- 左侧导航新增“租金账单”，位于“收款管理”之前。
- 新增受保护接口 `GET /rent-bills`，支持关键词、楼栋、账单状态、账期月份、页码和页大小筛选，并返回分页结果与当前筛选范围汇总。
- 新增受保护接口 `GET /rent-bills/:id`，返回账单、合同、房源、当前主承租人、账单调整、收款分配和预收款关联信息。
- 前端按原型实现：页面标题、四个指标卡、筛选条、账单表格、状态标签、分页、详情抽屉；日期和状态均中文显示。
- 详情抽屉提供“登记收款”跳转到现有收款工作区、 “查看合同”跳转到合同页面；不在本功能重复创建账单或修改金额。
- 导出按钮沿用已有财务导出任务能力，使用当前筛选条件创建账单 Excel 导出任务；若现有导出接口不支持账单筛选，先提供明确的“功能准备中”提示，不伪造导出成功。

## 不在范围内

- 不新增账单金额字段，不重新计算历史账单，不改变尾期固定 30 天口径。
- 不直接登记收款、优惠、退款、作废、退租或合同变更；这些操作仍由现有模块和后端权限控制负责。
- 不将押金、预收款或提成计入租金账单应收/实收汇总。

## 数据与接口

`GET /rent-bills` 请求参数：

| 参数 | 类型 | 规则 |
| --- | --- | --- |
| `keyword` | string | 匹配账单编号、房号、合同编号、当前主承租人姓名；空值表示不限 |
| `buildingId` | number | 楼栋筛选；空值表示全部楼栋 |
| `status` | `RentBillStatus` | `PENDING`、`PARTIAL`、`PAID`、`OVERDUE`、`VOIDED`、`REFUNDED`；空值表示全部 |
| `month` | `YYYY-MM` | 按账单账期开始日筛选；空值表示不限 |
| `page` | number | 从 1 开始，默认 1 |
| `pageSize` | number | 10、20、50、100，默认 20 |

响应统一为 `{ code, message, data }`，其中 `data` 为：

```ts
type RentBillListData = {
  items: Array<{
    id: number
    billNo: string
    room: { id: number; fullHouseNo: string; buildingId: number; buildingName: string }
    contract: { id: number; contractNo: string }
    tenant: { id: number; name: string } | null
    periodStart: string
    periodEnd: string
    dueDate: string
    baseRentAmount: string
    rentFreeAmount: string
    discountAmount: string
    payableAmount: string
    receivedAmount: string
    outstandingAmount: string
    status: RentBillStatus
  }>
  page: number
  pageSize: number
  total: number
  summary: { payable: string; received: string; outstanding: string; count: number; overdueCount: number }
}
```

汇总金额直接由账单快照字段求和；`VOIDED` 和 `REFUNDED` 保留在列表中便于追溯，但不计入“本月应收/已收/待收”经营汇总。收款退款或作废后的账单状态和金额由现有事务服务维护，本页面只读。

`GET /rent-bills/:id` 返回同一账单的完整详情以及：

- 当前合同与房源基本信息；
- 当前主承租人（没有主承租人时返回 `null`）；
- 按时间倒序的账单调整记录；
- 收款分配与已回退金额；
- 预收款关联流水（只展示，不混入租金实收）。

## 前端交互

- 首次进入默认查询当前月份，默认每页 20 条；月份使用中文日期选择器。
- 关键词输入支持回车查询，查询按钮清空旧结果后重新加载；分页只改变页码，不改变筛选条件。
- 状态颜色：已支付绿色、部分支付橙色、逾期红色、待支付/未到期灰色、已退款/已作废使用弱化标签。
- 点击“查看详情”打开右侧抽屉；抽屉关闭后保留列表筛选和滚动位置。
- “登记收款”只跳转到 `/payments/collect?rentBillId=<id>`，由收款模块决定是否允许操作；后端仍强制角色校验。
- 详情金额展示原始租金、已确认优惠/减免、最终应收、已收和未收，不把待审批调整显示为已生效优惠。

## 权限与安全

- 列表和详情必须经过 JWT 守卫；普通管理员和超级管理员可查看，未登录返回 401。
- 后端按账单 ID 查询详情并校验关联数据，不接受前端提交的金额作为可信值。
- 响应不包含身份证号、完整手机号、财务账户信息或文件原始地址等越权字段。

## 测试验收

- 服务测试：关键词、楼栋、状态、月份筛选；分页稳定；汇总排除已作废/已退款账单；详情关联数据正确。
- 接口测试：未认证访问返回 401；普通管理员和超级管理员可读取；不存在账单返回 404；响应字段不含敏感数据。
- 前端测试：导航和路由、默认月份筛选、状态标签、详情抽屉、跳转链接、加载失败提示。
- 构建、Lint、单元测试和 e2e 必须在合并前通过。

## 原型与实现差异说明

原型中的“生成账单”按钮不直接创建账单，实际实现将其改为进入合同管理的生成账单流程或隐藏，避免重复生成账单。其余布局、信息层级、颜色和交互按原型执行。
