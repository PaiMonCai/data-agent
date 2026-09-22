import "dotenv/config";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import nodemailer from "nodemailer";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { PrismaClient } from "./generated/prisma/client.js";

function boolEnv(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function intEnv(name: string, fallback: number, min = 1) {
  const n = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV || "development";
const sessionSecret = required("SESSION_SECRET");
if (sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters");
}

export const env = {
  nodeEnv,
  port: intEnv("PORT", 3000),
  databaseUrl: required("DATABASE_URL"),
  sessionSecret,
  sessionDays: intEnv("SESSION_DAYS", 30),
  cookieName: process.env.SESSION_COOKIE_NAME || "data_agent_session",
  cookieSecure: boolEnv("COOKIE_SECURE", nodeEnv === "production"),
  cookieSameSite: (process.env.COOKIE_SAME_SITE || "Lax") as "Strict" | "Lax" | "None",
  appOrigin: process.env.APP_ORIGIN?.trim() || "",
  serveStatic: boolEnv("SERVE_STATIC", true),
  staticRoot: process.env.STATIC_ROOT || "./public",
  llmBaseUrl: (process.env.LLM_BASE_URL || "").replace(/\/$/, ""),
  llmApiKey: process.env.LLM_API_KEY || "",
  llmModels: (process.env.LLM_MODELS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
  llmRequestsPerMinute: intEnv("LLM_REQUESTS_PER_MINUTE", 10),
  llmRequestsPerDay: intEnv("LLM_REQUESTS_PER_DAY", 300),
  llmMaxInputChars: intEnv("LLM_MAX_INPUT_CHARS", 200000),
  llmTimeoutMs: intEnv("LLM_TIMEOUT_MS", 180000),
  mailMode: (process.env.MAIL_MODE || (process.env.SMTP_HOST ? "smtp" : "console")).toLowerCase(),
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: intEnv("SMTP_PORT", 587),
  smtpSecure: boolEnv("SMTP_SECURE", false),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "Data Agent <no-reply@example.com>",
  otpTtlMinutes: intEnv("OTP_TTL_MINUTES", 10),
  otpMinIntervalSeconds: intEnv("OTP_MIN_INTERVAL_SECONDS", 60),
  otpHourlyLimit: intEnv("OTP_HOURLY_LIMIT", 5),
};

const adapter = new PrismaPg({ connectionString: env.databaseUrl });
export const prisma = new PrismaClient({ adapter });

export type PublicUser = {
  id: string;
  email: string;
};

export type AppEnv = {
  Variables: {
    user: PublicUser;
  };
};

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function publicUser(user: { id: string; email: string }): PublicUser {
  return { id: user.id, email: user.email };
}

function hmac(value: string) {
  return createHmac("sha256", env.sessionSecret).update(value).digest("hex");
}

export function hashOtp(verificationId: string, code: string) {
  return hmac(`otp:${verificationId}:${code}`);
}

export function otpMatches(expectedHash: string, verificationId: string, code: string) {
  const actual = Buffer.from(hashOtp(verificationId, code), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function sessionHash(raw: string) {
  return hmac(`session:${raw}`);
}

function cookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/",
    expires,
  } as const;
}

export async function createSession(c: Context, userId: string) {
  const raw = randomToken();
  const expires = new Date(Date.now() + env.sessionDays * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      token_hash: sessionHash(raw),
      user_id: userId,
      expires_at: expires,
    },
  });

  setCookie(c, env.cookieName, raw, cookieOptions(expires));
  return raw;
}

export async function currentSession(c: Context) {
  const raw = getCookie(c, env.cookieName);
  if (!raw) return null;

  const session = await prisma.session.findUnique({
    where: { token_hash: sessionHash(raw) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.expires_at <= new Date()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    deleteCookie(c, env.cookieName, cookieOptions());
    return null;
  }

  return session;
}

export async function destroySession(c: Context) {
  const raw = getCookie(c, env.cookieName);
  if (raw) {
    await prisma.session.deleteMany({ where: { token_hash: sessionHash(raw) } });
  }
  deleteCookie(c, env.cookieName, cookieOptions());
}

export async function rotateSession(c: Context) {
  const current = await currentSession(c);
  if (!current) throw new ApiError(401, "auth_required", "登录状态已失效，请重新登录");
  await prisma.session.delete({ where: { id: current.id } });
  await createSession(c, current.user_id);
  return publicUser(current.user);
}

export const authRequired = createMiddleware<AppEnv>(async (c, next) => {
  const session = await currentSession(c);
  if (!session) {
    return c.json(
      { error: { code: "auth_required", message: "登录状态已失效，请重新登录" } },
      401
    );
  }
  c.set("user", publicUser(session.user));
  await next();
});

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function mailer() {
  if (transporter) return transporter;
  if (!env.smtpHost) {
    throw new ApiError(503, "mail_not_configured", "邮件服务尚未配置");
  }
  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
  });
  return transporter;
}

export async function sendOtpMail(email: string, code: string, purpose: string) {
  const purposeText =
    purpose === "reset" ? "重置密码" : purpose === "signup" ? "注册账号" : "登录";

  if (env.mailMode === "console") {
    console.log(`[OTP] ${email} ${purposeText}: ${code}`);
    return;
  }
  if (env.mailMode !== "smtp") {
    throw new ApiError(500, "mail_mode_invalid", "MAIL_MODE 配置无效");
  }

  await mailer().sendMail({
    from: env.smtpFrom,
    to: email,
    subject: `Data Agent ${purposeText}验证码`,
    text: `你的验证码是 ${code}，${env.otpTtlMinutes} 分钟内有效。如果不是你本人操作，请忽略此邮件。`,
    html: `<p>你的验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>${env.otpTtlMinutes} 分钟内有效。如果不是你本人操作，请忽略此邮件。</p>`,
  });
}

export function jsonError(c: Context, err: unknown) {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status as any);
  }

  console.error(err);
  return c.json(
    { error: { code: "internal_error", message: "服务器内部错误" } },
    500
  );
}
