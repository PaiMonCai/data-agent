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

/** æ¨¡åäº§åºçåæè®¡åï¼å¯¹åº agent.ts ç plan å¯¹è±¡ï¼ */
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

/** Agent.analyze çè¿åç»æãagent.ts æªæ æ³¨è¿åç±»åï¼è¿éè¡¥ä¸æ¡å¯è¾¨è¯èåï¼ä¾è°ç¨ä¾§æ¶çªã */
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
