# Data Agent 前端

Data Agent 已从 `index.html + Vanilla JavaScript` 迁移到：

- Next.js 16（App Router）
- React 19
- TypeScript
- Tailwind CSS 4
- Apache ECharts
- Lucide React
- SheetJS Community Edition 0.20.3

源码位于：

```
frontend/
├── app/
├── components/
└── lib/
```

## 开发

```bash
cd frontend
npm install
npm run dev
```

开发服务器只负责前端。浏览器 API 客户端固定访问同源 `/api`；本地联调时建议通过反向代理把 `/api` 转发到 Hono，或直接使用生产 Docker 方式测试完整同源环境。

类型检查：

```bash
npm run typecheck
```

生产构建：

```bash
npm run build
```

Next.js 使用：

```ts
output: "export"
```

构建结果位于：

```
frontend/out/
```

## 生产架构

```
Next.js / React / TypeScript
          │
          │ next build
          ▼
    frontend/out
          │
          │ Docker multi-stage COPY
          ▼
    /app/server/public
          │
          ▼
         Hono
      ┌────┴─────┐
      │          │
  静态前端     /api/*
                 │
        Prisma / PostgreSQL
                 │
        OpenAI-compatible LLM
```

因此生产环境仍然只有一个应用容器，Compose 和 GHCR 部署方式不变。

## 数据文件

当前前端支持：

- CSV / TSV / 文本
- JSON
- Excel `.xlsx` / `.xlsm` / `.xls` / `.xlsb`
- OpenDocument `.ods`
- Stata `.dta`
- 直接粘贴表格
- 内置示例数据

表格解析使用 SheetJS Community Edition 0.20.3。由于 npm registry 中名为 `xlsx` 的版本停留在较旧的 0.18.5，项目按照 SheetJS 官方安装方式直接固定到其 0.20.3 发布 tarball。

## 模块

`lib/api.ts`

- Hono API typed client
- Session / Auth
- Dataset API
- SSE LLM streaming

`lib/parse.ts`

- CSV / TSV / JSON
- SheetJS 0.20.3
- 数据类型推断

`lib/dta.ts`

- Stata 数据适配

`lib/engine.ts`

- 聚合
- 趋势
- 异常检测
- 对比
- 相关性

`lib/clean.ts`

- 数据清洗操作
- 安全表达式求值

`lib/agent.ts`

- 自然语言规划
- 本地真实计算
- 模型解释生成

成熟分析算法是从原 Vanilla JS 版本直接迁移而来，目前这些模块局部使用 `@ts-nocheck` 以降低一次迁移风险。React UI、API、状态和类型层已经使用 strict TypeScript。后续可以逐模块消除 `@ts-nocheck`。

## 原前端

旧的根目录 `index.html` 和 `assets/*.js` 已从当前代码树删除。

需要回看或回滚时直接通过 Git 历史访问，不再在主分支同时维护两套前端。
