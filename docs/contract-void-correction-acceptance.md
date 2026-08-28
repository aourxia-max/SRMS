# 合同作废／纠错验收记录

日期：2026-08-28
需求基线：SRMS-RB-1.0-CR-20260826-01
分支：feature/contract-void-correction
计划起点：b5b27b6
Task 11 验收前 HEAD：02c0945
验收文档提交：docs: record contract void correction acceptance

## 验收结论

合同作废／纠错已通过 Prisma、迁移状态、后端全量、前端全量、全部后端 E2E、Docker 健康和四类真实 API／数据库流程验收。

- 四个验收合同均已进入 VOIDED，对应纠错单均为 COMPLETED。
- 四个影响快照的 postReversalNetImpact 均为 0.00。
- 所有带 balanceAfter 的纠错明细均为 0.00；没有非零分类余额。
- 原合同、账单、收款、收款分配、押金／预收款来源和已完成退租来源按场景保留。
- 每个完成场景恰有一条 CONTRACT_VOID_COMPLETED 安全审计事件。
- 同房后续合同仍为 ACTIVE，房态在执行前后均为 RENTED。
- 普通管理员申请、超级管理员确认、中文确认口令、中文状态、附件上传／下载入口和终态只读行为已有全量及聚焦单元测试证据。
- 未发现需要修改生产代码的 Task 11 缺陷；未执行 merge、push 或生产部署。

## 分支与提交

功能分支在 Task 11 开始时为干净 linked worktree：

- 路径：D:\Work\iwen-codex\codex-zhufang\srms\.worktrees\contract-void-correction
- 分支：feature/contract-void-correction
- HEAD：02c09456fe2201308dcb8c7fef1ae8a7578a6a61
- 基线：b5b27b6
- 计划预检：ff8585e

Task 1–10 的提交按实现阶段归纳如下：

| 阶段    | 提交                                                 |
| ------- | ---------------------------------------------------- |
| Task 1  | 5aa09e4、168682a、95fa29f、7c5ccaa                   |
| Task 2  | 483be3d、6968d46                                     |
| Task 3  | f7fe920                                              |
| Task 4  | 4977e95、3b80ca5                                     |
| Task 5  | 533852e、4222ed3                                     |
| Task 6  | a969041、20c3a2c、3ea844c                            |
| Task 7  | ef47437、4477b7e                                     |
| Task 8  | 3701d12、11a419b                                     |
| Task 9  | 0ac14c5、198afe0、6af2921、afd5745、2564525、e8bbc6a |
| Task 10 | 84a3ea8、5607cb4、47b409f、6b5be3c、02c0945          |

## 修改文件类别

从 b5b27b6 到 02c0945 共修改 95 个文件，约 18,132 行新增、706 行删除，分为：

1. Prisma schema 与迁移：纠错申请、冲销明细、附件关系和安全审计链头。
2. 后端合同域：影响计算、稳定哈希、预览、申请、审批、原子执行、锁序、冲销写入、房态协调和 VOIDED 操作保护。
3. 后端关联模块：收款、退款、收款作废、账单调整、租金退差、退租、押金、提成、财务、驾驶舱、账单和文件。
4. 审计与附件：追加式安全审计、证明附件上传／受保护下载和临时附件受控生命周期。
5. 后端测试：单元／集成测试，以及真实 MySQL 事务、四场景 API、mutation 数据库护栏 E2E。
6. 前端：合同域类型和 API、第五页签、详情入口、纠错面板、影响卡片、中文展示、风险确认、权限失败关闭和附件入口。
7. 验收与过程记录：设计、计划、progress、Task 报告和本文档。

未修改或提交 deploy/.env.test、密码、令牌或密钥。

## 数据库范围与迁移演练

### 精确测试库范围

| 项目                   | 值                                      |
| ---------------------- | --------------------------------------- |
| Docker Compose project | srms_test                               |
| MySQL container        | srms_test-mysql-1                       |
| Compose service        | mysql                                   |
| Image                  | mysql:8.4                               |
| Published port         | 13306                                   |
| Database               | srms_docker                             |
| 本轮 mutation mode     | CONTRACT_VOID_MUTATION_PROOF 明确 unset |

没有连接生产环境、其他容器或其他数据库。

### 已完成的实际演练

Task 10 fix round 2 已在用户明确授权下完成一次整体迁移演练，本轮没有再次 DROP／CREATE：

1. 对上述唯一测试库和测试 uploads 生成 current 备份并校验哈希。
2. 从 2026-08-25 基线整体恢复：41 张表、25 条迁移。
3. 应用 20260826090000_contract_void_correction。
4. 迁移后为 45 张表、26 条迁移。
5. **T0（重建并迁移完成的即时检查点）**：Task 10 marker／request／reversal 均为 0。
6. **T1（随后执行正常 GREEN／E2E）**：测试按 append-only 规则保留完整、有效的来源链，因此不得把 T0 的“0”误解为持久测试库必须始终为空。
7. **T2（Task 11 验收记录的最终只读全库快照）**：32 条纠错申请、127 条冲销明细、32 条 CONTRACT_VOID_COMPLETED 审计事件。四流 marker `合同纠错测试-Task10-mtcgnnsdhthv54` 的 request 25–28 只是这 32 条中的 4 条；四条均完整有效，不是污染数据。

上述数字是有时间点的证据，不是共享测试库的永久计数不变量；后续正常 GREEN E2E 仍可继续追加完整链。

### Task 11 只读复核

- prisma migrate status：26 migrations found，Database schema is up to date。
- 20260826090000_contract_void_correction：APPLIED。
- 当前表数：45。
- security_audit_chain_heads、contract_void_requests、contract_void_reversals、contract_void_request_files 均存在。
- 三张纠错表共有 14 个索引／主键定义；请求号、活动合同键、完成合同键、执行批次、提交幂等键、执行幂等键和冲销幂等键均为 UNIQUE。
- 附件关系使用复合主键 contract_void_request_id + file_asset_id。
- 四个外键均为 ON DELETE RESTRICT。

- 本次验收记录的最终只读全库快照为 32 条纠错申请、127 条冲销明细、32 条 CONTRACT_VOID_COMPLETED 审计；其中 request 25–28 是完整有效的四流子集，不是待清理污染。

## 备份与哈希

主工作区中的回滚备份未复制到 feature worktree，也未提交 Git。

| 备份                                                  |            大小 | SHA-256                                                          |
| ----------------------------------------------------- | --------------: | ---------------------------------------------------------------- |
| current-before-rebuild-20260828-094555/database.sql   |   778,996 bytes | AF4F96ADC08A21AD636BCBA3909314AE3744526FE80EC72C54C25796A80667E2 |
| current-before-rebuild-20260828-094555/uploads.tar.gz |   807,482 bytes | C453B401F8C646047342AB56733929464960223DAE1DEE631E3789737175D727 |
| backup-before-clear-20260825-081647/database.sql      |   350,935 bytes | A3CFECAC425E7D9B0988F9C1CDC1707A64AB29CA72DC4CEF5EFBF17AD4D4D17A |
| backup-before-clear-20260825-081647/uploads.tar.gz    | 2,441,181 bytes | 8594AC30A442FE21B63FB87743B28D2FF3EDD4CFFDD1116F19EB326FDD727C66 |

回滚目录：

- D:\Work\iwen-codex\codex-zhufang\srms\deploy\test-data\current-before-rebuild-20260828-094555
- D:\Work\iwen-codex\codex-zhufang\srms\deploy\test-data\backup-before-clear-20260825-081647

`current-before-rebuild-20260828-094555` 是重建前已知污染状态的精确兜底，包含不完整 mutation 链（marker `合同纠错测试-Task10-mtbw7plivhogqc`，request 115／contract 172 缺少 PAYMENT_ALLOCATION -100.00 冲销及对应结果类别）。它只用于取证或在明确要求下恢复重建前原状，**绝不能作为干净验收基线**。

如需恢复，必须再次取得对 project／container／port／database 四项精确测试库范围的明确授权，并在恢复前重新计算 database.sql 与 uploads.tar.gz 的 SHA-256、逐项匹配本节记录；不得用逐行删除、审计删除或事后补写替代整体恢复。干净重建优先使用 `backup-before-clear-20260825-081647` 的数据库与 uploads（两者哈希均须核验），整体恢复后迁移到 HEAD。恢复完成后重新运行 migrate status、表／索引／外键核验和两个健康检查。

## 自动化验证

| 命令／检查                                                 | 结果                                  |
| ---------------------------------------------------------- | ------------------------------------- |
| npm run db:validate                                        | 通过；Prisma schema valid             |
| npm run db:generate                                        | 通过；Prisma Client 7.8.0             |
| npm run lint                                               | 通过；0 个错误                        |
| npm test -- --runInBand                                    | 79/79 suites、480/480 tests           |
| npm --prefix backend run build                             | 通过                                  |
| npm --prefix frontend run test:unit -- --testTimeout=15000 | 39/39 files、221/221 tests            |
| npm --prefix frontend run build                            | 通过；vue-tsc 和 Vite 均 exit 0       |
| npm --prefix backend run test:e2e -- --runInBand           | 7/7 suites、37/37 tests               |
| Round 2 related contract-void unit suites                  | 3/3 suites、25/25 tests               |
| Round 2 new real MySQL／HTTP cases                         | 2/2 tests                             |
| Round 2 full target E2E file                               | 1/1 suite、8/8 tests                  |
| 前端作废 UI／权限／附件客户端聚焦                          | 4/4 files、76/76 tests                |
| 后端纠错控制器／文件聚焦                                   | 2/2 suites、44/44 tests               |
| http://127.0.0.1:13000/api/health                          | HTTP 200；service=srms-api，status=ok |
| http://127.0.0.1:15173/                                    | HTTP 200                              |

全部后端 E2E 均在普通 GREEN 模式运行；CONTRACT_VOID_MUTATION_PROOF 在启动前被显式清空。

## Spec §15（第 176 行）覆盖矩阵

| 验收面                                                              | 自动化／报告证据                                                                                                                         | 覆盖边界                                                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 未收、已收、自动押金、预收款余额、已完成退租、同房 ACTIVE successor | Task 10 真实 MySQL 四流 E2E；Task 10／11 报告及下文只读持久化证据                                                                        | 四流 marker 的 request 25–28 均是完整有效链                                                                                   |
| 部分收款、部分／全额退款、已作废收款不重复冲销                      | `contract-void-impact.spec.ts` 的部分收款、实际退款、全额退款与 VOIDED 收款用例；`contract-void-reversal-writer.spec.ts`；Task 2／5 报告 | 同时覆盖来源保留、配对与类别净额                                                                                              |
| 多期账单                                                            | `contract-void-correction.e2e-spec.ts` 通过真实 API 创建两期账单并只向首期收款 50.00；impact unit 另以手写两期 expected table 覆盖       | 两期来源、冲销 source id／金额、首期部分收款和次期未收均独立断言                                                              |
| 预收款 DEBIT_TO_BILL 抵扣                                           | 同一 E2E 由真实收款 API 生成 CREDIT_RECEIPT 60.00，仅用 Prisma fixture 按既有 enum／FK 装配 DEBIT_TO_BILL 40.00 与 PREPAYMENT_AUTO 分配  | 仓库没有 DEBIT_TO_BILL 创建 API／service；本轮只证明这一种抵扣账本链和剩余余额 20.00 的纠错，不声称覆盖 transfer／refund 全类 |
| 待审批流程取消；已批准、已退款、已作废记录保留                      | `contract-void-reversal-writer.spec.ts` 的 pending-only cancellation；Task 5 报告                                                        | 只取消允许取消的待审批流程                                                                                                    |
| 精确中文确认、权限、重复／并发确认                                  | `contract-void-executor.service.spec.ts`；`contract-void-executor.mysql.e2e-spec.ts` 的幂等与并发用例；前端 76 项和后端 44 项聚焦测试    | visitor／ADMIN／SUPER_ADMIN 与确认短语均有覆盖                                                                                |
| 事务回滚                                                            | executor 单元回滚用例；真实 MySQL E2E 的 reversal insert 后失败全量回滚                                                                  | 验证失败不留下部分业务／审计链                                                                                                |
| 报表、中文展示、真实 Prisma relation filters                        | `contract-void-correction.e2e-spec.ts` 的真实 relation-filter sentinel、中文现金流／XLSX；Task 7／10 报告                                | 财务报表按保留来源与冲销结果查询                                                                                              |
| 各财务类别／总额净影响 0、房态后继不变                              | impact 的不平衡拒绝单测；Task 10 四流聚合与 successor 房态证据                                                                           | 非空 balanceAfter 全为 0.00；后继合同／房态不被历史纠错覆盖                                                                   |
| 封账期间                                                            | 冻结 ruling：当前 SRMS 没有财务期间／封账模型；“open period”取执行时间，`originalOccurredAt` 保留历史日期，禁止虚构新模块                | 已覆盖执行时间与原发生时间语义；不存在可声称已测的封账实体或封账状态流                                                        |

## Round 2 多期账单与预收款抵扣证据

本轮 production 未修改，所有共享 `srms_docker` E2E 均显式 unset `CONTRACT_VOID_MUTATION_PROOF` 并通过真实 AppModule／HTTP 执行。新增场景完成后保留 append-only 来源、冲销和审计链。

### 多期账单

- API 创建 2026-08-01 至 2026-09-30 的两期合同，再通过收款 API 只向首期分配 50.00；纠错前首期为 PARTIAL（实收／未收 50.00／50.00），次期为 PENDING（0.00／100.00）。
- 最新完整运行 marker `合同纠错测试-Task10-mtcjzzi6wt39oz` 的 request 55／contract 111 为 COMPLETED；两张账单来源 id 350／351 均保留并转为 VOIDED。
- 持久化冲销严格为两条 RENT_BILL -100.00、PAYMENT source 123 -50.00、PAYMENT_ALLOCATION source 146 -50.00 和 ROOM_STATUS 0.00；所有金额行 balanceAfter=0.00，postReversalNetImpact=0.00，完成审计 1 条。

### DEBIT_TO_BILL 后的剩余预收款

- 收款 API 以 160.00 收清首期 100.00，并由现有 PaymentsService 生成 CREDIT_RECEIPT 60.00。仓库没有 DEBIT_TO_BILL 创建 API／service，因此测试装配仅按现有 Prisma enum、payment／bill FK 创建 DEBIT_TO_BILL 40.00（balanceAfter 20.00）和 PREPAYMENT_AUTO 分配；这不是新增业务入口。
- 同一 marker 的 request 56／contract 112 为 COMPLETED。原 CREDIT_RECEIPT／DEBIT_TO_BILL、payment source 124 和两条 allocation source 147／148 全部 append-only 保留。
- PREPAYMENT 只冲销当前剩余 20.00；40.00 历史抵扣不重复冲销。冲销 metadata 指向最新 DEBIT_TO_BILL 源，生成 PREPAYMENT REVERSAL 20.00、balanceAfter=0.00；另有 PAYMENT -160.00、两条 RENT_BILL -100.00 及 PAYMENT_ALLOCATION -100.00／-40.00。postReversalNetImpact=0.00，完成审计 1 条。

### RED／GREEN 与边界

- 新 unit 在未改 production 时自然 GREEN；临时纯 unit mutation 将账单数组截为一期并将预收款余额清零，同一 focused suite 按预期 3 failed／10 passed，随后反向恢复成功、production 文件哈希与 HEAD 一致，恢复后 13/13。
- 新真实 E2E 定向 2/2、完整目标文件 8/8；相关 unit 25/25。共享测试库从未运行 production mutation。
- backend full 首次运行暴露 FilesService TTL 测试的 1 ms 错向时间断言（8 次 focused 复现中 1 次失败）；改为验证服务取时落在调用开始／结束窗口后，FilesService 35/35、backend full 480/480、lint／build 通过。只改测试，不改业务逻辑。

## 四个验收流

本轮复用 Task 10 的真实 AppModule + Supertest + Prisma E2E，随后直接从 MySQL 只读复核。唯一前缀为：

合同纠错测试-Task10-mtcgnnsdhthv54

### 1. 简单未收

- request 25 / HTZF17878918698877eaa7c8c：COMPLETED。
- contract 75：VOIDED。
- postReversalNetImpact：0.00。
- 原账单保留 1 条并进入 VOIDED；无虚假收款。
- 冲销明细 2 条：RENT_BILL、ROOM_STATUS；所有非空 balanceAfter 为 0.00。
- 安全审计事件 1 条。
- 无其他有效合同后房态为 EMPTY，符合房态协调结果。

### 2. 已收 + 自动押金 + 预收款

- request 26 / HTZF178789187015116d98907：COMPLETED。
- contract 76：VOIDED。
- postReversalNetImpact：0.00。
- 原账单 1 条、原收款 3 条、原收款分配 1 条全部保留。
- 冲销明细 8 条：RENT_BILL 1、PAYMENT 3、PAYMENT_ALLOCATION 1、DEPOSIT 1、PREPAYMENT 1、ROOM_STATUS 1。
- 押金 50.00 和预收款 25.00 均生成 REVERSAL 台账，最新余额为 0.00。
- 每个金额明细的非空 balanceAfter 均为 0.00；安全审计事件 1 条。

### 3. 已完成退租历史纠错

- request 27 / HTZF1787891870345f84fd22b：COMPLETED。
- contract 77：VOIDED。
- postReversalNetImpact：0.00。
- 原账单 1 条、原收款 1 条、原分配 1 条和原 checkout 1 条全部保留。
- checkout 仍为 COMPLETED，没有覆盖历史退租状态或日期。
- 冲销明细 5 条：RENT_BILL、PAYMENT、PAYMENT_ALLOCATION、CHECKOUT、ROOM_STATUS；所有非空 balanceAfter 为 0.00。
- 安全审计事件 1 条。

### 4. 同房存在 ACTIVE successor

- request 28 / HTZF178789187050527836a3c：COMPLETED。
- 历史 contract 78：VOIDED。
- successor contract 79：仍为 ACTIVE。
- room：执行前 RENTED，执行结果 roomStatusAfter=RENTED，数据库当前仍为 RENTED。
- postReversalNetImpact：0.00。
- 原账单保留 1 条；冲销明细 2 条；安全审计事件 1 条。

### 全部保留链聚合

验收时对所有普通 Task 10 保留链做只读聚合：

- 本次 Task 11 记录的最终全库快照为 32 条纠错申请、127 条冲销明细、32 条 CONTRACT_VOID_COMPLETED 审计；request 25–28 仅是其中 4 条完整有效链，不是污染。
- Round 2 的定向 2/2 与完整目标文件 8/8 共追加 8 条完整纠错链；随后只读全库快照为 48 条纠错申请、193 条冲销明细、48 条 CONTRACT_VOID_COMPLETED 审计，48 条申请均 COMPLETED，nonzero_post_reversal=0，审计基数异常=0。该 48／193／48 是晚于 Task 11 原始 32／127／32 的新时间点，不覆盖或混淆历史证据。
- 全部为 COMPLETED。
- nonzero_post_reversal = 0。
- 存在原 payment allocation 的请求中，缺少对应 PAYMENT_ALLOCATION 冲销来源的请求数为 0。
- 缺少或多于一条 CONTRACT_VOID_COMPLETED 审计事件的请求数为 0。

## 中文 UI、权限和附件入口

本轮没有为了“手工点击”新增或篡改测试业务数据。证据来自：

- 前端完整 221 项测试以及作废面板／详情入口／工作区／API 客户端 76 项聚焦测试。
- 后端控制器／文件 44 项聚焦测试。
- visitor 不显示或不能强制进入纠错页；ADMIN 可申请但不能审批；SUPER_ADMIN 只有输入精确中文“确认作废合同”才可执行。
- VOIDED 合同显示“已作废”并隐藏收款、退租、退差、提成和再次作废入口，历史详情与附件保留。
- CONTRACT_VOID_PROOF 上传、移除未提交临时附件、历史附件受保护下载、缺失文件中文错误和终态只读均有测试。
- Docker Web 首页 HTTP 200；API health HTTP 200。

尝试用 in-app Browser 做只读页面烟测时，浏览器控制进程被本机既有 Windows deny-read ACL 初始化错误阻止。该错误发生在浏览器控制器启动阶段，不是 Web 页面错误；因此未虚构登录／点击结果，以上述 HTTP 与自动化 UI 证据替代。

## mutation 与 append-only 安全边界

- mutation sensitivity proof 只能在 localhost／127.0.0.1／IPv6 loopback 且数据库名严格匹配 srms_contract_void_mutation_<unique> 的一次性数据库运行。
- CONTRACT_VOID_MUTATION_PROOF=1 对共享持久 srms_docker 会在 App 初始化和 fixture 写入前拒绝。
- Task 11 未启用 mutation proof，也未创建一次性 mutation 数据库。
- Round 2 的 mutation sensitivity 仅临时修改纯 impact 函数并只运行不加载 AppModule／不连接数据库的 unit suite；补丁在同一命令中反向恢复，production diff 和哈希随后核验为 HEAD 原值。
- 普通 E2E 使用未修改 production 代码，完成链保留合同、财务来源、冲销明细和安全审计。
- 只有未完成且没有 append-only audit 的局部测试 fixture 可按精确 ID 清理；COMPLETED 来源链不得物理删除。

## 已知 warning 与非阻塞限制

1. 前端构建继续提示单个 minified chunk 大于 500 kB；本轮主 JS 约 1,316.46 kB，构建产物正常生成。
2. 容器内 mysql CLI 使用容器环境变量认证时显示通用“password on command line”警告；没有输出实际凭据。
3. in-app Browser 控制器受 Windows ACL 初始化错误阻止；HTTP 和组件／服务测试均通过。
4. 首次两次 migrate status 尝试因 Prisma 7 的 cwd／config 发现规则在建立连接前退出；从 backend 目录加载 prisma.config.ts 后同一只读检查通过，数据库无变更。
5. 前端 package 未提供独立 lint script；frontend build 已执行 vue-tsc 类型检查。
6. Prisma CLI 提示 7.8.0 可升级到 8.0.0-rc.12；本轮未变更依赖，schema 校验与 client generate 均通过。

## 最终边界

- 未再次 DROP／CREATE 或清空数据库。
- 未修改 deploy/.env.test。
- 未记录或提交密码、令牌或密钥。
- 未物理删除完成的合同纠错、冲销或安全审计。
- 未 merge、push、创建 PR 或部署生产。

## 2026-08-28 最终验证更新

本节为 Task 12 修复及最终发布门禁的最新证据；若与上文早期快照、测试计数或“未再次重建数据库”的阶段性描述冲突，以本节为准。

### 最终修复范围

- 权限与预览／执行口径一致：管理员不可读取冲销明细，超级管理员后端强制校验；房态预览和执行使用同一有效合同集合。
- 冲销写入 fail-closed：拒绝无法安全配对的预收款转账；来源快照、哈希、幂等键集合与写入数量完整校验。
- 资金流水兼容：普通已作废／已退款收款不再误计现金流，合同纠错来源收款保留历史发生日；提成冲销只写 0.00 审计指示行。
- 房间／合同锁序统一为 room → contract → children，交互式事务使用 ReadCommitted；固定合同直接确认和草稿确认共用同房门闩。
- 已作废合同不能通过后端绕过前端继续追加附件；物理文件与数据库写入失败有重试、脱敏记录和原始异常保留。
- 安全审计链区分事务内追加与原子追加，数据库恢复不再通过自动提交释放链头锁。
- 合同、租金账单、收款和退租结算的原记录支持安全深链；未知来源保持普通文本。
- 受合同纠错影响的原收款详情和可打印收据显著显示“因合同纠错已冲销”，普通退款不会误标。

### 新鲜自动化证据

| 命令／检查 | 最终结果 |
| --- | --- |
| `npm run lint` | 通过；0 errors |
| `npm test -- --runInBand` | 80/80 suites、516/516 tests |
| `npm --prefix backend run test:e2e -- --runInBand` | 7/7 suites、40/40 tests；普通 GREEN，mutation proof 未设置 |
| `npm --prefix frontend run test:unit -- --testTimeout=15000` | 39/39 files、248/248 tests |
| `npm run build` | 前端 vue-tsc + Vite、后端 Nest build 均通过；仅保留既有大 chunk warning |
| `npm run db:validate` | Prisma schema valid |
| 独立全分支审查 | Critical / Important / Minor 均为 0；最终结论 APPROVED |

### 本机测试库最终状态

- 用户明确授权的唯一目标：Docker project `srms_test`、container `srms_test-mysql-1`、port `13306`、database `srms_docker`。
- 重建前已核验兜底：`current-before-rebuild-20260828-094555/database.sql`，SHA-256 `AF4F96ADC08A21AD636BCBA3909314AE3744526FE80EC72C54C25796A80667E2`。
- 完整 E2E 通过后，因测试套件保留业务夹具，再次按同一授权整体 DROP／CREATE `srms_docker`，重新应用 26/26 migrations，并重启 `srms_test-api-1` 触发首名超级管理员初始化。
- 最终只读核验：45 tables、1 名启用超级管理员；buildings／rooms／tenants／contracts／rent_bills／payments／contract_void_requests 均为 0。
- `srms_test-api-1` 与 `srms_test-mysql-1` healthy；`srms_test-web-1` running。
- 未修改或提交 `deploy/.env.test`，未输出任何密码、令牌或密钥，未接触生产数据库。

### 非阻塞遗留

- Vite 仍提示单个压缩 chunk 大于 500 kB；构建成功，本次不调整拆包策略。
- 早期一次错误 E2E 连接在本机 `localhost:3306/srms` 创建了精确可识别的测试夹具（building 7、rooms 279/280、tenants 4/5/6），只读确认没有合同或审计关联。该数据库不在本轮 `srms_docker` 删除授权范围内，因此保持未删，等待单独授权处理。
- 未 merge、push、创建 PR 或部署生产。
