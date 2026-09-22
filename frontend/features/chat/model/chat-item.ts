import type {
  AnalysisOutcome,
  AnalysisPlan,
  AnalysisResult,
  CleanResult,
} from "@/lib/types";

// 分析域的类型统一住在 lib/types.ts，这里再导出一次，
// 让 features/chat 下的既有 import 路径不用改。
export type {
  AnalysisOutcome,
  AnalysisPlan,
  AnalysisResult,
  AnalysisFilter,
  CleanResult,
  CleanStepReport,
} from "@/lib/types";

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
