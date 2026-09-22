import * as echarts from "echarts";
import type { ECharts, EChartsOption, SeriesOption } from "echarts";
import type { AnalysisResult, ChartKind } from "./types";

/** 主题切换后重画用：记住每个容器上一次画的结果。
    以前这份数据跟结果一起挂在 DOM 节点上（el.__result），那会把
    全局的 HTMLElement 类型写脏。改成 WeakMap 后语义不变，而且节点被回收后能自动清理。 */
const lastResult = new WeakMap<HTMLElement, AnalysisResult>();

/** 深色 / 浅色两套设计令牌 */
interface ChartTokens {
  palette: string[];
  ink: string;
  ink2: string;
  line: string;
  grid: string;
  tipBg: string;
  tipInk: string;
  tipLine: string;
  area: number;
  mark: string;
  axis: string;
  pieEdge: string;
  scatter: string;
}

/* 图表渲染：把引擎算出的结构化结果转成 ECharts 配置
   配色读取 documentElement.dataset.theme，深色模式自动换成深色版令牌 */
const Charts = (function () {
  // 与 styles.css 的设计令牌保持一致（品牌 / 成功 / 警告 / 危险 / 信息 …）
  const PALETTE = ['#5b5bd6', '#059669', '#d97706', '#dc2626', '#0284c7', '#7c3aed', '#db2777', '#65a30d'];
  const PALETTE_DARK = ['#8f8ff2', '#34d399', '#fbbf24', '#f87171', '#38bdf8', '#c084fc', '#f472b6', '#a3e635'];

  const INK = '#475569';   // 轴文字
  const INK_2 = '#64748b'; // 轴名
  const LINE = '#eceef3';  // 轴线
  const GRID = '#f3f5f9';  // 网格线

  function isDark() {
    const el = document.documentElement;
    return !!el && el.dataset.theme === 'dark';
  }

  function tokens(): ChartTokens {
    return isDark()
      ? { palette: PALETTE_DARK, ink: '#9aa5b8', ink2: '#8b95a8', line: '#2c3546', grid: '#222a37',
          tipBg: '#1b2230', tipInk: '#e7ebf3', tipLine: '#33405a', area: 0.18, mark: '#f87171',
          axis: '#5c6b85', pieEdge: '#151b26', scatter: 'rgba(143,143,242,.6)' }
      : { palette: PALETTE, ink: INK, ink2: INK_2, line: LINE, grid: GRID,
          tipBg: '#fff', tipInk: '#0f172a', tipLine: LINE, area: 0.12, mark: '#dc2626',
          axis: '#94a3b8', pieEdge: '#fff', scatter: 'rgba(91,91,214,.55)' };
  }

  function base(t: ChartTokens) {
    return {
      textStyle: { fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif' },
      grid: { left: 56, right: 28, top: 48, bottom: 60 },
      tooltip: {
        trigger: 'axis' as const, backgroundColor: t.tipBg, borderColor: t.tipLine,
        textStyle: { color: t.tipInk },
        extraCssText: 'box-shadow:0 8px 24px rgba(15,23,42,.18);border-radius:10px',
      },
      color: t.palette,
    };
  }

  function axis(t: ChartTokens, name?: string) {
    return {
      name: name || '',
      nameTextStyle: { color: t.ink2, fontSize: 11 },
      axisLine: { lineStyle: { color: t.line } },
      axisLabel: { color: t.ink2, fontSize: 11, hideOverlap: true },
      splitLine: { lineStyle: { color: t.grid, type: 'dashed' as const } },
    };
  }

  function build(result: AnalysisResult): EChartsOption | null {
    const type = (result.chart || 'bar').toLowerCase() as ChartKind;
    if (type === 'table' || !result.labels?.length) return null;
    const t = tokens();
    if (type === 'pie') return pie(t, result);
    if (type === 'scatter') return scatter(t, result);
    if (type === 'line') return line(t, result);
    return bar(t, result);
  }

  function line(t: ChartTokens, result: AnalysisResult) {
    const labels = result.labels ?? [];
    const all = result.series ?? [];
    const series: SeriesOption[] = all.map((s, i) => ({
      name: s.name,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 6,
      showSymbol: labels.length <= 40,
      data: s.data,
      lineStyle: { width: 2.4 },
      areaStyle: all.length === 1 ? { opacity: t.area, color: t.palette[i % t.palette.length] } : undefined,
      markLine: result.baseline ? {
        silent: true,
        symbol: 'none',
        lineStyle: { color: t.axis, type: 'dashed' as const },
        label: { formatter: '均值 {c}', color: t.ink2, fontSize: 11 },
        data: [{ yAxis: result.baseline.mean }],
      } : undefined,
      markPoint: result.anomalyPoints && result.anomalyPoints.length ? {
        symbol: 'pin',
        symbolSize: 44,
        itemStyle: { color: t.mark },
        label: { fontSize: 10, color: '#fff', formatter: (p: { value?: unknown }) => p.value != null ? Number(p.value).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) : '' },
        data: result.anomalyPoints.slice(0, 12).map((p) => ({ name: p.label, coord: [p.label, p.value], value: p.value })),
      } : undefined,
    }));

    return Object.assign({}, base(t), {
      legend: all.length > 1 ? { top: 8, textStyle: { color: t.ink, fontSize: 12 } } : undefined,
      xAxis: Object.assign({ type: 'category' as const, boundaryGap: false, data: labels, axisLabel: { color: t.ink2, fontSize: 11, hideOverlap: true, rotate: labels.length > 12 ? 35 : 0 } }, axis(t)),
      yAxis: Object.assign({ type: 'value' as const }, axis(t, '')),
      dataZoom: labels.length > 30 ? [{ type: 'inside' as const }, { type: 'slider' as const, height: 16, bottom: 14, borderColor: t.line, fillerColor: 'rgba(91,91,214,.18)', handleStyle: { color: '#5b5bd6' } }] : undefined,
      series,
    });
  }

  function bar(t: ChartTokens, result: AnalysisResult) {
    const labels = result.labels ?? [];
    const all = result.series ?? [];
    return Object.assign({}, base(t), {
      legend: all.length > 1 ? { top: 8, textStyle: { color: t.ink, fontSize: 12 } } : undefined,
      xAxis: Object.assign({
        type: 'category' as const,
        data: labels,
        axisLabel: { color: t.ink2, fontSize: 11, hideOverlap: true, interval: 0, rotate: labels.length > 8 ? 30 : 0 },
      }, axis(t)),
      yAxis: Object.assign({ type: 'value' as const }, axis(t, '')),
      series: all.map((s) => ({
        name: s.name,
        type: 'bar' as const,
        barMaxWidth: 38,
        itemStyle: { borderRadius: [6, 6, 0, 0] },
        data: s.data,
      })),
    });
  }

  function pie(t: ChartTokens, result: AnalysisResult) {
    const s = (result.series ?? [])[0];
    return Object.assign({}, base(t), {
      tooltip: { trigger: 'item' as const, backgroundColor: t.tipBg, borderColor: t.tipLine, textStyle: { color: t.tipInk }, formatter: '{b}: {c} ({d}%)' },
      legend: { type: 'scroll' as const, orient: 'vertical' as const, right: 8, top: 20, textStyle: { color: t.ink, fontSize: 12 } },
      series: [{
        name: s ? s.name : '',
        type: 'pie' as const,
        radius: ['42%', '68%'],
        center: ['40%', '52%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: t.pieEdge, borderWidth: 2, borderRadius: 4 },
        label: { color: t.ink, fontSize: 11, formatter: '{b} {d}%' },
        data: (result.labels ?? []).map((l, i) => ({ name: l, value: s ? s.data[i] : 0 })),
      }],
    });
  }

  function scatter(t: ChartTokens, result: AnalysisResult) {
    const sc = result.scatter;
    if (!sc) return bar(t, result);
    return Object.assign({}, base(t), {
      tooltip: { trigger: 'item' as const, backgroundColor: t.tipBg, borderColor: t.tipLine, textStyle: { color: t.tipInk }, formatter: (p: { data?: unknown }) => { const d = p.data as number[]; return `${sc.x}: ${d[0]}<br/>${sc.y}: ${d[1]}`; } },
      xAxis: Object.assign({ type: 'value' as const, scale: true, name: sc.x }, axis(t, sc.x)),
      yAxis: Object.assign({ type: 'value' as const, scale: true, name: sc.y }, axis(t, sc.y)),
      series: [{
        type: 'scatter' as const,
        symbolSize: 7,
        itemStyle: { color: t.scatter },
        data: sc.points,
      }],
    });
  }

  function render(el: HTMLElement, result: AnalysisResult): ECharts | null {
    if (!echarts) return null;
    const option = build(result);
    lastResult.set(el, result); // 主题切换后要用它重画
    if (!option) {
      el.innerHTML = '<div class="chart-empty"><svg><use href="#i-table"/></svg>该分析结果以表格呈现，展开下方明细查看</div>';
      return null;
    }
    let chart = echarts.getInstanceByDom(el);
    if (chart) chart.dispose();
    chart = echarts.init(el, null, { renderer: 'canvas' });
    chart.setOption(option);
    return chart;
  }

  // 主题切换后重画页面上所有图表
  function rerenderAll(): void {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('.chart-box'))) {
      const prev = lastResult.get(el);
      if (prev) render(el, prev);
    }
  }

  return { render, build, rerenderAll };
})();


export { Charts };
export default Charts;
