"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uid } from "@/features/auth/lib/uid";
import type { AnalysisOutcome, ChatItem } from "@/features/chat/model/chat-item";
import { Agent } from "@/lib/agent";
import { Cloud } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { AnalysisHistory, AppSettings, Dataset } from "@/lib/types";

/** 流式分片很密，按 ~60ms 合并提交，避免每个分片都重渲染一次消息列表 */
const FLUSH_MS = 60;

/** 历史摘要入库上限，和后端列长度保持一致，避免超长文本写库失败 */
const SUMMARY_LIMIT = 20000;

export interface UseChatOptions {
  model: string;
  dataset: Dataset | null;
  prefs: AppSettings;
  /** 分析结果写入历史表后回调，用来刷新侧边栏的历史列表 */
  onHistoryChanged?: (datasetId: string) => void | Promise<void>;
}

/**
 * 会话状态机：消息列表、输入框、忙态，以及一次完整的提问流程
 * （建消息 -> 流式收结论 -> 落地结果 -> 落库 -> 回调刷新历史）。
 */
export function useChat({ model, dataset, prefs, onHistoryChanged }: UseChatOptions) {
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 流式中途卸载组件时，残留的定时器要把已经收到的内容落一次再走
  useEffect(() => () => {
    if (flushTimer.current !== null) clearTimeout(flushTimer.current);
    flushTimer.current = null;
  }, []);

  const patch = useCallback((id: string, data: Partial<ChatItem>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...data } : m)));
  }, []);

  const ask = useCallback(async (text?: string, datasetOverride?: Dataset) => {
    const q = (text ?? question).trim();
    const target = datasetOverride || dataset;
    if (!q || !target || !model || busy) return;

    setQuestion("");
    setBusy(true);
    const id = uid();
    let streamed = "";
    setMessages((prev) => [...prev, { id, question: q, stage: "理解问题中…" }]);

    const flush = () => {
      flushTimer.current = null;
      patch(id, { report: streamed });
    };

    try {
      const out = (await Agent.analyze({
        model,
        dataset: target,
        question: q,
        prefs,
        onStage: (stage: string) => patch(id, { stage }),
        onDelta: (delta: string) => {
          streamed += delta;
          if (flushTimer.current === null) flushTimer.current = setTimeout(flush, FLUSH_MS);
        },
        onRestart: () => { streamed = ""; patch(id, { report: "" }); },
        onResult: (plan: any, payload: any, kind: string) => {
          if (kind === "clean") patch(id, { plan, clean: payload, task: "clean" });
          else patch(id, { plan, result: payload, task: "analyze" });
        },
      })) as AnalysisOutcome;

      patch(id, {
        stage: "完成",
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
          summary: (out.report || "").slice(0, SUMMARY_LIMIT),
          model,
        });
        await onHistoryChanged?.(target.id);
      }
    } catch (e) {
      // 已经流回来的部分先留住，再标记失败，避免用户什么都看不到
      if (streamed) patch(id, { report: streamed });
      patch(id, { stage: "失败", error: Cloud.errText(e) });
    } finally {
      if (flushTimer.current !== null) clearTimeout(flushTimer.current);
      flushTimer.current = null;
      setBusy(false);
    }
  }, [busy, dataset, model, onHistoryChanged, patch, prefs, question]);

  /** 把一条历史分析作为一条新消息追加进当前会话 */
  const appendHistory = useCallback((h: AnalysisHistory) => {
    setMessages((prev) => [...prev, {
      id: uid(),
      question: h.question,
      plan: h.plan,
      result: h.result,
      report: h.summary || "",
      task: "analyze" as const,
      stage: fmtDate(h.created_at),
    }]);
  }, []);

  const reset = useCallback(() => {
    if (flushTimer.current !== null) clearTimeout(flushTimer.current);
    flushTimer.current = null;
    setMessages([]);
    setQuestion("");
  }, []);

  return { messages, question, setQuestion, busy, setBusy, ask, appendHistory, reset };
}

export default useChat;
