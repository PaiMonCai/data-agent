"use client";

import { ArrowDown, Sparkles } from "lucide-react";
import ResultCard from "@/features/chat/components/result-card";
import { useStickToBottom } from "@/features/chat/hooks/use-stick-to-bottom";
import type { ChatItem } from "@/features/chat/model/chat-item";
import { quickQuestions } from "@/features/chat/model/quick-questions";

export default function ChatMessageList({
  messages,
  theme,
  busy,
  onAsk,
  onApplyClean,
  onRetry,
}: {
  messages: ChatItem[];
  theme: string;
  busy: boolean;
  onAsk: (question: string) => void;
  onApplyClean: (item: ChatItem) => Promise<void>;
  onRetry: (item: ChatItem) => void;
}) {
  const { ref, atBottom, scrollToEnd } = useStickToBottom<HTMLDivElement>();

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={ref} className="pretty-scrollbar h-full overflow-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-4">
          {!messages.length && (
            <div className="py-10 text-center">
              <Sparkles className="brand mx-auto" size={28} />
              <h2 className="mt-3 font-semibold">æ³ä»è¿ä»½æ°æ®ç¥éä»ä¹ï¼</h2>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {quickQuestions.map((q) => (
                  <button key={q} onClick={() => onAsk(q)} disabled={busy}
                    className="surface border-ui rounded-full border px-3 py-2 text-xs hover:brand-soft disabled:opacity-50">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((item) => (
            <div key={item.id}>
              <div className="mb-3 flex justify-end">
                <div className="brand-bg max-w-[85%] rounded-2xl rounded-br-md px-4 py-3 text-sm text-white">
                  {item.question}
                </div>
              </div>
              <ResultCard item={item} theme={theme} onApplyClean={onApplyClean} onRetry={onRetry} />
            </div>
          ))}
        </div>
      </div>

      {!atBottom && (
        <button onClick={() => scrollToEnd()} title="åå°åºé¨"
          className="surface border-ui absolute bottom-4 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border shadow-lg">
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}
