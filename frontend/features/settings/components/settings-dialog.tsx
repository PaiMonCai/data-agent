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
          <div><h2 className="text-lg font-semibold">è®¾ç½®</h2><p className="muted mt-1 text-sm">åå¥½ä¿å­å¨å½åæµè§å¨</p></div>
          <button onClick={onClose} className="muted rounded-lg p-2 hover:surface-2"><X size={19}/></button>
        </div>
        <div className="space-y-6">
          <SettingSelect label="ä¸»é¢" value={settings.theme} onChange={(v) => set("theme", v as AppSettings["theme"])}
            options={[["system","è·éç³»ç»"],["light","æµè²"],["dark","æ·±è²"]]}/>
          <SettingSelect label="é»è®¤æ¨¡å" value={settings.model} onChange={(v) => set("model", v)}
            options={[["","èªå¨éæ©"], ...models.map((m) => [m.id, m.name || m.id] as [string,string])]}/>
          <SettingSelect label="é»è®¤èå" value={settings.agg} onChange={(v) => set("agg", v as AppSettings["agg"])}
            options={[["sum","æ±å"],["avg","å¹³åå¼"],["count","è®¡æ°"],["max","æå¤§å¼"],["min","æå°å¼"]]}/>
          <SettingSelect label="æ¶é´ç²åº¦" value={settings.granularity} onChange={(v) => set("granularity", v as AppSettings["granularity"])}
            options={[["auto","èªå¨"],["day","æ¥"],["week","å¨"],["month","æ"],["quarter","å­£åº¦"]]}/>
          <SettingSelect label="å¼å¸¸æ£æµ" value={settings.sensitivity} onChange={(v) => set("sensitivity", v as AppSettings["sensitivity"])}
            options={[["strict","ä¸¥æ ¼"],["normal","æ å"],["loose","å®½æ¾"]]}/>
          <SettingSelect label="ç»è®ºè¯¦ç»åº¦" value={settings.detail} onChange={(v) => set("detail", v as AppSettings["detail"])}
            options={[["brief","ç²¾ç®"],["normal","æ å"],["detailed","è¯¦ç»"]]}/>
          <SettingToggle label="å¯¼å¥åèªå¨åæ" value={settings.autoAnalyze} onChange={(v) => set("autoAnalyze", v)}/>
          <SettingToggle label="å é¤åç¡®è®¤" value={settings.confirmDelete} onChange={(v) => set("confirmDelete", v)}/>
          <button onClick={() => onChange(defaultSettings)}
            className="surface border-ui flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm">
            <RotateCcw size={15}/>æ¢å¤é»è®¤
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
