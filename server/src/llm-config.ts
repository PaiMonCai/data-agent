import { ApiError, decryptSystemSecret, encryptSystemSecret, env, prisma } from "./lib.js";

export type LlmModelChannel = {
  publicModel: string;
  upstreamModel: string;
  enabled: boolean;
};

export type LlmProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: LlmModelChannel[];
  enabled: boolean;
  source: "database" | "environment";
};

export type LlmRoutingStrategy = "round_robin" | "priority";

type StoredProvider = {
  id?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  models?: unknown;
  enabled?: unknown;
};

function cleanModelChannels(value: unknown): LlmModelChannel[] {
  const list = Array.isArray(value) ? value : [];
  const out: LlmModelChannel[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      const model = item.trim();
      if (model) out.push({ publicModel: model, upstreamModel: model, enabled: true });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const publicModel = String(row.publicModel || row.model || "").trim();
    const upstreamModel = String(row.upstreamModel || publicModel).trim();
    if (!publicModel || !upstreamModel) continue;
    out.push({
      publicModel,
      upstreamModel,
      enabled: row.enabled !== false,
    });
  }
  return out.slice(0, 500);
}

function cleanRouting(value: unknown): Record<string, LlmRoutingStrategy> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, LlmRoutingStrategy> = {};
  for (const [model, strategy] of Object.entries(value as Record<string, unknown>)) {
    const key = model.trim();
    if (!key) continue;
    out[key] = strategy === "priority" ? "priority" : "round_robin";
  }
  return out;
}

function normalizeBaseUrl(value: unknown) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function envProvider(): LlmProviderConfig | null {
  if (!env.llmBaseUrl) return null;
  return {
    id: "environment",
    name: "Environment",
    baseUrl: env.llmBaseUrl,
    apiKey: env.llmApiKey,
    models: env.llmModels.map((model) => ({
      publicModel: model,
      upstreamModel: model,
      enabled: true,
    })),
    enabled: true,
    source: "environment",
  };
}

async function rawLlmSetting() {
  return prisma.systemSetting.findUnique({ where: { key: "llm" } });
}

export async function resolveLlmProviders(): Promise<LlmProviderConfig[]> {
  const stored = await rawLlmSetting();
  const raw = (stored?.value || {}) as Record<string, unknown>;

  if (stored && Array.isArray(raw.providers)) {
    return (raw.providers as StoredProvider[])
      .map((item) => ({
        id: String(item.id || "").trim(),
        name: String(item.name || item.id || "").trim(),
        baseUrl: normalizeBaseUrl(item.baseUrl),
        apiKey: decryptSystemSecret(String(item.apiKey || "")),
        models: cleanModelChannels(item.models),
        enabled: item.enabled !== false,
        source: "database" as const,
      }))
      .filter((item) => item.id && item.baseUrl);
  }

  const fallback = envProvider();
  return fallback ? [fallback] : [];
}

export async function resolveRouting() {
  const stored = await rawLlmSetting();
  const raw = (stored?.value || {}) as Record<string, unknown>;
  return cleanRouting(raw.routing);
}

export async function publicLlmSettings() {
  const [providers, routing] = await Promise.all([resolveLlmProviders(), resolveRouting()]);
  return {
    source: providers.some((x) => x.source === "database") ? "database" as const : "environment" as const,
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      models: p.models,
      enabled: p.enabled,
      hasApiKey: Boolean(p.apiKey),
      source: p.source,
    })),
    routing,
  };
}

export async function saveLlmSettings(input: {
  providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
    models: LlmModelChannel[];
    enabled: boolean;
  }>;
  routing?: Record<string, LlmRoutingStrategy>;
}) {
  const previous = await rawLlmSetting();
  const oldRaw = (previous?.value || {}) as Record<string, unknown>;
  const oldProviders = Array.isArray(oldRaw.providers) ? oldRaw.providers as StoredProvider[] : [];
  const effective = await resolveLlmProviders();

  const providers = input.providers.map((provider) => {
    const old = oldProviders.find((x) => String(x.id || "") === provider.id);
    const current = effective.find((x) => x.id === provider.id);
    const key =
      provider.apiKey === undefined || provider.apiKey === ""
        ? String(old?.apiKey || (current?.apiKey ? encryptSystemSecret(current.apiKey) : ""))
        : encryptSystemSecret(provider.apiKey);

    return {
      id: provider.id,
      name: provider.name,
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      apiKey: key,
      models: cleanModelChannels(provider.models),
      enabled: provider.enabled,
    };
  });

  const routing = cleanRouting(input.routing || oldRaw.routing);

  await prisma.systemSetting.upsert({
    where: { key: "llm" },
    create: { key: "llm", value: { providers, routing } },
    update: { value: { providers, routing } },
  });

  return publicLlmSettings();
}

function headers(apiKey: string) {
  const out: Record<string, string> = { Accept: "application/json" };
  if (apiKey) out.Authorization = `Bearer ${apiKey}`;
  return out;
}

export async function discoverLlmModels(providerId: string) {
  const providers = await resolveLlmProviders();
  const provider = providers.find((x) => x.id === providerId);
  if (!provider) throw new ApiError(404, "llm_provider_not_found", "LLM 供应商不存在");
  if (!provider.baseUrl) throw new ApiError(400, "llm_provider_invalid", "LLM Base URL 不能为空");

  let res: Response;
  try {
    res = await fetch(`${provider.baseUrl}/models`, {
      headers: headers(provider.apiKey),
      signal: AbortSignal.timeout(Math.min(env.llmTimeoutMs, 30_000)),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiError(504, "llm_timeout", "模型服务响应超时");
    }
    throw new ApiError(502, "llm_upstream_unreachable", "无法连接模型供应商");
  }

  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(res.status >= 500 ? 502 : 400, "llm_upstream_error", `模型供应商返回 ${res.status}`);
  }

  let body: any;
  try { body = JSON.parse(text); } catch {
    throw new ApiError(502, "llm_models_invalid", "模型供应商 /models 返回的不是有效 JSON");
  }

  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const models: string[] = [...new Set<string>(
    rows.map((x: any) => String(x?.id || x?.name || x || "").trim()).filter(Boolean)
  )].slice(0, 200);
  return { models };
}

const rrCursor = new Map<string, number>();

export async function resolveRequestedModel(requested: string) {
  const [providers, routing] = await Promise.all([resolveLlmProviders(), resolveRouting()]);
  const channels = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) => {
      const configured = provider.models
        .filter((model) => model.enabled && model.publicModel === requested)
        .map((model) => ({ provider, model: model.upstreamModel }));
      if (configured.length) return configured;
      if (provider.source === "environment" && provider.models.length === 0) {
        return [{ provider, model: requested }];
      }
      return [];
    });

  if (!channels.length) {
    throw new ApiError(400, "llm_model_invalid", "模型不存在或没有可用渠道");
  }

  const strategy = routing[requested] || "round_robin";
  if (strategy === "priority" || channels.length === 1) return channels[0];

  const cursor = rrCursor.get(requested) || 0;
  const selected = channels[cursor % channels.length];
  rrCursor.set(requested, (cursor + 1) % channels.length);
  return selected;
}

export async function listPublicModels() {
  const providers = (await resolveLlmProviders()).filter((x) => x.enabled);
  const names = new Set<string>();

  for (const provider of providers) {
    if (provider.models.length === 0 && provider.source === "environment") {
      try {
        const discovered = await discoverLlmModels(provider.id);
        for (const model of discovered.models) names.add(model);
      } catch {}
      continue;
    }
    for (const model of provider.models) {
      if (model.enabled) names.add(model.publicModel);
    }
  }

  return [...names].sort().map((model) => ({
    id: model,
    name: model,
  }));
}
