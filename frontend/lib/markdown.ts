/* é¶ä¾èµçè½»é Markdown è§£æå¨ã
 *
 * åªè¦çæ¬é¡¹ç®æ¨¡åè¾åºä¼ç¨å°çè¯­æ³ï¼æ é¢ãæ®µè½ãåè¡¨ãå¼ç¨ãä»£ç åãåéçº¿ãè¡¨æ ¼ï¼
 * ä»¥åè¡åçå ç²/æä½/è¡åä»£ç /å é¤çº¿/é¾æ¥ãå»æä¸åå®æ´ CommonMarkï¼ä¹ä¸æ¥ç¬¬ä¸æ¹åºï¼
 * è¿æ ·é¦å±åä½ç§¯åå®è£ä¾èµé½ä¸å¢å ãè¾åºæ¯ ASTï¼äº¤ç» markdown-view.tsx æ¸²ææ React åç´ ã
 */

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "del"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] };

export type BlockNode =
  | { type: "heading"; level: 2 | 3 | 4; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "quote"; children: BlockNode[] }
  | { type: "code"; lang: string; value: string }
  | { type: "divider" }
  | { type: "table"; headers: InlineNode[][]; rows: InlineNode[][][] };

const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(~~[^~]+~~)|(\[[^\]]+\]\([^)\s]+\))/;

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let rest = text;

  while (rest) {
    const match = INLINE_PATTERN.exec(rest);
    if (!match || match.index === undefined) {
      nodes.push({ type: "text", value: rest });
      break;
    }
    if (match.index > 0) {
      nodes.push({ type: "text", value: rest.slice(0, match.index) });
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push({ type: "code", value: token.slice(1, -1) });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push({ type: "strong", children: parseInline(token.slice(2, -2)) });
    } else if (token.startsWith("~~")) {
      nodes.push({ type: "del", children: parseInline(token.slice(2, -2)) });
    } else if (token.startsWith("*")) {
      nodes.push({ type: "em", children: parseInline(token.slice(1, -1)) });
    } else if (token.startsWith("_")) {
      nodes.push({ type: "em", children: parseInline(token.slice(1, -1)) });
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (linkMatch) {
        nodes.push({ type: "link", href: linkMatch[2], children: parseInline(linkMatch[1]) });
      } else {
        nodes.push({ type: "text", value: token });
      }
    }

    rest = rest.slice(match.index + token.length);
  }

  return nodes;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let buffer = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === "\\" && (trimmed[i + 1] === "|" || trimmed[i + 1] === "\\")) {
      buffer += trimmed[i + 1];
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(buffer.trim());
      buffer = "";
      continue;
    }
    buffer += char;
  }
  cells.push(buffer.trim());
  return cells;
}

function isTableDivider(line: string) {
  return /^\|?[\s:-]*-[\s:-]*(\|[\s:-]*-[\s:-]*)*\|?$/.test(line.trim()) && line.includes("-");
}

function isTableRow(line: string) {
  return line.trim().startsWith("|") && line.trim().endsWith("|") && line.includes("|");
}

/** è§£æ Markdown ææ¬ä¸ºåçº§ ASTãæµå¼æªé­åçä»£ç åä¼è¢«å½ä½ä»£ç åå¤çã */
export function parseMarkdown(source: string): BlockNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: BlockNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = /^```(\w*)\s*$/.exec(trimmed);
    if (fence) {
      const lang = fence[1] || "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.exec(lines[index].trim())) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", lang, value: body.join("\n") });
      continue;
    }

    const heading = /^(#{2,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 2 | 3 | 4,
        children: parseInline(heading[2]),
      });
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "divider" });
      index += 1;
      continue;
    }

    if (isTableRow(line) && index + 1 < lines.length && isTableDivider(lines[index + 1])) {
      const headers = splitRow(line).map(parseInline);
      index += 2;
      const rows: InlineNode[][][] = [];
      while (index < lines.length && isTableRow(lines[index])) {
        rows.push(splitRow(lines[index]).map(parseInline));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: InlineNode[][] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const currentBullet = /^[-*+]\s+(.*)$/.exec(current);
        const currentOrdered = /^\d+[.)]\s+(.*)$/.exec(current);
        const matched = isOrdered ? currentOrdered : currentBullet;
        if (!matched) break;
        items.push(parseInline(matched[1]));
        index += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoted.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", children: parseMarkdown(quoted.join("\n")) });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      const currentTrimmed = current.trim();
      if (
        !currentTrimmed ||
        /^#{2,4}\s/.test(currentTrimmed) ||
        /^```/.test(currentTrimmed) ||
        /^[-*+]\s+/.test(currentTrimmed) ||
        /^\d+[.)]\s+/.test(currentTrimmed) ||
        /^>\s?/.test(currentTrimmed) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(currentTrimmed) ||
        isTableRow(current)
      ) {
        break;
      }
      paragraph.push(currentTrimmed);
      index += 1;
    }
    if (paragraph.length) {
      blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
    } else {
      index += 1;
    }
  }

  return blocks;
}
