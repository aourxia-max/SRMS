# Task 8 前端合同作废域层报告

## 状态

已完成；仅包含类型、API 客户端和中文展示 helper，未实现 Task 9 页面。

## 红灯证据

- `npm --prefix frontend run test:unit -- src/services/contract-voids.spec.ts src/components/contracts/voids/contract-void-presentation.spec.ts`
- 初次失败：展示 helper 模块不存在；`previewContractVoid`、提交、取消等 API 导出均为 `undefined`。

## 修改文件

- `frontend/src/types/contracts.ts`
- `frontend/src/services/contracts.ts`
- `frontend/src/services/contract-voids.spec.ts`
- `frontend/src/components/contracts/voids/contract-void-presentation.ts`
- `frontend/src/components/contracts/voids/contract-void-presentation.spec.ts`
- `frontend/src/utils/status-labels.ts`
- `frontend/src/utils/status-labels.spec.ts`

## 类型和 API 映射

- 金额字段均为 `string`；预览、申请、执行结果和冲销类型保留 `impactHash`、`executionBatchNo`、原始/纠错日期、生成实体来源和幂等键。
- 客户端严格对应后端 `GET /contracts/:id/void-preview`、列表/详情及提交、取消、确认、驳回 POST 接口，并统一解包 `{ code, message, data }`。
- 普通提交仅发送后端 `SubmitContractVoidRequestDto` 字段；确认只发送 `previewHash`、精确确认文本 `确认作废合同` 和执行幂等键。

## 中文映射

- 申请：`PENDING` 待确认、`COMPLETED` 已完成、`REJECTED` 已驳回、`CANCELLED` 已取消。
- 冲销：`RENT_BILL` 租金账单、`PAYMENT` 收款、`PAYMENT_ALLOCATION` 收款分配、`PREPAYMENT` 预收款、`DEPOSIT` 押金、`REFUND` 退款、`ADJUSTMENT` 账单调整、`PRICING_REBATE` 租金退差、`CHECKOUT` 退租结算、`COMMISSION` 租房提成、`ROOM_STATUS` 房态。
- 合同 `VOIDED` 保持“已作废”；未知合同、申请及分类代码显示 `未知状态（<value>）`。

## 命令和结果

- 聚焦绿灯：3 个文件、12 项通过。
- 完整前端单测：35 文件、170 项通过。
- `npm --prefix frontend run build`：通过；仅有既存的大 chunk 警告。
- `git diff --check`：通过。

## 自审
