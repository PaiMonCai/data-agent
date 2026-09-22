export type ColumnType = "number" | "date" | "string" | "text";

export type DataRow = Record<string, unknown>;

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  unique?: number;
  sample?: unknown[];
  min?: number | null;
  max?: number | null;
  labels?: string | null;
  desc?: string | null;
}

export interface DatasetMeta {
  id: string;
  name: string;
  source: string;
  columns: ColumnMeta[];
  row_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface Dataset extends DatasetMeta {
  rows: DataRow[];
}

export interface User {
  id: string;
  email: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  provider?: string;
  disabled?: boolean;
}

export interface AnalysisHistory {
  id: string;
  question: string;
  kind: string;
  result: AnalysisResult;
  summary?: string | null;
  created_at: string;
  plan?: AnalysisPlan | null;
}

export interface AppSettings {
  theme: "system" | "light" | "dark";
  model: string;
  agg: "sum" | "avg" | "count" | "max" | "min";
  granularity: "auto" | "day" | "week" | "month" | "quarter";
  sensitivity: "strict" | "normal" | "loose";
  detail: "brief" | "normal" | "detailed";
  autoAnalyze: boolean;
  confirmDelete: boolean;
}

export interface ParsedTable {
  headers: string[];
  rows: DataRow[];
  columns: ColumnMeta[];
  meta?: Record<string, unknown>;
}

/* ---------- 分析计划与结果 ---------- */

/** 图表类型，与 agent 计划里的 chart 字段一一对应 */
export type ChartKind = "line" | "bar" | "pie" | "scatter" | "table";

export type AnalysisAgg = "sum" | "avg" | "count" | "max" | "min";

export type AnalysisFilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";

export type Granularity = "day" | "week" | "month" | "quarter" | "year";

export type AnalysisFilter = {
  field: string;
  op: AnalysisFilterOp;
  value: unknown;
};

/** 模型规划出的分析计划。所有字段都可选：模型可能漏填，sanitize 之后才保证有值 */
export interface AnalysisPlan {
  title?: string;
  kind?: string;
  chart?: ChartKind;
  metric?: string | null;
  agg?: AnalysisAgg;
  dimension?: string | null;
  timeField?: string | null;
  granularity?: Granularity;
  filters?: AnalysisFilter[];
  compareField?: string | null;
  compareValues?: string[];
  periods?: number;
  /** "最近 N 期 vs 前 N 期" 对比时的另一个写法，与 periods 等价 */
  comparePeriods?: number;
  limit?: number;
  sort?: "asc" | "desc";
  /** 异常检测灵敏度，由「设置 → 分析偏好」控制 */
  sensitivity?: "strict" | "normal" | "loose";
  /** 该条计划是分析还是清洗；由 agent 填 */
  task?: "analyze" | "clean";
}

/** 一条图表序列 */
export interface AnalysisSeries {
  name: string;
  data: number[];
}

/** 结果表。表头是字符串，单元格可能是数字也可能是字符串 */
export interface AnalysisTable {
  headers: string[];
  rows: unknown[][];
}

/** 散点图：两个数值字段的点集，每个点是 [x, y] */
export interface AnalysisScatter {
  x: string;
  y: string;
  points: [number, number][];
}

/** 异常检测算出的均值基线，用来在折线图上画 markLine */
export interface AnalysisBaseline {
  mean: number;
  std: number;
  upper: number;
  lower: number;
}

export interface AnalysisAnomalyRecord {
  label: string;
  value: number;
  z: number;
  deviation: number;
  type: string;
  index: number;
}

export interface AnalysisAnomalyPoint {
  label: string;
  dataIndex: number;
  value: number;
  type: string;
}

/**
 * 分析引擎的真实产出。
 *
 * 上面列的是渲染层真正会读的字段。各分支还会附带只有自己用的字段
 * （概览的 distribution、异常分支的 anomalies、相关性分支的 pairs），
 * 所以保留一个宽松的索引签名，具体内容由对应的引擎分支保证。
 */
export interface AnalysisResult {
  kind?: string;
  title?: string;
  chart?: ChartKind;
  labels?: string[];
  series?: AnalysisSeries[];
  table?: AnalysisTable | null;
  scatter?: AnalysisScatter | null;
  baseline?: AnalysisBaseline | null;
  anomalyPoints?: AnalysisAnomalyPoint[];
  anomalies?: AnalysisAnomalyRecord[];
  filters?: AnalysisFilter[];
  rowCount?: number;
  stats?: Record<string, unknown>;
  notes?: string[];
  [key: string]: unknown;
}

/* ---------- 数据清洗 ---------- */

/** 清洗引擎单步操作的执行结果 */
export interface CleanStepReport {
  op: string;
  label: string;
  affected: number;
  summary: string;
}

export interface CleanResult {
  before: { rows: number; cols: number };
  after: { rows: number; cols: number };
  columns: ColumnMeta[];
  rows: DataRow[];
  report: CleanStepReport[];
}

/** Agent.analyze 的返回结构。agent.ts 未标注返回类型，这里补一条可辨识联合，供调用侧收窄。 */
export type AnalysisOutcome =
  | { task: "clean"; plan: AnalysisPlan | null; clean: CleanResult | null; report: string }
  | { task: "analyze"; plan: AnalysisPlan | null; result: AnalysisResult | null; report: string };
