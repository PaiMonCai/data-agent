# Data Agent 自建后端

后端位于 `server/`，使用：

- Hono + Node.js 22
- Prisma ORM 7 + PostgreSQL
- 服务端 Session + HttpOnly Cookie
- bcrypt 密码哈希
- 邮箱 OTP
- OpenAI-compatible LLM 反向代理
- Docker Compose

前端使用 Next.js + React + TypeScript + Tailwind CSS，并通过 Next.js static export 构建到静态目录。Docker 镜像把该目录复制给 Hono 提供，因此前端和后端仍由同一个容器提供，默认无需 CORS，浏览器只访问同源 `/api`。

前端开发与架构说明见 `FRONTEND.md`。

## 1. 环境变量

Docker Compose 从仓库根目录的 `.env` 读取部署变量。服务器部署只需要 `docker-compose.yml` 和 `.env`，应用镜像由 GHCR 提供，不需要在服务器上保留源码或执行 Docker build。

先复制模板：

```bash
cp .env.example .env
```

默认镜像：

```env
DATA_AGENT_IMAGE=ghcr.io/paimoncai/data-agent:latest
```

生产环境更建议固定版本，例如：

```env
DATA_AGENT_IMAGE=ghcr.io/paimoncai/data-agent:1.2.0
```

然后至少填写：

```env
POSTGRES_PASSWORD=replace-with-a-long-random-password
SESSION_SECRET=replace-with-at-least-32-random-characters

LLM_BASE_URL=https://your-openai-compatible-gateway.example.com/v1
LLM_API_KEY=your-server-side-key

# 本地测试可以保持 false；HTTPS 正式站必须改 true
COOKIE_SECURE=false

# 测试期验证码打印到 docker logs
MAIL_MODE=console
```

生成 Session Secret 示例：

```bash
openssl rand -hex 32
```

正式上线建议配置 SMTP：

```env
MAIL_MODE=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-user
SMTP_PASS=your-password
SMTP_FROM=Data Agent <no-reply@example.com>
```

正式 HTTPS 域名还应设置：

```env
COOKIE_SECURE=true
```

如果前端与 API 分域，再配置：

```env
APP_ORIGIN=https://data.example.com
COOKIE_SAME_SITE=None
COOKIE_SECURE=true
```

直接访问 Node 服务时同域部署可以不设置 `APP_ORIGIN`。如果正式环境前面有 Nginx / OpenResty / Cloudflare 等 HTTPS 反向代理，建议显式设置公开 Origin，例如 `APP_ORIGIN=https://data.example.com`，用于跨站写请求校验。

## 2. 构建镜像 Workflow

仓库中的 `.github/workflows/build-image.yml` 会构建并推送：

```
ghcr.io/paimoncai/data-agent
```

镜像同时支持 `linux/amd64` 和 `linux/arm64`。

触发规则：

- push 到 `main`：发布 `latest` 和 `sha-<commit>`
- push `v*` 标签，例如 `v1.2.0`：发布 Git tag、`1.2.0`、`1.2` 和 commit SHA 标签
- GitHub Actions 页面可通过 `workflow_dispatch` 手动运行

Workflow 使用仓库自带的 `GITHUB_TOKEN` 写入 GitHub Container Registry，不需要单独配置 Docker Hub 凭据。

如果 GHCR Package 是私有可见性，部署服务器需要先执行 `docker login ghcr.io`；公开 Package 可以直接拉取。

## 3. Compose 部署

首次启动或更新都使用：

```bash
docker compose pull
docker compose up -d
```

查看容器状态：

```bash
docker compose ps
```

查看应用日志：

```bash
docker compose logs -f app
```

应用默认监听：

```
http://服务器IP:3000
```

容器启动时自动执行：

```
prisma migrate deploy
```

首次启动会自动创建数据库表。

## 4. 健康检查

```bash
curl http://127.0.0.1:3000/api/health
```

正常示例：

```json
{
  "ok": true,
  "service": "data-agent",
  "database": "ok",
  "llmConfigured": true,
  "mailMode": "smtp"
}
```

## 5. OTP 测试

当：

```env
MAIL_MODE=console
```

验证码不会发送邮件，而是写入应用日志：

```bash
docker compose logs -f app
```

正式环境不要使用 console 模式。

## 6. LLM 网关

后端兼容 OpenAI 风格：

- `GET /v1/models`
- `POST /v1/chat/completions`

因此可以接 OpenAI、NewAPI 或其他 OpenAI-compatible 网关。

例如：

```env
LLM_BASE_URL=https://api.example.com/v1
LLM_API_KEY=sk-...
```

上游 Key 永远只保存在服务端环境变量中，不会发送给浏览器。

如果上游没有可靠的 `/models` 接口，可以手工定义模型目录：

```env
LLM_MODELS=gpt-5.6,gpt-5.6-mini,glm-4.6
```

这只影响模型列表，不限制前端自定义模型 ID。

建议在公开部署时按成本调整额度：

```env
LLM_REQUESTS_PER_MINUTE=10
LLM_REQUESTS_PER_DAY=300
LLM_MAX_INPUT_CHARS=200000
LLM_TIMEOUT_MS=180000
```

限流使用 PostgreSQL 原子计数桶，因此多实例部署时仍共享同一额度，不依赖单机内存。旧的分钟桶会被后台轻量清理。

## 7. 数据隔离与导入事务

前端导入数据走 `POST /api/data/import`。服务端会在一个 PostgreSQL transaction 中创建数据集并分块写入数据行；任何一批失败都会整体回滚。

后端不会接受前端提供的 `user_id`。

`datasets`、`dataset_rows`、`analyses` 的所有读写都会根据当前 HttpOnly Session 在服务端附加用户条件。数据行和分析记录写入前，还会再次检查所属数据集是否属于当前用户。

## 8. 认证设计

密码：

- bcrypt cost = 12
- 拒绝超过 bcrypt 72-byte 上限的密码

Session：

- 浏览器只保存随机 Session Token
- Cookie 为 HttpOnly
- 数据库只保存 Token HMAC，不保存原始 Token
- 默认有效期 30 天
- refresh 会轮换 Session Token

OTP：

- 6 位随机数字
- 数据库只保存 HMAC
- 默认 10 分钟过期
- 默认同邮箱同用途 60 秒只能发送一次
- 每小时默认最多 5 次
- 单验证码最多尝试 5 次

## 9. 数据库

主要表：

- `users`
- `sessions`
- `otp_codes`
- `datasets`
- `dataset_rows`
- `analyses`
- `llm_rate_buckets`

数据库数据位于 Docker volume：

```
data-agent-postgres
```

正式部署需要为 PostgreSQL 做独立备份，不要只依赖 Docker volume。

## 10. 开发模式

```bash
cd server
cp .env.example .env
npm install
npm run migrate:dev
npm run dev
```

如果开发时不通过 Hono 提供静态页面：

```env
SERVE_STATIC=false
```

前端若运行在另一个 Origin，需要设置 `APP_ORIGIN`。

## 11. CI

GitHub Actions 会执行：

```
prisma validate
prisma generate
tsc --noEmit
prisma migrate deploy
runtime smoke test
Docker image build
```

对应文件：

```
.github/workflows/backend-ci.yml
```

完整浏览器端接口约定见 `SELF_HOSTED_API.md`。
