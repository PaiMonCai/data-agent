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
  result: any;
  summary?: string | null;
  created_at: string;
  plan?: any;
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
