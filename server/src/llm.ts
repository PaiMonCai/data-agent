import { Hono } from "hono";
import { ApiError, authRequired, env, jsonError, type AppEnv } from "./lib.js";

const router = new Hono<AppEnv>();
router.use("*", authRequired);

function ensureConfigured() {
  if (!env.llmBaseUrl) {
    throw new ApiError(503, "llm_not_configured", "LLM_BASE_URL 尚未配置");
  }
}

function upstreamHeaders(extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...extra,
  };
  if (env.llmApiKey) headers.Authorization = `Bearer ${env.llmApiKey}`;
  return headers;
}

router.get("/models", async (c) => {
  try {
    if (env.llmModels.length) {
      return c.json({
        data: env.llmModels.map((id) => ({
          id,
          name: id,
          provider: "Self-hosted",
        })),
      });
    }

    ensureConfigured();
    const res = await fetch(`${env.llmBaseUrl}/models`, {
      headers: upstreamHeaders(),
    });

    const text = await res.text();
    const type = res.headers.get("content-type") || "application/json";

    if (!res.ok) {
      return new Response(text, {
        status: res.status,
        headers: { "Content-Type": type },
      });
    }

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": type,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/chat/completions", async (c) => {
  try {
    ensureConfigured();

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ApiError(400, "request_invalid", "请求体必须是 JSON");
    }
    if (typeof body.model !== "string" || !body.model.trim()) {
      throw new ApiError(400, "request_invalid", "model 不能为空");
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw new ApiError(400, "request_invalid", "messages 必须是非空数组");
    }

    const upstream = await fetch(`${env.llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: upstreamHeaders({
        "Content-Type": "application/json",
        Accept: body.stream ? "text/event-stream, application/json" : "application/json",
      }),
      body: JSON.stringify(body),
      signal: c.req.raw.signal,
    });

    const headers = new Headers();
    headers.set(
      "Content-Type",
      upstream.headers.get("content-type") ||
        (body.stream ? "text/event-stream; charset=utf-8" : "application/json")
    );
    headers.set("Cache-Control", "no-store");
    headers.set("X-Accel-Buffering", "no");

    const requestId = upstream.headers.get("x-request-id");
    if (requestId) headers.set("X-Upstream-Request-Id", requestId);

    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (e) {
    return jsonError(c, e);
  }
});

export default router;
