# Task 10 报告：Backend API integration and end-to-end financial invariants

## 状态

已完成。Task 10 新增真实本机 MySQL + AppModule + Supertest 的合同作废／纠错 API E2E，覆盖四类业务场景、角色与审批边界、财务归零、房态保护、真实 Prisma relation filters、幂等重试和非外部现金流中文语义。

## 四场景与 API 工作流

- 简单未收：ACTIVE 合同、未收租金账单、无押金／预收款；验证 visitor 预览 403、ADMIN 提交后 PENDING、ADMIN 审批 403、SUPER_ADMIN 错误确认 400、精确输入“确认作废合同”后 COMPLETED，以及同 execution idempotency key 返回原结果。
- 已收 + 自动押金：通过真实 `POST /api/contracts/fixed` 创建合同和自动押金收款／台账，再加入已收租金及正预收款余额；验证所有原支付、分配、押金和预收来源保留，最新押金／预收余额均为 `0.00`。
- 已完成退租：ENDED 合同带 PAID 账单、CONFIRMED 收款和 COMPLETED checkout；作废后 checkout 仍为 COMPLETED，原合同／账单／收款／退租来源均保留。
- 同房历史合同 + ACTIVE successor：只作废历史合同；后续合同仍为 ACTIVE，房态保持作废前 RENTED，执行结果的 `roomStatusAfter` 也保持 RENTED。

每个场景均由 ADMIN 预览和提交、SUPER_ADMIN 精确确认，并验证：

- 预览和持久化影响快照的 `postReversalNetImpact = 0.00`；
- 合同最终为 VOIDED；
- 目标合同全部原账单仍存在并为 VOIDED；
- 原支付、押金、预收款和退租来源 ID 仍可查询；
- 最新押金／预收款余额均为 `0.00`；
- COMPLETED request、reversal count、result snapshot 和唯一安全审计事件均存在；
- 同 execution idempotency key 的 HTTP 重试逐字段等于首次完成结果；
- 真实 request list 的 contractNo + roomKeyword + tenantKeyword 关系筛选只返回目标申请。

## Task 7 deferred：真实 Prisma relation filter 证据

E2E 创建一条可安全清理、故意不一致的 VOIDED sentinel：保留非 VOIDED 租金账单、非零押金余额、非零预收余额、COMPLETED checkout 和有效提成。真实 MySQL API 前后对比证明：

- `GET /api/finance/overview` 不计入 sentinel 押金和预收款；
- `GET /api/finance/rent-collection` 不计入 sentinel 账单；
- `GET /api/dashboard` 的本月退租和租金收缴摘要不受 sentinel 影响；
- `GET /api/commissions` 不返回 sentinel 提成。

sentinel 没有纠错申请或安全审计，断言后按精确主键和依赖顺序在测试事务中安全清理。

## 真实集成缺口与最小修复

唯一真实业务红灯是资金流水 Excel 将所有 `external=false` 行统一显示为“否（内部抵扣）”，导致合同纠错冲销文案错误。最小修复只调整 Excel 展示映射：

- `CONTRACT_VOID_REVERSAL` 显示“否（内部纠错）”；
- 押金等既有内部抵扣继续显示“否（内部抵扣）”；
- 不改变现金流金额、方向、外部流入／流出、租金实收或排序计算。

现金流 API 同时验证纠错行 `type = 合同纠错冲销`、`external = false`；真实 XLSX 读取第 7 列验证“否（内部纠错）”。

## TDD 红灯／绿灯

### 测试传输层修正

目标 E2E 首跑 5/6 通过，XLSX 用例先因 Supertest 未自动把响应解析为 Buffer 而失败。根据本地 Superagent parser 类型，测试增加显式二进制流收集器；这只是测试传输层修正，不计为业务红灯。

### 有效 RED

- 真实 MySQL E2E：四场景和 relation filters 继续通过；XLSX 第 7 列失败，Expected `否（内部纠错）`，Received `否（内部抵扣）`。
- focused unit：`finance-export-void-labels.spec.ts` 和 `finance-export.service.spec.ts` 均以同一 expected/received 差异失败，2 suites failed。

### GREEN

- focused finance unit：2 suites / 4 tests passed。
- 目标真实 MySQL E2E：1 suite / 6 tests passed。
- 相关 contract-void/controller/executor/finance unit：9 suites / 85 tests passed。

## 环境、fixture 与数据保留

- 测试只在进程内读取 `deploy/.env.test` 的 `MYSQL_*`，用 `MYSQL_USER`、`MYSQL_PASSWORD`、`MYSQL_DATABASE` 和本机 `MYSQL_PORT` 构造 `DATABASE_URL`；未输出、记录、修改或提交任何值。
- 每次运行使用 `合同纠错测试-Task10-<unique marker>` 作为中文可识别前缀，并对受长度约束的唯一编号使用同 marker 的 `CV10` 前缀。
- 未完成且未产生 append-only 安全审计的局部 fixture 可按精确 ID 安全清理。
- 四场景一旦 COMPLETED，其 `SecurityAuditLog` 为 append-only，必须保留来源 provenance；因此完成链及房源／租户／合同／财务来源不物理删除。多次红绿运行各自使用不同唯一 marker，可明确识别，不触碰既有 Task 5/9 fixture。

## 修改文件

- 新建 `backend/test/contract-void-correction.e2e-spec.ts`。
- 修改 `backend/src/finance/finance-export.service.ts`。
- 修改 `backend/src/finance/finance-export.service.spec.ts`。
- 修改 `backend/src/finance/finance-export-void-labels.spec.ts`。
- 更新 progress ledger 和本报告。

未修改 controller/executor production 或 specs，因为真实 E2E 证明其权限、确认、事务、房态和幂等契约均已满足；唯一缺口位于 finance Excel presentation。

## 最终验证

- `npm run test:e2e -- --runInBand contract-void-correction.e2e-spec.ts`：1 suite / 6 tests passed。
- 相关 unit：9 suites / 85 tests passed。
- `npm test -- --runInBand`：79 suites / 477 tests passed。
- `npm run lint:check`：通过。
- `npm run build`：通过。
- `git diff --check`：通过；仅 Git 的既有 LF→CRLF advisory，无空白错误。

## 边界自审

- 未增加恢复、复制合同、通用财务编辑或新审批 API。
- 未物理删除任何 COMPLETED 业务／安全审计来源，未覆盖原金额、日期、凭证、审批或退租记录。
- 只对无 append-only audit 的临时 sentinel 和未完成局部测试数据执行精确、安全清理。
- 后续 ACTIVE 合同及当前房态得到真实数据库断言保护。
- 无 env、密码、令牌、密钥或部署文件差异。
