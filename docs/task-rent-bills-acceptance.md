# 租金账单主功能验收记录

## 范围

本次仅实现租赁财务下的“租金账单”主功能，按已确认原型提供：

- 账单汇总卡片、关键词/楼栋/状态/月度筛选；
- 分页查询与状态标签；
- 账单详情抽屉，展示账单、合同、承租人最小资料、调整项、收款分配和预收款流水；
- 跳转到收款管理登记收款、合同管理查看合同；
- 后端 JWT 鉴权和角色权限强制校验；
- 既有 `rent_bills` 数据结构复用，不新增或修改金额口径，不生成重复账单。

本次不实现账单生成、收款登记、冲回、退款、催缴或其他后续业务动作。

## 修改文件

后端：

- `backend/src/rent-bills/dto/list-rent-bills.dto.ts`
- `backend/src/rent-bills/rent-bills.controller.ts`
- `backend/src/rent-bills/rent-bills.module.ts`
- `backend/src/rent-bills/rent-bills.service.ts`
- `backend/src/rent-bills/rent-bills.service.spec.ts`
- `backend/src/rent-bills/rent-bills.controller.spec.ts`
- `backend/src/app.module.ts`
- `backend/test/app.e2e-spec.ts`

前端：

- `frontend/src/views/RentBillsView.vue`
- `frontend/src/router/index.ts`
- `frontend/src/App.vue`
- `frontend/src/services/http.ts`
- `frontend/src/services/rentBillDisplay.ts`
- `frontend/src/services/rentBillDisplay.spec.ts`
- `frontend/package.json`
- `frontend/package-lock.json`

文档：

- `docs/superpowers/specs/2026-08-05-rent-bill-management-design.md`
- `docs/superpowers/plans/2026-08-05-rent-bill-management.md`

## 自动化测试结果

在独立分支 `feat/rent-bill-management` 中完成：

- Prisma 校验：通过；
- 后端构建：通过；
- 后端 ESLint：通过；
- 后端单元测试：22 个测试套件、67 个测试通过；
- 租金账单专项测试：2 个测试套件、5 个测试通过；
- 后端接口测试：7 个测试通过，包含未登录访问受保护接口返回 401；
- 前端单元测试：1 个测试文件、2 个测试通过；
- 前端构建：通过。

前端构建仍有既有的大体积 JS chunk 提示；依赖安装报告的安全审计提示未在本任务中强制升级。

## 手工验收步骤

1. 启动测试环境并登录超级管理员。
2. 在左侧“租赁财务”下点击“租金账单”。
3. 确认页面显示本月账单汇总、账单表格和分页。
4. 使用关键词、楼栋、账单状态、月份筛选，确认列表和汇总随查询刷新。
5. 点击任意账单的“查看详情”，确认右侧抽屉展示账单、合同、承租人、调整项、收款分配和预收款流水。
6. 点击“登记收款”应进入收款管理并携带账单 ID；点击“查看合同”应进入合同管理并携带合同 ID。
7. 使用无效/缺失 Bearer Token 请求 `/api/rent-bills` 和 `/api/rent-bills/:id`，确认后端返回 401。

## 交接与部署说明

- 本次变更尚未自动合并到主工作区，也未部署到线上环境；需要确认后再合并、推送和部署。
- 主工作区原有未提交改动保持不变。
- 测试接口使用现有测试环境配置；未将密码、JWT 密钥或数据库连接信息写入代码和文档。
