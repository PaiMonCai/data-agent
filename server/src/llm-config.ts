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

export type LlmChannelConfig = {
  id: string;
  providerId: string;
  upstreamModel: string;
  enabled: boolean;
};

export type LlmLogicalModelConfig = {
  id: string;
  name: string;
  enabled: boolean;
  strategy: "round_robin";
  channels: LlmChannelConfig[];
};

type StoredProvider = {
  id?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  models?: unknown;
  enabled?: unknown;
};

type StoredChannel = {
  id?: unknown;
  providerId?: unknown;
  upstreamModel?: unknown;
  enabled?: unknown;
};

type StoredLogicalModel = {
  id?: unknown;
  name?: unknown;
  enabled?: unknown;
  strategy?: unknown;
  channels?: unknown;
};

const roundRobinCursor = new Map<string, number>();

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

async function loadRawSetting() {
  const stored = await prisma.systemSetting.findUnique({ where: { key: "llm" } });
  return {
    stored,
    raw: (stored?.value || {}) as Record<string, unknown>,
  };
}

function providersFromRaw(stored: Awaited<ReturnType<typeof loadRawSetting>>["stored"], raw: Record<string, unknown>) {
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

function deriveLogicalModels(providers: LlmProviderConfig[]): LlmLogicalModelConfig[] {
  const grouped = new Map<string, LlmLogicalModelConfig>();

  for (const provider of providers) {
    for (const upstreamModel of provider.models) {
      let logical = grouped.get(upstreamModel);
      if (!logical) {
        logical = {
          id: upstreamModel,
          name: upstreamModel,
          enabled: true,
          strategy: "round_robin",
          channels: [],
        };
        grouped.set(upstreamModel, logical);
      }

      logical.channels.push({
        id: `${provider.id}::${upstreamModel}`,
        providerId: provider.id,
        upstreamModel,
        enabled: true,
      });
    }
  }

  return [...grouped.values()];
}

function logicalModelsFromRaw(raw: Record<string, unknown>, providers: LlmProviderConfig[]) {
  if (!Array.isArray(raw.models)) return deriveLogicalModels(providers);

  return (raw.models as StoredLogicalModel[])
    .map((item) => {
      const channelsRaw = Array.isArray(item.channels) ? item.channels as StoredChannel[] : [];
      return {
        id: String(item.id || "").trim(),
        name: String(item.name || item.id || "").trim(),
        enabled: item.enabled !== false,
        strategy: "round_robin" as const,
        channels: channelsRaw
          .map((channel) => ({
            id: String(channel.id || "").trim(),
            providerId: String(channel.providerId || "").trim(),
            upstreamModel: String(channel.upstreamModel || "").trim(),
            enabled: channel.enabled !== false,
          }))
          .filter((channel) => channel.id && channel.providerId && channel.upstreamModel),
      };
    })
    .filter((item) => item.id && item.name);
}

export async function resolveLlmConfig() {
  const { stored, raw } = await loadRawSetting();
  const providers = providersFromRaw(stored, raw);
  const models = logicalModelsFromRaw(raw, providers);
  return { providers, models };
}

export async function resolveLlmProviders(): Promise<LlmProviderConfig[]> {
  return (await resolveLlmConfig()).providers;
}

export async function publicLlmSettings() {
  const { providers, models } = await resolveLlmConfig();
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
    models,
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
  models: Array<{
    id: string;
    name: string;
    enabled: boolean;
    strategy: "round_robin";
    channels: Array<{
      id: string;
      providerId: string;
      upstreamModel: string;
      enabled: boolean;
    }>;
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

  const models = input.models.map((model) => ({
    id: model.id.trim(),
    name: model.name.trim(),
    enabled: model.enabled,
    strategy: "round_robin",
    channels: model.channels.map((channel) => ({
      id: channel.id.trim(),
      providerId: channel.providerId.trim(),
      upstreamModel: channel.upstreamModel.trim(),
      enabled: channel.enabled,
    })),
  }));

  await prisma.systemSetting.upsert({
    where: { key: "llm" },
    create: { key: "llm", value: { providers, models } },
    update: { value: { providers, models } },
  });

  roundRobinCursor.clear();
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

export async function resolveRequestedModel(requested: string) {
  const { providers, models } = await resolveLlmConfig();
  const providerMap = new Map(providers.filter((p) => p.enabled).map((p) => [p.id, p]));
  const logical = models.find((model) => model.enabled && model.id === requested);

  if (!logical) {
    throw new ApiError(400, "llm_model_invalid", "模型不存在或已停用");
  }

  const usable = logical.channels
    .map((channel) => ({ channel, provider: providerMap.get(channel.providerId) }))
    .filter((entry): entry is { channel: LlmChannelConfig; provider: LlmProviderConfig } =>
      entry.channel.enabled && Boolean(entry.provider)
    );

  if (!usable.length) {
    throw new ApiError(503, "llm_model_no_channel", "该模型当前没有可用渠道");
  }

  const cursor = roundRobinCursor.get(logical.id) || 0;
  const selected = usable[cursor % usable.length];
  roundRobinCursor.set(logical.id, (cursor + 1) % Math.max(usable.length, 1));

  return {
    provider: selected.provider,
    model: selected.channel.upstreamModel,
    channel: selected.channel,
    logicalModel: logical,
  };
}

export async function listPublicModels() {
  const { providers, models } = await resolveLlmConfig();
  const enabledProviders = new Set(providers.filter((p) => p.enabled).map((p) => p.id));

  return models
    .filter((model) =>
      model.enabled &&
      model.channels.some((channel) => channel.enabled && enabledProviders.has(channel.providerId))
    )
    .map((model) => ({
      id: model.id,
      name: model.name,
    }));
}
