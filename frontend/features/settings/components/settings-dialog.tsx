"use client";

import { RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Cloud, type AdminMailSettings } from "@/lib/api";
import { defaultSettings } from "@/lib/settings";
import type { AppSettings, ModelInfo, User } from "@/lib/types";

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

export default function SettingsDialog({ settings, onChange, models, user, onClose }: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  models: ModelInfo[];
  user: User;
  onClose: () => void;
}) {
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25 backdrop-blur-sm">
      <div className="surface pretty-scrollbar h-full w-full max-w-md overflow-y-auto border-l p-6 shadow-2xl">
        <div className="mb-7 flex items-center justify-between">
          <div><h2 className="text-lg font-semibold">设置</h2><p className="muted mt-1 text-sm">偏好保存在当前浏览器</p></div>
          <button onClick={onClose} aria-label="关闭设置" className="muted rounded-lg p-2 hover:surface-2"><X size={19}/></button>
        </div>
        <div className="space-y-6">
          <SettingSelect label="主题" value={settings.theme} onChange={(v) => set("theme", v as AppSettings["theme"])}
            options={[["system","跟随系统"],["light","浅色"],["dark","深色"]]}/>
          <SettingSelect label="默认模型" value={settings.model} onChange={(v) => set("model", v)}
            options={[["","自动选择"], ...models.map((m) => [m.id, m.name || m.id] as [string,string])]}/>
          <SettingSelect label="默认聚合" value={settings.agg} onChange={(v) => set("agg", v as AppSettings["agg"])}
            options={[["sum","求和"],["avg","平均值"],["count","计数"],["max","最大值"],["min","最小值"]]}/>
          <SettingSelect label="时间粒度" value={settings.granularity} onChange={(v) => set("granularity", v as AppSettings["granularity"])}
            options={[["auto","自动"],["day","日"],["week","周"],["month","月"],["quarter","季度"]]}/>
          <SettingSelect label="异常检测" value={settings.sensitivity} onChange={(v) => set("sensitivity", v as AppSettings["sensitivity"])}
            options={[["strict","严格"],["normal","标准"],["loose","宽松"]]}/>
          <SettingSelect label="结论详细度" value={settings.detail} onChange={(v) => set("detail", v as AppSettings["detail"])}
            options={[["brief","精简"],["normal","标准"],["detailed","详细"]]}/>
          <SettingToggle label="导入后自动分析" value={settings.autoAnalyze} onChange={(v) => set("autoAnalyze", v)}/>
          <SettingToggle label="删除前确认" value={settings.confirmDelete} onChange={(v) => set("confirmDelete", v)}/>

          {user.role === "admin" && <AdminMailSettingsPanel adminEmail={user.email}/>}

          <button onClick={() => onChange(defaultSettings)}
            className="surface border-ui flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm">
            <RotateCcw size={15}/>恢复默认
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminMailSettingsPanel({ adminEmail }: { adminEmail: string }) {
  const [mail, setMail] = useState<AdminMailSettings>(blankMail);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("正在读取邮件配置…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const value = await Cloud.admin.getMail();
        if (!alive) return;
        setMail(value);
        setStatus(value.configured ? `SMTP 已配置（${value.source === "database" ? "后台配置" : "环境变量"}）` : "SMTP 尚未配置");
      } catch (e) {
        if (alive) setStatus(Cloud.errText(e));
      }
    })();
    return () => { alive = false; };
  }, []);

  const patch = <K extends keyof AdminMailSettings>(key: K, value: AdminMailSettings[K]) =>
    setMail((cur) => ({ ...cur, [key]: value }));

  const save = async () => {
    setBusy(true); setStatus("正在保存…");
    try {
      const next = await Cloud.admin.saveMail({
        host: mail.host.trim(),
        port: Number(mail.port) || 587,
        secure: mail.secure,
        user: mail.user.trim(),
        ...(password ? { password } : {}),
        from: mail.from.trim(),
      });
      setMail(next);
      setPassword("");
      setStatus("SMTP 已保存并立即生效");
    } catch (e) {
      setStatus(Cloud.errText(e));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true); setStatus(`正在向 ${adminEmail} 发送测试邮件…`);
    try {
      await Cloud.admin.testMail(adminEmail);
      setStatus("测试邮件已发送，请检查管理员邮箱");
    } catch (e) {
      setStatus(Cloud.errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-ui space-y-4 border-t pt-6">
      <div>
        <h3 className="text-sm font-semibold">管理员 · 邮件服务</h3>
        <p className="muted mt-1 text-xs">保存后无需重启容器；密码加密存入数据库。</p>
      </div>
      <SettingInput label="SMTP Host" value={mail.host} onChange={(v) => patch("host", v)} placeholder="smtp.example.com"/>
      <label className="block">
        <span className="mb-2 block text-sm font-medium">SMTP Port</span>
        <input type="number" min={1} max={65535} value={mail.port}
          onChange={(e) => patch("port", Number(e.target.value))}
          className="surface-2 border-ui w-full rounded-xl border px-3 py-2.5 outline-none"/>
      </label>
      <SettingToggle label="SSL/TLS（通常 465 开启，587 关闭）" value={mail.secure} onChange={(v) => patch("secure", v)}/>
      <SettingInput label="SMTP 用户名" value={mail.user} onChange={(v) => patch("user", v)} placeholder="mailer@example.com"/>
      <label className="block">
        <span className="mb-2 block text-sm font-medium">SMTP 密码</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          placeholder={mail.hasPassword ? "留空 = 保留现有密码" : "请输入 SMTP 密码"}
          className="surface-2 border-ui w-full rounded-xl border px-3 py-2.5 outline-none"/>
      </label>
      <SettingInput label="发件人" value={mail.from} onChange={(v) => patch("from", v)} placeholder="Data Agent <mailer@example.com>"/>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => void save()}
          className="brand-bg flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">保存 SMTP</button>
        <button type="button" disabled={busy || !mail.configured} onClick={() => void test()}
          className="surface border-ui rounded-xl border px-4 py-2.5 text-sm disabled:opacity-50">发送测试</button>
      </div>
      <p className="muted text-xs">{status}</p>
    </section>
  );
}

function SettingInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string;
}) {
  return <label className="block"><span className="mb-2 block text-sm font-medium">{label}</span>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="surface-2 border-ui w-full rounded-xl border px-3 py-2.5 outline-none"/></label>;
}

function SettingSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: [string,string][];
}) {
  return <label className="block"><span className="mb-2 block text-sm font-medium">{label}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="surface-2 border-ui w-full rounded-xl border px-3 py-2.5 outline-none">
      {options.map(([v,t]) => <option key={v} value={v}>{t}</option>)}
    </select></label>;
}

function SettingToggle({ label, value, onChange }: { label:string; value:boolean; onChange:(v:boolean)=>void }) {
  return <button type="button" onClick={() => onChange(!value)} className="flex w-full items-center justify-between gap-3 text-left">
    <span className="text-sm font-medium">{label}</span>
    <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${value ? "brand-bg" : "surface-2 border border-ui"}`}>
      <span className={`absolute top-1 size-4 rounded-full bg-white shadow transition ${value ? "left-6" : "left-1"}`}/>
    </span>
  </button>;
}
