import { ApiError, decryptSystemSecret, encryptSystemSecret, env, prisma } from "./lib.js";

export type LlmProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
  source: "database" | "environment";
};

type StoredProvider = {
  id?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  models?: unknown;
  enabled?: unknown;
};

function cleanModels(value: unknown) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((x) => String(x).trim()).filter(Boolean))].slice(0, 200);
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
    models: [...env.llmModels],
    enabled: true,
    source: "environment",
  };
}

export async function resolveLlmProviders(): Promise<LlmProviderConfig[]> {
  const stored = await prisma.systemSetting.findUnique({ where: { key: "llm" } });
  const raw = (stored?.value || {}) as Record<string, unknown>;

  if (stored && Array.isArray(raw.providers)) {
    return (raw.providers as StoredProvider[])
      .map((item) => ({
        id: String(item.id || "").trim(),
        name: String(item.name || item.id || "").trim(),
        baseUrl: normalizeBaseUrl(item.baseUrl),
        apiKey: decryptSystemSecret(String(item.apiKey || "")),
        models: cleanModels(item.models),
        enabled: item.enabled !== false,
        source: "database" as const,
      }))
      .filter((item) => item.id && item.baseUrl);
  }

  const fallback = envProvider();
  return fallback ? [fallback] : [];
}

export async function publicLlmSettings() {
  const providers = await resolveLlmProviders();
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
  };
}

export async function saveLlmSettings(input: {
  providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
    models: string[];
    enabled: boolean;
  }>;
}) {
  const previous = await prisma.systemSetting.findUnique({ where: { key: "llm" } });
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
      models: cleanModels(provider.models),
      enabled: provider.enabled,
    };
  });

  await prisma.systemSetting.upsert({
    where: { key: "llm" },
    create: { key: "llm", value: { providers } },
    update: { value: { providers } },
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
  const models = [...new Set(rows.map((x: any) => String(x?.id || x?.name || x || "").trim()).filter(Boolean))].slice(0, 200);
  return { models };
}

export function publicModelId(provider: LlmProviderConfig, model: string, providerCount: number) {
  if (provider.source === "environment" && providerCount === 1) return model;
  return `${provider.id}::${model}`;
}

export async function resolveRequestedModel(requested: string) {
  const providers = (await resolveLlmProviders()).filter((x) => x.enabled);
  if (!providers.length) throw new ApiError(503, "llm_not_configured", "尚未配置可用的 LLM 供应商");

  if (requested.includes("::")) {
    const idx = requested.indexOf("::");
    const providerId = requested.slice(0, idx);
    const model = requested.slice(idx + 2);
    const provider = providers.find((x) => x.id === providerId);
    if (!provider || !model) throw new ApiError(400, "llm_model_invalid", "模型配置不存在或已停用");
    if (provider.models.length && !provider.models.includes(model)) {
      throw new ApiError(400, "llm_model_invalid", "模型不在该供应商的启用列表中");
    }
    return { provider, model };
  }

  if (providers.length === 1) {
    const provider = providers[0];
    if (provider.models.length && !provider.models.includes(requested)) {
      throw new ApiError(400, "llm_model_invalid", "模型不在供应商的启用列表中");
    }
    return { provider, model: requested };
  }

  const matches = providers.filter((x) => !x.models.length || x.models.includes(requested));
  if (matches.length !== 1) {
    throw new ApiError(400, "llm_model_ambiguous", "模型名称无法唯一匹配供应商，请重新选择模型");
  }
  return { provider: matches[0], model: requested };
}

export async function listPublicModels() {
  const providers = (await resolveLlmProviders()).filter((x) => x.enabled);
  const out: Array<{ id: string; name: string; provider: string }> = [];

  for (const provider of providers) {
    let models = provider.models;
    if (!models.length) {
      try {
        models = (await discoverLlmModels(provider.id)).models;
      } catch {
        models = [];
      }
    }
    for (const model of models) {
      out.push({
        id: publicModelId(provider, model, providers.length),
        name: model,
        provider: provider.name,
      });
    }
  }
  return out;
}
