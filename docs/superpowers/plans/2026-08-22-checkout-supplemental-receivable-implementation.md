# 退租补收与最终确认修复实施计划

> **实施前提**：本计划采用用户于 2026-08-22 确认的修正口径：用户界面是一张“退租补收单”，但不得新建一张包含欠租总额的重复租金账单。欠租收款必须核销原租金账单；仅剩余验房扣款使用专用补收账单。

## 目标

修复退租结算中 `finalReceivable > 0` 无法完成的闭环，同时保证不重复统计租金欠款、租金收入、应收与收缴率。管理员可按既有收款流程分次登记补收；仅超级管理员在补收清零且退款条件满足后可最终完成退租。

## 关键数据口径

- `CheckoutSettlement` 是唯一可见的“退租补收单”汇总载体，锁定：欠租补收、验房扣款补收、补收总额、已收、未收与收清时间。
- 欠租补收对应实际退房日前有效原 `RENT` 账单在押金抵扣后的未收余额；支付分配直接更新这些账单。
- 验房扣款补收对应一条可选的 `CHECKOUT_SUPPLEMENTAL` 账单；其金额仅为押金抵扣后的剩余验房扣款，不能包含欠租。
- 一张结算单的补收余额 = 关联原欠租账单未收余额 + 专用验房补收账单未收余额；不得创建欠租副本。
- 收款优先顺序固定为原欠租账单（按到期日、期数）→ 验房补收账单；不允许跳过、转预收款、优惠/减免或超额支付。

## 任务 1：更新已确认规格与数据库模型

**文件：**
- 修改：`docs/superpowers/specs/2026-08-22-checkout-supplemental-receivable-design.md`
- 修改：`backend/prisma/schema.prisma`
- 新增：`backend/prisma/migrations/<timestamp>_checkout_supplemental_receivable/migration.sql`

**步骤：**
1. 将规格中的“补收单复用一张总额 RentBill”修正为本计划的汇总单方案，并保留不计入租金统计的验房补收账单要求。
2. 新增 `RentBillCategory`：`RENT`、`CHECKOUT_SUPPLEMENTAL`；已有账单默认 `RENT`。
3. `RentBill` 新增 `billCategory`、可空唯一 `checkoutSettlementId`，仅专用验房补收账单使用。
4. `CheckoutSettlement` 新增不可变快照字段：`supplementalArrearsAmount`、`supplementalInspectionAmount`、`supplementalReceivedAmount`、`supplementalOutstandingAmount`、`supplementalCollectedAt`；添加关联的验房补收账单。
5. `PaymentCategory` 新增 `CHECKOUT_SUPPLEMENTAL`，以便票据和资金流水可区分来源。
6. 迁移为旧账单回填 `RENT`，不为历史退租结算生成任何补收记录。

**先写测试：** Prisma schema 校验与迁移后，现有账单默认 `RENT`；同一结算单不能关联两张验房补收账单。

**验证：** `npx prisma validate`、迁移应用到隔离测试库、生成 Prisma Client。

## 任务 2：为退租结算增加补收汇总查询与生成

**文件：**
- 修改：`backend/src/checkout/checkout.service.ts`
- 修改：`backend/src/checkout/checkout.controller.ts`
- 修改：`backend/src/checkout/checkout.module.ts`（如需注入服务）
- 修改：`backend/src/checkout/checkout.service.spec.ts`
- 新增或修改：`backend/src/checkout/checkout-supplemental*.spec.ts`

**步骤：**
1. 先为“确认结算后按押金抵扣结果锁定欠租和验房两个补收分量”的场景写失败测试。
2. 在确认结算的同一事务中：锁定合同、结算、有效账单；先执行既有押金抵扣；计算原账单剩余欠租与剩余验房扣款。
3. 写入汇总快照和总额；仅验房扣款大于零时创建专用验房补收账单及唯一关联。
4. 为补收汇总增加只读查询接口，返回来源账单、已收/未收、状态、可收金额和关联收款。
5. 所有响应使用中文显示字段或稳定枚举，由前端统一中文化；拒绝未授权角色访问敏感写接口。

**验证：**
- 仅欠租：不创建验房补收账单，补收余额等于原账单余额。
- 仅验房扣款：创建一张专用账单。
- 两者都有：总额等于两个分量之和，且原欠租不重复入专用账单。
- 并发确认只成功一次。

## 任务 3：收款登记支持受限的退租补收分配

**文件：**
- 修改：`backend/src/payments/payments.service.ts`
- 修改：`backend/src/payments/payments.controller.ts`
- 修改：`backend/src/payments/dto/record-payment.dto.ts`
- 修改：`backend/src/payments/payments.service.spec.ts`
- 新增或修改：`backend/src/payments/payment-checkout-supplemental.spec.ts`

**步骤：**
1. 先写失败测试：管理员可对指定结算单部分收款；同一支付按原欠租优先、再验房补收分配。
2. 增加一个专用且受保护的收款入口（可复用 PaymentCollectView），请求只接受 `checkoutSettlementId`、金额、日期、方式、凭证及备注；后端自行计算可分配账单，客户端不能提交任意账单集合。
3. 用合同、结算和关联账单的行锁防止并发超收；金额上限为实时补收未收余额。
4. 生成 `Payment` 与现有 `PaymentAllocation`；类别设为 `CHECKOUT_SUPPLEMENTAL`；禁止预收、优惠、减免和人工跳期。
5. 每次收款、作废和退款后重新计算结算的补收已收/未收状态；不得通过作废或退款保留“已收清”。
6. 普通管理员、超级管理员可登记；访客被后端拒绝。

**验证：** 一次收清、两次部分收款、超额、跳过欠租、预收、优惠、访客、并发支付、作废/退款回退均有后端测试。

## 任务 4：最终确认与退款流程接入补收保护

**文件：**
- 修改：`backend/src/checkout/checkout.service.ts`
- 修改：`backend/src/checkout/deposit-refunds.service.ts`
- 修改：`backend/src/checkout/deposit-refunds.service.spec.ts`
- 修改：`backend/src/checkout/checkout.service.spec.ts`

**步骤：**
1. 先写失败测试：补收未收清时，零额最终确认与退款最终确认均返回中文拒绝；收清后仍仅超级管理员可最终完成。
2. 在 `completeZeroRefund`、退款审批完成路径和任何最终结束合同路径统一校验补收汇总未收金额为零。
3. 完成退租后保持只读：显示补收构成、支付记录、收清时间；禁止修改/取消已产生收款的结算。
4. 保持原有零额退租、仅退款退租和不涉及补收的历史行为。

**验证：** 未收清拒绝、收清后成功、退款路径成功、普通管理员拒绝最终确认，且合同/房态仅在成功最终确认后改变。

## 任务 5：财务、驾驶舱和账单查询隔离验房补收

**文件：**
- 修改：包含 `rentBill.findMany`、应收/实收/收缴率聚合的服务与测试（通过 `rg` 精确定位）
- 修改：`backend/src/payments/*` 的账单详情/列表查询
- 修改：相关 dashboard/finance 单元测试

**步骤：**
1. 先写失败测试：验房补收票据可在资金流水按“退租补收”看到，但不进入租金收入、净应收、租金收缴率。
2. 所有租金指标查询显式限定 `billCategory = RENT`；资金流水可单独统计 `CHECKOUT_SUPPLEMENTAL`。
3. 账单列表和详情将专用验房账单显示为中文“退租验房补收”，而非“第 N 期租金”。

**验证：** 创建混合退租样本后，对账租金指标不变、退租补收资金流可追溯。

## 任务 6：前端退租、收款与详情界面

**文件：**
- 修改：`frontend/src/views/checkout/CheckoutRefundPanel.vue`
- 修改：`frontend/src/views/checkout/CheckoutWorkspace.vue`
- 修改：`frontend/src/views/checkout/checkout-types.ts`
- 修改：`frontend/src/services/checkout.ts`（按实际文件名）
- 修改：`frontend/src/views/payments/PaymentCollectView.vue`
- 修改：`frontend/src/services/payments.ts`
- 修改：相关 Payment / RentBill detail view
- 修改：对应 `*.spec.ts`

**步骤：**
1. 先写组件测试：确认结算且存在待补收时显示“待补收”卡片和按钮，而非错误显示零退款完成入口。
2. 退租结算显示：欠租、验房扣款、补收合计、已收、未收、收款记录；状态仅显示中文。
3. “前往收款登记”带入 `checkoutSettlementId`，收款页自动锁定合同、展示补收构成与账单分配顺序、默认未收余额；禁止编辑账单选择、优惠/减免和预收提示。
4. 管理员能登记收款；最终确认按钮仅在超级管理员、补收收清且退款条件已满足时显示。
5. 已完成结算页面只读显示收清金额、收款票据与完成时间。
6. 补收收款失败显示后端返回的中文原因，不用笼统的“收款登记失败”覆盖关键提示。

**验证：** 前端单测覆盖三态卡片、跳转参数、锁定收款表单、中文金额和角色按钮；进行浏览器手工回归。

## 任务 7：端到端回归、文档和上线准备

**文件：**
- 修改：`docs/...` 验收记录或任务文档（按现有规范）
- 可选修改：部署说明（只在变更迁移/环境步骤时）

**步骤：**
1. 在隔离本机测试数据库应用迁移，建立四组数据：零额、仅欠租、仅验房、混合补收。
2. 通过 API 与前端完整执行：发起退租 → 确认结算 → 分次补收 → 退款（如有）→ 超管最终确认。
3. 回归收款作废、退款、普通管理员权限、访客权限、财务统计与已退租只读页面。
4. 运行后端单测、前端单测、构建、Lint、Prisma 校验和相关 E2E；记录实际命令与结果，不输出环境机密。
5. 只有所有验证通过后，准备合并/提交说明；不自动部署生产环境，部署前单独向用户确认。

## 完成标准

- 不再出现“应补收但前端可错误进入零额完成、后端又拒绝”的死锁。
- 不会重复创建或统计欠租。
- 所有补收金额、权限、状态变化与支付记录均可审计。
- 退租完成必须满足补收收清与既有退款安全条件。
- 全量现有自动化测试以及本功能新增测试通过。