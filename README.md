# Data Agent

自托管的数据分析 Agent。上传 CSV、Excel、Stata 等数据后，可以通过自然语言完成数据概览、统计分析、可视化、异常检测与数据清洗。

前端使用 Next.js + React + TypeScript，后端使用 Hono + Prisma + PostgreSQL，并通过 OpenAI-compatible API 接入模型。生产部署默认使用 Docker Compose。

## 功能

- 数据集导入、预览与管理
- 自然语言数据分析与清洗
- 分析历史与结果复用
- 图表、表格、异常检测等多种结果展示
- OpenAI-compatible 模型网关
- 邮箱密码 + OTP 登录
- HttpOnly Cookie Session
- 多用户数据隔离
- 管理员运行时 SMTP 配置
- PostgreSQL 持久化与 Prisma Migration
- Docker / GHCR 自托管部署

## 架构

```text
Browser
  │
  ▼
Hono App :3000
  ├─ Next.js static export
  ├─ /api/auth
  ├─ /api/data
  ├─ /api/llm
  └─ /api/admin
       │
       ├─ PostgreSQL
       ├─ SMTP
       └─ OpenAI-compatible LLM gateway
```

主要目录：

```text
frontend/                 Next.js + React + TypeScript 前端
server/src/               Hono API
server/prisma/            Prisma schema 与 migrations
docker-compose.yml        PostgreSQL + Data Agent
BACKEND.md                后端与部署细节
FRONTEND.md               前端架构
SELF_HOSTED_API.md        API 约定
```

## 首次部署

### 1. 准备配置

```bash
cp .env.example .env
```

至少修改：

```env
POSTGRES_PASSWORD=replace-with-a-long-random-database-password
SESSION_SECRET=replace-with-at-least-32-random-characters

# 首次管理员
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-admin-password

# 用于加密后台保存的 SMTP 密码
SYSTEM_CONFIG_ENCRYPTION_KEY=replace-with-a-long-random-encryption-secret

# OpenAI-compatible API
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=your-key
```

随机密钥可以使用：

```bash
openssl rand -hex 32
```

> `SYSTEM_CONFIG_ENCRYPTION_KEY` 一旦用于保存 SMTP 密码后不要随意更换，否则数据库中已有的 SMTP 密码将无法解密。

### 2. 启动

```bash
docker compose pull
docker compose up -d
```

默认访问：

```text
http://服务器IP:3000
```

查看状态：

```bash
docker compose ps
docker compose logs -f app
```

健康检查：

```bash
curl http://127.0.0.1:3000/api/health
```

## 首次管理员初始化

新部署不要求先配置 SMTP。

应用启动时会检查数据库里是否已经存在 `role=admin` 的用户：

1. 已有管理员：正常启动，不修改任何管理员账号或密码。
2. 没有管理员，且设置了 `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`：创建或提升该邮箱为管理员。
3. 没有管理员，也没有 bootstrap 配置：应用仍可启动，但日志会提示先配置管理员。

管理员创建完成后，直接使用 **邮箱 + 密码** 登录，不依赖邮件验证码。

首次登录后建议：

```text
管理员密码登录
  ↓
打开「设置」
  ↓
管理员 · 邮件服务
  ↓
填写 SMTP
  ↓
保存 SMTP
  ↓
发送测试邮件
  ↓
确认成功
```

确认管理员已建立后，可以从 `.env` 删除：

```env
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD
```

即使忘记删除，只要数据库中已经存在管理员，后续启动也不会再次重置管理员密码。

## SMTP 管理

管理员可以直接在设置面板配置：

- SMTP Host
- Port
- SSL/TLS
- 用户名
- 密码
- 发件人

SMTP 配置保存在 PostgreSQL 的 `system_settings` 中。SMTP 密码使用 AES-256-GCM 加密保存。

后台保存后会**立即生效，无需重启容器**。

如果旧部署原本通过环境变量配置：

```env
SMTP_HOST=
SMTP_PORT=
SMTP_SECURE=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
```

仍然可以继续使用。管理员第一次从后台保存设置时，如果密码框留空，会保留当前有效密码。

## 邮件与注册

开发测试可以：

```env
MAIL_MODE=console
```

此时 OTP 会写入应用日志：

```bash
docker compose logs -f app
```

生产环境建议在管理员后台配置 SMTP。

> `MAIL_MODE=console` 仅适合测试，不建议长期用于公网部署。

## 管理接口

公开状态：

```http
GET /api/setup/status
```

返回类似：

```json
{
  "initialized": true,
  "mailConfigured": true
}
```

管理员接口：

```http
GET   /api/admin/settings/mail
PATCH /api/admin/settings/mail
POST  /api/admin/settings/mail/test
```

这些接口都要求当前 Session 对应用户的 `role` 为 `admin`。

## 数据库升级

Data Agent 使用 Prisma Migration。

容器启动时自动执行：

```bash
prisma migrate deploy
```

因此已有部署升级镜像后，会自动增加管理员角色和系统设置表，不需要删除 PostgreSQL volume。

正式环境仍建议单独备份 PostgreSQL 数据。

## OpenAI-compatible 模型

例如：

```env
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=sk-...
LLM_MODELS=gpt-5.6,gpt-5.6-mini
```

如果上游没有可靠的 `/models`，可以使用 `LLM_MODELS` 手动指定模型目录。

浏览器不会获得服务端的默认 API Key。

## HTTPS 部署

正式域名建议配置：

```env
APP_ORIGIN=https://data.example.com
COOKIE_SECURE=true
```

如果前后端分域，还需要根据部署情况设置：

```env
COOKIE_SAME_SITE=None
COOKIE_SECURE=true
```

可以在 Data Agent 前面继续使用 Nginx、OpenResty、Caddy 或 Cloudflare。

## 开发

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

## CI

GitHub Actions 会检查：

- 前端类型检查、测试与构建
- npm audit
- Prisma validate / generate
- 后端 TypeScript
- Prisma migration
- Runtime smoke test
- Docker Compose 配置
- Docker image build

## 安全说明

- 密码使用 bcrypt
- Session Cookie 为 HttpOnly
- 数据库只保存 Session Token 的 HMAC
- OTP 只保存摘要，并带有效期与频率限制
- SMTP 密码加密落库
- 管理接口需要 `admin` 角色
- 业务数据查询始终按当前 Session 用户隔离
- PostgreSQL 不需要暴露到公网

更多实现细节见 [BACKEND.md](BACKEND.md)、[FRONTEND.md](FRONTEND.md) 与 [SELF_HOSTED_API.md](SELF_HOSTED_API.md)。
