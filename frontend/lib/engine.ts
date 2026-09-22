import { Parse } from "./parse.ts";
import type {
  AnalysisAnomalyRecord,
  AnalysisFilter,
  AnalysisPlan,
  AnalysisResult,
  AnalysisScatter,
  AnalysisSeries,
  ColumnMeta,
  ColumnType,
  DataRow,
  Dataset,
  Granularity,
} from "./types";

/** 引擎支持的聚合方式。median 只在概览统计里出现，模型计划里不会给 */
type AggName = "sum" | "avg" | "count" | "max" | "min" | "median";

type AggFn = (a: number[]) => number;

/** 一个分组聚合结果 */
interface GroupBucket {
  key: string;
  value: number;
}

/** 时间轴上的一个周期 */
interface TrendPoint {
  key: string;
  value: number;
  n?: number;
  /** 最后一个周期往往还没走完，单独标记，避免被当成暴跌 */
  partial?: boolean;
}

interface AnomalyDetection {
  points: AnalysisAnomalyRecord[];
  mean: number;
  std: number;
  upper: number;
  lower: number;
}

type EngineHandler = (plan: AnalysisPlan, rows: DataRow[], cols: ColumnMeta[]) => AnalysisResult;

/** 分类维度候选：非数值字段、取值不太多。
    unique 缺失时视为不合格，与旧代码里 undefined 参与比较恒为 false 的行为保持一致。 */
function lowCardinality(c: ColumnMeta, min = 1, max = 30): boolean {
  return c.type !== "number" && c.unique !== undefined && c.unique >= min && c.unique <= max;
}

/** 聚合方式的中文名，给结论和表头用 */
const AGG_LABEL: Record<string, string> = { sum: '求和', avg: '均值', count: '计数', max: '最大值', min: '最小值', median: '中位数' };

/** 时间粒度的中文名 */
const GRAN_LABEL: Record<string, string> = { day: '日', week: '周', month: '月', quarter: '季', year: '年' };

/* 本地分析引擎：真实执行聚合 / 趋势 / 异常 / 对比 / 相关性计算，数字全部由数据算出，不由模型编造 */
const Engine = (function () {
  const N = Parse.toNumber;
  const D = Parse.toDate;

  const AGGS: Record<AggName, AggFn> = {
    sum: (a) => a.reduce((x, y) => x + y, 0),
    avg: (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0),
    count: (a) => a.length,
    max: (a) => (a.length ? Math.max(...a) : 0),
    min: (a) => (a.length ? Math.min(...a) : 0),
    median: (a) => {
      if (!a.length) return 0;
      const s = [...a].sort((x, y) => x - y);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    },
  };

  const r2 = (v: number): number => Math.round(v * 100) / 100;

  /** plan.agg 来自模型，可能是任意字符串；只承认 AGGS 里真实存在的键 */
  function toAggName(agg: string | undefined): AggName | null {
    return agg && Object.prototype.hasOwnProperty.call(AGGS, agg) ? (agg as AggName) : null;
  }

  /* ---------- 过滤 ---------- */
  function pass(row: DataRow, f: AnalysisFilter | undefined): boolean {
    if (!f || !f.field) return true;
    const raw = row[f.field];
    const num = N(raw);
    const val = f.value;
    switch ((f.op || 'eq').toLowerCase()) {
      case 'eq': return String(raw) === String(val);
      case 'neq': return String(raw) !== String(val);
      case 'gt': return num !== null && num > (N(val) ?? 0);
      case 'gte': return num !== null && num >= (N(val) ?? 0);
      case 'lt': return num !== null && num < (N(val) ?? 0);
      case 'lte': return num !== null && num <= (N(val) ?? 0);
      case 'contains': return String(raw).indexOf(String(val)) >= 0;
      case 'in': return String(val).split('|').map((s) => s.trim()).includes(String(raw));
      default: return true;
    }
  }

  function filterRows(rows: DataRow[], filters: AnalysisFilter[] | undefined): DataRow[] {
    if (!filters || !filters.length) return rows;
    return rows.filter((r) => filters.every((f) => pass(r, f)));
  }

  /* ---------- 字段挑选 ---------- */
  function pickField(
    cols: ColumnMeta[],
    name: string | null | undefined,
    type?: ColumnType,
    fallbackIndex = 0
  ): string | null {
    if (name && cols.some((c) => c.name === name)) return name;
    const pool = cols.filter((c) => !type || c.type === type);
    return pool.length ? pool[Math.min(fallbackIndex, pool.length - 1)].name : null;
  }

  function granularityFor(dates: number[]): Granularity {
    if (dates.length < 2) return 'day';
    const span = (Math.max(...dates) - Math.min(...dates)) / 86400000;
    if (span <= 40) return 'day';
    if (span <= 200) return 'week';
    if (span <= 800) return 'month';
    return 'quarter';
  }

  function bucketKey(d: Date, g: Granularity): string {
    const y = d.getFullYear(), m = d.getMonth() + 1;
    if (g === 'day') return `${y}-${String(m).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (g === 'month') return `${y}-${String(m).padStart(2, '0')}`;
    if (g === 'quarter') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    if (g === 'year') return String(y);
    const first = new Date(d.getTime());
    first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')} 周`;
  }

  /* ---------- 分组聚合 ---------- */
  function groupAgg(
    rows: DataRow[],
    dim: string | null | undefined,
    metric: string | null,
    agg: string
  ): GroupBucket[] {
    const map = new Map<string, number[]>();
    for (const r of rows) {
      const key = dim ? String(r[dim] === undefined || r[dim] === '' ? '(空)' : r[dim]) : '合计';
      if (!map.has(key)) map.set(key, []);
      const v = metric === null ? null : N(r[metric]);
      const bucket = map.get(key);
      if (v !== null && bucket) bucket.push(v);
    }
    const out: GroupBucket[] = [];
    const fn = toAggName(agg);
    map.forEach((vals, key) => out.push({ key, value: fn ? AGGS[fn](vals) : vals.length }));
    return out;
  }

  function sortLimit(arr: GroupBucket[], sort: "asc" | "desc" = "desc", limit = 20): GroupBucket[] {
    arr.sort((a, b) => (sort === 'asc' ? a.value - b.value : b.value - a.value));
    return arr.slice(0, limit);
  }

  /* ---------- 异常检测 ---------- */
  // sensitivity: strict（少报）/ normal / loose（多报），由「设置 → 分析偏好」控制
  const SENSITIVITY: Record<string, { z: number; k: number }> = { strict: { z: 2.5, k: 2.0 }, normal: { z: 2, k: 1.5 }, loose: { z: 1.5, k: 1.0 } };

  function detectAnomalies(points: TrendPoint[], sensitivity: string | undefined): AnomalyDetection {
    const vals = points.map((p) => p.value);
    const n = vals.length;
    if (n < 4) return { points: [], mean: 0, std: 0, upper: 0, lower: 0 };
    const s = SENSITIVITY[String(sensitivity ?? "")] || SENSITIVITY.normal;
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const sorted = [...vals].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(n * 0.25)], q3 = sorted[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    const upper = q3 + s.k * iqr, lower = q1 - s.k * iqr;
    const out: AnalysisAnomalyRecord[] = [];
    points.forEach((p, i) => {
      const z = std > 0 ? (p.value - mean) / std : 0;
      const outside = p.value > upper || p.value < lower;
      if (Math.abs(z) >= s.z || outside) {
        out.push({
          label: p.key,
          value: r2(p.value),
          z: r2(z),
          deviation: mean !== 0 ? r2(((p.value - mean) / Math.abs(mean)) * 100) : 0,
          type: p.value > mean ? '高值异常' : '低值异常',
          index: i,
        });
      }
    });
    return { points: out, mean: r2(mean), std: r2(std), upper: r2(upper), lower: r2(lower) };
  }

  /* ---------- 相关性 ---------- */
  function pearson(xs: number[], ys: number[]): number {
    const n = xs.length;
    if (n < 3) return 0;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    const den = Math.sqrt(dx * dy);
    return den === 0 ? 0 : num / den;
  }

  /* ================= 主入口 ================= */
  function run(plan: AnalysisPlan, dataset: Dataset): AnalysisResult {
    const cols = dataset.columns || [];
    const rows = filterRows(dataset.rows || [], plan.filters);
    if (!rows.length) throw new Error('筛选后没有可用数据，请调整分析条件');

    const kind = (plan.kind || "aggregate").toLowerCase();
    const handlers: Record<string, EngineHandler> = { summary, aggregate, trend, anomaly, compare, correlation };
    const fn = handlers[kind] || aggregate;
    const res = fn(plan, rows, cols);
    res.kind = kind;
    res.title = plan.title || res.title || '分析结果';
    res.chart = plan.chart || res.chart || 'bar';
    res.filters = plan.filters || [];
    res.rowCount = rows.length;
    return res;
  }

  /* ---------- 整体概览 ---------- */
  function summary(plan: AnalysisPlan, rows: DataRow[], cols: ColumnMeta[]): AnalysisResult {
    const numCols = cols.filter((c) => c.type === 'number');
    const catCols = cols.filter((c) => lowCardinality(c));
    const timeCols = cols.filter((c) => c.type === 'date');

    const metrics = numCols.slice(0, 6).map((c) => {
      const vals = rows.map((r) => N(r[c.name])).filter((v) => v !== null);
      return {
        field: c.name,
        count: vals.length,
        sum: r2(AGGS.sum(vals)),
        avg: r2(AGGS.avg(vals)),
        min: vals.length ? r2(Math.min(...vals)) : 0,
        max: vals.length ? r2(Math.max(...vals)) : 0,
        median: r2(AGGS.median(vals)),
      };
    });

    const primary = numCols.length ? numCols[0].name : null;
    const catField = catCols.length ? catCols[0].name : null;
    let labels: string[] = [], series: AnalysisSeries[] = [], distribution: GroupBucket[] = [];

    if (primary) {
      const agg = plan.agg || 'sum';
      if (catField) {
        distribution = sortLimit(groupAgg(rows, catField, primary, agg), 'desc', 10);
        labels = distribution.map((d) => d.key);
        series = [{ name: `${primary}(${aggLabel(agg)})`, data: distribution.map((d) => r2(d.value)) }];
      }
      if (timeCols.length) {
        const t = aggregateByTime(rows, timeCols[0].name, primary, agg, plan.granularity);
        labels = t.points.map((p) => p.key);
        series = [{ name: `${primary}(${aggLabel(agg)})`, data: t.points.map((p) => r2(p.value)) }];
      }
    }

    const table = {
      headers: ['字段', '类型', '非空值', '求和', '均值', '中位数', '最小', '最大'],
      rows: metrics.map((m) => [m.field, '数值', m.count, m.sum, m.avg, m.median, m.min, m.max]),
    };

    return {
      chart: timeCols.length ? 'line' : (catField ? 'bar' : 'table'),
      labels,
      series,
      table,
      distribution: distribution.map((d) => ({ key: d.key, value: r2(d.value) })),
      stats: { totalRows: rows.length, fieldCount: cols.length, metrics, topCategory: catField },
      notes: [
        `共 ${rows.length} 行、${cols.length} 个字段`,
        numCols.length ? `数值指标：${numCols.map((c) => c.name).join('、')}` : '未识别到数值字段',
        catField ? `主要分类维度：${catField}（${catCols[0].unique} 个取值）` : '',
        timeCols.length ? `时间字段：${timeCols.map((c) => c.name).join('、')}` : '',
      ].filter(Boolean),
    };
  }

  /* ---------- 分组聚合 ---------- */
  function aggregate(plan: AnalysisPlan, rows: DataRow[], cols: ColumnMeta[]): AnalysisResult {
    const metric = pickField(cols, plan.metric, 'number');
    const dim = plan.dimension && cols.some((c) => c.name === plan.dimension)
      ? plan.dimension
      : cols.find((c) => lowCardinality(c))?.name;
    const agg = toAggName(plan.agg) ?? (metric ? "sum" : "count");

    if (!metric) {
      return {
        chart: 'table',
        labels: [],
        series: [],
        table: { headers: ['分组', '记录数'], rows: sortLimit(groupAgg(rows, dim, null, 'count'), 'desc', plan.limit || 20).map((d) => [d.key, d.value]) },
        stats: {},
        notes: ['数据中未识别到数值字段，仅统计记录数'],
      };
    }

    const groups = sortLimit(groupAgg(rows, dim, metric, agg), plan.sort || 'desc', plan.limit || 20);
    const total = groups.reduce((a, b) => a + b.value, 0);
    return {
      chart: plan.chart || (groups.length <= 8 && groups.length > 1 ? 'pie' : 'bar'),
      labels: groups.map((g) => g.key),
      series: [{ name: `${metric}(${aggLabel(agg)})`, data: groups.map((g) => r2(g.value)) }],
      table: {
        headers: [dim || '分组', `${metric}(${aggLabel(agg)})`, '占比'],
        rows: groups.map((g) => [g.key, r2(g.value), total ? r2((g.value / total) * 100) + '%' : '-']),
      },
      stats: {
        metric, agg, dimension: dim, total: r2(total),
        top: groups[0] ? { key: groups[0].key, value: r2(groups[0].value), share: total ? r2((groups[0].value / total) * 100) : 0 } : null,
        bottom: groups.length ? { key: groups[groups.length - 1].key, value: r2(groups[groups.length - 1].value) } : null,
      },
      notes: [`按「${dim || '全量'}」分组统计 ${metric} 的${aggLabel(agg)}，覆盖 ${rows.length} 行数据`],
    };
  }

  /* ---------- 时间聚合 ---------- */
  function aggregateByTime(
    rows: DataRow[],
    timeField: string,
    metric: string,
    agg: string,
    granularity?: Granularity | null
  ): { points: TrendPoint[]; granularity: Granularity } {
    const buckets = new Map<number, number[]>();
    const dates: number[] = [];
    for (const r of rows) {
      const d = D(r[timeField]);
      if (!d) continue;
      dates.push(d.getTime());
      const v = N(r[metric]);
      buckets.set(d.getTime(), (buckets.get(d.getTime()) || []).concat(v === null ? [] : [v]));
    }
    const g = granularity || granularityFor(dates);
    const merged = new Map<string, number[]>();
    Array.from(buckets.keys()).sort((a, b) => a - b).forEach((t) => {
      const key = bucketKey(new Date(t), g);
      merged.set(key, (merged.get(key) || []).concat(buckets.get(t) || []));
    });
    const points: TrendPoint[] = [];
    const fn = toAggName(agg);
    merged.forEach((vals, key) => points.push({ key, value: fn ? AGGS[fn](vals) : vals.length, n: vals.length }));
    // 最后一个周期常常尚未结束（数据只到"今天"），单独标记，避免把它当成真实暴跌
    if (points.length > 3) {
      const med = AGGS.median(points.map((p) => p.n ?? 0));
      const last = points[points.length - 1];
      last.partial = med > 0 && (last.n ?? 0) < med * 0.6;
    }
    return { points, granularity: g };
  }

  function trend(plan: AnalysisPlan, rows: DataRow[], cols: ColumnMeta[]): AnalysisResult {
    const timeField = pickField(cols, plan.timeField, 'date');
    const metric = pickField(cols, plan.metric, 'number');
    const agg = toAggName(plan.agg) ?? "sum";
    if (!timeField || !metric) {
      return aggregate(plan, rows, cols);
    }

    const t = aggregateByTime(rows, timeField, metric, agg, plan.granularity);
    const pts = t.points;
    if (!pts.length) return aggregate(plan, rows, cols);

    const lastPt = pts[pts.length - 1];
    const endPt = lastPt.partial && pts.length > 1 ? pts[pts.length - 2] : lastPt;
    const first = pts[0].value, last = endPt.value;
    const growth = first !== 0 ? r2(((last - first) / Math.abs(first)) * 100) : 0;
    const changes = pts.slice(1).map((p, i) => (pts[i].value !== 0 ? ((p.value - pts[i].value) / Math.abs(pts[i].value)) * 100 : 0));
    const avgChange = changes.length ? r2(changes.reduce((a, b) => a + b, 0) / changes.length) : 0;
    const maxPt = pts.reduce((a, b) => (b.value > a.value ? b : a));
    const minPt = pts.reduce((a, b) => (b.value < a.value ? b : a));

    const dim = plan.dimension && cols.some((c) => c.name === plan.dimension) ? plan.dimension : null;
    let series: AnalysisSeries[] = [{ name: `${metric}(${aggLabel(agg)})`, data: pts.map((p) => r2(p.value)) }];
    if (dim) {
      const top = sortLimit(groupAgg(rows, dim, metric, agg), 'desc', 5).map((g) => g.key);
      series = top.map((k) => {
        const sub = rows.filter((r) => String(r[dim]) === k);
        const st = aggregateByTime(sub, timeField, metric, agg, t.granularity);
        const m = new Map<string, number>(st.points.map((p) => [p.key, p.value]));
        return { name: k, data: pts.map((p) => r2(m.get(p.key) || 0)) };
      });
    }

    return {
      chart: 'line',
      labels: pts.map((p) => p.key),
      series,
      table: {
        headers: [timeField, `${metric}(${aggLabel(agg)})`, '环比变化'],
        rows: pts.map((p, i) => [p.key, r2(p.value), i === 0 ? '-' : (changes[i - 1] >= 0 ? '+' : '') + r2(changes[i - 1]) + '%']),
      },
      stats: {
        metric, agg, timeField, granularity: t.granularity, periods: pts.length,
        first: r2(first), last: r2(last), growth, avgChange,
        peak: { key: maxPt.key, value: r2(maxPt.value) },
        trough: { key: minPt.key, value: r2(minPt.value) },
        lastPeriodIncomplete: !!lastPt.partial,
      },
      notes: [
        `${pts.length} 个${granLabel(t.granularity)}周期，${metric} 从 ${r2(first)} 变化到 ${r2(last)}`,
        lastPt.partial ? `注意：最后一个周期（${lastPt.key}）仅 ${lastPt.n} 条记录，可能尚未结束，已按倒数第二个完整周期（${endPt.key}）计算期末值` : '',
      ].filter(Boolean),
    };
  }

  /* ---------- 异常识别 ---------- */
  function anomaly(plan: AnalysisPlan, rows: DataRow[], cols: ColumnMeta[]): AnalysisResult {
    const timeField = pickField(cols, plan.timeField, 'date');
    const metric = pickField(cols, plan.metric, 'number');
    const agg = toAggName(plan.agg) ?? "sum";
    if (!metric) throw new Error('未找到可用于异常检测的数值字段');

    let points: TrendPoint[];
    let labels: string[];
    let dim: string | null = null;
    if (timeField) {
      const t = aggregateByTime(rows, timeField, metric, agg, plan.granularity);
      points = t.points.map((p) => ({ key: p.key, value: p.value, n: p.n, partial: p.partial }));
    } else {
      const d = plan.dimension && cols.some((c) => c.name === plan.dimension)
        ? plan.dimension
        : cols.find((c) => lowCardinality(c))?.name;
      dim = d ?? null;
      points = (d ? sortLimit(groupAgg(rows, d, metric, agg), 'desc', 60) : rows.slice(0, 200).map((r, i) => ({ key: '#' + (i + 1), value: N(r[metric]) || 0 })))
        .map((p) => ({ key: p.key, value: p.value }));
    }
    labels = points.map((p) => p.key);

    // 末尾未结束的周期不参与异常判定，避免"还没到月底"被误判成断崖
    const lastPartial = points.length > 3 && points[points.length - 1].partial;
    const forDetect = lastPartial ? points.slice(0, -1) : points;
    const det = detectAnomalies(forDetect, plan.sensitivity);
    const series = [{ name: `${metric}(${aggLabel(agg)})`, data: points.map((p) => r2(p.value)) }];

    return {
      chart: 'line',
      labels,
      series,
      anomalyPoints: det.points.map((p) => ({ label: p.label, dataIndex: p.index, value: p.value, type: p.type })),
      baseline: { mean: det.mean, std: det.std, upper: det.upper, lower: det.lower },
      table: {
        headers: [dim || timeField || '位置', metric, '偏离均值', 'Z 分数', '类型'],
        rows: det.points.slice(0, 20).map((p) => [p.label, p.value, (p.deviation >= 0 ? '+' : '') + p.deviation + '%', p.z, p.type]),
      },
      anomalies: det.points,
      stats: {
        metric, dimension: dim, timeField,
        baselineMean: det.mean, baselineStd: det.std,
        normalRange: [det.lower, det.upper],
        anomalyCount: det.points.length,
        totalPoints: points.length,
      },
      notes: [
        det.points.length
          ? `在 ${forDetect.length} 个数据点中发现 ${det.points.length} 个异常点（Z 分数绝对值 ≥ 2 或超出 IQR 边界）`
          : `${forDetect.length} 个数据点中未发现显著异常，数据分布相对平稳`,
        lastPartial ? `最后一个周期（${points[points.length - 1].key}）数据不完整，未纳入异常判定` : '',
      ].filter(Boolean),
    };
  }

  /* ---------- 指标对比 ---------- */
  function compare(plan: AnalysisPlan, rows: DataRow[], cols: ColumnMeta[]): AnalysisResult {
    const metric = pickField(cols, plan.metric, 'number');
    const agg = toAggName(plan.agg) ?? "sum";
    const timeField = pickField(cols, plan.timeField, 'date');

    // 时间段对比：最近 N 个周期 vs 之前 N 个周期
    if (timeField && (plan.periods || plan.comparePeriods)) {
      const n = plan.periods || 7;
      const t = aggregateByTime(rows, timeField, metric ?? "", agg, plan.granularity || 'day');
      const pts = t.points;
      if (pts.length >= 2 * n) {
        const A = pts.slice(pts.length - n), B = pts.slice(pts.length - 2 * n, pts.length - n);
        const sum = (arr: TrendPoint[]) => arr.reduce((a, b) => a + b.value, 0);
        const a = sum(A), b = sum(B);
        const diff = a - b;
        const rate = b !== 0 ? r2((diff / Math.abs(b)) * 100) : 0;
        return {
          chart: 'bar',
          labels: A.map((p) => p.key),
          series: [{ name: `本期(${A[0].key} 起)`, data: A.map((p) => r2(p.value)) }, { name: `上期(${B[0].key} 起)`, data: B.map((p) => r2(p.value)) }],
          table: {
            headers: ['对比项', `${metric}(${aggLabel(agg)})`, '均值'],
            rows: [
              ['本期', r2(a), r2(a / A.length)],
              ['上期', r2(b), r2(b / B.length)],
              ['差异', r2(diff), r2(diff / A.length)],
              ['变化率', (rate >= 0 ? '+' : '') + rate + '%', ''],
            ],
          },
          stats: { mode: 'period', metric, agg, current: r2(a), previous: r2(b), diff: r2(diff), changeRate: rate, periods: n, granularity: t.granularity },
          notes: [`最近 ${n} 个周期对比前 ${n} 个周期，${metric}${rate >= 0 ? '上升' : '下降'} ${Math.abs(rate)}%`],
        };
      }
    }

    // 分组对比
    let dim: string | null | undefined = plan.dimension || plan.compareField;
    if (!dim || !cols.some((c) => c.name === dim)) {
      dim = cols.find((c) => lowCardinality(c, 2))?.name;
    }
    let groups = sortLimit(groupAgg(rows, dim, metric, agg), 'desc', 100);
    let chosen = (plan.compareValues || []).filter((v) => groups.some((g) => g.key === v));
    if (chosen.length < 2) chosen = groups.slice(0, 2).map((g) => g.key);
    const A = groups.find((g) => g.key === chosen[0]);
    const B = groups.find((g) => g.key === chosen[1]);
    if (!A || !B) return aggregate(plan, rows, cols);

    const diff = A.value - B.value;
    const rate = B.value !== 0 ? r2((diff / Math.abs(B.value)) * 100) : 0;

    return {
      chart: 'bar',
      labels: groups.slice(0, Math.min(groups.length, 12)).map((g) => g.key),
      series: [{ name: `${metric}(${aggLabel(agg)})`, data: groups.slice(0, 12).map((g) => r2(g.value)) }],
      table: {
        headers: ['对比项', `${metric}(${aggLabel(agg)})`, '差异', '变化率'],
        rows: [
          [A.key, r2(A.value), '基准', '-'],
          [B.key, r2(B.value), r2(-diff), (rate >= 0 ? '-' : '+') + Math.abs(rate) + '%'],
        ],
      },
      stats: {
        mode: 'group', metric, agg, dimension: dim,
        a: { key: A.key, value: r2(A.value) },
        b: { key: B.key, value: r2(B.value) },
        diff: r2(diff), changeRate: rate, groupCount: groups.length,
      },
      notes: [`「${A.key}」${metric} 为 ${r2(A.value)}，较「${B.key}」${diff >= 0 ? '高' : '低'} ${Math.abs(rate)}%`],
    };
  }

  /* ---------- 相关性 ---------- */
  function correlation(plan: AnalysisPlan, rows: DataRow[], cols: ColumnMeta[]): AnalysisResult {
    const numCols = cols.filter((c) => c.type === 'number').slice(0, 8);
    if (numCols.length < 2) return summary(plan, rows, cols);

    const vectors: Record<string, number[]> = {};
    numCols.forEach((c) => { vectors[c.name] = rows.map((r) => N(r[c.name])).filter((v) => v !== null); });

    const pairs = [];
    for (let i = 0; i < numCols.length; i++) {
      for (let j = i + 1; j < numCols.length; j++) {
        const a = numCols[i].name, b = numCols[j].name;
        const len = Math.min(vectors[a].length, vectors[b].length);
        const r = pearson(vectors[a].slice(0, len), vectors[b].slice(0, len));
        pairs.push({ x: a, y: b, r: r2(r) });
      }
    }
    pairs.sort((p, q) => Math.abs(q.r) - Math.abs(p.r));
    const top = pairs.slice(0, 10);
    const strongest = top[0];

    let labels: string[] = [], series: AnalysisSeries[] = [], scatter: AnalysisScatter | null = null;
    if (strongest) {
      const len = Math.min(vectors[strongest.x].length, vectors[strongest.y].length, 600);
      scatter = { x: strongest.x, y: strongest.y, points: [] };
      for (let i = 0; i < len; i++) scatter.points.push([vectors[strongest.x][i], vectors[strongest.y][i]]);
      const baseLen = vectors[strongest.x].length;
      labels = numCols.map((c) => c.name);
      series = [{
        name: '相关系数',
        data: numCols.map((c) => {
          const len = Math.min(baseLen, vectors[c.name].length);
          return r2(pearson(vectors[strongest.x].slice(0, len), vectors[c.name].slice(0, len)));
        }),
      }];
    }

    return {
      chart: scatter ? 'scatter' : 'table',
      labels,
      series,
      scatter,
      table: {
        headers: ['指标 A', '指标 B', '相关系数', '相关强度'],
        rows: top.map((p) => [p.x, p.y, p.r, strength(p.r)]),
      },
      stats: { pairs: top, strongest, fieldCount: numCols.length },
      notes: strongest
        ? [`最强相关：${strongest.x} 与 ${strongest.y}，相关系数 ${strongest.r}（${strength(strongest.r)}）`]
        : ['未计算出有效相关性'],
    };
  }

  function strength(r: number): string {
    const a = Math.abs(r);
    if (a >= 0.8) return '极强';
    if (a >= 0.6) return '强';
    if (a >= 0.4) return '中等';
    if (a >= 0.2) return '弱';
    return '几乎无关';
  }

  function aggLabel(a: string): string {
    return AGG_LABEL[a] || a;
  }
  function granLabel(g: string): string {
    return GRAN_LABEL[g] || g;
  }

  /* ---------- 给模型的精简摘要 ---------- */
  function brief(result: AnalysisResult): string {
    const lines: string[] = [];
    lines.push(`分析类型：${result.kind}`);
    lines.push(`数据行数：${result.rowCount}`);
    if (result.notes) lines.push(...result.notes);
    if (result.stats) {
      const flat: Record<string, unknown> = {};
      Object.entries(result.stats).forEach(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.entries(v).forEach(([k2, v2]) => { flat[k + '.' + k2] = v2; });
        else if (!Array.isArray(v)) flat[k] = v;
      });
      lines.push('关键指标：' + Object.entries(flat).slice(0, 20).map(([k, v]) => `${k}=${v}`).join('，'));
    }
    if (result.table) {
      const t = result.table;
      lines.push('结果表：');
      lines.push(t.headers.join(' | '));
      t.rows.slice(0, 20).forEach((r) => lines.push(r.join(' | ')));
      if (t.rows.length > 20) lines.push(`（共 ${t.rows.length} 行，以上为前 20 行）`);
    }
    if (result.anomalies && result.anomalies.length) {
      lines.push('异常点：' + result.anomalies.slice(0, 10).map((a) => `${a.label}(${a.value}, ${a.type}, Z=${a.z})`).join('；'));
    }
    return lines.join('\n');
  }

  return { run, brief, aggLabel, pass };
})();


export { Engine };
export default Engine;
