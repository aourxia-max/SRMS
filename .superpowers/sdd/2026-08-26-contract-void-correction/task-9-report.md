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

## Fix round 2/5：跨重载幂等恢复、父页面失败关闭与同房锁序

### Important 红灯与根因

- 幂等恢复红灯：前端 3 文件 60 项中新增 4 项失败。根因是 submission/execution key 仅保存在组件内存，首次提交 timeout 后 catch 不按服务端 `submissionIdempotencyKey` 回查，重载后也不会自动选中已创建的 PENDING。
- 父页面失败关闭红灯：详情重载 reject 时旧 ACTIVE 对象仍保留，随后仍写 detail 路由；新增测试证明危险入口可能继续显示。
- 锁序红灯：统一 helper 的 3 项新增测试全部失败。旧路径为 target contract -> room -> 同房 contracts，同房 A/B 并发存在环路。

### 实现与生命周期

- submission key 以 `sessionStorage` 保存，定位键仅为表单摘要 fingerprint，不保存原因、附件内容等敏感 payload；同 fingerprint 跨 reload 复用，payload 变化轮换。execution key 按 requestId 跨 reload 复用，申请进入 COMPLETED/REJECTED/CANCELLED 后同时清除 execution 与对应 submission key。
- submit 响应 timeout/丢失时立即重新加载申请，并优先以完整 `submissionIdempotencyKey` 精确找回服务端 PENDING；找到后直接展示并可继续确认，未找到则保留原 key 供重试。页面重新挂载也从 sessionStorage 中的 opaque key 恢复。
- completed 事件先清空旧 selected contract、账单、附件、变更、退差和收款，再加载列表/详情。列表或详情任一失败都保持 selected 为空并回退安全列表路由；路由 watcher 不会恢复旧 ACTIVE 对象，危险按钮隐藏。
- 纠错独占锁统一为 identity-only 读取 roomId（不参与业务决策）后 `room FOR UPDATE -> 同房全部 contracts ORDER BY id FOR UPDATE -> request -> related rows`。锁内重载 target 并校验 roomId 未漂移；合同无房源或房源缺失均中文失败。executor 与 refresh 共用同一 helper。

### 真实 MySQL 并发证据

- 新增同一 room 两份非 VOIDED 合同 fixture，覆盖 refresh-vs-refresh 与 approve-vs-refresh；均在 10 秒保护超时内完成，无 deadlock，终态及持久化 impactHash 一致。
- 首次运行因 Docker 守护进程未启动而在连接阶段超时；启动既有 `srms_test` MySQL 后，fixture 又暴露 A 快照在 B 合同创建前生成而 stale。将 A 先通过受保护刷新接口同步基线后，最终真实 MySQL E2E 1 suite、6/6 通过。未输出或提交测试配置秘密。

### 最终验证

- 后端 affected/Task5/6/9 focused：5 suite、91/91。
- 前端 Task9 focused：4 文件、69/69；其中 3 个 Important 聚焦 61/61。
- 后端完整单元：79 suite、477/477；前端完整单元：39 文件、212/212。
- 真实 MySQL E2E：1 suite、6/6。
- 后端 `lint:check`、后端 build、前端 build、`git diff --check` 全部通过；仅保留既有前端大 chunk 警告。

### 自审

没有使用 localStorage，没有持久化原因或附件内容，没有自动重提/自动审批。普通合同 mutation 仍只锁单合同；仅 refresh/execute 纠错独占路径采用 room-first。未修改或输出任何 env、密码、令牌或密钥。三个 Important 均有先红后绿证据，无功能阻塞。

## Fix round 3/5：用户隔离、完成态竞态关闭与确定性并发证明

### Important 红灯与闭合

- 幂等会话现在以 `sessionStorage` 的 `user:<currentUserId>` 作用域保存 opaque key；认证用户未就绪时不读取、不恢复、不可提交。同一标签 ADMIN A 切换至 B／SUPER_ADMIN 时，相同 fingerprint 也不会复用前一用户 key 或自动选中前一用户 PENDING。未保存原因、附件内容等敏感 payload。
- 每次加载申请列表都会对当前用户作用域观察到的 COMPLETED／REJECTED／CANCELLED 执行终态清理。approve API 一旦返回 COMPLETED，立即清 submission/execution key 并 emit completed；后续详情 GET 仅为 best-effort，失败仍保持终态且父页面立即 fail-closed。
- 合同详情加载增加递增 generation。clear/completed 会使所有旧请求失效；异步结果写入前同时校验 generation 与 selected id，旧 ACTIVE 响应即使延迟返回也不能复活详情和危险操作。

### 确定性 MySQL 并发与 fixture 生命周期

- E2E 对事务客户端包裹测试 barrier：两个参与事务都完成 identity-only roomId 读取后才同时释放并争抢 room lock；两组测试均精确断言 `arrivals=2`，不是普通 `Promise.all` 偶然串行。
- refresh-vs-refresh 校验两次返回 hash 等于无业务变化的同步基线，并逐项等于最终持久化 hash，状态均为 PENDING。approve-vs-refresh 校验审批返回及持久化均为 COMPLETED、hash 一致；另一申请返回及持久化均为 PENDING、hash 一致。真实 MySQL 6/6 在超时内通过且无 deadlock。
- refresh-only 共享房源 fixture 在 afterAll 完整删除；approve-vs-refresh 的 PENDING 一侧删除。COMPLETED 一侧及房源来源保留，因为追加式安全审计必须保有 provenance；使用专用 `ZFSH` 前缀，不触碰既有 Task5 fixture。

### 测试与自审

- 前端聚焦：3 文件、64/64；新增同标签切用户隔离、approve 完成但详情 reject 仍 emit/清 key，以及既有父页面失败关闭/路由恢复回归。
- 后端完整单元：79 suite、477/477；前端完整单元：39 文件、215/215；真实 MySQL E2E：1 suite、6/6。
- 后端 `lint:check`、后端 build、前端 build、`git diff --check` 均通过；前端仅有既存大 chunk 警告。
- 用户授权的临时证明附件边界保持不变：仅 uploader-owned、unlocked、unassociated 的 `CONTRACT_VOID_PROOF`；submitted／locked／associated／historical attachment 绝不删除。本轮未修改 env、secret 或迁移，未输出任何密码或密钥。

## Fix round 4/5：身份切换失败关闭与精确并发持久化证明

### 红灯、根因与闭合

- 前端首轮聚焦为 2 文件、62 项中 5 项失败、57 项通过：合同工作区的 `role`／`canAccessVoidCorrection` 是 setup 时静态快照；面板仅轮换 action session，未清空 reason、impact、selected contract/request、staged proof 与预览，也没有按认证代际拒绝旧列表／影响／上传响应；`clearSelectedContract` 使旧 generation 失效后，旧请求的 finally 不再清 loading，导致加载态永久保留。
- `ContractsWorkspace` 将角色和作废页签权限改为响应式计算；同标签 `SUPER_ADMIN -> ADMIN` 立即撤下直接执行 UI，继续降为无权限角色时同步卸载作废面板、回退列表并移除合同选择。`clearSelectedContract` 现在同步清 loading，旧 generation 仍不能写回。
- `ContractVoidPanel` 以认证 generation 约束列表、详情、影响、刷新、提交、审批、驳回、取消、上传、证明预览和下载的每次异步写回。用户 ID 或角色变化时先失效旧 generation，关闭 prompt，清空请求、草稿、合同／申请选择、影响、staged proof、预览和所有 loading/saving 状态，再为已就绪且获授权的当前用户创建新 session；认证未就绪时不加载敏感数据并禁用选择、原因、上传、查询和提交。
- 提交前冻结当前合同、原因、impactHash、附件 ID、session 与幂等键；认证代际变化后旧响应不能写入新用户 UI。旧用户 staged proof 只从本地状态移除并撤销 object URL，不发后端删除请求，也绝不进入新用户 payload/key；服务端孤立文件继续由既有 24 小时受控 TTL 处理。

### 精确 MySQL 并发断言

- refresh-vs-refresh 保留真实 `arrivals=2` barrier，并对左右两项分别断言 baseline、返回值和对应持久化 request 均为 `PENDING`，三处 impactHash 逐项精确相等。
- approve-vs-refresh 同样保留双到达 barrier；审批 request 从数据库回读并精确断言 `COMPLETED` 且 impactHash 等于 `completed.impactHash`，刷新 request 精确断言 `PENDING` 且持久化 hash 等于 `refreshed.impactHash`。
- fixture cleanup 与安全审计 provenance 未改：refresh-only fixture 仍安全删除，approve 的 COMPLETED 一侧及其追加式审计来源仍保留。

### 绿灯与最终验证

- 面板聚焦：1 文件、27/27；工作区聚焦：1 文件、35/35；Task 9 前端聚焦：4 文件、72/72。
- 前端完整单元：39 文件、219/219；前端 build 通过，仅有既存大 chunk 警告。
- 后端聚焦：10 suite、117/117；后端完整单元：79 suite、477/477；真实 MySQL E2E：1 suite、6/6。
- 后端 `lint:check`、后端 build、`git diff --check` 均通过。

### 安全边界与自审

- 真实 MySQL E2E 只在测试进程内从 `deploy/.env.test` 导入 `MYSQL_*` 并构造 `DATABASE_URL`；没有输出、记录或提交任何值。
- 没有修改后端权限、附件删除资格、迁移或 Task 10+。显式删除仍只能作用于 uploader-owned、unlocked、unassociated 的 `CONTRACT_VOID_PROOF`；submitted／locked／associated／historical attachment 绝不触碰。
- 当前无功能阻塞或 Important 开放项。

## Fix round 5/5：组件专属风险确认框生命周期

### 红灯与根因

- 修改前两个聚焦文件 62/62 通过；加入审批降为 ADMIN 与直接执行时登出的回归用例后，2 文件 64 项中 2 项按预期失败、62 项通过，失败均为组件专属 `close` 调用次数期望 1、实际 0。
- Element Plus 静态 `ElMessageBox.prompt` 把弹框挂到 `document.body`，返回值只有 Promise。父工作区因登出或降为无访问权角色用 `v-else-if` 同步卸载面板时，子组件的 props watcher 不保证先运行；原 `onBeforeUnmount` 仅失效认证 generation，没有关闭弹框。
- 原 `saving` 条件下调用静态 `ElMessageBox.close()` 既遗漏父层先卸载路径，也会关闭页面中其他组件创建的 MessageBox。

### 最小实现与失败关闭

- 使用 Element Plus 2.14.3 公开的 message render-function action handlers，捕获当前面板 prompt 的实例级 `close`；直接执行、审批和驳回 prompt 共用组件专属 helper。
- 认证用户／角色 reset 与 `onBeforeUnmount` 都调用组件专属 close；Promise `finally` 仅清理自己的句柄，不再调用全局 `ElMessageBox.close()`，正常确认完成后也不会残留句柄。
- 关闭前先递增认证 generation；即使旧 prompt Promise 随后 resolve 或 reject，提交与审批路径都会在 API 前因旧 generation 失败关闭。测试分别证明登出后的旧 resolve 与降为 ADMIN 后的旧 reject 均不调用 submit/approve API。

### 绿灯与验证

- RED 对应命令修复后：2 文件、64/64。
- Task 9 前端四文件聚焦：4 文件、70/70。
- 前端完整单元：39 文件、221/221。
- `npm --prefix frontend run build` 通过；仅保留既有大 chunk 警告。
- 本轮后端 diff 为 none；`git diff --check` 通过。

### 范围与自审

- 仅修改 `ContractVoidPanel.vue` 及面板／父工作区回归测试；未改后端、权限、附件清理、迁移、Task 10+、env 或秘密。
- 历史／已提交附件不可变边界和 staged proof 的既有受控清理范围保持不变；本轮不发任何额外 API。
