import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { z } from "zod";
import {
  ApiError,
  createSession,
  currentSession,
  destroySession,
  env,
  hashOtp,
  jsonError,
  normalizeEmail,
  otpMatches,
  prisma,
  publicUser,
  randomToken,
  rotateSession,
  sendOtpMail,
  type AppEnv,
} from "./lib.js";

const router = new Hono<AppEnv>();

const emailField = z.string().trim().email().transform(normalizeEmail);
const passwordField = z.string().min(8).max(128);

const passwordLoginSchema = z.object({
  email: emailField,
  password: z.string().min(1).max(128),
});

const otpRequestSchema = z.object({
  email: emailField,
  purpose: z.enum(["login", "signup", "reset"]),
});

const otpVerifySchema = z.object({
  verificationId: z.string().min(8).max(200),
  token: z.string().trim().regex(/^\d{6}$/),
  email: emailField,
  purpose: z.enum(["login", "signup", "reset"]).optional(),
  password: passwordField.optional(),
  isExistingUser: z.boolean().optional(),
});

const resetSchema = z.object({
  email: emailField,
  verificationId: z.string().min(8).max(200),
  nonce: z.string().trim().regex(/^\d{6}$/),
  password: passwordField,
});

async function readJson(c: any) {
  try {
    return await c.req.json();
  } catch {
    throw new ApiError(400, "request_invalid", "请求体必须是 JSON");
  }
}

function ensureBcryptPassword(password: string) {
  if (bcrypt.truncates(password)) {
    throw new ApiError(400, "password_too_long", "密码 UTF-8 长度不能超过 72 字节");
  }
}

async function assertOtpRateLimit(email: string, purpose: string) {
  const now = Date.now();
  const tooSoon = await prisma.otpCode.count({
    where: {
      email,
      purpose,
      created_at: { gt: new Date(now - env.otpMinIntervalSeconds * 1000) },
    },
  });
  if (tooSoon > 0) {
    throw new ApiError(429, "otp_too_frequent", "验证码发送过于频繁，请稍后再试");
  }

  const hourly = await prisma.otpCode.count({
    where: {
      email,
      purpose,
      created_at: { gt: new Date(now - 60 * 60 * 1000) },
    },
  });
  if (hourly >= env.otpHourlyLimit) {
    throw new ApiError(429, "otp_hourly_limit", "验证码请求次数过多，请一小时后再试");
  }
}

async function consumeOtp(verificationId: string, email: string, code: string, expectedPurpose?: string) {
  const record = await prisma.otpCode.findUnique({
    where: { verification_id: verificationId },
  });

  if (
    !record ||
    record.email !== email ||
    record.consumed_at ||
    record.expires_at <= new Date() ||
    (expectedPurpose && record.purpose !== expectedPurpose)
  ) {
    throw new ApiError(400, "otp_invalid", "验证码无效或已过期");
  }

  if (record.attempts >= 5) {
    throw new ApiError(429, "otp_attempts_exceeded", "验证码尝试次数过多，请重新获取");
  }

  if (!otpMatches(record.code_hash, record.verification_id, code)) {
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw new ApiError(400, "otp_invalid", "验证码错误");
  }

  const consumed = await prisma.otpCode.updateMany({
    where: { id: record.id, consumed_at: null },
    data: { consumed_at: new Date() },
  });
  if (consumed.count !== 1) {
    throw new ApiError(400, "otp_used", "验证码已经使用");
  }

  return record;
}

router.get("/session", async (c) => {
  try {
    const s = await currentSession(c);
    if (!s) throw new ApiError(401, "auth_required", "未登录");
    return c.json({ user: publicUser(s.user) });
  } catch (e) {
    return jsonError(c, e);
  }
});

router.get("/user", async (c) => {
  try {
    const s = await currentSession(c);
    if (!s) throw new ApiError(401, "auth_required", "未登录");
    return c.json(publicUser(s.user));
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/password", async (c) => {
  try {
    const parsed = passwordLoginSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ApiError(400, "request_invalid", "邮箱或密码格式不正确");

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user?.password_hash) {
      throw new ApiError(401, "auth_invalid_credentials", "邮箱或密码错误");
    }

    const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
    if (!ok) throw new ApiError(401, "auth_invalid_credentials", "邮箱或密码错误");

    await createSession(c, user.id);
    return c.json({ user: publicUser(user) });
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/otp/request", async (c) => {
  try {
    const parsed = otpRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ApiError(400, "request_invalid", "邮箱或验证码用途格式不正确");

    const { email, purpose } = parsed.data;
    await assertOtpRateLimit(email, purpose);

    const user = await prisma.user.findUnique({ where: { email } });
    const verificationId = randomToken(24);
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

    await prisma.otpCode.create({
      data: {
        verification_id: verificationId,
        user_id: user?.id,
        email,
        purpose,
        code_hash: hashOtp(verificationId, code),
        expires_at: new Date(Date.now() + env.otpTtlMinutes * 60 * 1000),
      },
    });

    await sendOtpMail(email, code, purpose);

    return c.json({
      verificationId,
      ...(purpose === "signup" ? { isExistingUser: Boolean(user) } : {}),
    });
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/otp/verify", async (c) => {
  try {
    const parsed = otpVerifySchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ApiError(400, "request_invalid", "验证码参数格式不正确");

    const input = parsed.data;
    const otp = await consumeOtp(input.verificationId, input.email, input.token, input.purpose);

    if (otp.purpose === "reset") {
      throw new ApiError(400, "otp_wrong_endpoint", "请通过密码重置接口使用该验证码");
    }

    let user = await prisma.user.findUnique({ where: { email: input.email } });

    if (!user && otp.purpose === "signup") {
      if (!input.password) throw new ApiError(400, "password_required", "注册时必须设置密码");
      ensureBcryptPassword(input.password);
      user = await prisma.user.create({
        data: {
          email: input.email,
          password_hash: await bcrypt.hash(input.password, 12),
        },
      });
    } else if (!user && otp.purpose === "login") {
      user = await prisma.user.create({
        data: { email: input.email },
      });
    }

    if (!user) throw new ApiError(400, "auth_user_missing", "账号不存在");

    await createSession(c, user.id);
    return c.json({ user: publicUser(user) });
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/password/reset", async (c) => {
  try {
    const parsed = resetSchema.safeParse(await readJson(c));
    if (!parsed.success) throw new ApiError(400, "request_invalid", "密码重置参数格式不正确");

    ensureBcryptPassword(parsed.data.password);
    const otp = await consumeOtp(
      parsed.data.verificationId,
      parsed.data.email,
      parsed.data.nonce,
      "reset"
    );

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || otp.user_id !== user.id) {
      throw new ApiError(400, "reset_invalid", "该账号无法使用此重置请求");
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { password_hash: await bcrypt.hash(parsed.data.password, 12) },
    });

    await prisma.session.deleteMany({ where: { user_id: user.id } });
    await createSession(c, user.id);
    return c.json({ user: publicUser(updated) });
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/refresh", async (c) => {
  try {
    return c.json({ user: await rotateSession(c) });
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/logout", async (c) => {
  try {
    await destroySession(c);
    return c.json({ ok: true });
  } catch (e) {
    return jsonError(c, e);
  }
});

export default router;
