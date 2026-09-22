"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { Charts } from "@/lib/charts";

export default function ChartView({ result, theme }: { result: any; theme: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !result) return;
    const chart = Charts.render(ref.current, result);
    if (!chart) return;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      const instance = echarts.getInstanceByDom(ref.current!);
      instance?.dispose();
    };
  }, [result, theme]);

  return <div ref={ref} className="chart-box" />;
}
