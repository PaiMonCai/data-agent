"use client";

import { BarChart3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { Charts } from "@/lib/charts";
import type { AnalysisResult } from "@/features/chat/model/chat-item";

export default function ChartView({ result, theme }: { result: AnalysisResult | null | undefined; theme: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!ref.current || !result) return;
    const chart = Charts.render(ref.current, result);
    setRendered(Boolean(chart));
    if (!chart) return;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      const instance = echarts.getInstanceByDom(ref.current!);
      instance?.dispose();
    };
  }, [result, theme]);

  return (
    <div className="relative">
      <div ref={ref} className="chart-box" />
      {!rendered && (
        <div className="chart-empty surface-2 rounded-xl border border-ui">
          <BarChart3 size={18} className="muted" />
          <span className="muted">è¯¥ç»æä»¥è¡¨æ ¼åç°ï¼å±å¼ä¸æ¹æç»æ¥ç</span>
        </div>
      )}
    </div>
  );
}
