"use client";

import { Fragment, type ReactNode } from "react";
import { parseMarkdown, type BlockNode, type InlineNode } from "@/lib/markdown";

function renderInline(nodes: InlineNode[], keyPrefix = ""): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`;
    switch (node.type) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "strong":
        return <strong key={key} className="font-semibold">{renderInline(node.children, `${key}-`)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, `${key}-`)}</em>;
      case "del":
        return <del key={key} className="muted">{renderInline(node.children, `${key}-`)}</del>;
      case "code":
        return (
          <code key={key} className="surface-2 rounded-md px-1.5 py-0.5 font-mono text-[0.9em]">
            {node.value}
          </code>
        );
      case "link":
        return (
          <a key={key} href={node.href} target="_blank" rel="noopener noreferrer" className="brand underline">
            {renderInline(node.children, `${key}-")}
          </a>
        );
      default:
        return null;
    }
  });
}

function renderBlock(node: BlockNode, key: string): ReactNode {
  switch (node.type) {
    case "heading": {
      const className = "mt-4 mb-2 font-semibold first:mt-0";
      const children = renderInline(node.children, `${key}-`);
      if (node.level === 2) return <h2 key={key} className={className}>{children}</h2>;
      if (node.level === 3) return <h3 key={key} className={className}>{children}</h3>;
      return <h4 key={key} className={className}>{children}</h4>;
    }
    case "paragraph":
      return <p key={key} className="my-2 first:mt-0 last:mb-0">{renderInline(node.children, `${key}-`)}</p>;
    case "list":
      return node.ordered ? (
        <ol key={key} className="my-2 list-decimal space-y-1 pl-5">
          {node.items.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}-`)}</li>)}
        </ol>
      ) : (
        <ul key={key} className="my-2 list-disc space-y-1 pl-5">
          {node.items.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}-`)}</li>)}
        </ul>
      );
    case "quote":
      return (
        <blockquote key={key} className="brand-soft my-3 rounded-r-lg border-l-2 border-[var(--brand)] px-3 py-2 text-sm">
          {node.children.map((child, i) => renderBlock(child, `${key}-${i}`))}
        </blockquote>
      );
    case "code":
      return (
        <pre key={key} className="surface-2 pretty-scrollbar my-3 overflow-auto rounded-xl p-3 text-xs">
          <code className="font-mono">{node.value}</code>
        </pre>
      );
    case "divider":
      return <hr key={key} className="border-ui my-4" />;
    case "table":
      return (
        <div key={key} className="pretty-scrollbar my-3 overflow-auto rounded-xl border border-ui">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="surface-2">
              <tr>
                {node.headers.map((cell, i) => (
                  <th key={i} className="border-ui border-b px-3 py-2 text-left font-medium">
                    {renderInline(cell, `${key}-h${i}-`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border-ui border-b px-3 py-2">
                      {renderInline(cell, `${key}-${r}-${c}-`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return null;
  }
}

export default function MarkdownView({ content }: { content: string }) {
  const blocks = parseMarkdown(content);
  return <div className="text-sm leading-7">{blocks.map((node, i) => renderBlock(node, `b${i}`))}</div>;
}
