"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Server,
  Shuffle,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Cloud,
  type AdminLlmChannel,
  type AdminLlmModel,
  type AdminLlmProvider,
  type AdminLlmSettings,
  type AdminMailSettings,
} from "@/lib/api";
import { applyTheme, loadSettings } from "@/lib/settings";
import type { User } from "@/lib/types";

const blankMail: AdminMailSettings = {
  host: "",
  port: 587,
  secure: false,
  user: "",
  from: "",
  configured: false,
  hasPassword: false,
  source: "environment",
};

type ProviderDraft = AdminLlmProvider;
type LogicalModelDraft = AdminLlmModel;

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [mail, setMail] = useState<AdminMailSettings>(blankMail);
  const [mailPassword, setMailPassword] = useState("");
  const [mailStatus, setMailStatus] = useState("");
  const [llm, setLlm] = useState<AdminLlmSettings>({ source: "environment", providers: [], models: [] });
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [llmStatus, setLlmStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    applyTheme(loadSettings().theme);
    void (async () => {
      try {
        const session = await Cloud.session();
        const current = session?.user || null;
        setUser(current);
        if (current?.role === "admin") {
          const [mailSettings, llmSettings] = await Promise.all([
            Cloud.admin.getMail(),
            Cloud.admin.getLlm(),
          ]);
          setMail(mailSettings);
          setLlm(llmSettings);
        }
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  if (booting) {
    return <div className="grid min-h-screen place-items-center muted">正在加载管理中心…</div>;
  }

  if (!user) {
    return <AccessState title="需要登录" message="请先登录 Data Agent，再进入管理中心。"/>;
  }

  if (user.role !== "admin") {
    return <AccessState title="没有管理员权限" message="当前账号不能访问系统管理中心。"/>;
  }

  const patchProvider = (id: string, patch: Partial<ProviderDraft>) => {
    setLlm((current) => ({
      ...current,
      providers: current.providers.map((p) => p.id === id ? { ...p, ...patch } : p),
    }));
  };

  const addProvider = () => {
    let id = uid("provider");
    while (llm.providers.some((p) => p.id === id)) id = uid("provider");
    setLlm((current) => ({
      ...current,
      providers: [
        ...current.providers,
        {
          id,
          name: "New Provider",
          baseUrl: "https://api.example.com/v1",
          models: [],
          enabled: true,
          hasApiKey: false,
          source: "database",
        },
      ],
    }));
  };

  const removeProvider = (id: string) => {
    setLlm((current) => ({
      ...current,
      providers: current.providers.filter((p) => p.id !== id),
      models: current.models.map((model) => ({
        ...model,
        channels: model.channels.filter((channel) => channel.providerId !== id),
      })),
    }));
    setProviderKeys((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const patchLogicalModel = (id: string, patch: Partial<LogicalModelDraft>) => {
    setLlm((current) => ({
      ...current,
      models: current.models.map((model) => model.id === id ? { ...model, ...patch } : model),
    }));
  };

  const addLogicalModel = () => {
    let id = uid("model");
    while (llm.models.some((model) => model.id === id)) id = uid("model");
    const provider = llm.providers.find((p) => p.enabled) || llm.providers[0];
    setLlm((current) => ({
      ...current,
      models: [
        ...current.models,
        {
          id,
          name: "New Model",
          enabled: true,
          strategy: "round_robin",
          channels: provider ? [{
            id: uid("channel"),
            providerId: provider.id,
            upstreamModel: provider.models[0] || "",
            enabled: true,
          }] : [],
        },
      ],
    }));
  };

  const removeLogicalModel = (id: string) => {
    setLlm((current) => ({
      ...current,
      models: current.models.filter((model) => model.id !== id),
    }));
  };

  const addChannel = (modelId: string) => {
    const provider = llm.providers.find((p) => p.enabled) || llm.providers[0];
    if (!provider) {
      setLlmStatus("请先添加至少一个 LLM 供应商");
      return;
    }
    const channel: AdminLlmChannel = {
      id: uid("channel"),
      providerId: provider.id,
      upstreamModel: provider.models[0] || "",
      enabled: true,
    };
    setLlm((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.id === modelId ? { ...model, channels: [...model.channels, channel] } : model
      ),
    }));
  };

  const patchChannel = (modelId: string, channelId: string, patch: Partial<AdminLlmChannel>) => {
    setLlm((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.id === modelId
          ? {
              ...model,
              channels: model.channels.map((channel) =>
                channel.id === channelId ? { ...channel, ...patch } : channel
              ),
            }
          : model
      ),
    }));
  };

  const removeChannel = (modelId: string, channelId: string) => {
    setLlm((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.id === modelId
          ? { ...model, channels: model.channels.filter((channel) => channel.id !== channelId) }
          : model
      ),
    }));
  };

  const saveMail = async () => {
    setBusy(true);
    setMailStatus("正在保存…");
    try {
      const next = await Cloud.admin.saveMail({
        host: mail.host.trim(),
        port: Number(mail.port) || 587,
        secure: mail.secure,
        user: mail.user.trim(),
        ...(mailPassword ? { password: mailPassword } : {}),
        from: mail.from.trim(),
      });
      setMail(next);
      setMailPassword("");
      setMailStatus("SMTP 已保存并立即生效");
    } catch (error) {
      setMailStatus(Cloud.errText(error));
    } finally {
      setBusy(false);
    }
  };

  const testMail = async () => {
    setBusy(true);
    setMailStatus(`正在向 ${user.email} 发送测试邮件…`);
    try {
      await Cloud.admin.testMail(user.email);
      setMailStatus("测试邮件已发送，请检查管理员邮箱");
    } catch (error) {
      setMailStatus(Cloud.errText(error));
    } finally {
      setBusy(false);
    }
  };

  const payloadOf = (providers = llm.providers, models = llm.models) => ({
    providers: providers.map((p) => ({
      id: p.id.trim(),
      name: p.name.trim(),
      baseUrl: p.baseUrl.trim(),
      ...(providerKeys[p.id] ? { apiKey: providerKeys[p.id] } : {}),
      models: p.models.map((x) => x.trim()).filter(Boolean),
      enabled: p.enabled,
    })),
    models: models.map((model) => ({
      id: model.id.trim(),
      name: model.name.trim(),
      enabled: model.enabled,
      strategy: "round_robin" as const,
      channels: model.channels.map((channel) => ({
        id: channel.id.trim(),
        providerId: channel.providerId.trim(),
        upstreamModel: channel.upstreamModel.trim(),
        enabled: channel.enabled,
      })),
    })),
  });

  const persistLlm = async (providers = llm.providers, models = llm.models) => {
    const saved = await Cloud.admin.saveLlm(payloadOf(providers, models));
    setLlm(saved);
    setProviderKeys({});
    return saved;
  };

  const saveLlm = async () => {
    setBusy(true);
    setLlmStatus("正在保存模型与渠道配置…");
    try {
      await persistLlm();
      setLlmStatus("LLM 供应商、逻辑模型与渠道已保存并立即生效");
    } catch (error) {
      setLlmStatus(Cloud.errText(error));
    } finally {
      setBusy(false);
    }
  };

  const discoverModels = async (id: string) => {
    setBusy(true);
    setLlmStatus("正在保存配置并读取供应商模型列表…");
    try {
      const saved = await persistLlm();
      const found = await Cloud.admin.discoverLlmModels(id);
      const providers = saved.providers.map((p) => p.id === id ? { ...p, models: found.models } : p);
      const final = await Cloud.admin.saveLlm(payloadOf(providers, saved.models));
      setLlm(final);
      setLlmStatus(`已从供应商读取 ${found.models.length} 个上游模型；可在渠道中选择`);
    } catch (error) {
      setLlmStatus(Cloud.errText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="surface border-ui sticky top-0 z-20 border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <a href="/" className="muted rounded-lg p-2 hover:surface-2" aria-label="返回 Data Agent">
              <ArrowLeft size={19}/>
            </a>
            <div>
              <h1 className="font-semibold">Data Agent 管理中心</h1>
              <p className="muted text-xs">{user.email}</p>
            </div>
          </div>
          <span className="brand-soft brand rounded-full px-3 py-1 text-xs font-medium">Admin</span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <section className="surface border-ui rounded-2xl border p-5 sm:p-6">
          <div className="mb-6 flex items-start gap-3">
            <div className="brand-soft brand grid size-10 shrink-0 place-items-center rounded-xl"><Server size={19}/></div>
            <div>
              <h2 className="font-semibold">LLM 供应商</h2>
              <p className="muted mt-1 text-sm">
                Provider 只负责连接上游。API Key 加密保存；模型列表用于给渠道提供候选项。
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {llm.providers.length === 0 && (
              <div className="surface-2 border-ui rounded-xl border border-dashed p-6 text-center">
                <p className="font-medium">尚未配置 LLM 供应商</p>
                <p className="muted mt-1 text-sm">先添加 OpenAI-compatible API，再创建逻辑模型与渠道。</p>
              </div>
            )}

            {llm.providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                apiKey={providerKeys[provider.id] || ""}
                busy={busy}
                onPatch={(patch) => patchProvider(provider.id, patch)}
                onApiKey={(value) => setProviderKeys((current) => ({ ...current, [provider.id]: value }))}
                onRemove={() => removeProvider(provider.id)}
                onDiscover={() => void discoverModels(provider.id)}
              />
            ))}
          </div>

          <button type="button" onClick={addProvider} disabled={busy}
            className="surface border-ui mt-5 inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm disabled:opacity-50">
            <Plus size={16}/>添加供应商
          </button>
        </section>

        <section className="surface border-ui rounded-2xl border p-5 sm:p-6">
          <div className="mb-6 flex items-start gap-3">
            <div className="brand-soft brand grid size-10 shrink-0 place-items-center rounded-xl"><Shuffle size={19}/></div>
            <div>
              <h2 className="font-semibold">前端模型与自定义渠道</h2>
              <p className="muted mt-1 text-sm">
                前端只显示逻辑模型。一个逻辑模型可绑定多个渠道；启用多个渠道时按 Round Robin 逐请求轮询。
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {llm.models.length === 0 && (
              <div className="surface-2 border-ui rounded-xl border border-dashed p-6 text-center">
                <p className="font-medium">尚未创建前端模型</p>
                <p className="muted mt-1 text-sm">创建逻辑模型后，为它添加一个或多个供应商渠道。</p>
              </div>
            )}

            {llm.models.map((model) => (
              <LogicalModelCard
                key={model.id}
                model={model}
                providers={llm.providers}
                busy={busy}
                onPatch={(patch) => patchLogicalModel(model.id, patch)}
                onRemove={() => removeLogicalModel(model.id)}
                onAddChannel={() => addChannel(model.id)}
                onPatchChannel={(channelId, patch) => patchChannel(model.id, channelId, patch)}
                onRemoveChannel={(channelId) => removeChannel(model.id, channelId)}
              />
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={addLogicalModel} disabled={busy}
              className="surface border-ui inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm disabled:opacity-50">
              <Plus size={16}/>添加前端模型
            </button>
            <button type="button" onClick={() => void saveLlm()} disabled={busy}
              className="brand-bg inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              <Save size={16}/>保存 LLM 配置
            </button>
          </div>
          {llmStatus && <p className="muted mt-3 text-sm">{llmStatus}</p>}
        </section>

        <section className="surface border-ui rounded-2xl border p-5 sm:p-6">
          <div className="mb-6 flex items-start gap-3">
            <div className="brand-soft brand grid size-10 shrink-0 place-items-center rounded-xl"><Mail size={19}/></div>
            <div>
              <h2 className="font-semibold">邮件服务</h2>
              <p className="muted mt-1 text-sm">用于注册、登录与密码重置验证码。</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Input label="SMTP Host" value={mail.host} onChange={(host) => setMail({ ...mail, host })} placeholder="smtp.example.com"/>
            <label className="block">
              <span className="mb-2 block text-sm font-medium">SMTP Port</span>
              <input type="number" min={1} max={65535} value={mail.port}
                onChange={(e) => setMail({ ...mail, port: Number(e.target.value) })}
                className="surface-2 border-ui w-full rounded-xl border px-3 py-2.5 outline-none"/>
            </label>
            <Input label="SMTP 用户名" value={mail.user} onChange={(userName) => setMail({ ...mail, user: userName })} placeholder="mailer@example.com"/>
            <label className="block">
              <span className="mb-2 block text-sm font-medium">SMTP 密码</span>
              <input type="password" value={mailPassword} onChange={(e) => setMailPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={mail.hasPassword ? "留空 = 保留现有密码" : "请输入 SMTP 密码"}
                className="surface-2 border-ui w-full rounded-xl border px-3 py-2.5 outline-none"/>
            </label>
            <div className="md:col-span-2">
              <Input label="发件人" value={mail.from} onChange={(from) => setMail({ ...mail, from })} placeholder="Data Agent <mailer@example.com>"/>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={mail.secure} onChange={(e) => setMail({ ...mail, secure: e.target.checked })}/>
              SSL/TLS（通常 465 开启，587 关闭）
            </label>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void saveMail()}
              className="brand-bg inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
              <Save size={16}/>保存 SMTP
            </button>
            <button type="button" disabled={busy || !mail.configured} onClick={() => void testMail()}
              className="surface border-ui inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm disabled:opacity-50">
              <CheckCircle2 size={16}/>发送测试邮件
            </button>
          </div>
          {mailStatus && <p className="muted mt-3 text-sm">{mailStatus}</p>}
        </section>
      </main>
    </div>
  );
}

function ProviderCard({ provider, apiKey, busy, onPatch, onApiKey, onRemove, onDiscover }: {
  provider: ProviderDraft;
  apiKey: string;
  busy: boolean;
  onPatch: (patch: Partial<ProviderDraft>) => void;
  onApiKey: (value: string) => void;
  onRemove: () => void;
  onDiscover: () => void;
}) {
  const modelText = provider.models.join("\n");

  return (
    <div className="surface-2 border-ui rounded-2xl border p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{provider.name || provider.id}</p>
          <p className="muted mt-0.5 text-xs">
            {provider.source === "environment" ? "当前来自环境变量；保存后转为后台配置" : "后台配置"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={provider.enabled}
              onChange={(e) => onPatch({ enabled: e.target.checked })}/>
            Provider 启用
          </label>
          <button type="button" onClick={onRemove} disabled={busy}
            className="muted rounded-lg p-2 hover:bg-red-500/10 hover:text-[var(--danger)] disabled:opacity-50"
            aria-label={`删除 ${provider.name}`}>
            <Trash2 size={16}/>
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium">供应商 ID</span>
          <input value={provider.id} readOnly
            className="surface border-ui muted w-full cursor-not-allowed rounded-xl border px-3 py-2.5 outline-none"/>
        </label>
        <Input label="显示名称" value={provider.name} onChange={(name) => onPatch({ name })} placeholder="OpenAI"/>
        <div className="md:col-span-2">
          <Input label="Base URL" value={provider.baseUrl} onChange={(baseUrl) => onPatch({ baseUrl })}
            placeholder="https://api.openai.com/v1"/>
        </div>
        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm font-medium">API Key</span>
          <input type="password" value={apiKey} onChange={(e) => onApiKey(e.target.value)}
            autoComplete="new-password"
            placeholder={provider.hasApiKey ? "留空 = 保留现有 Key" : "sk-..."}
            className="surface border-ui w-full rounded-xl border px-3 py-2.5 outline-none"/>
        </label>
        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm font-medium">上游模型目录</span>
          <textarea value={modelText}
            onChange={(e) => onPatch({ models: e.target.value.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) })}
            rows={4}
            placeholder={"gpt-5.6\ngpt-5.6-mini"}
            className="surface border-ui w-full rounded-xl border px-3 py-2.5 font-mono text-sm outline-none"/>
          <span className="muted mt-1 block text-xs">这里只是 Provider 可选模型目录；真正是否对前端开放由下面的渠道开关决定。</span>
        </label>
      </div>

      <button type="button" onClick={onDiscover} disabled={busy || !provider.baseUrl.trim()}
        className="surface border-ui mt-4 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50">
        <RefreshCw size={15}/>保存并从 /models 拉取
      </button>
    </div>
  );
}

function LogicalModelCard({ model, providers, busy, onPatch, onRemove, onAddChannel, onPatchChannel, onRemoveChannel }: {
  model: LogicalModelDraft;
  providers: AdminLlmProvider[];
  busy: boolean;
  onPatch: (patch: Partial<LogicalModelDraft>) => void;
  onRemove: () => void;
  onAddChannel: () => void;
  onPatchChannel: (channelId: string, patch: Partial<AdminLlmChannel>) => void;
  onRemoveChannel: (channelId: string) => void;
}) {
  const activeChannels = model.channels.filter((channel) =>
    channel.enabled && providers.some((provider) => provider.id === channel.providerId && provider.enabled)
  ).length;

  return (
    <div className="surface-2 border-ui rounded-2xl border p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{model.name || model.id}</p>
          <p className="muted mt-0.5 text-xs">
            前端 ID：{model.id} · {activeChannels} 个启用渠道 · Round Robin
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={model.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })}/>
            前端启用
          </label>
          <button type="button" onClick={onRemove} disabled={busy}
            className="muted rounded-lg p-2 hover:bg-red-500/10 hover:text-[var(--danger)] disabled:opacity-50"
            aria-label={`删除模型 ${model.name}`}>
            <Trash2 size={16}/>
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Input label="前端模型 ID" value={model.id} onChange={(id) => onPatch({ id })} placeholder="gpt-5.6"/>
        <Input label="前端显示名称" value={model.name} onChange={(name) => onPatch({ name })} placeholder="GPT-5.6"/>
        <label className="block">
          <span className="mb-2 block text-sm font-medium">路由策略</span>
          <select value={model.strategy} disabled
            className="surface border-ui w-full rounded-xl border px-3 py-2.5 outline-none disabled:opacity-70">
            <option value="round_robin">Round Robin 轮询</option>
          </select>
        </label>
      </div>

      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">渠道</p>
            <p className="muted text-xs">每个渠道 = 一个 Provider + 一个上游模型，可独立开关。</p>
          </div>
          <button type="button" onClick={onAddChannel} disabled={busy || providers.length === 0}
            className="surface border-ui inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs disabled:opacity-50">
            <Plus size={14}/>添加渠道
          </button>
        </div>

        {model.channels.length === 0 && (
          <div className="surface border-ui rounded-xl border border-dashed p-4 text-center text-sm muted">
            没有渠道；该模型不会出现在普通用户的模型列表中。
          </div>
        )}

        {model.channels.map((channel) => {
          const provider = providers.find((p) => p.id === channel.providerId);
          const options = provider?.models || [];
          const listId = `models-${model.id.replace(/[^A-Za-z0-9_-]/g, "_")}-${channel.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

          return (
            <div key={channel.id} className="surface border-ui rounded-xl border p-3">
              <div className="grid gap-3 md:grid-cols-[auto_1fr_1fr_auto] md:items-end">
                <label className="flex items-center gap-2 pb-2 text-xs">
                  <input type="checkbox" checked={channel.enabled}
                    onChange={(e) => onPatchChannel(channel.id, { enabled: e.target.checked })}/>
                  启用
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium">Provider</span>
                  <select value={channel.providerId}
                    onChange={(e) => {
                      const next = providers.find((p) => p.id === e.target.value);
                      onPatchChannel(channel.id, {
                        providerId: e.target.value,
                        upstreamModel: next?.models[0] || "",
                      });
                    }}
                    className="surface-2 border-ui w-full rounded-lg border px-2.5 py-2 text-sm outline-none">
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}{p.enabled ? "" : "（已停用）"}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium">上游模型</span>
                  <input list={listId} value={channel.upstreamModel}
                    onChange={(e) => onPatchChannel(channel.id, { upstreamModel: e.target.value })}
                    placeholder="gpt-5.6"
                    className="surface-2 border-ui w-full rounded-lg border px-2.5 py-2 font-mono text-sm outline-none"/>
                  <datalist id={listId}>
                    {options.map((name) => <option key={name} value={name}/>)}
                  </datalist>
                </label>

                <button type="button" onClick={() => onRemoveChannel(channel.id)} disabled={busy}
                  className="muted mb-0.5 rounded-lg p-2 hover:bg-red-500/10 hover:text-[var(--danger)] disabled:opacity-50"
                  aria-label="删除渠道">
                  <Trash2 size={16}/>
                </button>
              </div>
              <p className="muted mt-2 text-xs">
                {provider?.enabled === false ? "此 Provider 已停用，因此该渠道不会参与轮询。" :
                  channel.enabled ? "该渠道会参与轮询。" : "该渠道已关闭。"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="surface-2 border-ui w-full rounded-xl border px-3 py-2.5 outline-none"/>
    </label>
  );
}

function AccessState({ title, message }: { title: string; message: string }) {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="surface border-ui max-w-md rounded-2xl border p-7 text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="muted mt-2 text-sm">{message}</p>
        <a href="/" className="brand-bg mt-5 inline-flex rounded-xl px-4 py-2.5 text-sm font-medium text-white">
          返回 Data Agent
        </a>
      </div>
    </div>
  );
}
