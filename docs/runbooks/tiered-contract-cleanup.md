# 历史阶梯合同受控清理运行手册

## 1. 用途与当前状态

本工具只用于清理 `pricing_mode = TIERED_RETROACTIVE` 的历史阶梯合同及其关联业务、财务和附件关联数据。它不是 Prisma migration，也不通过网页开放。

工具默认执行只读预检。开发阶段和普通验收阶段严禁运行 `execute`；必须先在测试环境演练，并在生产环境执行前向项目负责人展示最新预检清单、成功备份信息和影响范围，再取得一次单独的最终授权。

截至本手册随代码交付时，只实现和自动测试了工具能力，没有运行任何环境的 `execute`，没有删除任何数据。

## 2. 安全门槛

执行模式必须同时满足以下条件，任一条件不满足都会在事务开始前退出：

1. `--environment` 只能为 `test` 或 `production`，且必须与运行进程的 `NODE_ENV` 完全一致。
2. `--backup-no` 必须对应 `backup_records` 中仍在保留期内的备份。
3. 备份状态必须为 `SUCCESS`，并且数据库文件路径和 SHA-256 校验和均存在。
4. 删除确认短语必须精确等于 `DELETE_ALL_TIERED_CONTRACT_HISTORY`，不能带空格。
5. 独立最终授权短语必须精确等于 `OWNER_APPROVED_EXECUTION`。只有项目负责人看过本次预检结果并明确再次授权后才能提供。
6. 预检读取 `INFORMATION_SCHEMA.KEY_COLUMN_USAGE`；发现静态清单之外的新外键时立即停止。
7. 关联数据删除、合同删除和房态重算必须在同一个数据库事务中完成，任一步失败整体回滚。
8. 文件资产只有在所有已知业务引用均解除后才删除；物理文件仅在事务提交后处理，失败项会列入 `manualFileCleanup`。

这些参数不能代替人工审批。任何历史预检截图或以前的授权都不能用于新的生产执行。

## 3. 构建

在项目根目录执行：

```powershell
npm --prefix backend run build
```

CLI 使用构建产物 `backend/dist/src/maintenance/tiered-contract-cleanup.cli.js`，避免生产镜像依赖 `ts-node`。

## 4. 只读预检

默认模式就是预检；以下两条命令等价：

```powershell
npm --prefix backend run cleanup:tiered
npm --prefix backend run cleanup:tiered -- --mode=preflight --environment=test
```

预检不会启动数据库事务，不调用任何 `create`、`update` 或 `delete`。输出包含：

- 阶梯合同 ID 和合同编号；
- 每张受影响表的记录数；
- 受影响房源 ID；
- 关联附件资产数量；
- 数据库当前外键清单；
- 未纳入静态依赖清单的外键。

把完整 JSON 输出保存到本次变更记录中。若 `unknownDependencies` 非空，不得继续。

## 5. 测试环境演练

测试环境也必须先创建成功备份并记录备份编号。先运行预检，由另一名复核者核对合同编号、各表数量和附件数量。只有专门的测试环境演练得到项目负责人授权时，才允许按第 6 节的格式把环境设为 `test` 执行。

演练后必须核对：

- 固定月租合同、账单、收款和附件未被删除；
- 非租赁房态（维修中、待出售、已出售、停用、其他）未改变；
- 其余房源按仍存在的固定合同恢复为待入住、已出租、待退房或空置；
- `residualForeignKeys` 为空；
- `manualFileCleanup` 已逐项人工处理并留痕。

## 6. 执行格式（不得在本开发阶段运行）

下面仅说明参数格式，不是本阶段执行指令：

```powershell
npm --prefix backend run cleanup:tiered -- --mode=execute --environment=<test或production> --backup-no=<本次成功备份编号> --confirmation=DELETE_ALL_TIERED_CONTRACT_HISTORY --final-authorization=OWNER_APPROVED_EXECUTION
```

生产执行前必须再次完成以下人工检查：

1. 向项目负责人展示刚生成的生产预检 JSON。
2. 展示备份编号、状态、保留期和校验和，确认备份文件可用。
3. 明确说明删除不可通过业务页面撤销，只能从备份恢复。
4. 取得针对“这一次生产执行”的明确最终授权。
5. 由服务器受控终端执行，保存标准输出、错误输出和退出码；不得把数据库连接串、密码或 JWT 写入记录。

没有新的单独最终授权时，任何人都不得运行生产 `execute`。

## 7. 失败处理

- 授权、备份或未知外键检查失败：不启动事务，修正问题后重新预检。
- 事务内失败：数据库自动整体回滚，禁止手工续删；保留错误日志并重新分析依赖。
- 物理文件清理失败：数据库事务已经提交，不回滚业务数据；按 `manualFileCleanup` 清单核对存储路径并人工处理。
- 生产结果异常：立即停止其他写操作，根据成功备份和恢复流程评估回滚，完整保留审计材料。
