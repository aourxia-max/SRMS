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

```bash
cp .env.example .env
docker compose -f deploy/docker-compose.yml up --build
```

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
- [~] Task006 合同、计价与账单（核心实现与验收记录已完成；等待端到端 MySQL 业务数据验收）
- [~] Task007 收款、分配与预收款（核心实现完成；等待真实合同账单手工验收）
- [~] Task008 优惠、退款与作废（核心审批、退款与作废实现完成；等待真实账单手工验收）
- [~] Task009 阶梯退差（核心模型、审批接口与前端入口已完成；待真实阶梯合同手工验收）
- [~] Task010 押金与退租（核心流程、审批与前端入口已完成；待真实结算数据手工验收）
- [~] Task011 财务中心与提成（核心查询、提成台账与前端入口已完成；导出任务待后续完善）
- [~] Task012 驾驶舱（核心汇总接口与飞书式页面已完成；待真实业务数据手工验收）
- [~] Task013 系统设置、日志与备份（系统参数、日志审计、数据库与附件备份、每日任务、30 天清理及恢复安全流程已完成；待真实业务数据手工验收与跨环境部署配置）

Task001 的详细验收结果见 `task001-acceptance.md`。
Task002—005 的验收记录见 `docs/task002-acceptance.md` 至 `docs/task005-acceptance.md`。
Task013 的验收记录见 `docs/task013-acceptance.md`。
