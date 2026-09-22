"use client";

import { RotateCcw, X } from "lucide-react";
import { defaultSettings } from "@/lib/settings";
import type { AppSettings, ModelInfo } from "@/lib/types";

export default function SettingsDialog({ settings, onChange, models, onClose }: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  models: ModelInfo[];
  onClose: () => void;
}) {
  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25 backdrop-blur-sm">
      <div className="surface h-full w-full max-w-md border-l p-6 shadow-2xl">
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
          <button onClick={() => onChange(defaultSettings)}
            className="surface border-ui flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm">
            <RotateCcw size={15}/>恢复默认
          </button>
        </div>
      </div>
    </div>
  );
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
  return <button onClick={() => onChange(!value)} className="flex w-full items-center justify-between">
    <span className="text-sm font-medium">{label}</span>
    <span className={`relative h-6 w-11 rounded-full transition ${value ? "brand-bg" : "surface-2 border border-ui"}`}>
      <span className={`absolute top-1 size-4 rounded-full bg-white shadow transition ${value ? "left-6" : "left-1"}`}/>
    </span>
  </button>;
}
