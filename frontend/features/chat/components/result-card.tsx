"use client";

import { AlertTriangle, Check, Copy, RotateCcw, Sparkles } from "lucide-react";
import { memo, useState } from "react";
import dynamic from "next/dynamic";
import MarkdownView from "@/components/markdown-view";
import type { ChatItem } from "@/features/chat/model/chat-item";

// echarts ä½ç§¯å¾å¤§ï¼æéæå è½½ï¼é¿åé¦å±å°±è¦ä¸è½½æ´ä¸ªå¾è¡¨åº
const ChartView = dynamic(() => import("@/components/chart-view"), { ssr: false });

const ResultCard = memo(function ResultCard({ item, theme, onApplyClean, onRetry }: {
  item: ChatItem; theme: string; onApplyClean: (item: ChatItem) => Promise<void>; onRetry?: (item: ChatItem) => void;
}) {
  const result = item.result;
  const clean = item.clean;
  const table = result?.table;
  const [copied, setCopied] = useState(false);

  const copyReport = async () => {
    if (!item.report) return;
    try {
      await navigator.clipboard.writeText(item.report);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="surface fade-in rounded-2xl border p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="brand-soft brand grid size-8 place-items-center rounded-lg"><Sparkles size={16}/></div>
          <div>
            <p className="font-medium">{item.plan?.title || (item.task === "clean" ? "æ°æ®æ¸æ´" : "åæç»æ")}</p>
            {item.stage && <p className="muted mt-0.5 text-xs">{item.stage}</p>}
          </div>
        </div>
        {item.error && <AlertTriangle size={18} className="text-[var(--danger)]"/>}
      </div>

      {item.error && (
        <div className="mt-1">
          <p className="text-sm text-[var(--danger)]">{item.error}</p>
          {onRetry && (
            <button onClick={() => onRetry(item)}
              className="surface-2 border-ui mt-3 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs hover:brand-soft">
              <RotateCcw size={13}/>éè¯
            </button>
          )}
        </div>
      )}

      {result && (
        <>
          <ChartView result={result} theme={theme}/>
          {table && table.rows.length > 0 && (
            <details className="mt-4">
              <summary className="muted cursor-pointer text-sm">æ¥çè®¡ç®æç»</summary>
              <div className="pretty-scrollbar mt-3 max-h-72 overflow-auto rounded-xl border border-ui">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="surface-2 sticky top-0">
                    <tr>{table.headers.map((h: string) => <th key={h} className="border-ui border-b px-3 py-2 text-left font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>{table.rows.slice(0,100).map((row: unknown[], i:number) =>
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
            <div><span className="muted">æ¸æ´å</span><p className="mt-1 font-semibold">{clean.before.rows} è¡ Ã {clean.before.cols} å</p></div>
            <div><span className="muted">æ¸æ´å</span><p className="mt-1 font-semibold">{clean.after.rows} è¡ Ã {clean.after.cols} å</p></div>
          </div>
          <div className="mt-4 space-y-2">
            {clean.report?.map((r:any,i:number)=><div key={i} className="surface-2 rounded-lg px-3 py-2 text-sm">
              <span className="font-medium">{r.label}</span><span className="muted"> Â· {r.summary}</span>
            </div>)}
          </div>
          <button onClick={() => void onApplyClean(item)}
            className="brand-bg mt-4 rounded-xl px-4 py-2.5 text-sm font-medium text-white">
            åºç¨å¹¶ä¿å­ä¸ºæ°æ°æ®é
          </button>
        </div>
      )}

      {item.report && (
        <div className="border-ui mt-5 border-t pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="muted text-xs font-medium">åæç»è®º</span>
            <button onClick={() => void copyReport()} title="å¤å¶ç»è®º"
              className="muted flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:surface-2">
              {copied ? <Check size={13} className="text-[var(--success)]"/> : <Copy size={13}/>}
              {copied ? "å·²å¤å¶" : "å¤å¶"}
            </button>
          </div>
          <MarkdownView content={item.report}/>
        </div>
      )}
    </div>
  );
});

export default ResultCard;
