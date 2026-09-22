# 自建 API 接口契约

前端已经移除第三方云 SDK，默认通过同源 `/api` 调用自建服务。

可在加载 `assets/config.js` 前设置：

```html
<script>
  window.__DATA_AGENT_API_BASE__ = 'https://api.example.com/api';
</script>
```

如果前后端同域部署，无需额外配置。

## 认证

推荐使用 **HttpOnly + Secure + SameSite** Cookie 保存会话。前端请求默认携带 `credentials: include`，不需要把长期 token 暴露给浏览器 JavaScript。

| 方法 | 路径 | 请求体 / 返回值 |
| --- | --- | --- |
| GET | `/api/auth/session` | 返回 `{ "user": {...} }`；未登录返回 401 |
| GET | `/api/auth/user` | 返回用户对象或 `{ "user": {...} }` |
| POST | `/api/auth/password` | `{ email, password }`，返回 `{ "user": {...} }` |
| POST | `/api/auth/otp/request` | `{ email, purpose }`，purpose 为 `login/signup/reset`；返回 `{ verificationId, isExistingUser? }` |
| POST | `/api/auth/otp/verify` | `{ verificationId, token, email, purpose?, password?, isExistingUser? }` |
| POST | `/api/auth/password/reset` | `{ email, verificationId, nonce, password }` |
| POST | `/api/auth/refresh` | 刷新会话 |
| POST | `/api/auth/logout` | 注销当前会话 |

接口既可以直接返回业务对象，也可以包成 `{ "data": ... }`；前端两种格式都能识别。

## 数据接口

前端只使用三个逻辑表：

- `datasets`
- `dataset_rows`
- `analyses`

后端必须做**表名白名单**，并且所有查询、更新和删除都必须在服务端自动按当前用户隔离，不能相信浏览器传入的用户 ID。

### 原子导入数据集

前端上传/粘贴数据时优先使用：

```
POST /api/data/import
Content-Type: application/json

{
  "name": "Q3 销售明细",
  "source": "file",
  "columns": [
    { "name": "amount", "type": "number" }
  ],
  "rows": [
    { "amount": 100 },
    { "amount": 120 }
  ]
}
```

后端会在**一个数据库事务**里完成数据集元信息和全部数据行写入；任意步骤失败都会整体回滚，不会留下半成品数据集。当前上限为 20000 行、500 个字段。

### 查询

```
GET /api/data/:table
```

查询参数：

- `select`：逗号分隔字段，或 `*`
- `eq`：JSON 对象，例如 `{"dataset_id":"..."}`
- `order`：JSON，例如 `{"column":"created_at","ascending":false}`
- `limit`：整数
- `range`：JSON 数组，例如 `[0,999]`，两端都包含

返回数组或 `{ "data": [...] }`。

### 插入

```
POST /api/data/:table
Content-Type: application/json

{
  "rows": [
    { "...": "..." }
  ]
}
```

返回插入后的记录数组。

### 更新

```
PATCH /api/data/:table

{
  "patch": { "...": "..." },
  "eq": { "id": "..." }
}
```

### 删除

```
DELETE /api/data/:table

{
  "eq": { "dataset_id": "..." }
}
```

## LLM

### 模型列表

```
GET /api/llm/models
```

推荐直接使用 OpenAI 风格：

```json
{
  "data": [
    {
      "id": "gpt-5.6",
      "name": "GPT-5.6",
      "provider": "OpenAI"
    }
  ]
}
```

也支持直接返回数组，或 `{ "models": [...] }`。

### 对话

```
POST /api/llm/chat/completions
```

请求体沿用 OpenAI Chat Completions 风格。前端默认传 `stream: true`，推荐后端返回 `text/event-stream`：

```
data: {"choices":[{"delta":{"content":"部分文本"}}]}

data: [DONE]
```

非流式 JSON 也兼容，只要返回：

```json
{
  "choices": [
    {
      "message": {
        "content": "完整文本"
      }
    }
  ]
}
```

LLM 上游 API Key 必须只保存在服务端环境变量中，不要下发到 `assets/config.js`。

服务端还会执行用户级保护：

- 每分钟请求上限：`LLM_REQUESTS_PER_MINUTE`，默认 10
- 每日请求上限：`LLM_REQUESTS_PER_DAY`，默认 300
- 最大输入规模：`LLM_MAX_INPUT_CHARS`，默认 200000
- 上游超时：`LLM_TIMEOUT_MS`，默认 180000 ms

成功的对话响应会附带 `X-RateLimit-*` 响应头；超额返回 HTTP 429。

## 错误格式

推荐统一返回：

```json
{
  "error": {
    "code": "some_code",
    "message": "可读错误信息"
  }
}
```

并使用正确的 HTTP 状态码。前端会特别处理 401、403、404、429 和 5xx。

## 部署检查

完成自建后端后至少验证：

1. 未登录访问 `/api/auth/session` 返回 401。
2. 注册、密码登录、OTP 登录、密码重置、退出可完整跑通。
3. 两个不同账号无法读取或删除对方的数据集。
4. 原子导入失败时不会留下半成品数据集，`range` 分页查询顺序正确。
5. LLM SSE 能持续输出，401 时刷新会话后允许重试。
6. LLM 分钟/日额度超限时正确返回 429。
7. 浏览器源码和 Network 中不存在任何长期上游 LLM Key。
