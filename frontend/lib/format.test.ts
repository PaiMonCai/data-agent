import test from "node:test";
import assert from "node:assert/strict";
import { fmtDate } from "./format.ts";

test("空值返回空字符串", () => {
  assert.equal(fmtDate(), "");
  assert.equal(fmtDate(undefined), "");
  assert.equal(fmtDate(""), "");
});

test("ISO 时间格式化为 月-日 时:分", () => {
  const out = fmtDate("2026-09-22T08:30:00Z");
  assert.match(out, /^\d{2}[/-]\d{2} \d{2}:\d{2}$/);
});

test("非法输入原样返回，不抛异常", () => {
  assert.equal(fmtDate("not-a-date"), "not-a-date");
});
