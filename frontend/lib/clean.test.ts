import test from "node:test";
import assert from "node:assert/strict";
import { Parse } from "./parse.ts";
import { Clean } from "./clean.ts";
import type { CleanStep } from "./types.ts";

/* 一份固定的小数据集：带空值、脏空格、非数值、可拆分文本，够每个 op 都跑一遍 */
const CSV = [
  "date,city,amount,qty,note",
  "2024-01-01,BJ,100,2,hello world",
  "2024-01-02,,200,3,x",
  "2024-01-03,SH,200,3,y",
  "2024-01-04,SH,abc,4,z",
  "2024-01-05,GZ,500,5,hello world",
].join("\n");

const dataset = Parse.fromText(CSV);
const run = (ops: CleanStep[]) => Clean.run(dataset.rows.map((r) => Object.assign({}, r)), dataset.columns, ops);
/* 原始单元格都是字符串，clip/fill_null 等写回的可能是数字，统一转成数字再断言 */
const colOf = (rows: Record<string, unknown>[], name: string): number[] => rows.map((r) => Number(r[name]));

test("isBlank 认识空值占位符", () => {
  assert.equal(Clean.isBlank(null), true);
  assert.equal(Clean.isBlank(undefined), true);
  assert.equal(Clean.isBlank(""), true);
  assert.equal(Clean.isBlank("   "), true);
  assert.equal(Clean.isBlank("N/A"), true);
  assert.equal(Clean.isBlank("--"), true);
  assert.equal(Clean.isBlank("—"), true);
  assert.equal(Clean.isBlank(0), false);
  assert.equal(Clean.isBlank("x"), false);
});

test("evalExpr 四则运算与优先级", () => {
  const row = { a: 10, b: 3 };
  assert.equal(Clean.evalExpr("a + b * 2", row, ["a", "b"]), 16);
  assert.equal(Clean.evalExpr("(a + b) * 2", row, ["a", "b"]), 26);
  assert.equal(Clean.evalExpr("a ^ 2", row, ["a", "b"]), 100);
  assert.equal(Clean.evalExpr("-a + b", row, ["a", "b"]), -7);
});

test("evalExpr 除零得 0，不抛错", () => {
  assert.equal(Clean.evalExpr("a / 0", { a: 5 }, ["a"]), 0);
  assert.equal(Clean.evalExpr("a % 0", { a: 5 }, ["a"]), 0);
});

test("evalExpr 字符串相加走拼接，数值走相加", () => {
  assert.equal(Clean.evalExpr("city + '-x'", { city: "SH" }, ["city"]), "SH-x");
  assert.equal(Clean.evalExpr("'a' + 'b'", {}, []), "ab");
});

test("evalExpr 非数值字段参与乘除会报错", () => {
  assert.throws(() => Clean.evalExpr("city * 2", { city: "SH" }, ["city"]), /不是数值/);
});

test("evalExpr 白名单函数可用", () => {
  const row = { amount: "100", city: " sh " };
  assert.equal(Clean.evalExpr("ROUND(amount / 3, 2)", row, ["amount"]), 33.33);
  assert.equal(Clean.evalExpr("ABS(-4)", row, []), 4);
  assert.equal(Clean.evalExpr("MAX(1, 9, 3)", row, []), 9);
  assert.equal(Clean.evalExpr("SUM(1, 2, 3)", row, []), 6);
  assert.equal(Clean.evalExpr("AVG(2, 4)", row, []), 3);
  assert.equal(Clean.evalExpr("LEN(city)", row, ["city"]), 4);
  assert.equal(Clean.evalExpr("UPPER(city)", row, ["city"]), " SH ");
  assert.equal(Clean.evalExpr("TRIM(city)", row, ["city"]), "sh");
  assert.equal(Clean.evalExpr("LEFT(city, 2)", row, ["city"]), " s");
  assert.equal(Clean.evalExpr("CONCAT(city, '!')", row, ["city"]), " sh !");
  assert.equal(Clean.evalExpr("YEAR('2024-03-05')", row, []), 2024);
  assert.equal(Clean.evalExpr("MONTH('2024-03-05')", row, []), 3);
  assert.equal(Clean.evalExpr("DAY('2024-03-05')", row, []), 5);
  assert.equal(Clean.evalExpr("NUMBER('12x')", row, []), 0);
  assert.equal(Clean.evalExpr("IF(1, '是', '否')", row, []), "是");
});

test("evalExpr 不支持的白名单外函数会报错", () => {
  assert.throws(() => Clean.evalExpr("EVIL(1)", {}, []), /不支持的函数/);
});

test("evalExpr 比较与逻辑运算", () => {
  const row = { city: "SH", amount: "100" };
  assert.equal(Clean.evalExpr("amount > 50", row, ["city", "amount"]), true);
  assert.equal(Clean.evalExpr("amount >= 100", row, ["city", "amount"]), true);
  assert.equal(Clean.evalExpr("amount < 100", row, ["city", "amount"]), false);
  assert.equal(Clean.evalExpr("amount == 100", row, ["city", "amount"]), true);
  assert.equal(Clean.evalExpr("amount != 100", row, ["city", "amount"]), false);
  assert.equal(Clean.evalExpr("city == 'SH'", row, ["city", "amount"]), true);
  assert.equal(Clean.evalExpr("amount > 50 AND city == 'SH'", row, ["city", "amount"]), true);
  assert.equal(Clean.evalExpr("amount > 500 or city == 'SH'", row, ["city", "amount"]), true);
  assert.equal(Clean.evalExpr("amount > 500 or city == 'BJ'", row, ["city", "amount"]), false);
});

test("evalExpr 字段名按大小写与空格模糊匹配", () => {
  const row = { "City Name": "SH", city: "BJ" };
  assert.equal(Clean.evalExpr("CityName", row, ["City Name"]), "SH");
  assert.equal(Clean.evalExpr("CITY", row, ["city"]), "BJ");
  assert.equal(Clean.evalExpr("city", row, ["city"]), "BJ");
  assert.throws(() => Clean.evalExpr("city name", row, ["City Name"]), /多余内容/);
});

test("evalExpr 拒绝坏输入", () => {
  assert.throws(() => Clean.evalExpr("a $ 1", { a: 1 }, ["a"]), /无法识别的符号/);
  assert.throws(() => Clean.evalExpr("nope + 1", {}, ["a"]), /不存在的字段/);
  assert.throws(() => Clean.evalExpr("1 2", {}, []), /多余内容/);
  assert.throws(() => Clean.evalExpr("(1", {}, []), /括号不匹配/);
  assert.throws(() => Clean.evalExpr("SUM(1", {}, []), /函数括号不匹配/);
  assert.throws(() => Clean.evalExpr("", {}, []), /表达式不完整/);
});

test("drop_duplicates 按列与整行", () => {
  assert.equal(run([{ op: "drop_duplicates", columns: ["qty"] }]).report[0].summary, "删除了 1 行重复数据（按 qty 判定）");
  assert.equal(run([{ op: "drop_duplicates" }]).after.rows, 5);
  assert.equal(run([{ op: "drop_duplicates", columns: ["nope"] }]).after.rows, 5);
});

test("fill_null 各策略", () => {
  assert.equal(run([{ op: "fill_null", column: "city", strategy: "value", value: "未知" }]).rows[1].city, "未知");
  assert.equal(run([{ op: "fill_null", column: "city", strategy: "zero" }]).rows[1].city, 0);
  assert.equal(run([{ op: "fill_null", column: "city", strategy: "ffill" }]).rows[1].city, "BJ");
  assert.equal(run([{ op: "fill_null", column: "city", strategy: "bfill" }]).rows[1].city, "SH");
  const mean = run([{ op: "fill_null", column: "amount", strategy: "mean" }]);
  assert.equal(mean.report[0].summary.indexOf("用均值填充了「amount」的 0 个缺失值") === 0, true, mean.report[0].summary);
  assert.equal(run([{ op: "fill_null", column: "nope" }]).report[0].summary, "字段不存在，跳过");
});

test("drop_null 按列与 all/any", () => {
  assert.equal(run([{ op: "drop_null", columns: ["city"] }]).after.rows, 4);
  assert.equal(run([{ op: "drop_null", how: "all" }]).after.rows, 5);
});

test("keep_rows 与 drop_rows 走 Engine.pass", () => {
  const eq = [{ field: "city", op: "eq" as const, value: "SH" }];
  assert.equal(run([{ op: "keep_rows", filters: eq }]).after.rows, 2);
  assert.equal(run([{ op: "drop_rows", filters: eq }]).after.rows, 3);
  assert.equal(run([{ op: "keep_rows", filters: [{ field: "qty", op: "gt" as const, value: 3 }] }]).after.rows, 2);
  assert.equal(run([{ op: "keep_rows" }]).after.rows, 5);
});

test("convert 转数值/日期/文本", () => {
  const num = run([{ op: "convert", column: "note", type: "number" }]);
  assert.equal(num.rows[0].note, "");
  assert.match(num.report[0].summary, /5 个值无法转换被置空/);
  assert.equal(run([{ op: "convert", column: "amount", type: "number" }]).rows[0].amount, 100);
  assert.equal(run([{ op: "convert", column: "city", type: "text" }]).rows[0].city, "BJ");
  assert.equal(run([{ op: "convert", column: "nope", type: "number" }]).report[0].summary, "字段不存在，跳过");
});

test("rename / drop_columns", () => {
  const renamed = run([{ op: "rename", from: "city", to: "城市" }]);
  assert.equal(renamed.rows[0]["城市"], "BJ");
  assert.equal(renamed.columns.map((c) => c.name).includes("city"), false);
  assert.equal(run([{ op: "rename", from: "city", to: "城市" }]).report[0].summary, "「city」已改名为「城市」");
  const dropped = run([{ op: "drop_columns", columns: ["note", "nope"] }]);
  assert.equal(dropped.after.cols, 4);
});

test("replace 支持 map、from/to 与 contains", () => {
  assert.equal(run([{ op: "replace", column: "city", map: { BJ: "北京" } }]).rows[0].city, "北京");
  assert.equal(run([{ op: "replace", column: "city", from: "SH", to: "上海" }]).rows[2].city, "上海");
  assert.equal(run([{ op: "replace", column: "note", map: { hello: "你好" }, contains: true }]).rows[0].note, "你好");
  const untouched = run([{ op: "replace", column: "city", map: { BJ: "北京" } }]);
  assert.equal(untouched.report[0].summary, "「city」替换了 1 个值");
});

test("normalize 各模式只影响指定列", () => {
  const rows = [{ a: "  x  y  ", b: "  keep  " }];
  const cols = [{ name: "a", type: "string" as const }, { name: "b", type: "string" as const }];
  const go = (mode: string) => Clean.run(rows.map((r) => Object.assign({}, r)), cols, [{ op: "normalize", column: "a", mode }]);
  assert.equal(go("trim").rows[0].a, "x  y");
  assert.equal(go("collapse").rows[0].a, " x y ");
  assert.equal(go("lower").rows[0].a, "x  y");
  assert.equal(go("upper").rows[0].a, "X  Y");
  assert.equal(go("all").rows[0].a, "x y");
  assert.equal(go("digits").rows[0].a, "");
  // 未指定的模式原样返回，label 回落成模式名本身
  assert.equal(go("mystery").report[0].summary, "a 已mystery，影响 0 个值");
  // 只动指定列
  assert.equal(go("all").rows[0].b, "  keep  ");
  assert.equal(run([{ op: "normalize", column: "nope" }]).report[0].affected, 0);
});

test("split 拆分字段并重建列元数据", () => {
  const r = run([{ op: "split", column: "note", delimiter: " ", into: ["a", "b"] }]);
  assert.equal(r.rows[0].a, "hello");
  assert.equal(r.rows[0].b, "world");
  assert.equal(r.rows[1].b, "");
  assert.equal(r.after.cols, 7);
  assert.equal(r.columns.find((c) => c.name === "b") !== undefined, true);
});

test("derive 用自研表达式派生字段", () => {
  const r = run([{ op: "derive", name: "double", expr: "amount * 2" }]);
  assert.equal(r.rows[0].double, 200);
  // 第 4 行 amount 是 "abc"，表达式算不出来 -> 置空并计入失败行数
  assert.equal(r.rows[3].double, "");
  assert.match(r.report[0].summary, /1 行计算失败/);
  const flag = run([{ op: "derive", name: "tag", expr: "IF(qty > 3, '多', '少')" }]);
  assert.equal(flag.rows[0].tag, "少");
  assert.equal(flag.rows[4].tag, "多");
  assert.equal(run([{ op: "derive", expr: "1 + 1" }]).report[0].summary, "缺少新字段名或表达式，跳过");
});

test("sort 数值列按数值、文本列按本地化顺序", () => {
  const r = run([{ op: "sort", by: "qty", order: "desc" }]);
  assert.deepEqual(colOf(r.rows, "qty"), [5, 4, 3, 3, 2]);
  const rev = run([{ op: "sort", by: "city" }]);
  assert.deepEqual(rev.rows.map((x) => String(x.city)), ["", "BJ", "GZ", "SH", "SH"]);
  assert.equal(run([{ op: "sort", by: "nope" }]).report[0].summary, "排序字段不存在，跳过");
});

test("sample 三种取法都不越界", () => {
  assert.deepEqual(run([{ op: "sample", n: 2, mode: "head" }]).rows.map((x) => x.city), ["BJ", ""]);
  assert.deepEqual(run([{ op: "sample", n: 2, mode: "tail" }]).rows.map((x) => x.city), ["SH", "GZ"]);
  assert.equal(run([{ op: "sample", n: 99, mode: "head" }]).after.rows, 5);
  const random = run([{ op: "sample", n: 3, mode: "random" }]);
  assert.equal(random.after.rows, 3);
  // 抽出来的必须是原数据集里真实存在的行
  assert.equal(random.rows.every((x) => dataset.rows.some((r) => r.note === x.note)), true);
});

test("clip 把超出范围的值压到边界", () => {
  const r = run([{ op: "clip", column: "qty", min: 3, max: 4 }]);
  assert.deepEqual(colOf(r.rows, "qty"), [3, 3, 3, 4, 4]);
  // min/max 缺省时没有边界，一个都不动
  assert.equal(run([{ op: "clip", column: "qty" }]).report[0].affected, 0);
  // 模型给了非数值边界时同样当成没有边界，而不是当成 0
  assert.equal(run([{ op: "clip", column: "qty", min: "abc" }]).report[0].affected, 0);
  assert.equal(run([{ op: "clip", column: "nope", min: 1 }]).report[0].summary, "字段不存在，跳过");
});

test("未实现的 op 只跳过，不影响后续步骤", () => {
  const r = run([{ op: "drop_everything" }, { op: "drop_columns", columns: ["note"] }]);
  assert.equal(r.report[0].label, "不支持的操作");
  assert.equal(r.report[0].op, "drop_everything");
  assert.equal(r.report[1].label, "删除字段");
  assert.equal(r.after.cols, 4);
  assert.equal(run([{}]).report[0].op, "未知");
});

test("run 的 before/after 与列元数据跟着操作走", () => {
  const r = run([{ op: "derive", name: "double", expr: "qty * 2" }, { op: "drop_null", columns: ["city"] }]);
  assert.deepEqual(r.before, { rows: 5, cols: 5 });
  assert.deepEqual(r.after, { rows: 4, cols: 6 });
  assert.equal(r.report.length, 2);
  assert.equal(r.columns.find((c) => c.name === "double")?.type, "number");
});

test("run 不改调用方传入的数据", () => {
  const before = JSON.stringify(dataset.rows);
  run([{ op: "fill_null", column: "city", strategy: "value", value: "x" }, { op: "rename", from: "city", to: "c" }]);
  assert.equal(JSON.stringify(dataset.rows), before);
});
