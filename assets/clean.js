/* 数据清洗引擎：用自然语言描述 -> 操作序列 -> 在这里真实执行，输出逐步清洗报告
   设计原则同分析引擎：不改数据语义，不执行任何来自模型的字符串代码（表达式走自研解析器） */
window.Clean = (function () {
  const N = Parse.toNumber;
  const D = Parse.toDate;

  const BLANK_RE = /^(null|none|nil|na|n\/a|nan|-|--|—|unknown)$/i;
  function isBlank(v) {
    if (v === null || v === undefined) return true;
    const s = String(v).trim();
    return s === '' || BLANK_RE.test(s);
  }

  function headersOf(columns) { return columns.map((c) => c.name); }

  function rebuild(rows, columns) {
    const names = headersOf(columns);
    return Parse.inferColumns(names, rows);
  }

  function median(a) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mode(a) {
    const cnt = new Map();
    a.forEach((v) => cnt.set(v, (cnt.get(v) || 0) + 1));
    let best = a[0], bestN = 0;
    cnt.forEach((n, v) => { if (n > bestN) { bestN = n; best = v; } });
    return best;
  }

  /* ================= 安全表达式求值 =================
     只认数字、字符串、字段名、白名单函数和有限运算符，绝不 eval / new Function */
  const FUNCS = {
    ROUND: (a, b = 0) => { const p = Math.pow(10, b); return Math.round(a * p) / p; },
    ABS: (a) => Math.abs(a),
    CEIL: (a) => Math.ceil(a),
    FLOOR: (a) => Math.floor(a),
    MIN: (...a) => Math.min(...a),
    MAX: (...a) => Math.max(...a),
    SUM: (...a) => a.reduce((x, y) => x + y, 0),
    AVG: (...a) => a.reduce((x, y) => x + y, 0) / a.length,
    LEN: (a) => String(a).length,
    UPPER: (a) => String(a).toUpperCase(),
    LOWER: (a) => String(a).toLowerCase(),
    TRIM: (a) => String(a).trim(),
    NUMBER: (a) => { const n = N(a); return n === null ? 0 : n; },
    IF: (c, a, b) => (c ? a : b),
    YEAR: (a) => { const d = D(a); return d ? d.getFullYear() : 0; },
    MONTH: (a) => { const d = D(a); return d ? d.getMonth() + 1 : 0; },
    DAY: (a) => { const d = D(a); return d ? d.getDate() : 0; },
    LEFT: (a, n) => String(a).slice(0, n),
    RIGHT: (a, n) => String(a).slice(-n),
    CONCAT: (...a) => a.join(''),
  };

  function tokenize(src) {
    const s = String(src);
    const out = [];
    let i = 0;
    const isIdentStart = (c) => /[A-Za-z_\u4e00-\u9fa5]/.test(c);
    const isIdent = (c) => /[A-Za-z0-9_\u4e00-\u9fa5.]/.test(c);
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1, buf = '';
        while (j < s.length && s[j] !== c) buf += s[j++];
        out.push({ t: 'str', v: buf });
        i = j + 1;
        continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(s[i + 1] || ''))) {
        let j = i, buf = '';
        while (j < s.length && /[0-9.]/.test(s[j])) buf += s[j++];
        out.push({ t: 'num', v: parseFloat(buf) });
        i = j;
        continue;
      }
      if (isIdentStart(c)) {
        let j = i, buf = '';
        while (j < s.length && isIdent(s[j])) buf += s[j++];
        out.push({ t: 'id', v: buf });
        i = j;
        continue;
      }
      const two = s.substr(i, 2);
      if (['>=', '<=', '!=', '=='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/%^(),<>'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
      throw new Error('表达式里有无法识别的符号：' + c);
    }
    return out;
  }

  function evalExpr(src, row, names) {
    const tk = tokenize(src);
    let p = 0;
    const peek = () => tk[p];
    const eat = (v) => { if (tk[p] && tk[p].v === v) { p++; return true; } return false; };

    function lookup(name) {
      if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
      const hit = names.find((n) => n === name)
        || names.find((n) => String(n).toLowerCase() === String(name).toLowerCase())
        || names.find((n) => String(n).replace(/\s/g, '') === String(name).replace(/\s/g, ''));
      if (!hit) throw new Error('表达式引用了不存在的字段：' + name);
      return row[hit];
    }

    function logic() {
      let left = comparison();
      while (peek() && peek().t === 'id' && ['AND', 'OR', 'and', 'or', '&&', '||'].includes(peek().v)) {
        const op = tk[p++].v.toUpperCase();
        const right = comparison();
        left = (op === 'OR' || op === '||') ? (left || right) : (left && right);
      }
      return left;
    }

    function comparison() {
      let left = additive();
      if (peek() && peek().t === 'op' && ['=', '==', '!=', '>', '<', '>=', '<='].includes(peek().v)) {
        const op = tk[p++].v;
        const right = additive();
        const ln = N(left), rn = N(right);
        const cmp = (ln !== null && rn !== null) ? ln - rn
          : String(left).localeCompare(String(right), 'zh-CN');
        if (op === '=' || op === '==') return cmp === 0;
        if (op === '!=') return cmp !== 0;
        if (op === '>') return cmp > 0;
        if (op === '<') return cmp < 0;
        if (op === '>=') return cmp >= 0;
        return cmp <= 0;
      }
      return left;
    }

    function additive() {
      let v = multiplicative();
      while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = tk[p++].v;
        const r = multiplicative();
        const ln = N(v), rn = N(r);
        if (ln !== null && rn !== null && !/^[A-Za-z\u4e00-\u9fa5]/.test(String(v).trim()) === false) {
          // 数值相加；字符串拼接也支持
        }
        v = op === '+' ? ((ln !== null && rn !== null && String(v).trim() !== '' && String(r).trim() !== '') ? ln + rn : String(v) + String(r))
          : (ln !== null && rn !== null ? ln - rn : NaN);
      }
      return v;
    }

    function multiplicative() {
      let v = unary();
      while (peek() && peek().t === 'op' && ['*', '/', '%', '^'].includes(peek().v)) {
        const op = tk[p++].v;
        const r = unary();
        const a = N(v), b = N(r);
        if (a === null || b === null) throw new Error('参与运算的字段不是数值：' + v + ' ' + op + ' ' + r);
        v = op === '*' ? a * b : op === '/' ? (b === 0 ? 0 : a / b) : op === '%' ? (b === 0 ? 0 : a % b) : Math.pow(a, b);
      }
      return v;
    }

    function unary() {
      if (peek() && peek().t === 'op' && (peek().v === '-' || peek().v === '+')) {
        const op = tk[p++].v;
        const v = unary();
        const n = N(v);
        return op === '-' ? -(n === null ? 0 : n) : (n === null ? v : n);
      }
      return primary();
    }

    function primary() {
      const t = peek();
      if (!t) throw new Error('表达式不完整');
      if (t.t === 'num') { p++; return t.v; }
      if (t.t === 'str') { p++; return t.v; }
      if (t.t === 'op' && t.v === '(') {
        p++;
        const v = logic();
        if (!eat(')')) throw new Error('括号不匹配');
        return v;
      }
      if (t.t === 'id') {
        p++;
        const name = t.v;
        if (peek() && peek().t === 'op' && peek().v === '(') {
          p++;
          const args = [];
          if (!(peek() && peek().t === 'op' && peek().v === ')')) {
            args.push(logic());
            while (eat(',')) args.push(logic());
          }
          if (!eat(')')) throw new Error('函数括号不匹配：' + name);
          const fn = FUNCS[name.toUpperCase()];
          if (!fn) throw new Error('不支持的函数：' + name);
          return fn.apply(null, args);
        }
        return lookup(name);
      }
      throw new Error('表达式解析失败：' + JSON.stringify(t));
    }

    const val = logic();
    if (p < tk.length) throw new Error('表达式末尾有多余内容');
    return val;
  }

  /* ================= 清洗操作 ================= */
  const OPS = {
    drop_duplicates(rows, columns, op) {
      const keys = (op.columns || []).filter((c) => headersOf(columns).includes(c));
      const seen = new Set();
      const out = [];
      rows.forEach((r) => {
        const k = keys.length ? keys.map((c) => String(r[c])).join('\u0001') : JSON.stringify(r);
        if (seen.has(k)) return;
        seen.add(k);
        out.push(r);
      });
      const removed = rows.length - out.length;
      return { rows: out, columns, affected: removed,
        summary: removed ? `删除了 ${removed} 行重复数据${keys.length ? '（按 ' + keys.join('、') + ' 判定）' : '（整行完全相同）'}` : '未发现重复行' };
    },

    fill_null(rows, columns, op) {
      const col = op.column;
      if (!col || !headersOf(columns).includes(col)) return { rows, columns, affected: 0, summary: '字段不存在，跳过' };
      const strategy = op.strategy || 'value';
      const vals = rows.map((r) => N(r[col])).filter((v) => v !== null);
      const nonEmpty = rows.map((r) => r[col]).filter((v) => !isBlank(v));
      let filler = op.value;
      if (strategy === 'mean') filler = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : '';
      else if (strategy === 'median') filler = median(vals);
      else if (strategy === 'mode') filler = nonEmpty.length ? mode(nonEmpty.map(String)) : '';
      else if (strategy === 'zero') filler = 0;
      const label = { mean: '均值', median: '中位数', mode: '众数', ffill: '上一行的值', bfill: '下一行的值', value: '指定值', zero: '零' }[strategy] || strategy;

      let n = 0, prev = null;
      if (strategy === 'bfill') {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (isBlank(rows[i][col])) { if (prev !== null) { rows[i][col] = prev; n++; } }
          else prev = rows[i][col];
        }
      } else {
        rows.forEach((r) => {
          if (!isBlank(r[col])) { prev = r[col]; return; }
          r[col] = strategy === 'ffill' ? (prev === null ? '' : prev) : filler;
          n++;
        });
      }
      return { rows, columns, affected: n, summary: `用${label}填充了「${col}」的 ${n} 个缺失值` };
    },

    drop_null(rows, columns, op) {
      const cols = (op.columns || []).filter((c) => headersOf(columns).includes(c));
      const targets = cols.length ? cols : headersOf(columns);
      const how = op.how === 'all' ? 'all' : 'any';
      const out = rows.filter((r) => {
        const blanks = targets.filter((c) => isBlank(r[c])).length;
        return how === 'all' ? blanks < targets.length : blanks === 0;
      });
      const removed = rows.length - out.length;
      return { rows: out, columns, affected: removed,
        summary: removed ? `删除了 ${removed} 行含缺失值的记录（${targets.join('、')}）` : '没有含缺失值的行' };
    },

    keep_rows(rows, columns, op) {
      const out = rows.filter((r) => (op.filters || []).every((f) => Engine.pass(r, f)));
      const removed = rows.length - out.length;
      return { rows: out, columns, affected: removed, summary: `按条件保留后剩 ${out.length} 行（剔除 ${removed} 行）` };
    },

    drop_rows(rows, columns, op) {
      const out = rows.filter((r) => !(op.filters || []).every((f) => Engine.pass(r, f)));
      const removed = rows.length - out.length;
      return { rows: out, columns, affected: removed, summary: `按条件删除了 ${removed} 行，剩 ${out.length} 行` };
    },

    convert(rows, columns, op) {
      const col = op.column;
      if (!col || !headersOf(columns).includes(col)) return { rows, columns, affected: 0, summary: '字段不存在，跳过' };
      const type = op.type;
      let fail = 0;
      rows.forEach((r) => {
        const raw = r[col];
        if (isBlank(raw)) return;
        if (type === 'number') {
          const v = N(raw);
          if (v === null) { fail++; r[col] = ''; } else r[col] = v;
        } else if (type === 'date') {
          const d = D(raw);
          if (!d) { fail++; r[col] = ''; } else r[col] = d.toISOString().slice(0, 10);
        } else if (type === 'text') {
          r[col] = String(raw);
        }
      });
      return { rows, columns, affected: fail,
        summary: `「${col}」已转为${type === 'number' ? '数值' : type === 'date' ? '日期' : '文本'}${fail ? `，${fail} 个值无法转换被置空` : ''}` };
    },

    rename(rows, columns, op) {
      const from = op.from, to = op.to;
      if (!from || !to || !headersOf(columns).includes(from)) return { rows, columns, affected: 0, summary: '字段不存在，跳过' };
      rows.forEach((r) => { r[to] = r[from]; delete r[from]; });
      const cols = columns.map((c) => (c.name === from ? Object.assign({}, c, { name: to }) : c));
      return { rows, columns: cols, affected: 1, summary: `「${from}」已改名为「${to}」` };
    },

    drop_columns(rows, columns, op) {
      const drop = (op.columns || []).filter((c) => headersOf(columns).includes(c));
      rows.forEach((r) => drop.forEach((c) => { delete r[c]; }));
      const cols = columns.filter((c) => !drop.includes(c.name));
      return { rows, columns: cols, affected: drop.length, summary: `已删除 ${drop.length} 个字段：${drop.join('、')}` };
    },

    replace(rows, columns, op) {
      const col = op.column;
      if (!col || !headersOf(columns).includes(col)) return { rows, columns, affected: 0, summary: '字段不存在，跳过' };
      const map = op.map && typeof op.map === 'object' ? op.map : { [op.from]: op.to };
      let n = 0;
      rows.forEach((r) => {
        const key = String(r[col]);
        if (Object.prototype.hasOwnProperty.call(map, key)) { r[col] = map[key]; n++; }
        else if (op.contains) {
          Object.keys(map).forEach((k) => {
            if (key.indexOf(k) >= 0) { r[col] = map[k]; n++; }
          });
        }
      });
      return { rows, columns, affected: n, summary: `「${col}」替换了 ${n} 个值` };
    },

    normalize(rows, columns, op) {
      const cols = (op.columns || [op.column]).filter((c) => c && headersOf(columns).includes(c));
      const mode = op.mode || 'trim';
      let n = 0;
      rows.forEach((r) => {
        cols.forEach((c) => {
          const before = String(r[c] === undefined || r[c] === null ? '' : r[c]);
          let v = before;
          if (mode === 'trim' || mode === 'all') v = v.trim();
          if (mode === 'collapse' || mode === 'all') v = v.replace(/\s+/g, ' ');
          if (mode === 'lower') v = v.trim().toLowerCase();
          if (mode === 'upper') v = v.trim().toUpperCase();
          if (mode === 'digits') v = v.replace(/[^\d.-]/g, '');
          if (v !== before) { r[c] = v; n++; }
        });
      });
      const label = { trim: '去除首尾空格', collapse: '合并多余空格', lower: '统一小写', upper: '统一大写', digits: '只保留数字', all: '空格规范化' }[mode] || mode;
      return { rows, columns, affected: n, summary: `${cols.join('、')} 已${label}，影响 ${n} 个值` };
    },

    split(rows, columns, op) {
      const col = op.column;
      if (!col || !headersOf(columns).includes(col)) return { rows, columns, affected: 0, summary: '字段不存在，跳过' };
      const delim = op.delimiter || ' ';
      const into = op.into || [col + '_1', col + '_2'];
      rows.forEach((r) => {
        const parts = String(r[col] === undefined ? '' : r[col]).split(delim);
        into.forEach((name, i) => { r[name] = parts[i] === undefined ? '' : parts[i].trim(); });
      });
      const cols = rebuild(rows, columns.concat(into.map((n) => ({ name: n, type: 'string' }))));
      return { rows, columns: cols, affected: rows.length, summary: `「${col}」按「${delim}」拆分为：${into.join('、')}` };
    },

    derive(rows, columns, op) {
      const name = op.name;
      const expr = op.expr;
      if (!name || !expr) return { rows, columns, affected: 0, summary: '缺少新字段名或表达式，跳过' };
      const names = headersOf(columns);
      let ok = 0, fail = 0, lastErr = '';
      rows.forEach((r) => {
        try {
          const v = evalExpr(expr, r, names);
          r[name] = typeof v === 'number' ? (Math.round(v * 1000000) / 1000000) : (v === true || v === false ? String(v) : v);
          ok++;
        } catch (e) { fail++; lastErr = e.message; r[name] = ''; }
      });
      const cols = rebuild(rows, columns.concat([{ name, type: 'string' }]));
      return { rows, columns: cols, affected: ok,
        summary: `新增字段「${name}」= ${expr}${fail ? `（${fail} 行计算失败${lastErr ? '：' + lastErr : ''}）` : ''}` };
    },

    sort(rows, columns, op) {
      const by = op.by;
      if (!by || !headersOf(columns).includes(by)) return { rows, columns, affected: 0, summary: '排序字段不存在，跳过' };
      const asc = op.order !== 'desc';
      const out = rows.slice().sort((a, b) => {
        const na = N(a[by]), nb = N(b[by]);
        const cmp = (na !== null && nb !== null) ? na - nb : String(a[by]).localeCompare(String(b[by]), 'zh-CN');
        return asc ? cmp : -cmp;
      });
      return { rows: out, columns, affected: rows.length, summary: `已按「${by}」${asc ? '升序' : '降序'}排列` };
    },

    sample(rows, columns, op) {
      const n = Math.max(1, Math.min(rows.length, Number(op.n) || rows.length));
      const mode = op.mode || 'head';
      let out;
      if (mode === 'tail') out = rows.slice(-n);
      else if (mode === 'random') {
        const pool = rows.slice();
        out = [];
        for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      } else out = rows.slice(0, n);
      return { rows: out, columns, affected: out.length, summary: `已${mode === 'tail' ? '取末尾' : mode === 'random' ? '随机抽样' : '取前'} ${out.length} 行` };
    },

    clip(rows, columns, op) {
      const col = op.column;
      if (!col || !headersOf(columns).includes(col)) return { rows, columns, affected: 0, summary: '字段不存在，跳过' };
      const min = op.min === undefined ? -Infinity : N(op.min);
      const max = op.max === undefined ? Infinity : N(op.max);
      let n = 0;
      rows.forEach((r) => {
        const v = N(r[col]);
        if (v === null) return;
        if (v < min) { r[col] = min; n++; }
        else if (v > max) { r[col] = max; n++; }
      });
      return { rows, columns, affected: n, summary: `「${col}」把 ${n} 个超出 [${min}, ${max}] 的值截断到边界` };
    },
  };

  const OP_LABEL = {
    drop_duplicates: '去重', fill_null: '填充缺失值', drop_null: '删除缺失行',
    keep_rows: '条件筛选', drop_rows: '条件删除', convert: '类型转换', rename: '字段改名',
    drop_columns: '删除字段', replace: '值替换', normalize: '文本规范化', split: '字段拆分',
    derive: '派生新字段', sort: '排序', sample: '抽样', clip: '异常值截断',
  };

  /* ================= 主入口 ================= */
  function run(rows, columns, ops) {
    let cur = rows.map((r) => Object.assign({}, r));
    let cols = columns;
    const report = [];
    const before = { rows: rows.length, cols: columns.length };

    (ops || []).forEach((op) => {
      const fn = OPS[op && op.op];
      if (!fn) {
        report.push({ op: (op && op.op) || '未知', label: '不支持的操作', affected: 0, summary: '该操作未实现，已跳过' });
        return;
      }
      try {
        const res = fn(cur, cols, op);
        cur = res.rows;
        cols = res.columns;
        report.push({ op: op.op, label: OP_LABEL[op.op] || op.op, affected: res.affected, summary: res.summary });
      } catch (e) {
        report.push({ op: op.op, label: OP_LABEL[op.op] || op.op, affected: 0, summary: '执行失败：' + e.message });
      }
    });

    return {
      rows: cur,
      columns: rebuild(cur, cols),
      report,
      before,
      after: { rows: cur.length, cols: cols.length },
    };
  }

  return { run, evalExpr, isBlank };
})();
