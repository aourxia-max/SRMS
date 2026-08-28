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

## 独立复审 fix round 1/5

复审指出初版 E2E 的财务断言仍依赖 preview/result 常量，且 source ID、allocation 关系和中途失败清理证据不足。round 1 已补齐：

- `SourceIds` 纳入原始 `PaymentAllocation.id`；fixture 同时保存 allocation 的 `paymentId`、`rentBillId`、分配金额、已冲销金额和来源类型。
- 四场景分别维护手工推导的持久化 reversal 表，逐行精确比较 category、original entity type/id、signed amount、balance before/after 和 generated entity type，不再用 executor 的 `reversalCount` 代替内容证据。
- 执行后直接读取原 `Payment`，验证全部变为 VOIDED；直接读取原 allocation，验证 ID、payment/bill 外键、金额和两侧合同关系均未改变。
- 对押金／预收款余额冲销，沿 reversal 的 `generatedEntityId` 读取新台账，验证类型为 REVERSAL、金额分别为 `50.00`／`25.00`、余额为 `0.00`。
- 从持久化 reversal 的 `metadata.affectsNetImpact=true` 行独立求和，再与 fixture 手工给定的当前净影响相加，四场景均必须得到 `0.00`。
- 自动押金在作废前直接验证：Payment purpose/category 为 DEPOSIT、origin/method 为 SYSTEM_AUTO、金额与余额均为 `50.00`、`autoSourceKey` 和 DepositTransaction.paymentId 均指向正确合同／支付来源。
- cleanup entry 在创建任何 DB 实体前登记；building、room、tenant、contract 创建后即时登记，并在清理前用本次唯一中文 prefix + scenario label 补发现遗漏 ID。因而任一步中途失败时，afterAll 仍能按合同关系清除 bill/payment/allocation 等未完成且无 append-only audit 的来源。
- finance export 增加真实形态的非纠错 `DEPOSIT_OFFSET + external=false` 回归样本，精确断言仍为“否（内部抵扣）”。

### round 1 RED/GREEN

- 测试补齐后，原生产代码自然通过目标 E2E 6/6。
- 为证明新断言独立有效，临时把 production writer 的 allocation 输入变为空，仅运行 paid 场景；测试以缺少 `PAYMENT_ALLOCATION`、source id 和 `-100.00` 精确失败（1 failed / 5 skipped）。
- 立即恢复 production，确认 writer 无 Git diff；同一 paid 场景自然通过 1/1。mutation RED 产生的 COMPLETED 链使用专用唯一前缀，因 append-only SecurityAuditLog 要求保留并可识别。
- 新 finance 回归首跑曾因测试误把第 4 列“类别”当成第 3 列“流水类型”失败；修正测试索引后 focused finance 为 2 suites / 5 tests。该测试索引错误不计为业务 RED。
- round 1 未暴露新的真实生产缺口，未修改任何 production 文件；初版 Excel 文案最小修复保持不变。

## 最终验证

- `npm run test:e2e -- --runInBand contract-void-correction.e2e-spec.ts`：1 suite / 6 tests passed。
- round 1 focused finance：2 suites / 5 tests passed。
- 相关 unit：9 suites / 85 tests passed。
- `npm test -- --runInBand`：79 suites / 478 tests passed。
- `npm run lint:check`：通过。
- `npm run build`：通过。
- `git diff --check`：通过；仅 Git 的既有 LF→CRLF advisory，无空白错误。

## 边界自审

- 未增加恢复、复制合同、通用财务编辑或新审批 API。
- 未物理删除任何 COMPLETED 业务／安全审计来源，未覆盖原金额、日期、凭证、审批或退租记录。
- 只对无 append-only audit 的临时 sentinel 和未完成局部测试数据执行精确、安全清理。
- 后续 ACTIVE 合同及当前房态得到真实数据库断言保护。
- 无 env、密码、令牌、密钥或部署文件差异。

## Fix round 2：共享测试库重建与 mutation 安全护栏

独立复审确认 round 1 的断言已闭合，但指出：为证明断言敏感性而运行的 production mutation 在共享测试库提交了一条已知不完整的 COMPLETED append-only 链。该链不能逐行删除或事后补写，因此 round 1 中“保留 mutation 链可接受”的表述由本轮裁决取代：mutation proof 只能运行在本机一次性、可整体销毁的专用数据库，普通共享测试库只能运行未修改 production 的 GREEN E2E。

### 用户授权与精确目标

用户明确授权整体重建本机 Docker compose project `srms_test`、container `srms_test-mysql-1`、published port `13306` 内的 `srms_docker`，并接受当前测试库数据丢失，以 `current-before-rebuild-20260828-094555` 备份兜底。执行前再次验证 project、service、container、port、database 四项完全一致；未触碰其他容器、数据库、生产环境或 env 文件。

### 重建前备份与污染清单

- 当前数据库备份：`deploy/test-data/current-before-rebuild-20260828-094555/database.sql`，SHA256 `AF4F96ADC08A21AD636BCBA3909314AE3744526FE80EC72C54C25796A80667E2`。
- 当前测试附件备份：同目录 `uploads.tar.gz`，SHA256 `C453B401F8C646047342AB56733929464960223DAE1DEE631E3789737175D727`。
- 备份通过非空、SQL 结构、tar 可读性和 hash 校验。
- 重建前共有 30 条 Task 10 COMPLETED 链；唯一已知不完整 marker 为 `mtbw7plivhogqc`，request 115、contract 172。其 1 张账单和 3 笔支付已 VOIDED，原 allocation 为 `100.00` 且 reversedAmount 仍为 `0.00`，仅有 7 条 reversal，缺少 `PAYMENT_ALLOCATION -100.00` 及对应 result category，安全审计事件为 1 条。
- 清单只记录技术标识和聚合财务状态，不记录姓名、电话、密码、令牌或密钥。

### 整体恢复与迁移

- 基线 `backup-before-clear-20260825-081647/database.sql` 的 SHA256 重新校验为 `A3CFECAC425E7D9B0988F9C1CDC1707A64AB29CA72DC4CEF5EFBF17AD4D4D17A`。
- 仅对目标 `srms_docker` 执行整体 DROP/CREATE；未逐行删除或补写任何 COMPLETED 审计链。
- 基线恢复后为 41 张表、25 条迁移；随后成功应用 `20260826090000_contract_void_correction`，最终为 45 张表、26 条迁移。
- 恢复后 Task 10 marker/request/reversal 均为 0；合同纠错 3 张表、14 个索引、4 个 RESTRICT 外键完整。
- 基线保留 3 栋、195 间房源和 5 个用户；有效角色含 2 个 SUPER_ADMIN、2 个 ADMIN。未输出个人资料。
- 未覆盖测试 uploads：本轮 GREEN E2E 不依赖历史附件，且现有 uploads 已单独备份。

### mutation 数据库护栏

新增 `assertContractVoidMutationDatabaseSafety`：仅当 `CONTRACT_VOID_MUTATION_PROOF=1` 时启用，并且只允许 host 为 localhost/127.0.0.1/[::1]、数据库名匹配 `srms_contract_void_mutation_<唯一标识>`。其他目标在应用初始化和任何 fixture/数据库写入前以固定中文错误“合同纠错 mutation 只能运行在本机一次性数据库”拒绝。普通 GREEN E2E 不受影响。

TDD 证据：护栏先因 module 缺失 RED；实现后 helper 4/4 GREEN。共享 `srms_docker` 开启 mutation mode 时 6 个测试全部在 beforeAll 安全失败且数据库零写入；关闭 mutation mode 后 guard + 正常 E2E 为 2 suites / 10 tests passed。重建后的首轮 GREEN 产生 4 条完整 COMPLETED/audit 链；后续两次最终复验使用各自唯一 marker，当前合计 12/12，且每次及最终聚合不完整 allocation 链均为 0。

### Fix round 2 最终验证

- focused contract-void + finance：9 suites / 86 tests passed。
- backend full unit：79 suites / 478 tests passed。
- Prisma validate：通过。
- backend lint：通过。
- backend build：通过。
- Docker `up -d --build api web`：通过，MySQL container ID 未改变，API/Web 重建后健康。
- `http://127.0.0.1:13000/api/health` 返回 200；`http://127.0.0.1:15173/` 返回 200。
- 构建仅有既存前端 chunk 大于 500 kB、npm audit/deprecation 警告，无合同纠错失败。

## Fix round 3：mutation guard 边界收口

独立复审唯一 Minor：malformed percent pathname 会泄漏原生 URIError，且 disposable database regex 的 `/i` 会误允许大写 prefix/identifier。

TDD RED：focused guard 共 9 个测试，3 failed / 6 passed；分别为 `%E0%A4%A` 收到 `URI malformed`、大写 prefix 未抛错、大写 identifier 未抛错。空数据库名拒绝及 `[::1]` + 小写数据库名当时已经通过。

最小实现：将 `decodeURIComponent` 纳入 `new URL` 的同一 `try/catch`，并移除 database-name regex 的 `/i`。所有非法 URL、host 或 database name 均固定抛出“合同纠错 mutation 只能运行在本机一次性数据库”。

GREEN：

- focused guard：9/9。
- guard + normal target E2E：2 suites / 15 tests。
- backend full：79 suites / 478 tests。
- lint、build、`git diff --check`：通过。

本轮只修改 test guard、spec、报告与台账；未修改 production、数据库 schema 或 env 文件，也未启用 mutation proof。普通 target E2E 按既有策略创建完整的 append-only provenance chains。

## Fix round 4：127.0.0.1 正向边界覆盖

独立复审唯一 Minor 是缺少 host = `127.0.0.1` 且严格小写 disposable database 的显式允许用例。新增真实 helper `not.toThrow` 回归：如果以后移除 IPv4 loopback allowlist 或破坏严格小写合法名，该测试会失败。现有实现自然 GREEN，无 helper 或 implementation 改动。

验证：

- focused guard：1 suite / 10 tests。
- guard + normal target E2E：2 suites / 16 tests。
- backend full：79 suites / 478 tests。
- lint、build、`git diff --check`：通过。

round 4 已解决 1 个 Minor，0 open。本轮只增加测试覆盖、报告和台账；无 implementation、production、database schema 或 env-file 变化，mutation proof 未启用。普通 E2E 仍按既有策略创建完整 append-only provenance chains。
