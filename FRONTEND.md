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
├── app/                     # App Router 入口、全局样式、error / not-found 边界
├── components/              # 跨功能复用的展示组件
├── features/                # 按领域切分的功能模块
│   ├── auth/                #   登录 / 注册 / 验证码
│   ├── chat/                #   会话、结果卡片、消息列表、模型层
│   ├── datasets/            #   数据集侧边栏、导入
│   └── settings/            #   偏好设置抽屉
└── lib/                     # 与 UI 无关的纯逻辑与 API 客户端
```

## 开发

```bash
cd frontend
npm ci
npm run dev
```

开发服务器只负责前端。浏览器 API 客户端固定访问同源 `/api`；本地联调时建议通过反向代理把 `/api` 转发到 Hono，或直接使用生产 Docker 方式测试完整同源环境。

类型检查：

```bash
npm run typecheck
```

测试（Node 内置 test runner，零额外依赖）：

```bash
npm test
```

测试文件与被测模块同目录，命名 `*.test.ts`，覆盖 `lib/` 下零依赖的纯逻辑。
`tsconfig.json` 因此开启了 `allowImportingTsExtensions`，测试用 `./markdown.ts` 这类带扩展名的相对路径导入。

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

`lib/markdown.ts`

- 零依赖的 Markdown 解析器，输出 AST（刻意不做完整 CommonMark）
- 覆盖标题、段落、列表、引用、代码块、分隔线、表格，以及行内加粗 / 斜体 / 行内代码 / 删除线 / 链接
- 表格要求首尾都有竖线；缺分隔行时按普通段落处理，不会丢内容
- 由 `components/markdown-view.tsx` 渲染成 React 元素，不使用 `dangerouslySetInnerHTML`
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

成熟分析算法是从原 Vanilla JS 版本直接迁移而来，目前这些模块局部使用 `@ts-nocheck` 以降低一次迁移风险。React UI、API、状态和类型层已经使用 strict TypeScript。后续可以逐模块消除 `@ts-nocheck`。（当前涉及 `agent.ts` / `charts.ts` / `clean.ts` / `dta.ts` / `engine.ts` / `parse.ts`）

## 原前端

旧的根目录 `index.html` 和 `assets/*.js` 已从当前代码树删除。

需要回看或回滚时直接通过 Git 历史访问，不再在主分支同时维护两套前端。


## 依赖锁定

前端提交 `package-lock.json`，CI 和 Docker build 使用 `npm ci`，避免每次构建解析出不同依赖树。

CI 还会执行：

```bash
npm audit --audit-level=high
```

当前前端审计结果为 0 vulnerability。
