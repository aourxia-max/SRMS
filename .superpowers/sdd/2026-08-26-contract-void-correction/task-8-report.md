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
客户端方法、URL 和请求体均由单测精确断言；类型未将金额 number 化；没有为普通管理员提交加入确认文案；未改动部署环境、密码、令牌或密钥。

## Fix round 1：详情冲销契约

- 根因：`requestInclude` 被列表和详情共用且没有 `reversals`，因此详情查询无法提供 Task 9 所需的原实体、生成实体、日期、金额和幂等键。
- 修复：新增仅供 `detail` 使用的 `requestDetailInclude`，加载 `reversals` 并按 `correctionOccurredAt asc, id asc` 排序；列表仍使用原轻量 include。前端 `ContractVoidRequest` 增加可选 `reversals`。
- 序列化证据：应用未注册额外响应序列化器；服务测试使用真实 `Prisma.Decimal` 与 `Date`，对 `JSON.stringify`/`JSON.parse` 后的详情断言 amount/balance 为字符串、日期为 ISO 文本，且保留生成来源和幂等键。

## Fix round 1 命令和结果

- 红灯：`npm --prefix backend test -- --runInBand contract-void-requests.service.spec.ts` 初始 1 失败，缺少详情 `reversals` include。
- 后端聚焦：22/22 通过。
- Task 8 前端聚焦：3 文件、13 项通过。
- 完整前端单测：35 文件、171 项通过；frontend build 通过（仅既有大 chunk 警告）。
- 后端 lint:check、完整单测（78 文件、453 项）和 backend build 均通过。
- `git diff --check` 通过。

## Fix round 1 自审和顾虑

详情响应的 relation 只在详情查询加载，避免列表 N×明细膨胀；排列顺序稳定。没有迁移、环境或凭据改动。唯一已知警告仍是前端既有大 chunk 警告；无功能阻塞。