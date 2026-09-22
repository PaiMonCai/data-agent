"use client";

import {
  BarChart3, Database, FileSpreadsheet, LogOut, Menu, Moon, Plus, Search,
  Send, Settings, Sparkles, Sun, Table2, Trash2, Upload, X, Zap, ChevronDown,
  RotateCcw, Check, AlertTriangle
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import ChartView from "./chart-view";
import { Agent } from "@/lib/agent";
import { Cloud, listDatasets, listHistory, loadDatasetRows } from "@/lib/api";
import { Parse } from "@/lib/parse";
import { applyTheme, defaultSettings, loadSettings, saveSettings } from "@/lib/settings";
import type {
  AnalysisHistory, AppSettings, Dataset, DatasetMeta, ModelInfo, ParsedTable, User
} from "@/lib/types";

type ChatItem = {
  id: string;
  question: string;
  stage?: string;
  report?: string;
  plan?: any;
  result?: any;
  clean?: any;
  task?: "analyze" | "clean";
  error?: string;
};

const quickQuestions = [
  "给我一份这份数据的整体概览",
  "分析主要指标随时间的变化趋势",
  "检测数据中的异常值和异常波动",
  "对比不同分组之间的指标表现",
  "哪些维度对结果影响最大？给出相关性洞察",
];

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function fmtDate(value?: string) {
  if (!value) return "";
  try { return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  catch { return value; }
}

function AuthView({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<"password" | "otp" | "signup" | "reset">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    if (!email) return setMessage("先填写邮箱");
    setBusy(true); setMessage("");
    try {
      const purpose = mode === "signup" ? "signup" : mode === "reset" ? "reset" : "login";
      const r = await Cloud.auth.sendOtp({ email, purpose });
      if (r.error || !r.data) throw r.error || new Error("发送失败");
      setVerificationId(r.data.verificationId);
      setMessage("验证码已发送，请检查邮箱");
    } catch (e) {
      setMessage(Cloud.errText(e));
    } finally { setBusy(false); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMessage("");
    try {
      if (mode === "password") {
        const r = await Cloud.auth.signInWithPassword({ email, password });
        if (r.error || !r.data?.user) throw r.error || new Error("登录失败");
        onAuthed(r.data.user);
        return;
      }

      if (!verificationId) throw new Error("请先发送验证码");
      if (!code) throw new Error("请输入验证码");

      if (mode === "reset") {
        const r = await Cloud.auth.resetPassword({
          email, verificationId, nonce: code, password,
        });
        if (r.error || !r.data?.user) throw r.error || new Error("重置失败");
        onAuthed(r.data.user);
        return;
      }

      const purpose = mode === "signup" ? "signup" : "login";
      const r = await Cloud.auth.verifyOtp({
        verificationId, token: code, email, purpose,
        ...(mode === "signup" ? { password } : {}),
      });
      if (r.error || !r.data?.user) throw r.error || new Error("验证失败");
      onAuthed(r.data.user);
    } catch (e) {
      setMessage(Cloud.errText(e));
    } finally { setBusy(false); }
  };

  const tabs = [
    ["password", "密码登录"],
    ["otp", "验证码"],
    ["signup", "注册"],
  ] as const;

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="surface w-full max-w-md rounded-3xl border p-7 shadow-[0_24px_70px_rgba(15,23,42,.10)]">
        <div className="mb-7 flex items-center gap-3">
          <div className="brand-bg grid size-11 place-items-center rounded-2xl text-white"><BarChart3 size={22} /></div>
          <div>
            <h1 className="text-xl font-semibold">Data Agent</h1>
            <p className="muted mt-1 text-sm">上传数据，用自然语言完成分析与清洗</p>
          </div>
        </div>

        <div className="surface-2 mb-6 grid grid-cols-3 rounded-xl p-1">
          {tabs.map(([value, label]) => (
            <button key={value} type="button" onClick={() => { setMode(value); setMessage(""); }}
              className={`rounded-lg px-3 py-2 text-sm transition ${mode === value ? "surface shadow-sm" : "muted"}`}>
              {label}
            </button>
          ))}
        </div>

        {mode === "reset" && (
          <button className="muted mb-4 text-sm hover:underline" onClick={() => setMode("password")}>← 返回登录</button>
        )}

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">邮箱</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="surface-2 border-ui w-full rounded-xl border px-3.5 py-3 outline-none focus:border-[var(--brand)]"
              placeholder="you@example.com" />
          </label>

          {(mode === "password" || mode === "signup" || mode === "reset") && (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">{mode === "reset" ? "新密码" : "密码"}</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className="surface-2 border-ui w-full rounded-xl border px-3.5 py-3 outline-none focus:border-[var(--brand)]"
                placeholder="至少 8 位" />
            </label>
          )}

          {mode !== "password" && (
            <div>
              <span className="mb-1.5 block text-sm font-medium">邮箱验证码</span>
              <div className="flex gap-2">
                <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric"
                  className="surface-2 border-ui min-w-0 flex-1 rounded-xl border px-3.5 py-3 outline-none focus:border-[var(--brand)]"
                  placeholder="6 位验证码" />
                <button type="button" disabled={busy} onClick={sendCode}
                  className="surface border-ui rounded-xl border px-4 text-sm font-medium hover:brand-soft">
                  发送
                </button>
              </div>
            </div>
          )}

          {message && <p className="text-sm text-[var(--danger)]">{message}</p>}

          <button disabled={busy} className="brand-bg w-full rounded-xl px-4 py-3 font-medium text-white disabled:opacity-50">
            {busy ? "处理中…" : mode === "password" ? "登录" : mode === "reset" ? "重置并登录" : mode === "signup" ? "创建账号" : "验证并登录"}
          </button>

          {mode === "password" && (
            <button type="button" onClick={() => setMode("reset")} className="muted w-full text-sm hover:underline">
              忘记密码？
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function ImportDialog({ onClose, onImported }: {
  onClose: () => void;
  onImported: (dataset: DatasetMeta) => Promise<void>;
}) {
  const [source, setSource] = useState<"file" | "paste" | "sample">("file");
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [parsed, setParsed] = useState<ParsedTable | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const parseFile = async (file: File) => {
    setBusy(true); setNote("正在解析文件…");
    try {
      let out: ParsedTable;
      if (Parse.isExcel(file.name)) {
        const wb = await Parse.workbook(await file.arrayBuffer());
        out = wb.use(wb.sheets[0]);
        setNote(`已读取工作表：${wb.sheets[0]}`);
      } else if (Parse.isStata(file.name)) {
        out = await Parse.fromStata(new Uint8Array(await file.arrayBuffer()));
        setNote("Stata 文件解析完成");
      } else {
        out = Parse.fromText(await file.text());
        setNote(`已解析 ${out.rows.length} 行 × ${out.columns.length} 列`);
      }
      setParsed(out);
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      setNote(Cloud.errText(e));
      setParsed(null);
    } finally { setBusy(false); }
  };

  const importNow = async () => {
    setBusy(true);
    try {
      let data = parsed;
      if (source === "paste") data = Parse.fromText(paste);
      if (source === "sample") data = Parse.sampleData();
      if (!data?.rows?.length) throw new Error("没有可导入的数据");
      const rows = data.rows.slice(0, 20000);
      const created = await Cloud.db.importDataset({
        name: (name.trim() || (source === "sample" ? "电商销售示例" : "新数据集")).slice(0, 60),
        source,
        columns: data.columns,
      }, rows);
      if (!created[0]) throw new Error("服务端未返回数据集");
      await onImported(created[0]);
      onClose();
    } catch (e) {
      setNote(Cloud.errText(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="surface max-h-[90vh] w-full max-w-2xl overflow-auto rounded-3xl border shadow-2xl">
        <div className="border-ui flex items-center justify-between border-b px-6 py-5">
          <div><h2 className="text-lg font-semibold">新建数据集</h2><p className="muted mt-1 text-sm">支持 CSV / TSV / JSON / Excel .xlsx / Stata</p></div>
          <button onClick={onClose} className="muted rounded-lg p-2 hover:surface-2"><X size={19}/></button>
        </div>

        <div className="p-6">
          <div className="surface-2 mb-5 grid grid-cols-3 rounded-xl p-1">
            {([
              ["file", "上传文件", Upload],
              ["paste", "粘贴数据", FileSpreadsheet],
              ["sample", "示例数据", Sparkles],
            ] as const).map(([value, label, Icon]) => (
              <button key={value} onClick={() => setSource(value)}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm ${source === value ? "surface shadow-sm" : "muted"}`}>
                <Icon size={16}/>{label}
              </button>
            ))}
          </div>

          {source === "file" && (
            <label className="surface-2 border-ui flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center">
              <Upload className="brand mb-3" />
              <span className="font-medium">选择文件</span>
              <span className="muted mt-2 text-sm">最大导入 20,000 行</span>
              <input type="file" className="hidden" accept=".csv,.tsv,.txt,.json,.xlsx,.xlsm,.dta"
                onChange={(e) => e.target.files?.[0] && void parseFile(e.target.files[0])}/>
            </label>
          )}

          {source === "paste" && (
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)}
              className="surface-2 border-ui h-44 w-full rounded-2xl border p-4 outline-none focus:border-[var(--brand)]"
              placeholder="粘贴 CSV、TSV 或从 Excel 复制的表格…" />
          )}

          {source === "sample" && (
            <div className="surface-2 rounded-2xl p-5">
              <p className="font-medium">电商销售示例数据</p>
              <p className="muted mt-2 text-sm">180 天 × 4 个渠道，包含趋势、异常峰值、退款与毛利率等字段。</p>
            </div>
          )}

          <label className="mt-5 block">
            <span className="mb-1.5 block text-sm font-medium">数据集名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="surface-2 border-ui w-full rounded-xl border px-3.5 py-3 outline-none focus:border-[var(--brand)]"
              placeholder="例如：Q3 销售明细"/>
          </label>

          {note && <p className="muted mt-3 text-sm">{note}</p>}
          {parsed && <p className="mt-2 text-sm text-[var(--success)]">✓ {parsed.rows.length} 行，{parsed.columns.length} 个字段</p>}
        </div>

        <div className="border-ui flex justify-end gap-2 border-t px-6 py-4">
          <button onClick={onClose} className="surface border-ui rounded-xl border px-4 py-2.5 text-sm">取消</button>
          <button disabled={busy} onClick={() => void importNow()} className="brand-bg rounded-xl px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "处理中…" : "导入"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsDialog({ settings, onChange, models, onClose }: {
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
          <button onClick={onClose} className="muted rounded-lg p-2 hover:surface-2"><X size={19}/></button>
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

function ResultCard({ item, theme, onApplyClean }: {
  item: ChatItem; theme: string; onApplyClean: (item: ChatItem) => Promise<void>;
}) {
  const result = item.result;
  const clean = item.clean;
  return (
    <div className="surface fade-in rounded-2xl border p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="brand-soft brand grid size-8 place-items-center rounded-lg"><Sparkles size={16}/></div>
          <div>
            <p className="font-medium">{item.plan?.title || (item.task === "clean" ? "数据清洗" : "分析结果")}</p>
            {item.stage && <p className="muted mt-0.5 text-xs">{item.stage}</p>}
          </div>
        </div>
        {item.error && <AlertTriangle size={18} className="text-[var(--danger)]"/>}
      </div>

      {item.error && <p className="text-sm text-[var(--danger)]">{item.error}</p>}

      {result && (
        <>
          <ChartView result={result} theme={theme}/>
          {result.table?.rows?.length > 0 && (
            <details className="mt-4">
              <summary className="muted cursor-pointer text-sm">查看计算明细</summary>
              <div className="pretty-scrollbar mt-3 max-h-72 overflow-auto rounded-xl border border-ui">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="surface-2 sticky top-0">
                    <tr>{result.table.headers.map((h: string) => <th key={h} className="border-ui border-b px-3 py-2 text-left font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>{result.table.rows.slice(0,100).map((row: any[], i:number) =>
                    <tr key={i}>{row.map((v,j)=><td key={j} className="border-ui border-b px-3 py-2">{String(v ?? "")}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      {clean && (
        <div>
          <div className="surface-2 grid grid-cols-2 gap-3 rounded-xl p-4 text-sm">
            <div><span className="muted">清洗前</span><p className="mt-1 font-semibold">{clean.before.rows} 行 × {clean.before.cols} 列</p></div>
            <div><span className="muted">清洗后</span><p className="mt-1 font-semibold">{clean.after.rows} 行 × {clean.after.cols} 列</p></div>
          </div>
          <div className="mt-4 space-y-2">
            {clean.report?.map((r:any,i:number)=><div key={i} className="surface-2 rounded-lg px-3 py-2 text-sm">
              <span className="font-medium">{r.label}</span><span className="muted"> · {r.summary}</span>
            </div>)}
          </div>
          <button onClick={() => void onApplyClean(item)}
            className="brand-bg mt-4 rounded-xl px-4 py-2.5 text-sm font-medium text-white">
            应用并保存为新数据集
          </button>
        </div>
      )}

      {item.report && <div className="mt-5 whitespace-pre-wrap text-sm leading-7">{item.report}</div>}
    </div>
  );
}

export default function DataAgentApp() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [current, setCurrent] = useState<Dataset | null>(null);
  const [history, setHistory] = useState<AnalysisHistory[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [settingsState, setSettingsState] = useState<AppSettings>(defaultSettings);
  const [view, setView] = useState<"chat" | "preview">("chat");
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileSidebar, setMobileSidebar] = useState(false);

  const resolvedTheme = useMemo(() => {
    if (settingsState.theme !== "system") return settingsState.theme;
    if (typeof window === "undefined") return "light";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, [settingsState.theme]);

  const updateSettings = (next: AppSettings) => {
    setSettingsState(next);
    saveSettings(next);
    applyTheme(next.theme);
    if (next.model) setModel(next.model);
  };

  const refreshDatasets = useCallback(async () => {
    const list = await listDatasets();
    setDatasets(list);
    return list;
  }, []);

  const loadModels = useCallback(async (settings: AppSettings) => {
    try {
      const list = await Cloud.models();
      setModels(list);
      const preferred = settings.model && list.some((m) => m.id === settings.model) ? settings.model : list[0]?.id || "";
      setModel(preferred);
    } catch {
      setModels([]);
    }
  }, []);

  const selectDataset = useCallback(async (meta: DatasetMeta) => {
    setBusy(true);
    try {
      const rows = await loadDatasetRows(meta.id, meta.row_count);
      const selected: Dataset = { ...meta, rows };
      setCurrent(selected);
      setHistory(await listHistory(meta.id));
      setMessages([]);
      setView("chat");
      setMobileSidebar(false);
      return selected;
    } finally { setBusy(false); }
  }, []);

  useEffect(() => {
    const settings = loadSettings();
    setSettingsState(settings);
    applyTheme(settings.theme);
    void (async () => {
      const s = await Cloud.session();
      const u = s?.user || null;
      setUser(u);
      if (u) {
        await Promise.all([refreshDatasets(), loadModels(settings)]);
      }
      setBooting(false);
    })();
  }, [loadModels, refreshDatasets]);

  const afterAuth = async (u: User) => {
    setUser(u);
    await Promise.all([refreshDatasets(), loadModels(settingsState)]);
  };

  const logout = async () => {
    await Cloud.auth.signOut();
    setUser(null); setCurrent(null); setDatasets([]); setMessages([]);
  };

  const ask = async (text?: string, datasetOverride?: Dataset) => {
    const q = (text ?? question).trim();
    const target = datasetOverride || current;
    if (!q || !target || !model || busy) return;
    setQuestion("");
    setBusy(true);
    const id = uid();
    const item: ChatItem = { id, question: q, stage: "理解问题中…" };
    setMessages((prev) => [...prev, item]);
    let streamed = "";

    const patch = (data: Partial<ChatItem>) =>
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, ...data } : m));

    try {
      const out = await Agent.analyze({
        model,
        dataset: target,
        question: q,
        prefs: settingsState,
        onStage: (stage: string) => patch({ stage }),
        onDelta: (delta: string) => { streamed += delta; patch({ report: streamed }); },
        onRestart: () => { streamed = ""; patch({ report: "" }); },
        onResult: (plan: any, payload: any, kind: string) => {
          if (kind === "clean") patch({ plan, clean: payload, task: "clean" });
          else patch({ plan, result: payload, task: "analyze" });
        },
      });
      patch({
        stage: "完成",
        report: out.report || streamed,
        plan: out.plan,
        task: out.task as "analyze" | "clean",
        ...(out.task === "clean" ? { clean: out.clean } : { result: out.result }),
      });

      if (out.task === "analyze") {
        await Cloud.db.insert("analyses", {
          dataset_id: target.id,
          question: q,
          kind: out.result.kind || "analysis",
          plan: out.plan,
          result: out.result,
          summary: (out.report || "").slice(0, 20000),
          model,
        });
        setHistory(await listHistory(target.id));
      }
    } catch (e) {
      patch({ stage: "失败", error: Cloud.errText(e) });
    } finally { setBusy(false); }
  };

  const applyClean = async (item: ChatItem) => {
    if (!item.clean || !current) return;
    const created = await Cloud.db.importDataset({
      name: `${current.name}（已清洗）`.slice(0,60),
      source: "clean",
      columns: item.clean.columns,
    }, item.clean.rows);
    if (created[0]) {
      const list = await refreshDatasets();
      const meta = list.find((d) => d.id === created[0].id) || created[0];
      await selectDataset(meta);
    }
  };

  const imported = async (dataset: DatasetMeta) => {
    const list = await refreshDatasets();
    const meta = list.find((d) => d.id === dataset.id) || dataset;
    const selected = await selectDataset(meta);
    if (settingsState.autoAnalyze && selected) {
      await ask("给我一份这份数据的整体概览", selected);
    }
  };

  const removeDataset = async () => {
    if (!current) return;
    if (settingsState.confirmDelete && !window.confirm(`确定删除「${current.name}」？该操作无法恢复。`)) return;
    await Cloud.db.remove("datasets", { id: current.id });
    setCurrent(null); setHistory([]); setMessages([]);
    await refreshDatasets();
  };

  const loadHistoryItem = (h: AnalysisHistory) => {
    setMessages((prev) => [...prev, {
      id: uid(), question: h.question, plan: h.plan,
      result: h.result, report: h.summary || "", task: "analyze", stage: fmtDate(h.created_at),
    }]);
    setView("chat");
  };

  if (booting) return <div className="min-h-screen grid place-items-center muted">正在启动 Data Agent…</div>;
  if (!user) return <AuthView onAuthed={afterAuth}/>;

  const Sidebar = () => (
    <aside className="surface flex h-full w-72 shrink-0 flex-col border-r">
      <div className="border-ui flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2 font-semibold"><Database size={17} className="brand"/>数据集</div>
        <button onClick={() => setImportOpen(true)} className="brand-soft brand rounded-lg p-2" title="新建数据集"><Plus size={17}/></button>
      </div>
      <div className="pretty-scrollbar flex-1 overflow-auto p-3">
        {!datasets.length && <p className="muted px-2 py-8 text-center text-sm">还没有数据集</p>}
        <div className="space-y-1">
          {datasets.map((d) => (
            <button key={d.id} onClick={() => void selectDataset(d)}
              className={`w-full rounded-xl px-3 py-3 text-left transition ${current?.id === d.id ? "brand-soft" : "hover:surface-2"}`}>
              <p className="truncate text-sm font-medium">{d.name}</p>
              <p className="muted mt-1 text-xs">{d.row_count.toLocaleString()} 行 · {d.columns?.length || 0} 字段</p>
            </button>
          ))}
        </div>

        {current && (
          <div className="mt-6">
            <p className="muted mb-2 px-2 text-xs font-medium uppercase tracking-wider">分析历史</p>
            <div className="space-y-1">
              {history.map((h) => <button key={h.id} onClick={() => loadHistoryItem(h)}
                className="w-full rounded-lg px-2 py-2 text-left hover:surface-2">
                <p className="truncate text-xs">{h.question}</p>
                <p className="muted mt-1 text-[11px]">{fmtDate(h.created_at)}</p>
              </button>)}
            </div>
          </div>
        )}
      </div>
      <div className="border-ui border-t p-3">
        <button onClick={() => setSettingsOpen(true)} className="muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:surface-2">
          <Settings size={16}/>设置
        </button>
      </div>
    </aside>
  );

  return (
    <div className="h-screen overflow-hidden">
      <header className="surface border-ui flex h-16 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <button className="lg:hidden muted rounded-lg p-2 hover:surface-2" onClick={() => setMobileSidebar(true)}><Menu size={20}/></button>
          <div className="brand-bg grid size-9 place-items-center rounded-xl text-white"><BarChart3 size={19}/></div>
          <div><p className="font-semibold">Data Agent</p><p className="muted text-[11px]">Next.js + Hono</p></div>
        </div>

        <div className="flex items-center gap-2">
          <div className="surface-2 hidden items-center gap-2 rounded-xl px-3 py-2 sm:flex">
            <Zap size={15} className="brand"/>
            <select value={model} onChange={(e) => setModel(e.target.value)} className="bg-transparent text-sm outline-none">
              {!models.length && <option value="">未配置模型</option>}
              {models.map((m) => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
            </select>
            <ChevronDown size={13} className="muted"/>
          </div>
          <button onClick={() => updateSettings({ ...settingsState, theme: resolvedTheme === "dark" ? "light" : "dark" })}
            className="muted rounded-lg p-2 hover:surface-2">{resolvedTheme === "dark" ? <Sun size={18}/> : <Moon size={18}/>}</button>
          <button onClick={() => setSettingsOpen(true)} className="muted rounded-lg p-2 hover:surface-2"><Settings size={18}/></button>
          <button onClick={() => void logout()} className="muted rounded-lg p-2 hover:surface-2" title={user.email}><LogOut size={18}/></button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-4rem)]">
        <div className="desktop-sidebar"><Sidebar/></div>
        {mobileSidebar && <div className="fixed inset-0 z-40 flex bg-black/35" onClick={() => setMobileSidebar(false)}>
          <div onClick={(e) => e.stopPropagation()}><Sidebar/></div>
        </div>}

        <main className="min-w-0 flex-1">
          {!current ? (
            <div className="grid h-full place-items-center p-6">
              <div className="max-w-xl text-center">
                <div className="brand-soft brand mx-auto grid size-16 place-items-center rounded-2xl"><Table2 size={30}/></div>
                <h1 className="mt-5 text-2xl font-semibold">从一份数据开始</h1>
                <p className="muted mt-2">上传 CSV、Excel、Stata 或直接载入示例数据，然后用自然语言完成分析、出图和数据清洗。</p>
                <button onClick={() => setImportOpen(true)} className="brand-bg mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-3 font-medium text-white">
                  <Upload size={17}/>新建数据集
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="surface border-ui flex items-center justify-between border-b px-5 py-4">
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold">{current.name}</h1>
                  <p className="muted mt-1 text-xs">{current.row_count.toLocaleString()} 行 · {current.columns.length} 个字段 · {current.source}</p>
                </div>
                <button onClick={() => void removeDataset()} className="muted rounded-lg p-2 hover:bg-red-500/10 hover:text-[var(--danger)]"><Trash2 size={17}/></button>
              </div>

              <div className="surface border-ui flex gap-1 border-b px-5">
                <button onClick={() => setView("chat")} className={`border-b-2 px-4 py-3 text-sm ${view === "chat" ? "brand border-[var(--brand)]" : "muted border-transparent"}`}>分析对话</button>
                <button onClick={() => setView("preview")} className={`border-b-2 px-4 py-3 text-sm ${view === "preview" ? "brand border-[var(--brand)]" : "muted border-transparent"}`}>数据预览</button>
              </div>

              {view === "preview" ? (
                <div className="pretty-scrollbar flex-1 overflow-auto p-5">
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {current.columns.slice(0,8).map((c) => <div key={c.name} className="surface rounded-xl border p-3">
                      <p className="truncate text-sm font-medium">{c.name}</p><p className="muted mt-1 text-xs">{c.type} · {c.unique ?? "—"} 个取值</p>
                    </div>)}
                  </div>
                  <div className="surface pretty-scrollbar max-h-[calc(100vh-16rem)] overflow-auto rounded-2xl border">
                    <table className="min-w-full text-sm">
                      <thead className="surface-2 sticky top-0"><tr>{current.columns.map((c) => <th key={c.name} className="border-ui whitespace-nowrap border-b px-3 py-2.5 text-left font-medium">{c.name}</th>)}</tr></thead>
                      <tbody>{current.rows.slice(0,100).map((row,i)=><tr key={i}>{current.columns.map((c)=><td key={c.name} className="border-ui max-w-64 truncate border-b px-3 py-2">{String(row[c.name] ?? "")}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                  <p className="muted mt-3 text-xs">预览前 100 行；分析时使用完整 {current.rows.length.toLocaleString()} 行。</p>
                </div>
              ) : (
                <>
                  <div className="pretty-scrollbar flex-1 overflow-auto px-4 py-5 sm:px-6">
                    <div className="mx-auto max-w-5xl space-y-4">
                      {!messages.length && (
                        <div className="py-10 text-center">
                          <Sparkles className="brand mx-auto" size={28}/>
                          <h2 className="mt-3 font-semibold">想从这份数据知道什么？</h2>
                          <div className="mt-5 flex flex-wrap justify-center gap-2">
                            {quickQuestions.map((q) => <button key={q} onClick={() => void ask(q)}
                              className="surface border-ui rounded-full border px-3 py-2 text-xs hover:brand-soft">{q}</button>)}
                          </div>
                        </div>
                      )}

                      {messages.map((item) => <div key={item.id}>
                        <div className="mb-3 flex justify-end"><div className="brand-bg max-w-[85%] rounded-2xl rounded-br-md px-4 py-3 text-sm text-white">{item.question}</div></div>
                        <ResultCard item={item} theme={resolvedTheme} onApplyClean={applyClean}/>
                      </div>)}
                    </div>
                  </div>

                  <div className="surface border-ui border-t p-4">
                    <div className="surface-2 border-ui mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border p-2 shadow-sm">
                      <textarea value={question} onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }}
                        rows={2} placeholder="输入问题，例如：按渠道比较销售额并解释差异"
                        className="max-h-36 min-h-12 flex-1 resize-none bg-transparent px-3 py-2 outline-none"/>
                      <button disabled={busy || !model || !question.trim()} onClick={() => void ask()}
                        className="brand-bg grid size-11 shrink-0 place-items-center rounded-xl text-white disabled:opacity-40"><Send size={18}/></button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImported={imported}/>}
      {settingsOpen && <SettingsDialog settings={settingsState} onChange={updateSettings} models={models} onClose={() => setSettingsOpen(false)}/>}
    </div>
  );
}
