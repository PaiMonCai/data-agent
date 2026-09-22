import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown, type BlockNode, type InlineNode } from "./markdown.ts";

type Pick<K extends BlockNode["type"]> = Extract<BlockNode, { type: K }>;

/** 解析并断言只有且仅有一个指定类型的块，返回收窄后的类型。 */
function only<K extends BlockNode["type"]>(source: string, kind: K): Pick<K> {
  const blocks = parseMarkdown(source);
  const matched = blocks.filter((b): b is Pick<K> => b.type === kind);
  assert.equal(
    matched.length,
    1,
    `期望恰好一个 ${kind} 块，实际是 [${blocks.map((b) => b.type).join(", ")}]`,
  );
  return matched[0];
}

const types = (source: string) => parseMarkdown(source).map((b) => b.type);

function flatten(nodes: InlineNode[]): string {
  return nodes
    .map((n) => (n.type === "text" || n.type === "code" ? n.value : flatten(n.children)))
    .join("");
}

const inline = (source: string) => flatten(only(source, "paragraph").children);

test("空输入返回空数组", () => {
  assert.deepEqual(parseMarkdown(""), []);
  assert.deepEqual(parseMarkdown("\n\n  \n"), []);
});

test("标题支持 1 到 4 级 #，5 级退回段落", () => {
  assert.deepEqual(types("## 二级"), ["heading"]);
  assert.deepEqual(only("# 一级", "heading"), {
    type: "heading",
    level: 2,
    children: [{ type: "text", value: "一级" }],
  });
  assert.equal(only("### 三级", "heading").level, 3);
  assert.equal(only("#### 四级", "heading").level, 4);
  assert.deepEqual(types("##### 五级"), ["paragraph"]);
  assert.equal(flatten(only("## 标题里的 **加粗**", "heading").children), "标题里的 加粗");
});

test("连续行合并为一个段落", () => {
  assert.deepEqual(types("第一行\n第二行"), ["paragraph"]);
  assert.equal(inline("第一行\n第二行"), "第一行 第二行");
});

test("段落遇到块级语法就断开", () => {
  assert.deepEqual(types("正文\n## 标题"), ["paragraph", "heading"]);
  assert.deepEqual(types("正文\n- 列表"), ["paragraph", "list"]);
  assert.deepEqual(types("正文\n1. 列表"), ["paragraph", "list"]);
  assert.deepEqual(types("正文\n> 引用"), ["paragraph", "quote"]);
  assert.deepEqual(types("正文\n---"), ["paragraph", "divider"]);
  assert.deepEqual(types("正文\n| a |\n|---|"), ["paragraph", "table"]);
  assert.deepEqual(types("正文\n```\n代码\n```"), ["paragraph", "code"]);
});

test("无序列表支持 - * + 三种符号", () => {
  assert.deepEqual(types("- a\n- b"), ["list"]);
  assert.deepEqual(types("* a\n* b"), ["list"]);
  assert.deepEqual(types("+ a\n+ b"), ["list"]);

  const list = only("- 粗 **体**\n- 普通\n- 三", "list");
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 3);
  assert.equal(flatten(list.items[0]), "粗 体");
});

test("有序列表", () => {
  const list = only("1. 一\n2. 二\n3) 三", "list");
  assert.equal(list.ordered, true);
  assert.equal(list.items.length, 3);
});

test("换符号会结束列表", () => {
  assert.deepEqual(types("- 甲\n- 乙\n普通文字"), ["list", "paragraph"]);
  assert.deepEqual(types("1. 甲\n2. 乙\n- 丙"), ["list", "list"]);
});

test("引用块支持多行和嵌套块", () => {
  const quote = only("> 第一行\n> 第二行", "quote");
  assert.deepEqual(quote.children.map((c) => c.type), ["paragraph"]);
  const firstBlock = quote.children[0];
  assert.equal(firstBlock.type, "paragraph");
  if (firstBlock.type !== "paragraph") throw new Error("unreachable");
  assert.equal(flatten(firstBlock.children), "第一行 第二行");

  const nested = only("> ## 标题\n> 正文", "quote");
  assert.deepEqual(nested.children.map((c) => c.type), ["heading", "paragraph"]);
});

test("代码块", () => {
  assert.deepEqual(only("```js\nconst a = 1;\n```", "code"), { type: "code", lang: "js", value: "const a = 1;" });
  assert.equal(only("```\nplain\n```", "code").lang, "");
  assert.equal(only("```ts\nlet x", "code").value, "let x");
});

test("代码块内的标记不被解析", () => {
  assert.equal(only("```\n**不是粗体** # 不是标题\n```", "code").value, "**不是粗体** # 不是标题");
  assert.deepEqual(types("```\n**不是粗体**\n```"), ["code"]);
});

test("分隔线", () => {
  assert.deepEqual(types("---"), ["divider"]);
  assert.deepEqual(types("***"), ["divider"]);
  assert.deepEqual(types("___"), ["divider"]);
  assert.deepEqual(types("--"), ["paragraph"]);
  // - 后跟空格就是列表项，这是 CommonMark 的行为
  assert.deepEqual(types("- - -"), ["list"]);
});

test("表格", () => {
  const table = only("| 维度 | 数值 |\n| --- | --- |\n| a | 1 |\n| b | 2 |", "table");
  assert.deepEqual(table.headers.map(flatten), ["维度", "数值"]);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0].map(flatten), ["a", "1"]);
  assert.deepEqual(table.rows[1].map(flatten), ["b", "2"]);
});

test("表格要求首尾竖线", () => {
  // 没有外层竖线的一律按段落处理，不猜
  assert.deepEqual(types("维度 | 数值\n--- | ---\na | 1"), ["paragraph"]);
});

test("缺少分隔行时表格内容不会丢", () => {
  // 回归：以前这种输入会被整行吞掉
  const blocks = parseMarkdown("| a | b |\n| 1 | 2 |");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(inline("| a | b |\n| 1 | 2 |"), "| a | b | | 1 | 2 |");
  assert.deepEqual(types("| a |\n|:-:|"), ["table"]);
  assert.equal(inline("| a |\n普通行"), "| a | 普通行");
});

test("表格内可转义竖线", () => {
  const table = only("| a | b |\n|---|---|\n| x \\| y | 2 |", "table");
  assert.equal(flatten(table.rows[0][0]), "x | y");
  assert.equal(table.rows.length, 1);
});

test("行内：加粗、斜体、行内代码、删除线", () => {
  assert.deepEqual(only("普通 **粗** 普通", "paragraph").children, [
    { type: "text", value: "普通 " },
    { type: "strong", children: [{ type: "text", value: "粗" }] },
    { type: "text", value: " 普通" },
  ]);
  assert.equal(only("__粗__", "paragraph").children[0].type, "strong");
  assert.equal(only("*斜*", "paragraph").children[0].type, "em");
  assert.equal(only("_斜_", "paragraph").children[0].type, "em");
  assert.equal(only("~~删~~", "paragraph").children[0].type, "del");
  assert.deepEqual(only("`code`", "paragraph").children[0], { type: "code", value: "code" });
});

test("行内代码优先于加粗且不再二次解析", () => {
  assert.deepEqual(only("`**不是粗体**`", "paragraph").children, [{ type: "code", value: "**不是粗体**" }]);
  assert.deepEqual(only("`a *b* c`", "paragraph").children, [{ type: "code", value: "a *b* c" }]);
});

test("链接", () => {
  assert.deepEqual(only("[文字](https://example.com/a)", "paragraph").children, [
    { type: "link", href: "https://example.com/a", children: [{ type: "text", value: "文字" }] },
  ]);
  const withStrong = only("[带 **粗** 的文字](https://example.com)", "paragraph").children[0];
  assert.equal(withStrong.type, "link");
  if (withStrong.type !== "link") throw new Error("unreachable");
  assert.equal(flatten(withStrong.children), "带 粗 的文字");
});

test("未闭合的行内标记按普通文本处理", () => {
  assert.equal(inline("**只有一半"), "**只有一半");
  assert.equal(inline("*"), "*");
  assert.equal(inline("]("), "](");
});

test("未闭合的代码块按代码块返回", () => {
  const code = only("```py\nprint(1)", "code");
  assert.equal(code.value, "print(1)");
});

test("CRLF 输入与 LF 一致", () => {
  const lf = parseMarkdown("## 标题\n\n正文\n\n- 甲\n- 乙");
  const crlf = parseMarkdown("## 标题\r\n\r\n正文\r\n\r\n- 甲\r\n- 乙");
  assert.deepEqual(crlf, lf);
});

test("大输入不会退化", () => {
  let source = "";
  for (let i = 0; i < 300; i += 1) {
    source += `## 小节 ${i}\n\n第 ${i} 段结论，含 **粗体** 与 \`代码\`。\n\n- 甲 ${i}\n- 乙 ${i}\n\n| a | b |\n| --- | --- |\n| 1 | ${i} |\n\n`;
  }
  const blocks = parseMarkdown(source);
  assert.equal(blocks.length, 1200);
  assert.equal(blocks.filter((b) => b.type === "heading").length, 300);
  assert.equal(blocks.filter((b) => b.type === "table").length, 300);
});
