"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Server,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Cloud,
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

export default function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [mail, setMail] = useState<AdminMailSettings>(blankMail);
  const [mailPassword, setMailPassword] = useState("");
  const [mailStatus, setMailStatus] = useState("");
  const [llm, setLlm] = useState<AdminLlmSettings>({ source: "environment", providers: [] });
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
    let id = `provider_${Date.now().toString(36)}`;
    while (llm.providers.some((p) => p.id === id)) id += "_1";
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
    }));
    setProviderKeys((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
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

  const payloadOf = (providers: ProviderDraft[]) => ({
    providers: providers.map((p) => ({
      id: p.id.trim(),
      name: p.name.trim(),
      baseUrl: p.baseUrl.trim(),
      ...(providerKeys[p.id] ? { apiKey: providerKeys[p.id] } : {}),
      models: p.models.map((x) => x.trim()).filter(Boolean),
      enabled: p.enabled,
    })),
  });

  const persistLlm = async (providers = llm.providers) => {
    const saved = await Cloud.admin.saveLlm(payloadOf(providers));
    setLlm(saved);
    setProviderKeys({});
    return saved;
  };

  const saveLlm = async () => {
    setBusy(true);
    setLlmStatus("正在保存模型配置…");
    try {
      await persistLlm();
      setLlmStatus("LLM 供应商与模型已保存并立即生效");
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
      const patched = saved.providers.map((p) => p.id === id ? { ...p, models: found.models } : p);
      const final = await Cloud.admin.saveLlm({
        providers: patched.map((p) => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          models: p.models,
          enabled: p.enabled,
        })),
      });
      setLlm(final);
      setLlmStatus(`已从供应商读取 ${found.models.length} 个模型并保存`);
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
              <h2 className="font-semibold">LLM 供应商与模型</h2>
              <p className="muted mt-1 text-sm">
                后台配置优先于环境变量。API Key 加密保存；配置保存后无需重启。
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {llm.providers.length === 0 && (
              <div className="surface-2 border-ui rounded-xl border border-dashed p-6 text-center">
                <p className="font-medium">尚未配置 LLM 供应商</p>
                <p className="muted mt-1 text-sm">添加 OpenAI-compatible API 后即可在主界面选择模型。</p>
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

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={addProvider} disabled={busy}
              className="surface border-ui inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm disabled:opacity-50">
              <Plus size={16}/>添加供应商
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
            启用
          </label>
          <button type="button" onClick={onRemove} disabled={busy}
            className="muted rounded-lg p-2 hover:bg-red-500/10 hover:text-[var(--danger)] disabled:opacity-50"
            aria-label={`删除 ${provider.name}`}>
            <Trash2 size={16}/>
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Input label="供应商 ID" value={provider.id}
          onChange={(id) => onPatch({ id: id.replace(/[^A-Za-z0-9_-]/g, "") })}
          placeholder="openai"/>
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
          <span className="mb-2 block text-sm font-medium">模型列表</span>
          <textarea value={modelText}
            onChange={(e) => onPatch({ models: e.target.value.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) })}
            rows={5}
            placeholder={"gpt-5.6\ngpt-5.6-mini"}
            className="surface border-ui w-full rounded-xl border px-3 py-2.5 font-mono text-sm outline-none"/>
          <span className="muted mt-1 block text-xs">每行一个，也支持逗号分隔。</span>
        </label>
      </div>

      <button type="button" onClick={onDiscover} disabled={busy || !provider.baseUrl.trim()}
        className="surface border-ui mt-4 inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm disabled:opacity-50">
        <RefreshCw size={15}/>保存并从 /models 拉取
      </button>
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
