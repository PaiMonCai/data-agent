"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

/** 路由级错误边界。放在 error.tsx 里，客户端渲染出错时整页替换为这个 UI。 */
export default function Error({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[data-agent] 页面渲染出错", error);
  }, [error]);

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="surface w-full max-w-md rounded-3xl border p-7 text-center shadow-[0_24px_70px_rgba(15,23,42,.10)]">
        <div className="mx-auto grid size-11 place-items-center rounded-2xl bg-[var(--danger)]/10 text-[var(--danger)]">
          <AlertTriangle size={22} />
        </div>
        <h1 className="mt-4 text-xl font-semibold">页面出错了</h1>
        <p className="muted mt-2 text-sm">渲染过程中出现异常，数据不会丢失，重试一下通常就能恢复。</p>
        {error.digest && (
          <p className="muted mt-3 font-mono text-xs">错误编号 {error.digest}</p>
        )}
        <button onClick={reset}
          className="brand-bg mt-6 inline-flex items-center gap-2 rounded-xl px-5 py-3 font-medium text-white">
          <RotateCcw size={16} />重新加载
        </button>
      </div>
    </div>
  );
}
