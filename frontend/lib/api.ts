import type { AnalysisHistory, DatasetMeta, DataRow, ModelInfo, User } from "./types";

const API_BASE = "/api";

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function dataOf<T>(value: any): T {
  return value && typeof value === "object" && "data" in value ? value.data : value;
}

async function parseBody(res: Response) {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(API_BASE + path, {
    ...init,
    credentials: "include",
    headers,
  });
  const body = await parseBody(res);
  if (!res.ok) {
    const detail = body?.error ?? body;
    throw new ApiError(
      res.status,
      detail?.code || `http_${res.status}`,
      detail?.message || detail?.detail || (typeof detail === "string" ? detail : `HTTP ${res.status}`),
      body
    );
  }
  return dataOf<T>(body);
}

function isAuthError(error: unknown) {
  const e = error as ApiError;
  return e?.status === 401 || String(e?.code || "").startsWith("auth_");
}

async function withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isAuthError(error)) throw error;
    try {
      await request("/auth/refresh", { method: "POST", body: "{}" });
    } catch {
      throw error;
    }
    return fn();
  }
}

async function wrapped<T>(fn: () => Promise<T>) {
  try {
    return { data: await fn(), error: null as unknown };
  } catch (error) {
    return { data: null as T | null, error };
  }
}

const auth = {
  getSession: () => wrapped(async () => {
    try {
      return await request<{ user: User }>("/auth/session");
    } catch (error) {
      if ((error as ApiError)?.status === 401) return null;
      throw error;
    }
  }),
  getUser: () => wrapped(() => request<User>("/auth/user")),
  signInWithPassword: (payload: { email: string; password: string }) =>
    wrapped(() => request<{ user: User }>("/auth/password", { method: "POST", body: JSON.stringify(payload) })),
  sendOtp: ({ email, purpose = "signup" }: { email: string; purpose?: string }) =>
    wrapped(() => request<{ verificationId: string; isExistingUser?: boolean }>("/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ email, purpose }),
    })),
  signInWithOtp: ({ email }: { email: string }) =>
    wrapped(async () => {
      const data = await request<{ verificationId: string }>("/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ email, purpose: "login" }),
      });
      return data;
    }),
  verifyOtp: (payload: Record<string, unknown>) =>
    wrapped(() => request<{ user: User }>("/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify(payload),
    })),
  resetPasswordForEmail: (email: string) =>
    wrapped(() => request<{ verificationId: string }>("/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ email, purpose: "reset" }),
    })),
  resetPassword: (payload: Record<string, unknown>) =>
    wrapped(() => request<{ user: User }>("/auth/password/reset", {
      method: "POST",
      body: JSON.stringify(payload),
    })),
  refreshSession: () =>
    wrapped(() => request("/auth/refresh", { method: "POST", body: "{}" })),
  signOut: () =>
    wrapped(() => request("/auth/logout", { method: "POST", body: "{}" })),
};

export interface AdminMailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  configured: boolean;
  hasPassword: boolean;
  source: "database" | "environment";
}

const admin = {
  getMail: () => withAuthRetry(() => request<AdminMailSettings>("/admin/settings/mail")),
  saveMail: (payload: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password?: string;
    from: string;
  }) => withAuthRetry(() => request<AdminMailSettings>("/admin/settings/mail", {
    method: "PATCH",
    body: JSON.stringify(payload),
  })),
  testMail: (email?: string) => withAuthRetry(() => request<{ ok: boolean }>("/admin/settings/mail/test", {
    method: "POST",
    body: JSON.stringify(email ? { email } : {}),
  })),
};

const db = {
  async list(table: string, opts: {
    select?: string;
    eq?: Record<string, unknown>;
    order?: { column: string; ascending: boolean };
    limit?: number;
    range?: [number, number];
  } = {}) {
    const qs = new URLSearchParams();
    if (opts.select) qs.set("select", opts.select);
    if (opts.eq) qs.set("eq", JSON.stringify(opts.eq));
    if (opts.order) qs.set("order", JSON.stringify(opts.order));
    if (opts.limit) qs.set("limit", String(opts.limit));
    if (opts.range) qs.set("range", JSON.stringify(opts.range));
    return withAuthRetry(() => request<any[]>(`/data/${encodeURIComponent(table)}?${qs}`));
  },
  async insert(table: string, rows: unknown | unknown[]) {
    return withAuthRetry(() => request<any[]>(`/data/${encodeURIComponent(table)}`, {
      method: "POST",
      body: JSON.stringify({ rows: Array.isArray(rows) ? rows : [rows] }),
    }));
  },
  async remove(table: string, eq: Record<string, unknown>) {
    return withAuthRetry(() => request<{ deleted: number }>(`/data/${encodeURIComponent(table)}`, {
      method: "DELETE",
      body: JSON.stringify({ eq }),
    }));
  },
  async importDataset(meta: { name: string; source: string; columns: unknown[] }, rows: DataRow[]) {
    return withAuthRetry(() => request<DatasetMeta[]>("/data/import", {
      method: "POST",
      body: JSON.stringify({ ...meta, rows }),
    }));
  },
};

async function session() {
  const result = await auth.getSession();
  return result.data;
}

async function models(): Promise<ModelInfo[]> {
  const raw = await withAuthRetry(() => request<any>("/llm/models"));
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.models) ? raw.models : Array.isArray(raw?.data) ? raw.data : [];
  return list.filter((m: ModelInfo) => m && !m.disabled);
}

async function streamChat(payload: Record<string, unknown>, onDelta?: (delta: string) => void) {
  const res = await fetch(API_BASE + "/llm/chat/completions", {
    method: "POST",
    credentials: "include",
    headers: { Accept: "text/event-stream, application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await parseBody(res);
    const detail = body?.error ?? body;
    throw new ApiError(res.status, detail?.code || `http_${res.status}`, detail?.message || `HTTP ${res.status}`, body);
  }

  const type = String(res.headers.get("content-type") || "").toLowerCase();
  if (!type.includes("text/event-stream") || !res.body) {
    const body = await parseBody(res);
    const text = body?.choices?.[0]?.message?.content || "";
    if (text && onDelta) onDelta(text);
    return text;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";

  const consume = (block: string) => {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const part = parsed?.choices?.[0]?.delta?.content;
        if (part) {
          output += part;
          onDelta?.(part);
        }
      } catch {}
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, "\n");
    let idx = -1;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      consume(buffer.slice(0, idx));
      buffer = buffer.slice(idx + 2);
    }
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  return output;
}

async function chat(args: {
  model: string;
  messages: { role: string; content: string }[];
  jsonMode?: boolean;
  temperature?: number;
  onDelta?: (delta: string) => void;
  onRestart?: () => void;
}) {
  let first = true;
  return withAuthRetry(async () => {
    if (!first) args.onRestart?.();
    first = false;
    return streamChat({
      model: args.model,
      messages: args.messages,
      stream: true,
      response_format: args.jsonMode ? { type: "json_object" } : undefined,
      temperature: args.temperature ?? 0.3,
      stream_options: { include_usage: true },
    }, args.onDelta);
  });
}

function errText(err: any) {
  if (!err) return "未知错误";
  if (isAuthError(err)) return "登录状态已失效，请重新登录";
  if (err.status === 403) return "没有权限执行该操作";
  if (err.status === 404) return "API 路径不存在，请检查后端版本";
  if (err.status === 429) return "请求过于频繁，请稍后再试";
  if (err.status >= 500) return "后端服务暂时不可用，请稍后重试";
  return err.message || String(err);
}

export async function loadDatasetRows(datasetId: string, rowCount: number): Promise<DataRow[]> {
  const rows: DataRow[] = [];
  for (let from = 0; from < rowCount; from += 2000) {
    const part = await db.list("dataset_rows", {
      select: "row_index,data",
      eq: { dataset_id: datasetId },
      order: { column: "row_index", ascending: true },
      range: [from, Math.min(rowCount - 1, from + 1999)],
    });
    rows.push(...part.map((r) => r.data as DataRow));
  }
  return rows;
}

export async function listDatasets(): Promise<DatasetMeta[]> {
  return db.list("datasets", {
    order: { column: "created_at", ascending: false },
    limit: 1000,
  }) as Promise<DatasetMeta[]>;
}

export async function listHistory(datasetId: string): Promise<AnalysisHistory[]> {
  return db.list("analyses", {
    select: "id,question,kind,result,summary,plan,created_at",
    eq: { dataset_id: datasetId },
    order: { column: "created_at", ascending: false },
    limit: 30,
  }) as Promise<AnalysisHistory[]>;
}

export const Cloud = {
  client: () => ({ auth }),
  auth,
  admin,
  db,
  session,
  models,
  chat,
  errText,
  requireSession: async () => {
    const s = await session();
    if (!s) throw new Error("登录状态已失效，请重新登录");
    return s;
  },
};
