"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const EDGE_PX = 64;

/**
 * 让滚动容器在内容增长时保持贴底，但用户向上滚动后立即让出控制权。
 *
 * 原生 ResizeObserver 的跟随发生在 paint 之后，流式文本每批都会闪一帧
 * （内容先出现在视口下方再被拉回）。这里用 MutationObserver 在同一帧内
 * 观测 DOM 变化并钉底，避免闪烁。
 */
export function useStickToBottom<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToEnd = useCallback((behavior: ScrollBehavior = "smooth") => {
    const node = ref.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    setAtBottom(true);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      setAtBottom(distance <= EDGE_PX);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const observer = new MutationObserver(() => {
      if (node.scrollHeight - node.scrollTop - node.clientHeight <= EDGE_PX) {
        node.scrollTop = node.scrollHeight;
        setAtBottom(true);
      }
    });
    observer.observe(node, { childList: true, subtree: true, characterData: true });

    return () => {
      node.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, []);

  return { ref, atBottom, scrollToEnd };
}
