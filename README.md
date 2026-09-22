# Data Agent

自托管的数据分析 Agent。上传 CSV、Excel、Stata 等数据后，可以通过自然语言完成数据概览、统计分析、可视化与数据清洗。

## 主要功能

- 数据集导入、预览与管理
- 自然语言分析与数据清洗
- 图表、表格、异常检测等结果展示
- 分析历史记录
- OpenAI-compatible 模型接入
- 邮箱密码 + OTP 登录
- 多用户数据隔离
- 管理员后台配置 SMTP
- Docker 自托管部署

## 技术栈

- 前端：Next.js + React + TypeScript
- 后端：Hono
- 数据库：PostgreSQL + Prisma
- 部署：Docker Compose

## 快速部署

```bash
cp .env.example .env
```

至少配置：

```env
POSTGRES_PASSWORD=replace-with-a-long-random-password
SESSION_SECRET=replace-with-at-least-32-random-characters

BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-admin-password
SYSTEM_CONFIG_ENCRYPTION_KEY=replace-with-a-long-random-secret

LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=your-key
```

然后启动：

```bash
docker compose pull
docker compose up -d
```

默认访问：

```text
http://服务器IP:3000
```

## 首次管理员与 SMTP

首次部署不需要提前配置 SMTP。

应用发现数据库里没有管理员时，会使用：

```env
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD
```

创建管理员。之后直接使用管理员邮箱和密码登录，在：

```text
设置 → 管理员 · 邮件服务
```

中配置 SMTP，并发送测试邮件。

SMTP 保存后立即生效，不需要重启容器。

管理员创建成功后，可以从 `.env` 删除：

```env
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD
```

`SYSTEM_CONFIG_ENCRYPTION_KEY` 用于加密 SMTP 密码，投入使用后不要随意更换。

## 已有部署升级

Data Agent 使用 Prisma Migration。更新镜像并重新启动后会自动执行数据库迁移，不需要删除 PostgreSQL volume。

升级前建议备份数据库。

## HTTPS

正式部署建议设置：

```env
APP_ORIGIN=https://data.example.com
COOKIE_SECURE=true
```

并在前面使用 Nginx、OpenResty、Caddy 或 Cloudflare 提供 HTTPS。

## 本地开发

前端：

```bash
cd frontend
npm ci
npm run dev
```

后端：

```bash
cd server
cp .env.example .env
npm ci
npm run migrate:dev
npm run dev
```

更多细节见：

- [BACKEND.md](BACKEND.md)
- [FRONTEND.md](FRONTEND.md)
- [SELF_HOSTED_API.md](SELF_HOSTED_API.md)
