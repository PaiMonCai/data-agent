import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { z } from "zod";
import {
  ApiError,
  authRequired,
  env,
  jsonError,
  prisma,
  publicMailSettings,
  saveMailSettings,
  sendTestMail,
  type AppEnv,
} from "./lib.js";
import {
  discoverLlmModels,
  publicLlmSettings,
  saveLlmSettings,
} from "./llm-config.js";

const router = new Hono<AppEnv>();

router.use("*", authRequired);
router.use("*", async (c, next) => {
  if (c.get("user").role !== "admin") {
    return c.json(
      { error: { code: "admin_required", message: "需要管理员权限" } },
      403
    );
  }
  await next();
});

const mailSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(255),
  password: z.string().max(1024).optional(),
  from: z.string().trim().min(1).max(320),
});

const llmModelChannelSchema = z.object({
  publicModel: z.string().trim().min(1).max(200),
  upstreamModel: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
});

const llmProviderSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(100),
  baseUrl: z.string().trim().url().max(500),
  apiKey: z.string().max(4096).optional(),
  models: z.array(llmModelChannelSchema).max(500),
  enabled: z.boolean(),
});

const llmSchema = z.object({
  providers: z.array(llmProviderSchema).max(20),
  routing: z.record(z.enum(["round_robin", "priority"])).optional(),
});

router.get("/settings/mail", async (c) => {
  try {
    return c.json(await publicMailSettings());
  } catch (e) {
    return jsonError(c, e);
  }
});

router.patch("/settings/mail", async (c) => {
  try {
    const parsed = mailSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "request_invalid", "SMTP 配置格式不正确");
    }
    return c.json(await saveMailSettings(parsed.data));
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/settings/mail/test", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const email = String(body?.email || c.get("user").email).trim().toLowerCase();
    if (!z.string().email().safeParse(email).success) {
      throw new ApiError(400, "invalid_email", "测试邮箱格式不正确");
    }
    await sendTestMail(email);
    return c.json({ ok: true });
  } catch (e) {
    return jsonError(c, e);
  }
});

router.get("/settings/llm", async (c) => {
  try {
    return c.json(await publicLlmSettings());
  } catch (e) {
    return jsonError(c, e);
  }
});

router.patch("/settings/llm", async (c) => {
  try {
    const parsed = llmSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      throw new ApiError(400, "request_invalid", "LLM 供应商配置格式不正确");
    }
    const ids = parsed.data.providers.map((x) => x.id);
    if (new Set(ids).size !== ids.length) {
      throw new ApiError(400, "request_invalid", "LLM 供应商 ID 不能重复");
    }
    return c.json(await saveLlmSettings(parsed.data));
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/settings/llm/providers/:id/discover", async (c) => {
  try {
    return c.json(await discoverLlmModels(c.req.param("id")));
  } catch (e) {
    return jsonError(c, e);
  }
});

export async function ensureBootstrapAdmin() {
  const existingAdmin = await prisma.user.count({ where: { role: "admin" } });
  if (existingAdmin > 0) return;

  const email = env.bootstrapAdminEmail;
  const password = env.bootstrapAdminPassword;
  if (!email || !password) {
    console.warn(
      "[bootstrap] 尚无管理员。请设置 BOOTSTRAP_ADMIN_EMAIL 和 BOOTSTRAP_ADMIN_PASSWORD 后重启一次。"
    );
    return;
  }
  if (!z.string().email().safeParse(email).success) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL is not a valid email address");
  }
  if (password.length < 8) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters");
  }
  if (bcrypt.truncates(password)) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD exceeds bcrypt 72-byte limit");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({
    where: { email },
    create: { email, password_hash: passwordHash, role: "admin" },
    update: { password_hash: passwordHash, role: "admin" },
  });
  console.log(`[bootstrap] 管理员已初始化：${email}`);
}

export async function setupStatus() {
  const [admins, mail] = await Promise.all([
    prisma.user.count({ where: { role: "admin" } }),
    publicMailSettings(),
  ]);
  return {
    initialized: admins > 0,
    mailConfigured: mail.configured,
  };
}

export default router;
