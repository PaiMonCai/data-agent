import { Parse } from "./parse";
import type { DataRow, ParsedTable } from "./types";

/* statfmt 只发 JS、不带类型，这里按 CDN 上那几个子模块的实际导出逐个声明。
   只覆盖 dta 分支真正用到的部分，其余交给 unknown。 */

/** statfmt 里带 toJS() 的标量值 */
interface StatfmtValue {
  toJS?: () => unknown;
}

/** statfmt 变量元信息对象的读取接口 */
interface StatfmtVariableMeta {
  getName?: () => string;
  getLabel?: () => string | null;
  getFormat?: () => string | null;
  type: unknown;
}

export interface StataValueLabel {
  value: unknown;
  label: string;
}

/** 我们自己维护的变量表顿；valueLabels 在解析完成后回填 */
interface StataVariable {
  index: number;
  name: string;
  label: string | null;
  type: unknown;
  format: string | null;
  valueLabelsName: string | null;
  valueLabels: StataValueLabel[] | null;
}

interface StataDataset {
  metadata: Record<string, unknown>;
  variables: StataVariable[];
  rows: unknown[][];
}

interface StatfmtParser {
  setCodec?: (codec: unknown) => void;
  setMetadataHandler(handler: (meta: Record<string, unknown>) => void): void;
  setVariableHandler(
    handler: (index: number, meta: StatfmtVariableMeta, valueLabelsName: string | null) => void
  ): void;
  setValueHandler(
    handler: (obsIndex: number, variable: { index: number }, value: StatfmtValue | null) => void
  ): void;
  setValueLabelHandler(
    handler: (name: string, value: StatfmtValue | null, label: string) => void
  ): void;
}

interface StatfmtIoContext {}

interface StatfmtParserModule {
  ReadStatParser: new () => StatfmtParser;
}

interface StatfmtIoModule {
  BufferIoContext: new (bytes: Uint8Array) => StatfmtIoContext;
}

interface StatfmtErrorModule {
  ReadStatError: { OK: number };
  readstatErrorMessage?: (code: number) => string;
}

interface StatfmtDtaModule {
  parseDta: (parser: StatfmtParser, io: StatfmtIoContext, opts: unknown) => number;
}

/** load() 缓存起来的部件，也就是上面四个子模块的合集 */
interface StatfmtModules {
  ReadStatParser: StatfmtParserModule["ReadStatParser"];
  BufferIoContext: StatfmtIoModule["BufferIoContext"];
  ReadStatError: StatfmtErrorModule["ReadStatError"];
  readstatErrorMessage: StatfmtErrorModule["readstatErrorMessage"];
  parseDta: StatfmtDtaModule["parseDta"];
}

/* Stata .dta 解析适配器
   底层用 @irbisadm/statfmt（ReadStat 的纯 TypeScript 移植，无 WASM、无原生依赖），
   按需从 CDN 动态 import，只在用户真的上传 .dta 时才加载，不影响首屏。
   注意：statfmt 顶层 index.js 会连带引入依赖 node:zlib 的 SPSS 模块，浏览器里加载会失败，
   所以这里只 import Stata 用到的几个子模块，绕开顶层入口。 */
const Dta = (function () {
  const CDN = 'https://cdn.jsdelivr.net/npm/@irbisadm/statfmt@0.1.1/dist/';
  let cache: StatfmtModules | null = null;
  /** CDN 上的模块是运行时才拿到的，类型只能由调用方逐个给出 */
  const remoteImport = <T>(url: string): Promise<T> => new Function('u', 'return import(u)')(url);

  async function load(base?: string): Promise<StatfmtModules> {
    if (cache) return cache;
    const b = base || CDN;
    const [parserMod, ioMod, errMod, dtaMod] = await Promise.all([
      remoteImport<StatfmtParserModule>(b + 'parser.js'),
      remoteImport<StatfmtIoModule>(b + 'io.js'),
      remoteImport<StatfmtErrorModule>(b + 'errors.js'),
      remoteImport<StatfmtDtaModule>(b + 'stata/dta-read.js'),
    ]);
    cache = {
      ReadStatParser: parserMod.ReadStatParser,
      BufferIoContext: ioMod.BufferIoContext,
      ReadStatError: errMod.ReadStatError,
      readstatErrorMessage: errMod.readstatErrorMessage,
      parseDta: dtaMod.parseDta,
    };
    return cache;
  }

  /* 编码修正：statfmt 对 dta<118 默认按 WINDOWS-1252 解码，而中文/日文等
     用 Stata 14+ 存的老格式文件里其实是 UTF-8 字节，直接解会变"ç·"这种乱码。
     这里注入一个解码器：先按 UTF-8 严格解，不合法再退回库原本指定的编码，
     这样中文 UTF-8 文件和真正的西欧 cp1252 文件都能正确显示。 */
  function makeCodec() {
    const cache = new Map<string, TextDecoder>();
    const dec = (label: string, fatal: boolean): TextDecoder => {
      const k = label + (fatal ? '!' : '');
      let d = cache.get(k);
      if (!d) cache.set(k, (d = new TextDecoder(label, { fatal })));
      return d;
    };
    return {
      decode(bytes: Uint8Array, encoding?: string | null): string {
        try { return dec('utf-8', true).decode(bytes); } catch (e) { /* 不是 UTF-8，走原编码 */ }
        const label = String(encoding || 'utf-8').toLowerCase();
        try { return dec(label, false).decode(bytes); } catch (e) { return dec('iso-8859-1', false).decode(bytes); }
      },
    };
  }

  // 复刻 statfmt 的 readData('dta')，但只依赖 Stata 子模块
  async function readDataset(bytes: Uint8Array, base?: string): Promise<StataDataset> {
    const M = await load(base);
    const parser = new M.ReadStatParser();
    if (parser.setCodec) parser.setCodec(makeCodec());
    let metadata: Record<string, unknown> | null = null;
    const variables: StataVariable[] = [];
    const rows: unknown[][] = [];
    const labelSets = new Map<string, StataValueLabel[]>();
    const varsByLabelName = new Map<string, StataVariable[]>();

    parser.setMetadataHandler((m) => { metadata = m; });
    parser.setVariableHandler((index, v, valLabels) => {
      variables[index] = {
        index,
        name: (v.getName && v.getName()) || ('var' + (index + 1)),
        label: v.getLabel ? v.getLabel() : null,
        type: v.type,
        format: v.getFormat ? v.getFormat() : null,
        valueLabelsName: valLabels || null,
        valueLabels: null,
      };
      if (valLabels) {
        let arr = varsByLabelName.get(valLabels);
        if (!arr) varsByLabelName.set(valLabels, (arr = []));
        arr.push(variables[index]);
      }
    });
    parser.setValueHandler((obsIndex, v, value) => {
      let row = rows[obsIndex];
      if (!row) rows[obsIndex] = row = [];
      row[v.index] = value && value.toJS ? value.toJS() : value;
    });
    parser.setValueLabelHandler((name, value, label) => {
      let arr = labelSets.get(name);
      if (!arr) labelSets.set(name, (arr = []));
      arr.push({ value: value && value.toJS ? value.toJS() : value, label });
    });

    const code = M.parseDta(parser, new M.BufferIoContext(bytes), null);
    if (code !== M.ReadStatError.OK) {
      const msg = M.readstatErrorMessage ? M.readstatErrorMessage(code) : null;
      throw new Error('无法解析该 .dta 文件' + (msg ? '：' + msg : '（可能是版本过旧或文件损坏，可先另存为 CSV）'));
    }
    labelSets.forEach((pairs, name) => {
      const vars = varsByLabelName.get(name);
      if (vars) vars.forEach((v) => { v.valueLabels = pairs; });
    });
    return { metadata: metadata || {}, variables: variables.filter(Boolean), rows };
  }

  function cellToValue(v: unknown): unknown {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
      const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
      const hh = v.getHours(), mm = v.getMinutes();
      return hh || mm ? `${y}-${m}-${d} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : `${y}-${m}-${d}`;
    }
    return v;
  }

  /* 转成应用内部表格结构：{ headers, rows, columns, meta }
     带值标签的字段（1=男 / 2=女）默认还原成文字，便于分组分析和看图 */
  async function read(bytes: Uint8Array, base?: string): Promise<ParsedTable> {
    const ds = await readDataset(bytes, base);
    const variables = ds.variables;
    const headers = variables.map((v) => v.name);
    const applied: Array<{ field: string; map: string }> = [];

    const rows = ds.rows.map((arr) => {
      const o: DataRow = {};
      variables.forEach((v) => {
        let val = cellToValue(arr[v.index]);
        if (v.valueLabels && v.valueLabels.length) {
          const hit = v.valueLabels.find((l) => String(l.value) === String(val));
          if (hit) val = hit.label;
        }
        o[v.name] = val;
      });
      return o;
    });

    variables.forEach((v) => {
      if (v.valueLabels && v.valueLabels.length) {
        applied.push({ field: v.name, map: v.valueLabels.map((l) => `${l.value}=${l.label}`).join(' / ') });
      }
    });

    const columns = Parse.inferColumns(headers, rows);
    columns.forEach((c) => {
      const src = variables.find((v) => v.name === c.name);
      if (!src) return;
      if (src.label) c.desc = src.label;
      if (src.valueLabels && src.valueLabels.length) c.labels = src.valueLabels.map((l) => `${l.value}=${l.label}`).join(' / ');
    });

    return {
      headers,
      rows,
      columns,
      meta: {
        fileLabel: ds.metadata.fileLabel || '',
        version: ds.metadata.fileFormatVersion || 0,
        rowCount: rows.length,
        appliedLabels: applied,
      },
    };
  }

  return { read, load };
})();


export { Dta };
export default Dta;
