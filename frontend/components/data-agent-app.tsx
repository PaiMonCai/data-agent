"use client";

import {
  BarChart3, ChevronDown, LogOut, Menu, Moon, Send, Settings, Shield, Sun, Table2, Trash2, Upload, Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthView from "@/features/auth/components/auth-view";
import ImportDialog from "@/features/datasets/components/import-dialog";
import Sidebar from "@/features/datasets/components/dataset-sidebar";
import SettingsDialog from "@/features/settings/components/settings-dialog";
import ChatMessageList from "@/features/chat/components/chat-message-list";
import type { ChatItem } from "@/features/chat/model/chat-item";
import { useChat } from "@/features/chat/hooks/use-chat";
import { Cloud, listDatasets, listHistory, loadDatasetRows } from "@/lib/api";
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

  const refreshDatasets = useCallback(async () => {
    const list = await listDatasets();
    setDatasets(list);
    return list;
  }, []);

  const refreshHistory = useCallback(async (datasetId: string) => {
    setHistory(await listHistory(datasetId));
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

  const chat = useChat({
    model,
    dataset: current,
    prefs: settingsState,
    onHistoryChanged: refreshHistory,
  });
  const { messages, question, setQuestion, busy, setBusy, ask, appendHistory, reset } = chat;

  const onHistory = useCallback((h: AnalysisHistory) => {
    appendHistory(h);
    setView("chat");
  }, [appendHistory]);

  const askAndShow = useCallback((text?: string, datasetOverride?: Dataset) => {
    setView("chat");
    return ask(text, datasetOverride);
  }, [ask]);

  const selectDataset = useCallback(async (meta: DatasetMeta) => {
    setBusy(true);
    try {
      const rows = await loadDatasetRows(meta.id, meta.row_count);
      const selected: Dataset = { ...meta, rows };
      setCurrent(selected);
      setHistory(await listHistory(meta.id));
      reset();
      setView("chat");
      setMobileSidebar(false);
      return selected;
    } finally { setBusy(false); }
  }, [reset, setBusy]);

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
    setUser(null); setCurrent(null); setDatasets([]); setHistory([]);
    reset();
  };

  const applyClean = useCallback(async (item: ChatItem) => {
    if (!item.clean || !current) return;
    const created = await Cloud.db.importDataset({
      name: `${current.name}（已清洗）`.slice(0, 60),
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
      await askAndShow("给我一份这份数据的整体概览", selected);
    }
  };

  const removeDataset = async () => {
    if (!current) return;
    if (settingsState.confirmDelete && !window.confirm(`确定删除「${current.name}」？该操作无法恢复。`)) return;
    await Cloud.db.remove("datasets", { id: current.id });
    setCurrent(null); setHistory([]);
    reset();
    await refreshDatasets();
  };

  const sidebarProps = useMemo(() => ({
    datasets,
    currentId: current?.id ?? null,
    history,
    onSelect: selectDataset,
    onCreate: openImport,
    onOpenSettings: openSettings,
    onHistory,
  }), [datasets, current?.id, history, selectDataset, openImport, openSettings, onHistory]);

  if (booting) return <div className="min-h-screen grid place-items-center muted">正在启动 Data Agent…</div>;
  if (!user) return <AuthView onAuthed={afterAuth}/>;

  return (
    <div className="h-screen overflow-hidden">
      <header className="surface border-ui flex h-16 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setMobileSidebar(true)} aria-label="打开数据集列表"
            className="lg:hidden muted rounded-lg p-2 hover:surface-2"><Menu size={20}/></button>
          <div className="brand-bg grid size-9 place-items-center rounded-xl text-white"><BarChart3 size={19}/></div>
          <div><p className="font-semibold">Data Agent</p><p className="muted text-[11px]">Next.js + Hono</p></div>
        </div>

        <div className="flex items-center gap-2">
          <div className="surface-2 hidden items-center gap-2 rounded-xl px-3 py-2 sm:flex">
            <Zap size={15} className="brand"/>
            <label className="sr-only" htmlFor="model-select">选择模型</label>
            <select id="model-select" value={model} onChange={(e) => setModel(e.target.value)} className="bg-transparent text-sm outline-none">
              {!models.length && <option value="">未配置模型</option>}
              {models.map((m) => <option key={m.id} value={m.id}>{m.provider ? `${m.provider} · ${m.name || m.id}` : (m.name || m.id)}</option>)}
            </select>
            <ChevronDown size={13} className="muted"/>
          </div>
          <button onClick={() => updateSettings({ ...settingsState, theme: resolvedTheme === "dark" ? "light" : "dark" })}
            aria-label={resolvedTheme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            className="muted rounded-lg p-2 hover:surface-2">{resolvedTheme === "dark" ? <Sun size={18}/> : <Moon size={18}/>}</button>
          <button onClick={() => setSettingsOpen(true)} aria-label="打开设置"
            className="muted rounded-lg p-2 hover:surface-2"><Settings size={18}/></button>
          {user.role === "admin" && (
            <a href="/admin/" aria-label="打开管理中心" title="管理中心"
              className="muted rounded-lg p-2 hover:surface-2"><Shield size={18}/></a>
          )}
          <button onClick={() => void logout()} aria-label="退出登录" title={user.email}
            className="muted rounded-lg p-2 hover:surface-2"><LogOut size={18}/></button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-4rem)]">
        <div className="desktop-sidebar"><Sidebar {...sidebarProps}/></div>
        {mobileSidebar && (
          <div className="fixed inset-0 z-40 flex bg-black/35" onClick={closeMobileSidebar} role="presentation">
            <div className="fixed inset-y-0 left-0" role="dialog" aria-label="数据集列表"
              onClick={(e) => e.stopPropagation()}>
              <Sidebar {...sidebarProps}/>
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1">
          {!current ? (
            <div className="grid h-full place-items-center p-6">
              <div className="max-w-xl text-center">
                <div className="brand-soft brand mx-auto grid size-16 place-items-center rounded-2xl"><Table2 size={30}/></div>
                <h1 className="mt-5 text-2xl font-semibold">从一份数据开始</h1>
                <p className="muted mt-2">上传 CSV、Excel、Stata 或直接载入示例数据，然后用自然语言完成分析、出图和数据清洗。</p>
                <button onClick={openImport} className="brand-bg mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-3 font-medium text-white">
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
                <button onClick={() => void removeDataset()} aria-label={`删除数据集 ${current.name}`}
                  className="muted rounded-lg p-2 hover:bg-red-500/10 hover:text-[var(--danger)]"><Trash2 size={17}/></button>
              </div>

              <div className="surface border-ui flex gap-1 border-b px-5" role="tablist" aria-label="数据集视图">
                <button role="tab" aria-selected={view === "chat"} onClick={() => setView("chat")}
                  className={`border-b-2 px-4 py-3 text-sm ${view === "chat" ? "brand border-[var(--brand)]" : "muted border-transparent"}`}>分析对话</button>
                <button role="tab" aria-selected={view === "preview"} onClick={() => setView("preview")}
                  className={`border-b-2 px-4 py-3 text-sm ${view === "preview" ? "brand border-[var(--brand)]" : "muted border-transparent"}`}>数据预览</button>
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
                      <caption className="sr-only">{current.name} 前 100 行预览</caption>
                      <thead className="surface-2 sticky top-0"><tr>{current.columns.map((c) => <th key={c.name} scope="col" className="border-ui whitespace-nowrap border-b px-3 py-2.5 text-left font-medium">{c.name}</th>)}</tr></thead>
                      <tbody>{current.rows.slice(0,100).map((row,i)=><tr key={i}>{current.columns.map((c)=><td key={c.name} className="border-ui max-w-64 truncate border-b px-3 py-2">{String(row[c.name] ?? "")}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                  <p className="muted mt-3 text-xs">预览前 100 行；分析时使用完整 {current.rows.length.toLocaleString()} 行。</p>
                </div>
              ) : (
                <>
                  <ChatMessageList
                    messages={messages}
                    theme={resolvedTheme}
                    busy={busy}
                    onAsk={(q) => void askAndShow(q)}
                    onApplyClean={applyClean}
                    onRetry={(item) => void ask(item.question)}
                  />

                  <div className="surface border-ui border-t p-4">
                    <div className="surface-2 border-ui mx-auto flex max-w-4xl items-end gap-2 rounded-2xl border p-2 shadow-sm">
                      <label className="sr-only" htmlFor="question-input">输入你的问题</label>
                      <textarea id="question-input" value={question} onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void askAndShow(); } }}
                        rows={2} placeholder="输入问题，例如：按渠道比较销售额并解释差异"
                        className="max-h-36 min-h-12 flex-1 resize-none bg-transparent px-3 py-2 outline-none"/>
                      <button disabled={busy || !model || !question.trim()} onClick={() => void askAndShow()}
                        aria-label="发送问题"
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
