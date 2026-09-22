// @ts-nocheck

/* 数据解析：分隔文本 / JSON -> { headers, rows, columns } */
const Parse = (function () {

  function detectDelimiter(text) {
    const head = text.split(/\r?\n/).slice(0, 5).join('\n');
    const cands = [',', '\t', ';', '|'];
    let best = ',', bestScore = -1;
    for (const d of cands) {
      const lines = head.split('\n').filter(Boolean);
      const counts = lines.map((l) => splitLine(l, d).length);
      const avg = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);
      const consistent = counts.every((c) => c === counts[0]);
      const score = avg + (consistent ? 10 : 0);
      if (avg > 1 && score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  function splitLine(line, delim) {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else quoted = false;
        } else cur += c;
      } else if (c === '"') {
        quoted = true;
      } else if (c === delim) {
        out.push(cur); cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  }

  function toNumber(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    const cleaned = s.replace(/[,\s]/g, '').replace(/[¥$€]/g, '').replace(/%$/, '');
    if (cleaned === '' || isNaN(Number(cleaned))) return null;
    return Number(cleaned);
  }

  function toDate(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return isNaN(d.getTime()) ? null : d;
    }
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
      return isNaN(d.getTime()) ? null : d;
    }
    const n = Number(s);
    if (/^\d{10}$/.test(s) || /^\d{13}$/.test(s)) {
      const d = new Date(s.length === 13 ? n : n * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    if (/^\d{4}$/.test(s)) return new Date(Number(s), 0, 1);
    return null;
  }

  function inferColumnType(values) {
    const sample = values.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').slice(0, 200);
    if (!sample.length) return 'string';
    let num = 0, date = 0;
    for (const v of sample) {
      if (toNumber(v) !== null) num++;
      if (toDate(v) !== null) date++;
    }
    const ratio = (x) => x / sample.length;
    if (ratio(date) >= 0.9 && num < sample.length) return 'date';
    if (ratio(num) >= 0.9) return 'number';
    return 'string';
  }

  /* 文本 -> 表格 */
  function fromText(text, opts = {}) {
    const raw = String(text).replace(/^﻿/, '').trim();
    if (!raw) throw new Error('内容为空');

    const trimmed = raw.trimLeft();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      return fromJSON(JSON.parse(raw));
    }

    const delim = opts.delimiter || detectDelimiter(raw);
    const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
    const grid = lines.map((l) => splitLine(l, delim));
    const width = Math.max(...grid.map((r) => r.length));
    for (const r of grid) while (r.length < width) r.push('');

    const hasHeader = opts.hasHeader !== undefined ? opts.hasHeader : guessHeader(grid);
    let headers, body;
    if (hasHeader) {
      headers = grid[0].map((h, i) => String(h).trim() || ('列' + (i + 1)));
      body = grid.slice(1);
    } else {
      headers = grid[0].map((_, i) => '列' + (i + 1));
      body = grid;
    }
    headers = dedupe(headers);
    const rows = body
      .filter((r) => r.some((c) => String(c).trim() !== ''))
      .map((r) => {
        const o = {};
        headers.forEach((h, i) => { o[h] = r[i] === undefined ? '' : String(r[i]).trim(); });
        return o;
      });
    return build(headers, rows);
  }

  function fromJSON(json) {
    const arr = Array.isArray(json) ? json : (Array.isArray(json.data) ? json.data : [json]);
    if (!arr.length) throw new Error('JSON 中没有数据行');
    const headers = dedupe(Object.keys(arr[0]));
    const rows = arr.map((o) => {
      const r = {};
      headers.forEach((h) => {
        const v = o[h];
        r[h] = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
      });
      return r;
    });
    return build(headers, rows);
  }

  function guessHeader(grid) {
    if (grid.length < 2) return true;
    const first = grid[0];
    const nonNumeric = first.filter((c) => toNumber(c) === null).length;
    const allText = grid.slice(1, 6).map((r) => r.filter((c) => toNumber(c) === null).length);
    return nonNumeric === first.length && allText.every((n) => n <= nonNumeric);
  }

  function dedupe(names) {
    const seen = {};
    return names.map((n) => {
      if (!seen[n]) { seen[n] = 1; return n; }
      seen[n]++;
      return n + '_' + seen[n];
    });
  }

  function inferColumns(headers, rows) {
    return headers.map((name) => {
      const vals = rows.slice(0, 500).map((r) => r[name]);
      const type = inferColumnType(vals);
      const nonEmpty = vals.filter((v) => String(v || '').trim() !== '');
      const uniq = new Set(nonEmpty.map((v) => String(v)));
      const nums = nonEmpty.map(toNumber).filter((v) => v !== null);
      return {
        name,
        type,
        unique: uniq.size,
        sample: Array.from(uniq).slice(0, 5),
        min: nums.length ? Math.min(...nums) : null,
        max: nums.length ? Math.max(...nums) : null,
      };
    });
  }

  function build(headers, rows) {
    return { headers, rows, columns: inferColumns(headers, rows) };
  }

  /* ---------- Excel / WPS 表格 ---------- */
  const XLSX_EXT = /\.(xlsx|xlsm|xls|xlsb|ods)$/i;

  function isExcel(fileName) { return XLSX_EXT.test(String(fileName || '')); }

  async function workbook(arrayBuffer) {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    if (!wb.SheetNames.length) throw new Error('这个文件里没有工作表');
    return {
      sheets: wb.SheetNames,
      use(sheetName) {
        const name = sheetName || wb.SheetNames[0];
        const ws = wb.Sheets[name];
        if (!ws) throw new Error('找不到工作表：' + name);
        const arr = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
        if (!arr.length) throw new Error('工作表「' + name + '」没有数据');
        const headers = dedupe(Object.keys(arr[0]));
        return build(headers, arr.map((o) => {
          const row = {};
          headers.forEach((h) => {
            const v = o[h];
            row[h] = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
          });
          return row;
        }));
      },
    };
  }

  /* ---------- 示例数据 ---------- */
  function sampleData() {
    const channels = ['线上商城', '线下门店', '社群团购', '直播带货'];
    const regions = ['华东', '华北', '华南', '西南'];
    const headers = ['日期', '渠道', '地区', '订单数', '销售额', '退款额', '访客数', '毛利率'];
    const rows = [];
    const start = new Date();
    start.setDate(start.getDate() - 179);
    let seed = 20260701;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

    for (let d = 0; d < 180; d++) {
      const date = new Date(start.getTime());
      date.setDate(date.getDate() + d);
      const dow = date.getDay();
      const weekend = dow === 0 || dow === 6 ? 1.35 : 1;
      for (const ch of channels) {
        const region = regions[Math.floor(rnd() * regions.length)];
        const base = { '线上商城': 3200, '线下门店': 2400, '社群团购': 1500, '直播带货': 2600 }[ch];
        const trend = 1 + d / 260;
        let sales = base * trend * weekend * (0.75 + rnd() * 0.5);
        // 制造两处异常：一次大促峰值、一次系统故障导致的断崖
        if (d === 96) sales *= 4.2;
        if (d === 137) sales *= 0.28;
        sales = Math.round(sales * 100) / 100;
        const orders = Math.max(1, Math.round(sales / (95 + rnd() * 45)));
        const refund = Math.round(sales * (0.01 + rnd() * 0.06) * 100) / 100;
        const visitors = Math.round(orders * (7 + rnd() * 5));
        const margin = Math.round((0.22 + rnd() * 0.2) * 1000) / 1000;
        rows.push({
          日期: date.toISOString().slice(0, 10),
          渠道: ch,
          地区: region,
          订单数: orders,
          销售额: sales,
          退款额: refund,
          访客数: visitors,
          毛利率: margin,
        });
      }
    }
    return build(headers, rows);
  }

  /* ---------- Stata / 统计软件格式 ---------- */
  function isStata(fileName) { return /\.dta$/i.test(String(fileName || '')); }

  async function fromStata(bytes) { const { Dta } = await import('./dta'); return Dta.read(bytes); }

  return {
    fromText, fromJSON, workbook, isExcel, isStata, fromStata,
    sampleData, inferColumns, toNumber, toDate, inferColumnType,
  };
})();


export { Parse };
export default Parse;
