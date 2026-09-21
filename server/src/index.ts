import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import authRoutes from "./auth.js";
import dataRoutes from "./data.js";
import llmRoutes from "./llm.js";
import { env, jsonError, prisma, type AppEnv } from "./lib.js";

const app = new Hono<AppEnv>();

app.use("*", logger());

app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  await next();
});

if (env.appOrigin) {
  app.use(
    "/api/*",
    cors({
      origin: env.appOrigin,
      credentials: true,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    })
  );
}

app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});

app.get("/api/health", async (c) => {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return c.json({
      ok: true,
      service: "data-agent",
      database: "ok",
      llmConfigured: Boolean(env.llmBaseUrl),
      mailMode: env.mailMode,
    });
  } catch (e) {
    console.error("[health]", e);
    return c.json(
      {
        ok: false,
        service: "data-agent",
        database: "error",
      },
      503
    );
  }
});

app.route("/api/auth", authRoutes);
app.route("/api/data", dataRoutes);
app.route("/api/llm", llmRoutes);

if (env.serveStatic) {
  app.use("/assets/*", serveStatic({ root: env.staticRoot }));
  app.get("/", serveStatic({ root: env.staticRoot, path: "index.html" }));
}

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json(
      { error: { code: "not_found", message: "API 路径不存在" } },
      404
    );
  }
  return c.text("Not Found", 404);
});

app.onError((err, c) => jsonError(c, err));

const server = serve(
  {
    fetch: app.fetch,
    port: env.port,
    hostname: "0.0.0.0",
  },
  (info) => {
    console.log(`Data Agent listening on http://0.0.0.0:${info.port}`);
    if (env.mailMode === "console") {
      console.warn("[security] MAIL_MODE=console：验证码会输出到服务日志，仅适合开发/测试。");
    }
  }
);

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
