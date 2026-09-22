import type { ColumnMeta, DataRow } from "@/lib/types";

export type ChatTask = "analyze" | "clean";

export type ChatItem = {
  id: string;
  question: string;
  stage?: string;
  report?: string;
  plan?: AnalysisPlan | null;
  result?: AnalysisResult | null;
  clean?: CleanResult | null;
  task?: ChatTask;
  error?: string;
};

/** 模型产出的分析计划（对应 agent.ts 的 plan 对象） */
export interface AnalysisPlan {
  title?: string;
  kind?: string;
  chart?: "line" | "bar" | "pie" | "scatter" | "table";
  metric?: string | null;
  agg?: "sum" | "avg" | "count" | "max" | "min";
  dimension?: string | null;
  timeField?: string | null;
  granularity?: "day" | "week" | "month" | "quarter";
  filters?: AnalysisFilter[];
  compareField?: string | null;
  compareValues?: string[];
  periods?: number;
  limit?: number;
  sort?: "asc" | "desc";
}

export type AnalysisFilter = {
  field: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";
  value: unknown;
};

export interface AnalysisResult {
  kind?: string;
  title?: string;
  table?: { headers: string[]; rows: unknown[][] } | null;
  [key: string]: unknown;
}

export interface CleanStepReport {
  label: string;
  summary: string;
}

/** Agent.analyze 的返回结构。agent.ts 未标注返回类型，这里补一条可辨识联合，供调用侧收窄。 */
export type AnalysisOutcome =
  | { task: "clean"; plan: AnalysisPlan | null; clean: CleanResult | null; report: string }
  | { task: "analyze"; plan: AnalysisPlan | null; result: AnalysisResult | null; report: string };

export interface CleanResult {
  before: { rows: number; cols: number };
  after: { rows: number; cols: number };
  columns: ColumnMeta[];
  rows: DataRow[];
  report?: CleanStepReport[];
}
