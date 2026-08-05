# SRMS 房屋租赁管理系统

SRMS 是围绕房源、承租人、合同、租金账单、收款和退租结算构建的房屋租赁管理系统。第一版需求以 `docs/requirements-freeze-v1.md` 为准。

## 技术栈

- 前端：Vue 3、TypeScript、Element Plus、Pinia、Vue Router、Axios
- 后端：NestJS、TypeScript、Prisma
- 数据库：MySQL 8
- 部署：Docker Compose

## 环境要求

- Node.js 24 LTS
- npm 11+
- MySQL 8，或 Docker Desktop

## 本地启动

```bash
cp .env.example .env
cp backend/.env.example backend/.env
npm install
npm --prefix frontend install
npm --prefix backend install
npm run db:generate
npm run dev
```

Windows 新电脑首次准备可以直接运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

当前约定的 Windows 项目目录为 `D:\Work\iwen-codex\codex-zhufang\srms`。请在该目录打开 VS Code/Codex 和 PowerShell。

完整产品需求与开发交接方案见 `docs/SRMS-PRD-Codex-Handoff-v1.0.md`，换机说明见 `docs/other-computer-handoff.md`，交给新会话 Codex 的续开发指令见 `docs/codex-resume-prompt.md`。

- 前端：http://localhost:5173
- 后端健康检查：http://localhost:3000/api/health

## 使用 Docker 启动

Docker 环境与本机开发环境使用不同端口，不会占用本机的 `3306`、`3000`、`5173`。

1. 启动 Docker Desktop。
2. 复制 [deploy/.env.example](deploy/.env.example) 为 `deploy/.env`，填写强密码、JWT 密钥、证件加密密钥和首名超级管理员信息。
3. 执行：

```powershell
docker compose --project-name srms_docker --env-file deploy/.env -f deploy/docker-compose.yml up --build -d
```

默认访问地址：

- 前端：http://localhost:15173
- 后端健康检查：http://localhost:13000/api/health
- Docker MySQL：localhost:13306

首次启动会自动执行 Prisma migration 并在空库中创建配置的首名超级管理员。上传文件与备份数据使用独立 Docker 卷持久化。

## 常用命令

```bash
npm run build
npm run test
npm run lint
npm run db:validate
```

## 当前进度

- [x] Task001 项目初始化
- [x] Task002 登录与会话
- [x] Task003 用户与权限基础
- [x] Task004 楼栋与房源
- [x] Task005 承租人与文件基础
- [x] Task006 合同、计价与账单
- [x] Task007 收款、分配与预收款
- [x] Task008 优惠、退款与作废
- [x] Task009 阶梯退差
- [x] Task010 押金与退租
- [x] Task011 财务中心与提成（核心查询、提成台账、Excel/PDF 异步导出任务与下载入口已完成）
- [x] Task012 驾驶舱
- [x] Task013 系统设置、日志与备份
- [x] 租金账单主功能（查询、筛选、分页、详情与权限校验）

Task001 的详细验收结果见 `task001-acceptance.md`。
Task002—005 的验收记录见 `docs/task002-acceptance.md` 至 `docs/task005-acceptance.md`。
Task013 的验收记录见 `docs/task013-acceptance.md`。
租金账单功能的验收记录见 `docs/task-rent-bills-acceptance.md`。

Task006 至 Task013 已在本机 MySQL TEST 数据中完成验收；完整记录见各任务验收文档。跨环境部署前仍应在目标环境复核备份目录、MySQL 工具路径和中文字体配置。
