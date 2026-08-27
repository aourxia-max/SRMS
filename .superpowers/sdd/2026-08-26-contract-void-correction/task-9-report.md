# Task 9 合同作废／纠错工作区报告

## 状态

已完成。范围仅含 Task 9 的第五页签、作废纠错列表/详情/影响核对/风险确认/终态 UI、VOIDED 约束，以及历史证明附件受保护下载；未实现 Task 10+。

## 红灯证据

- 导航/入口首轮：`npm --prefix frontend run test:unit -- src/components/contracts/contract-top-nav.spec.ts src/components/contracts/contract-detail-void-entry.spec.ts src/views/contracts/contract-workspace.spec.ts`，3 文件失败，4 失败、31 通过；缺第五页签、精确 `void-correction(contractId)` 事件和面板。
- 面板首轮：`npm --prefix frontend run test:unit -- src/components/contracts/voids/contract-void-panel.spec.ts src/services/contract-voids.spec.ts src/components/contracts/contract-detail-void-entry.spec.ts`，3 文件失败，13 失败、7 通过；申请/执行/审批/驳回/取消、stale、附件、终态、筛选和 VOIDED 行为尚不存在。
- 历史附件下载首轮：`npm --prefix backend test -- contract-void.controller.spec.ts files.service.spec.ts --runInBand`，2 suite 失败，4 个新增测试失败、30 通过；下载 handler/service 尚不存在。
- 页签角色红灯：1 失败、1 通过，访客仍看到第五页签；强制路由红灯：1 失败、31 通过，访客可用 `?tab=void-correction` 渲染面板。实现导航、路由和渲染三层门禁后转绿。

## 修改文件

- 后端：`backend/src/contracts/contract-void.controller.ts`、对应 spec、`backend/src/files/files.service.ts`、对应 spec。
- 前端类型/client：`frontend/src/types/contracts.ts`、`frontend/src/services/contracts.ts`、`frontend/src/services/contract-voids.spec.ts`。
- 前端导航/详情：`ContractTopNav.vue`、`contract-top-nav.spec.ts`、`ContractDetailPanel.vue`、`contract-detail-void-entry.spec.ts`。
- 作废纠错 UI：`contract-void-presentation.ts`、`ContractVoidImpactCards.vue`、`ContractVoidPanel.vue`、`contract-void-panel.spec.ts`。
- 工作区：`ContractsWorkspace.vue`、`contract-workspace.spec.ts`。

## 角色/状态矩阵

| 角色/状态 | 入口 | 提交 | 执行/审核 | 取消 |
| --- | --- | --- | --- | --- |
| ADMIN + 非 VOIDED | 显示 | 允许 | 不显示 | 仅本人 PENDING |
| SUPER_ADMIN + 非 VOIDED | 显示 | 允许 | 精确口令后直接执行/确认；可驳回 | 任意 PENDING |
| VISITOR | 隐藏；强制 query 回退列表 | 不渲染 | 不渲染 | 不渲染 |
| 合同 VOIDED | 红色“已作废”；保留只读详情/附件/历史 | 禁止 | 禁止 | 不适用 |
| 请求 COMPLETED/REJECTED/CANCELLED | 终态只读详情 | 不显示 | 不显示 | 不显示 |

后端角色、归属和状态校验仍为最终权限边界；前端捕获后端错误、显示中文消息并恢复按钮状态。

## 交互与展示

- 第五页签精确 key `void-correction`、文字 `合同作废／纠错`；详情发送精确 `void-correction(contractId)` 并预选合同。
- 列表按合同编号、楼栋房号、租户姓名和待确认/已完成/已驳回/已取消筛选，展示申请号、合同、房号、租户、原因、提交人、状态、时间和详情。
- ADMIN 只能提交；SUPER_ADMIN 可普通提交或直接执行。直接执行与确认均使用 Element Plus prompt，validator 仅接受逐字符相等的 `确认作废合同`，不 trim、不接受相似文本。
- 终态显示证明附件和完整冲销卡片，保留类别、原实体来源、金额、原业务日期和纠错日期。
- bill/payment/deposit/prepayment/refund/final net 及当前净影响/计划冲销均按后端 `string` 用正则分组展示，不转 number；同时展示 pending workflow IDs、completed checkout IDs、后续合同、当前房态和房态动作。
- 状态、类别、来源、房态和动作使用 Task 8 中文 helper，未知值显示中文未知状态，不暴露 raw enum。

## 附件、stale 与防重

- 上传真实调用 `POST /contracts/void-request-files`，multipart 字段为 `file`；后端返回 FileAsset 后才建本地预览 URL 并关联 `fileAssetIds`，切换合同/卸载时回收 URL。
- 历史/终态附件调用 `GET /contracts/void-requests/:id/files/:fileId/download` 取 blob 后预览/下载。后端在查询前拒绝非 ADMIN/SUPER_ADMIN，并校验 requestId、fileAssetId、关联和 `CONTRACT_VOID_PROOF` 类别；固定 proof 目录并对 storedName 取 `basename`，响应沿用安全 Content-Type/UTF-8 Content-Disposition，不暴露 storagePath。
- 精确识别 400 + `合同关联数据已变化，请重新预览` 与 409 + `合同关联审批状态已并发变化，请重新预览`；仅重新 preview、替换 impactHash、刷新列表并提示 `合同关联数据已变化，已为你重新计算，请再次核对`，不自动重提/确认。
- submit 禁用同时检查 impactHash、必填 reason、合同有效性、附件上传和 saving；操作按钮及函数首部双重防重，提交/执行使用独立幂等键，finally 恢复 saving。

## 命令结果

- Task 9 frontend focused：5 文件、55 项通过。
- 完整 frontend unit：38 文件、192 项通过；`npm --prefix frontend run build` 通过，仅有既存大 chunk 警告。
- backend focused：2 suite、34 项通过；完整 backend unit：78 suite、457 项通过。
- `npm --prefix backend run lint:check`、`npm --prefix backend run build`、`git diff --check` 均通过；diff check 仅提示 Windows LF 将来可能转 CRLF，无空白错误。

## 自审与顾虑

测试使用具体现实合同/申请/影响/冲销/附件 fixture 并实际挂载 Element Plus；URL、multipart 字段、请求体和 prompt validator 均有精确断言。VOIDED 合同仍留在通用列表，详情隐藏收款、退租、退差、提成维护、附件追加及再次作废，附件/历史保留。未修改 env、secret、迁移或 Task 10+ 文件。

无功能阻塞。唯一已知非失败项是前端既有单包超过 500 kB 的 Vite 警告，本任务未扩展构建拆包范围。

## Fix round 1/5：刷新快照与临时证明生命周期

### 用户授权与边界

- 用户明确授权实施受保护的 `refresh-snapshot` 接口。
- 用户明确授权清理未提交的临时附件。实现严格限定为 `CONTRACT_VOID_PROOF`、上传者本人、未锁定、未关联任何作废申请的 staged `FileAsset` 及对应物理文件；已锁定、已提交关联或历史附件绝不删除。
- 清理触发仅包括用户明确移除／切换合同／重置、上传时顺带清理超过 24 小时的孤立 staged 文件，以及数据库记录创建失败后的物理文件回滚。

### 状态机、锁序与 key 生命周期

- stale 申请通过受保护接口在事务内按 `contract -> request -> related rows` 的固定锁序刷新持久化影响快照；审批仍须用户重新核对，不自动再次确认。
- 提交幂等键以合同、原因、影响哈希和排序后的附件 ID 形成 fingerprint：内容不变复用同一 key，内容变化轮换 key；执行 key 在同一申请进入终态前稳定复用。
- 作废完成后父工作区重新加载合同列表和当前详情，立即隐藏已不再允许的危险操作。

### 文件生命周期与一致性

- 显式删除同时校验上传者、类别、未锁定、未关联；服务先原子 claim，再删除物理文件和数据库记录。物理删除失败时解除 claim、保留数据库记录并返回中文错误，前端保留附件且不假装成功。
- 24 小时 TTL 仅扫描未锁定、未关联的 `CONTRACT_VOID_PROOF`，逐条 claim；单个物理文件失败只解除该条 claim，不阻塞本次上传。
- 物理写入成功但 `FileAsset` 创建失败时立即 unlink；下载缺失物理文件返回中文 404。所有路径均以固定 proof 目录和安全 basename 解析。

### 红灯／绿灯与最终验证

- 后端 cleanup 首轮聚焦测试：4 suite、88 项中 8 项失败；补齐删除端点、TTL、rollback unlink 后为 4 suite、88/88 通过。
- 前端首轮 cleanup 聚焦测试有 3 项失败；补齐客户端删除、明确移除／切换／重置及失败保留后为 4 文件、63/63 通过。
- fingerprint 新增测试先失败，随后实现按 payload 轮换并转绿；父页面完成后刷新、中文缺失文件错误也有回归覆盖。
- 最终后端全量：78 suite、474/474；前端全量：39 文件、206/206。
- 后端 `lint:check`、后端构建、前端构建、`git diff --check` 均通过；前端仅保留既有大 chunk 警告。

### 自审

负向测试覆盖他人上传、已锁定、已关联、物理删除失败、TTL 竞争条件及数据库创建失败回滚。没有删除 submitted/locked/historical attachment，没有读取、输出或提交任何秘密。当前无功能阻塞。
