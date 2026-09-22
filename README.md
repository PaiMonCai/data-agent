# Data Agent

自托管的数据分析 Agent。上传 CSV、Excel、Stata 等数据后，可以通过自然语言完成数据概览、统计分析、可视化与数据清洗。

## 主要功能

- 数据集导入、预览与管理
- 自然语言分析与数据清洗
- 图表、表格、异常检测等结果展示
- 分析历史记录
- 多个 OpenAI-compatible LLM 供应商、自定义模型渠道与轮询
- 邮箱密码 + OTP 登录
- 多用户数据隔离
- 独立管理员页面（SMTP / LLM）
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

## 管理中心

管理员登录后可以从主界面进入：

```text
/admin/
```

管理中心用于配置：

- SMTP 邮件服务
- OpenAI-compatible LLM 供应商
- Provider Base URL / API Key
- 每个 Provider 的模型渠道开关
- 前端逻辑模型名 → 上游真实模型名映射
- 同一逻辑模型的多渠道轮询 / 固定优先
- 从 `/models` 自动导入上游模型

LLM 与 SMTP 配置保存后立即生效，不需要重启容器。LLM API Key 与 SMTP 密码均使用 `SYSTEM_CONFIG_ENCRYPTION_KEY` 加密保存。

例如可以把两个渠道：

```text
OpenAI  : gpt-5.6
NewAPI  : gpt-5.6-2026
```

都映射成前端的 `gpt-5.6`。用户只会看到一个 `gpt-5.6`，后端可以在两个启用渠道之间轮询。管理员也可以单独关闭任意供应商的某个模型渠道。

如果后台还没有保存 LLM 配置，系统继续使用 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODELS` 环境变量作为兼容 fallback。

## 首次管理员与 SMTP

首次部署不需要提前配置 SMTP。

应用发现数据库里没有管理员时，会使用：

```env
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD
```

创建管理员。之后直接使用管理员邮箱和密码登录，在：

```text
/admin/ → 邮件服务
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
