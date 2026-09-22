"use client";

import { Database, Plus, Settings } from "lucide-react";
import { fmtDate } from "@/lib/format";
import type { AnalysisHistory, DatasetMeta } from "@/lib/types";

export interface SidebarProps {
  datasets: DatasetMeta[];
  currentId: string | null;
  history: AnalysisHistory[];
  onSelect: (dataset: DatasetMeta) => void;
  onCreate: () => void;
  onOpenSettings: () => void;
  onHistory: (item: AnalysisHistory) => void;
}

export default function Sidebar({
  datasets,
  currentId,
  history,
  onSelect,
  onCreate,
  onOpenSettings,
  onHistory,
}: SidebarProps) {
  return (
    <aside className="surface flex h-full w-72 shrink-0 flex-col border-r">
      <div className="border-ui flex items-center justify-between border-b p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Database size={17} className="brand" />数据集
        </div>
        <button onClick={onCreate} className="brand-soft brand rounded-lg p-2" title="新建数据集">
          <Plus size={17} />
        </button>
      </div>
      <div className="pretty-scrollbar flex-1 overflow-auto p-3">
        {!datasets.length && <p className="muted px-2 py-8 text-center text-sm">还没有数据集</p>}
        <div className="space-y-1">
          {datasets.map((d) => (
            <button key={d.id} onClick={() => onSelect(d)}
              className={`w-full rounded-xl px-3 py-3 text-left transition ${currentId === d.id ? "brand-soft" : "hover:surface-2"}`}>
              <p className="truncate text-sm font-medium">{d.name}</p>
              <p className="muted mt-1 text-xs">{d.row_count.toLocaleString()} 行 · {d.columns?.length || 0} 字段</p>
            </button>
          ))}
        </div>

        {currentId && (
          <div className="mt-6">
            <p className="muted mb-2 px-2 text-xs font-medium uppercase tracking-wider">分析历史</p>
            <div className="space-y-1">
              {history.map((h) => (
                <button key={h.id} onClick={() => onHistory(h)}
                  className="w-full rounded-lg px-2 py-2 text-left hover:surface-2">
                  <p className="truncate text-xs">{h.question}</p>
                  <p className="muted mt-1 text-[11px]">{fmtDate(h.created_at)}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="border-ui border-t p-3">
        <button onClick={onOpenSettings} className="muted flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:surface-2">
          <Settings size={16} />设置
        </button>
      </div>
    </aside>
  );
}
