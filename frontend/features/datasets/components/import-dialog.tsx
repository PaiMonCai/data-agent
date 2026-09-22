"use client";

import { FileSpreadsheet, Sparkles, Upload, X } from "lucide-react";
import { useState } from "react";
import { Cloud } from "@/lib/api";
import { Parse } from "@/lib/parse";
import type { DatasetMeta, ParsedTable } from "@/lib/types";

export default function ImportDialog({ onClose, onImported }: {
  onClose: () => void;
  onImported: (dataset: DatasetMeta) => Promise<void>;
}) {
  const [source, setSource] = useState<"file" | "paste" | "sample">("file");
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [parsed, setParsed] = useState<ParsedTable | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const parseFile = async (file: File) => {
    setBusy(true); setNote("正在解析文件…");
    try {
      let out: ParsedTable;
      if (Parse.isExcel(file.name)) {
        const wb = await Parse.workbook(await file.arrayBuffer());
        out = wb.use(wb.sheets[0]);
        setNote(`已读取工作表：${wb.sheets[0]}`);
      } else if (Parse.isStata(file.name)) {
        out = await Parse.fromStata(new Uint8Array(await file.arrayBuffer()));
        setNote("Stata 文件解析完成");
      } else {
        out = Parse.fromText(await file.text());
        setNote(`已解析 ${out.rows.length} 行 × ${out.columns.length} 列`);
      }
      setParsed(out);
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      setNote(Cloud.errText(e));
      setParsed(null);
    } finally { setBusy(false); }
  };

  const importNow = async () => {
    setBusy(true);
    try {
      let data = parsed;
      if (source === "paste") data = Parse.fromText(paste);
      if (source === "sample") data = Parse.sampleData();
      if (!data?.rows?.length) throw new Error("没有可导入的数据");
      const rows = data.rows.slice(0, 20000);
      const created = await Cloud.db.importDataset({
        name: (name.trim() || (source === "sample" ? "电商销售示例" : "新数据集")).slice(0, 60),
        source,
        columns: data.columns,
      }, rows);
      if (!created[0]) throw new Error("服务端未返回数据集");
      await onImported(created[0]);
      onClose();
    } catch (e) {
      setNote(Cloud.errText(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="surface max-h-[90vh] w-full max-w-2xl overflow-auto rounded-3xl border shadow-2xl">
        <div className="border-ui flex items-center justify-between border-b px-6 py-5">
          <div><h2 className="text-lg font-semibold">新建数据集</h2><p className="muted mt-1 text-sm">支持 CSV / TSV / JSON / Excel / ODS / Stata</p></div>
          <button onClick={onClose} aria-label="关闭" className="muted rounded-lg p-2 hover:surface-2"><X size={19}/></button>
        </div>

        <div className="p-6">
          <div className="surface-2 mb-5 grid grid-cols-3 rounded-xl p-1">
            {([
              ["file", "上传文件", Upload],
              ["paste", "粘贴数据", FileSpreadsheet],
              ["sample", "示例数据", Sparkles],
            ] as const).map(([value, label, Icon]) => (
              <button key={value} onClick={() => setSource(value)}
                className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm ${source === value ? "surface shadow-sm" : "muted"}`}>
                <Icon size={16}/>{label}
              </button>
            ))}
          </div>

          {source === "file" && (
            <label className="surface-2 border-ui flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-6 text-center">
              <Upload className="brand mb-3" />
              <span className="font-medium">选择文件</span>
              <span className="muted mt-2 text-sm">最大导入 20,000 行</span>
              <input type="file" className="hidden" accept=".csv,.tsv,.txt,.json,.xlsx,.xls,.xlsb,.xlsm,.ods,.dta"
                onChange={(e) => e.target.files?.[0] && void parseFile(e.target.files[0])}/>
            </label>
          )}

          {source === "paste" && (
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)}
              className="surface-2 border-ui h-44 w-full rounded-2xl border p-4 outline-none focus:border-[var(--brand)]"
              placeholder="粘贴 CSV、TSV 或从 Excel 复制的表格…" />
          )}

          {source === "sample" && (
            <div className="surface-2 rounded-2xl p-5">
              <p className="font-medium">电商销售示例数据</p>
              <p className="muted mt-2 text-sm">180 天 × 4 个渠道，包含趋势、异常峰值、退款与毛利率等字段。</p>
            </div>
          )}

          <label className="mt-5 block">
            <span className="mb-1.5 block text-sm font-medium">数据集名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="surface-2 border-ui w-full rounded-xl border px-3.5 py-3 outline-none focus:border-[var(--brand)]"
              placeholder="例如：Q3 销售明细"/>
          </label>

          {note && <p className="muted mt-3 text-sm">{note}</p>}
          {parsed && <p className="mt-2 text-sm text-[var(--success)]">✓ {parsed.rows.length} 行，{parsed.columns.length} 个字段</p>}
        </div>

        <div className="border-ui flex justify-end gap-2 border-t px-6 py-4">
          <button onClick={onClose} className="surface border-ui rounded-xl border px-4 py-2.5 text-sm">取消</button>
          <button disabled={busy} onClick={() => void importNow()} className="brand-bg rounded-xl px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "处理中…" : "导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
