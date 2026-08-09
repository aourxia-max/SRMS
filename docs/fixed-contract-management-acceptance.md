# 固定月租合同管理重构验收记录

验收日期：2026-08-09  
验收分支：`codex/fixed-contract-redesign`  
业务基线：SRMS-RB-1.0 及 `SRMS-RB-1.0-CR-20260805-01`

## 1. 验收范围

- 新建合同仅允许固定月租；后端强制拒绝新阶梯合同和阶梯退差。
- 合同草稿、账单预览、正式确认事务、系统合同编号和账单编号。
- 合同附件上传、关联、列表和下载。
- 超级管理员提成字段权限、固定月租人工退差及退款凭证约束。
- 合同列表、创建表单、详情、固定月租退差四个工作区，以及旧路由兼容和响应式布局。
- 历史阶梯合同清理工具的只读预检；本次不执行任何删除。

## 2. 自动化验证结果

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| Prisma 结构 | `npm --prefix backend run prisma:validate` | 通过，schema valid |
| Prisma 客户端 | `npm --prefix backend run prisma:generate` | 通过，Prisma Client 7.8.0 生成成功 |
| 后端 Lint | `npm --prefix backend run lint:check` | 通过，0 个错误 |
| 后端构建 | `npm --prefix backend run build` | 通过 |
| 后端完整单元测试 | `npm --prefix backend test -- --runInBand` | 44 个测试套件、203 项测试全部通过 |
| 后端 e2e | 加载本地 `deploy/.env.test` 并设置测试 `DATABASE_URL` 后运行 `npm --prefix backend run test:e2e -- --runInBand` | 2 个测试套件、11 项测试全部通过 |
| 前端完整测试 | `npm --prefix frontend run test:unit` | 6 个测试文件、24 项测试全部通过 |
| 前端生产构建 | `npm --prefix frontend run build` | 通过；存在大于 500 kB 的分包提示 |
| Docker 镜像 | `docker compose --progress plain -p srms_test ... build api web` | API、Web 镜像构建成功 |
| Docker 服务 | `docker compose -p srms_test ... up -d --no-build api web` | MySQL、API healthy，Web running |
| HTTP 健康检查 | `GET http://localhost:13000/api/health`、`GET http://localhost:15173/contracts` | 均返回 HTTP 200 |

第一次在未设置 `DATABASE_URL` 时运行 e2e，`app.e2e-spec.ts` 有 7 项在应用启动阶段被数据库配置门槛阻断，另 4 项通过。随后只连接本地 `srms_test` 的 13306 端口重新运行，11 项全部通过。该首次失败属于环境配置证据，未从记录中删除。

## 3. 本地测试环境与 migration

- Compose 项目名：`srms_test`。
- 测试入口：http://localhost:15173/contracts
- API：http://localhost:13000/api/health
- 测试数据库：`srms_docker`，仅通过本地 13306 端口访问。
- API 容器启动时发现 21 个 migration，并成功应用 `20260805100000_fixed_contract_management_redesign`。
- 未连接生产数据库，未访问线上服务器，未修改 `srms_prod`。

## 4. 测试专用业务闭环

在本地 `srms_test` 中创建了两份明确标记为“测试专用”的固定月租合同：

1. 账单预览返回 12 期；草稿 ID 1 从 `DRAFT` 确认为合同 ID 6。
2. 合同定价模式为 `FIXED`，生成 12 期正式账单，房源更新为 `PENDING_MOVE_IN`。
3. 再次确认同一草稿返回“草稿已确认”，未重复创建合同。
4. 第二份附件合同 ID 7 关联文件资产 ID 1；附件列表返回 1 项，下载返回 HTTP 200、`application/pdf`、44 字节。
5. 使用字段完整的阶梯合同请求验证后端边界，返回 HTTP 410 和“阶梯合同功能已停用”。

测试记录的纸质合同编号/备注均包含“测试专用”，只存在于 `srms_test`。本次未清理这些测试记录，便于项目负责人继续页面验收；不得迁入生产环境。

## 5. 历史阶梯清理预检

仅对本地 `srms_test` 运行：

```powershell
npm --prefix backend run cleanup:tiered -- --mode=preflight --environment=test
```

预检成功，未运行 `execute`：

- 待处理阶梯合同：1 份，合同 ID 4。
- 关联阶梯档位：4 条；租金账单：12 条；收款：4 条；收款分配：30 条；作废申请：3 条；房态历史：2 条。
- 受影响房源：1 间；附件：0 个。
- 未知外键依赖：0。
- 预检指纹：`61fcc4355ffb4e362568fc271795fb72cca43a8a524a112730959e84ba279341`。

本次没有提供备份编号、确认短语或最终授权，未执行测试库删除，更未执行生产删除。

## 6. 未完成项与风险

- 浏览器控制运行时被 Windows ACL 隔离权限阻止，因此没有形成自动桌面/平板/手机截图。页面 HTTP 200、前端组件测试和生产构建通过，但视觉与真实点击流程仍需在 `http://localhost:15173/contracts` 人工复核。
- 现有 Jest e2e 主要覆盖健康检查、未登录保护和收款接口鉴权；草稿、确认、附件和阶梯拒绝已通过本次真实测试库 API 演练及单元测试覆盖，但尚未形成对应的独立 Jest e2e 用例。
- 固定月租退差的真实提交/审批未在本次测试库执行，避免制造实际退款业务记录；其服务、权限、凭证和前端交互由现有单元/组件测试覆盖，仍需人工页面验收。
- 普通管理员提成不可见/不可写主要由后端与前端自动化测试验证；本次测试库只确认了超级管理员登录，没有可用的普通管理员测试账号用于浏览器复核。
- 前端构建提示主 JavaScript 包约 1.24 MB（gzip 约 390 kB），后续可做按路由拆包优化。
- Docker API 镜像执行 `npm ci` 时报告 10 个依赖漏洞（7 个 moderate、3 个 high）。本次未自动升级依赖，避免引入超出验收范围的破坏性版本变更；上线前应单独评估 `npm audit` 结果。

## 7. 上线与删除前置条件

1. 项目负责人在测试环境人工复核四个顶部页签、中文日期、草稿恢复、附件、合同详情、固定退差和移动端布局。
2. 补充或准备普通管理员测试账号，复核提成字段不可见、不可提交。
3. 生产发布前先备份数据库和上传目录，核对备份状态、文件可读性和 SHA-256。
4. 在生产环境仅运行新的只读预检，展示合同清单、关联表计数、未知外键和最新指纹。
5. 只有项目负责人针对该次最新清单再次单独授权后，才可运行生产 `execute`；本次验收不构成删除授权。

## 8. 本次文档修改

- `README.md`
- `docs/fixed-contract-management-acceptance.md`

既有暂存文件 `backend/src/contracts/contract-schema.spec.ts` 未被修改，也不应包含在本次文档提交中。
