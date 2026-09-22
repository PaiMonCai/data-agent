"use client";

import {
  BarChart3, ChevronDown, LogOut, Menu, Moon, Send, Settings, Sun, Table2, Trash2, Upload, Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthView from "@/features/auth/components/auth-view";
import ImportDialog from "@/features/datasets/components/import-dialog";
import Sidebar from "@/features/datasets/components/dataset-sidebar";
import SettingsDialog from "@/features/settings/components/settings-dialog";
import ChatMessageList from "@/features/chat/components/chat-message-list";
import { uid } from "@/features/auth/lib/uid";
import type { AnalysisOutcome, ChatItem } from "@/features/chat/model/chat-item";
import { Agent } from "@/lib/agent";
import { Cloud, listDatasets, listHistory, loadDatasetRows } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { applyTheme, defaultSettings, loadSettings, saveSettings } from "@/lib/settings";
import type {
  AnalysisHistory, AppSettings, Dataset, DatasetMeta, ModelInfo, User
} from "@/lib/types";

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

  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = useMemo(
    () => (settingsState.theme === "system" ? (systemDark ? "dark" : "light") : settingsState.theme),
    [settingsState.theme, systemDark]
  );

  const updateSettings = useCallback((next: AppSettings) => {
    setSettingsState(next);
    saveSettings(next);
    applyTheme(next.theme);
    if (next.model) setModel(next.model);
  }, []);

  const openImport = useCallback(() => setImportOpen(true), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileSidebar(false), []);

  const loadHistoryItem = useCallback((h: AnalysisHistory) => {
    setMessages((prev) => [...prev, {
      id: uid(), question: h.question, plan: h.plan,
      result: h.result, report: h.summary || "", task: "analyze" as const, stage: fmtDate(h.created_at),
    }]);
    setView("chat");
  }, []);

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
    const item: ChatItem = { id, question: q, stage: "çè§£é®é¢ä¸­â¦" };
    setMessages((prev) => [...prev, item]);
    let streamed = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const patch = (data: Partial<ChatItem>) =>
      setMessages((prev) => prev.map((m) => m.id === id ? { ...m, ...data } : m));

    // æµå¼åçå¾å¯ï¼æ ~60ms åå¹¶æäº¤ï¼é¿åæ¯ä¸ªåçé½éæ¸²ææ´æ£µåºç¨æ 
    const flush = () => {
      flushTimer = null;
      patch({ report: streamed });
    };

    try {
      const out = (await Agent.analyze({
        model,
        dataset: target,
        question: q,
        prefs: settingsState,
        onStage: (stage: string) => patch({ stage }),
        onDelta: (delta: string) => {
          streamed += delta;
          if (flushTimer === null) flushTimer = setTimeout(flush, 60);
        },
        onRestart: () => { streamed = ""; patch({ report: "" }); },
        onResult: (plan: any, payload: any, kind: string) => {
          if (kind === "clean") patch({ plan, clean: payload, task: "clean" });
          else patch({ plan, result: payload, task: "analyze" });
        },
      })) as AnalysisOutcome;
      patch({
        stage: "å®æ",
        report: out.report || streamed,
        plan: out.plan,
        task: out.task,
        ...(out.task === "clean" ? { clean: out.clean } : { result: out.result }),
      });

      if (out.task === "analyze" && out.result) {
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
      if (streamed) patch({ report: streamed });
      patch({ stage: "å¤±è´¥", error: Cloud.errText(e) });
    } finally {
      if (flushTimer !== null) clearTimeout(flushTimer);
      setBusy(false);
    }
  };

  const sidebarProps = useMemo(() => ({
    datasets,
    currentId: current?.id ?? null,
    history,
    onSelect: selectDataset,
    onCreate: openImport,
    onOpenSettings: openSettings,
    onHistory: loadHistoryItem,
  }), [datasets, current?.id, history, selectDataset, openImport, openSettings, loadHistoryItem]);

  const applyClean = useCallback(async (item: ChatItem) => {
    if (!item.clean || !current) return;
    const created = await Cloud.db.importDataset({
      name: `${current.name}ï¼å·²æ¸æ´ï¼`.slice(0,60),
      source: "clean",
      columns: item.clean.columns,
    }, item.clean.rows);
    if (created[0]) {
      const list = await refreshDatasets();
      const meta = list.find((d) => d.id === created[0].id) || created[0];
      await selectDataset(meta);
    }
  }, [current, refreshDatasets, selectDataset]);

  const imported = async (dataset: DatasetMeta) => {
    const list = await refreshDatasets();
    const meta = list.find((d) => d.id === dataset.id) || dataset;
    const selected = await selectDataset(meta);
    if (settingsState.autoAnalyze && selected) {
      await ask("ç»æä¸ä»½è¿ä»½æ°æ®çæ´ä½æ¦è§", selected);
    }
  };

  const removeDataset = async () => {
    if (!current) return;
    if (settingsState.confirmDelete && !window.confirm(`ç¡®å®å é¤ã${current.name}ãï¼è¯¥æä½æ æ³æ¢å¤ã`)) return;
    await Cloud.db.remove("datasets", { id: current.id });
    setCurrent(null); setHistory([]); setMessages([]);
    await refreshDatasets();
  };

  if (booting) return <div className="min-h-screen grid place-items-center muted">æ­£å¨å¯å¨ Data Agentâ¦</div>;
  if (!user) return <AuthView onAuthed={afterAuth}/>;

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
              {!models.length && <option value="">æªéç½®æ¨¡å</option>}
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
        <div className="desktop-sidebar"><Sidebar {...sidebarProps}/></div>
        {mobileSidebar && <div className="fixed inset-0 z-40 flex bg-black/35" onClick={closeMobileSidebar}>
          <div onClick={(e) => e.stopPropagation()}><Sidebar {...sidebarProps}/></div>
        </div>}

        <main className="min-w-0 flex-1">
          {!current ? (
            <div className="grid h-full place-items-center p-6">
              <div className="max-w-xl text-center">
                <div className="brand-soft brand mx-auto grid size-16 place-items-center rounded-2xl"><Table2 size={30}/></div>
                <h1 className="mt-5 text-2xl font-semibold">ä»ä¸ä»½æ°æ®å¼å§</h1>
                <p className="muted mt-2">ä¸ä¼  CSVãExcelãStata æç´æ¥è½½å¥ç¤ºä¾æ°æ®ï¼ç¶åç¨èªç¶è¯­è¨å®æåæãåºå¾åæ°æ®æ¸æ´ã</p>
                <button onClick={() => setImportOpen(true)} className="brand-bg mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-3 font-medium text-white">
                  <Upload size={17}/>æ°å»ºæ°æ®é
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div className="surface border-ui flex items-center justify-between border-b px-5 py-4">
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold">{current.name}</h1>
                  <p className="muted mt-1 text-xs">{current.row_count.toLocaleString()} è¡ Â· {current.columns.length} ä¸ªå­æ®µ Â· {current.source}</p>
                </div>
                <button onClick={() => void removeDataset()} className="muted rounded-lg p-2 hover:bg-red-500/10 hover:text-[var(--danger)]"><Trash2 size={17}/></button>
              </div>

              <div className="surface border-ui flex gap-1 border-b px-5">
                <button onClick={() => setView("chat")} className={`border-b-2 px-4 py-3 text-sm ${view === "chat" ? "brand border-[var(--brand)]" : "muted border-transparent"}`}>åæå¯¹è¯</button>
                <button onClick={() => setView("preview")} className={`border-b-2 px-4 py-3 text-sm ${view === "preview" ? "brand border-[var(--brand)]" : "muted border-transparent"}`}>æ°æ®é¢è§</button>
              </div>

              {view === "preview" ? (
                <div className="pretty-scrollbar flex-1 overflow-auto p-5">
                  <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {current.columns.slice(0,8).map((c) => <div key={c.name} className="surface rounded-xl border p-3">
                      <p className="truncate text-sm font-medium">{c.name}</p><p className="muted mt-1 text-xs">{c.type} Â· {c.unique ?? "â"} ä¸ªåå¼</p>
                    </div>)}
                  </div>
                  <div className="surface pretty-scrollbar max-h-[calc(100vh-16rem)] overflow-auto rounded-2xl border">
                    <table className="min-w-full text-sm">
                      <thead className="surface-2 sticky top-0"><tr>{current.columns.map((c) => <th key={c.name} className="border-ui whitespace-nowrap border-b px-3 py-2.5 text-left font-medium">{c.name}</th>)}</tr></thead>
                      <tbody>{current.rows.slice(0,100).map((row,i)=><tr key={i}>{current.columns.map((c)=><td key={c.name} className="border-ui max-w-64 truncate border-b px-3 py-2">{String(row[c.name] ?? "")}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                  <p className="muted mt-3 text-xs">é¢è§å 100 è¡ï¼åææ¶ä½¿ç¨å®æ´ {current.rows.length.toLocaleString()} è¡ã</p>
                </div>
              ) : (
                <ChatMessageList
                  messages={messages}
                  theme={resolvedTheme}
                  busy={busy}
                  onAsk={(q) => void ask(q)}
                  onApplyClean={applyClean}
                  onRetry={(item) => void ask(item.question)}
                />

                <div className="surface border-ui border-t p-4">
                  <div className="surface-2 border-ui mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border p-2 shadow-sm">
                    <textarea value={question} onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }}
                      rows={2} placeholder="è¾å¥é®é¢ï¼ä¾å¦ï¼ææ¸ éæ¯è¾éå®é¢å¹¶è§£éå·®å¼"
                      className="max-h-36 min-h-12 flex-1 resize-none bg-transparent px-3 py-2 outline-none"/>
                    <button disabled={busy || !model || !question.trim()} onClick={() => void ask()}
                      className="brand-bg grid size-11 shrink-0 place-items-center rounded-xl text-white disabled:opacity-40"><Send size={18}/></button>
                  </div>
                </div>
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
