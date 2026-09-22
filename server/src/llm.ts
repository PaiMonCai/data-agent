import { Hono } from "hono";
import { ApiError, authRequired, env, jsonError, prisma, type AppEnv } from "./lib.js";
import { listPublicModels, resolveRequestedModel } from "./llm-config.js";

const router = new Hono<AppEnv>();
router.use("*", authRequired);

let lastRateCleanup = 0;

function upstreamHeaders(apiKey: string, extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...extra,
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function minuteStart(now = new Date()) {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

function dayStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function incrementBucket(
  userId: string,
  kind: "minute" | "day",
  start: Date
) {
  return prisma.llmRateBucket.upsert({
    where: {
      user_id_bucket_kind_bucket_start: {
        user_id: userId,
        bucket_kind: kind,
        bucket_start: start,
      },
    },
    create: {
      user_id: userId,
      bucket_kind: kind,
      bucket_start: start,
      request_count: 1,
    },
    update: {
      request_count: { increment: 1 },
    },
    select: {
      request_count: true,
    },
  });
}

async function consumeRateLimit(userId: string) {
  const now = new Date();

  // 每个实例最多每小时做一次轻量清理，避免分钟桶长期累积。
  if (Date.now() - lastRateCleanup > 60 * 60 * 1000) {
    lastRateCleanup = Date.now();
    void prisma.llmRateBucket.deleteMany({
      where: {
        bucket_start: { lt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
      },
    }).catch(() => undefined);
  }

  const minute = await incrementBucket(userId, "minute", minuteStart(now));
  if (minute.request_count > env.llmRequestsPerMinute) {
    throw new ApiError(
      429,
      "llm_rate_minute",
      `调用过于频繁：每分钟最多 ${env.llmRequestsPerMinute} 次`
    );
  }

  const day = await incrementBucket(userId, "day", dayStart(now));
  if (day.request_count > env.llmRequestsPerDay) {
    throw new ApiError(
      429,
      "llm_rate_day",
      `今日模型调用额度已用完：每天最多 ${env.llmRequestsPerDay} 次`
    );
  }

  return {
    minuteUsed: minute.request_count,
    dayUsed: day.request_count,
  };
}

function rateHeaders(state: { minuteUsed: number; dayUsed: number }) {
  return {
    "X-RateLimit-Minute-Limit": String(env.llmRequestsPerMinute),
    "X-RateLimit-Minute-Remaining": String(
      Math.max(0, env.llmRequestsPerMinute - state.minuteUsed)
    ),
    "X-RateLimit-Day-Limit": String(env.llmRequestsPerDay),
    "X-RateLimit-Day-Remaining": String(
      Math.max(0, env.llmRequestsPerDay - state.dayUsed)
    ),
  };
}

router.get("/models", async (c) => {
  try {
    return c.json({ data: await listPublicModels() });
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/chat/completions", async (c) => {
  try {
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
    if (body.messages.length > 100) {
      throw new ApiError(400, "request_too_large", "单次最多允许 100 条消息");
    }

    const inputChars = JSON.stringify(body.messages).length;
    if (inputChars > env.llmMaxInputChars) {
      throw new ApiError(
        413,
        "llm_input_too_large",
        `输入内容过大，最多允许约 ${env.llmMaxInputChars} 个 JSON 字符`
      );
    }

    const requested = await resolveRequestedModel(body.model.trim());
    const user = c.get("user");
    const rate = await consumeRateLimit(user.id);

    const signal = AbortSignal.any([
      c.req.raw.signal,
      AbortSignal.timeout(env.llmTimeoutMs),
    ]);

    const upstreamBody = { ...body, model: requested.model };
    const upstream = await fetch(`${requested.provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: upstreamHeaders(requested.provider.apiKey, {
        "Content-Type": "application/json",
        Accept: body.stream ? "text/event-stream, application/json" : "application/json",
      }),
      body: JSON.stringify(upstreamBody),
      signal,
    });

    const headers = new Headers(rateHeaders(rate));
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
    if (e instanceof DOMException && e.name === "TimeoutError") {
      return jsonError(c, new ApiError(504, "llm_timeout", "模型服务响应超时"));
    }
    return jsonError(c, e);
  }
});

export default router;
