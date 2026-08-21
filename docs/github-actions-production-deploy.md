# GitHub Actions 自动部署

项目已配置 `.github/workflows/deploy-production.yml`。以后代码合并到 `main` 后，GitHub 会先执行测试和构建，全部通过后才通过 SSH 更新生产服务器。

## 第一次配置 GitHub Secrets

进入 GitHub 仓库：`Settings` → `Secrets and variables` → `Actions`，新增以下 Repository secrets：

| 名称 | 值 |
| --- | --- |
| `SRMS_DEPLOY_HOST` | `123.207.64.190` |
| `SRMS_DEPLOY_PORT` | `22` |
| `SRMS_DEPLOY_USER` | 服务器 SSH 登录用户，通常为 `root` |
| `SRMS_DEPLOY_SSH_KEY` | 对应部署公钥的私钥内容，只粘贴私钥，不要粘贴 `.pub` 公钥 |
| `SRMS_DEPLOY_DIR` | `/opt/srms` |

私钥只保存到 GitHub Secrets，不要写进代码、`.env` 或聊天消息。服务器必须已经安装 Docker、Docker Compose，并且 `/opt/srms` 是项目 Git 工作区；服务器上的 `deploy/.env` 仍由服务器自己保管。

## 部署规则

- 合并到 `main` 会自动触发部署。
- 可在仓库 `Actions` 页面手动运行 `SRMS 生产部署`。
- 后端测试、Lint、Prisma 校验、前端测试或构建任一步失败，部署不会开始。
- 如果服务器工作区有未提交修改，流程会主动停止，不会覆盖服务器上的内容。
- 后端容器启动时会执行 `prisma migrate deploy`，只应用已有迁移，不会重置数据库。
