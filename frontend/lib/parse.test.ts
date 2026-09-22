import test from "node:test";
import assert from "node:assert/strict";
import { Parse } from "./parse.ts";

const t = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();

test("toNumber 支持千分位、空格、货币符与百分号", () => {
  assert.equal(Parse.toNumber("1,234.5"), 1234.5);
  assert.equal(Parse.toNumber("  12  "), 12);
  assert.equal(Parse.toNumber("12 345"), 12345);
  assert.equal(Parse.toNumber("1200"), 1200);
  assert.equal(Parse.toNumber("45%"), 45);
});

test("toNumber 对空值与非数字返回 null", () => {
  assert.equal(Parse.toNumber(null), null);
  assert.equal(Parse.toNumber(undefined), null);
  assert.equal(Parse.toNumber(""), null);
  assert.equal(Parse.toNumber("   "), null);
  assert.equal(Parse.toNumber("abc"), null);
  assert.equal(Parse.toNumber("1.2.3"), null);
});

test("toDate 覆盖 ISO、斜杠、美式、时间戳与纯年份", () => {
  assert.equal(Parse.toDate("2024-03-05")!.getTime(), t(2024, 3, 5));
  assert.equal(Parse.toDate("2024/3/5")!.getTime(), t(2024, 3, 5));
  assert.equal(Parse.toDate("2024.3.5")!.getTime(), t(2024, 3, 5));
  assert.equal(Parse.toDate("3/5/2024")!.getTime(), t(2024, 3, 5));
  assert.equal(Parse.toDate("2024")!.getTime(), t(2024, 1, 1));
  assert.equal(Parse.toDate("1710000000000")!.getTime(), 1710000000000);
  assert.equal(Parse.toDate("1710000000")!.getTime(), 1710000000000);
});

test("toDate 对无法识别的内容返回 null", () => {
  assert.equal(Parse.toDate(null), null);
  assert.equal(Parse.toDate(""), null);
  assert.equal(Parse.toDate("今天天气不错"), null);
  assert.equal(Parse.toDate("abc"), null);
  assert.equal(Parse.toDate("13:45"), null);
});

test("inferColumnType 按填充率判定类型", () => {
  assert.equal(Parse.inferColumnType([]), "string");
  assert.equal(Parse.inferColumnType([null, undefined, "", "  "]), "string");
  assert.equal(Parse.inferColumnType(["1", "2", "3", "4"]), "number");
  assert.equal(Parse.inferColumnType(["2024-01-01", "2024-02-01", "2024-03-01"]), "date");
  assert.equal(Parse.inferColumnType(["1", "a", "3", "b"]), "string");
});

test("splitLine 处理引号包裹的分隔符与转义引号", () => {
  // 不公开，通过 fromText 间接覆盖；这里用带引号的 CSV 验证分割结果
  const table = Parse.fromText('a,b,c\n"x,1",2,"y""z"');
  assert.deepEqual(table.headers, ["a", "b", "c"]);
  assert.deepEqual(table.rows[0], { a: "x,1", b: "2", c: 'y"z' });
});

test("detectDelimiter 自动识别逗号/制表符/分号/竖线", () => {
  assert.deepEqual(Parse.fromText("a,b\n1,2").headers, ["a", "b"]);
  assert.deepEqual(Parse.fromText("a\tb\n1\t2").headers, ["a", "b"]);
  assert.deepEqual(Parse.fromText("a;b\n1;2").headers, ["a", "b"]);
  assert.deepEqual(Parse.fromText("a|b\n1|2").headers, ["a", "b"]);
});

test("fromText 判定表头、补齐短行并推断列类型", () => {
  const table = Parse.fromText("a,b\n1,2\n3");
  assert.deepEqual(table.headers, ["a", "b"]);
  assert.deepEqual(table.rows[0], { a: "1", b: "2" });
  assert.deepEqual(table.rows[1], { a: "3", b: "" });
  assert.deepEqual(table.columns.map((c) => c.type), ["number", "number"]);
});

test("fromText 可以显式关闭表头", () => {
  const table = Parse.fromText("a,b\n1,2", { hasHeader: false });
  assert.deepEqual(table.headers, ["列1", "列2"]);
  assert.deepEqual(table.rows[0], { "列1": "a", "列2": "b" });
  assert.equal(table.rows.length, 2);
});

test("fromText 可以显式指定分隔符", () => {
  const table = Parse.fromText("a,b,c\n1,2,3", { delimiter: "," });
  assert.equal(table.headers.length, 3);
});

test("fromText 去掉 BOM，否则第一个列名就毁了", () => {
  const table = Parse.fromText("\uFEFFa,b\n1,2");
  assert.deepEqual(table.headers, ["a", "b"]);
});

test("fromText 空内容抛错", () => {
  assert.throws(() => Parse.fromText(""), /内容为空/);
  assert.throws(() => Parse.fromText("   \n  "), /内容为空/);
});

test("fromText 过滤掉整行都为空的行", () => {
  const table = Parse.fromText("a,b\n1,2\n,\n3,4");
  assert.equal(table.rows.length, 2);
});

test("fromText 识别 JSON 并转交 JSON 分支", () => {
  const table = Parse.fromText('[{"a":1,"b":2}]');
  assert.deepEqual(table.headers, ["a", "b"]);
  assert.deepEqual(table.rows[0], { a: "1", b: "2" });
});

test("fromJSON 支持数组、data 包裹与单条记录", () => {
  assert.deepEqual(Parse.fromJSON([{ x: 1 }]).rows, [{ x: "1" }]);
  assert.deepEqual(Parse.fromJSON({ data: [{ x: 1 }] }).rows, [{ x: "1" }]);
  assert.deepEqual(Parse.fromJSON({ x: 1 }).rows, [{ x: "1" }]);
});

test("fromJSON 把嵌套对象序列化成字符串", () => {
  const table = Parse.fromJSON([{ a: { b: 1 } }]);
  assert.deepEqual(table.rows[0], { a: '{"b":1}' });
});

test("fromJSON 空数组抛错", () => {
  assert.throws(() => Parse.fromJSON([]), /JSON 中没有数据行/);
});

test("inferColumns 统计唯一值与数值范围", () => {
  const cols = Parse.inferColumns(["n", "c"], [{ n: 5, c: "x" }, { n: 9, c: "x" }, { n: 1, c: "y" }]);
  assert.equal(cols[0].type, "number");
  assert.equal(cols[0].unique, 3);
  assert.equal(cols[0].min, 1);
  assert.equal(cols[0].max, 9);
  assert.equal(cols[1].unique, 2);
  assert.deepEqual(cols[0].sample, [5, 9, 1].map(String));
});

test("sampleData 结构稳定且可重复", () => {
  const a = Parse.sampleData();
  const b = Parse.sampleData();
  assert.deepEqual(a.headers, ["日期", "渠道", "地区", "订单数", "销售额", "退款额", "访客数", "毛利率"]);
  assert.equal(a.rows.length, 720);
  assert.equal(a.columns.length, 8);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.ok(new Set(a.rows.map((r) => r["渠道"])).size === 4);
  for (const r of a.rows) {
    assert.match(String(r["日期"]), /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number(r["订单数"]) >= 1);
    assert.ok(Number(r["毛利率"]) >= 0.22 && Number(r["毛利率"]) <= 0.42);
  }
});

test("isExcel / isStata 按扩展名判断", () => {
  assert.equal(Parse.isExcel("a.xlsx"), true);
  assert.equal(Parse.isExcel("a.XLSM"), true);
  assert.equal(Parse.isExcel("a.ods"), true);
  assert.equal(Parse.isExcel("a.csv"), false);
  assert.equal(Parse.isExcel(""), false);
  assert.equal(Parse.isStata("a.dta"), true);
  assert.equal(Parse.isStata("a.DTA"), true);
  assert.equal(Parse.isStata("a.xlsx"), false);
});

test("Parse 对外端口完整", () => {
  for (const k of ["fromText", "fromJSON", "workbook", "isExcel", "isStata", "fromStata", "sampleData", "inferColumns", "toNumber", "toDate", "inferColumnType"]) {
    assert.equal(typeof (Parse as Record<string, unknown>)[k], "function", k);
  }
});
