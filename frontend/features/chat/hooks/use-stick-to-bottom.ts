"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const EDGE_PX = 64;

/**
 * è®©æ»å¨å®¹å¨å¨åå®¹å¢é¿æ¶ä¿æè´´åºï¼ä½ç¨æ·åä¸æ»å¨åç«å³è®©åºæ§å¶æã
 *
 * åç ResizeObserver çè·éåçå¨ paint ä¹åï¼æµå¼ææ¬æ¯æ¹é½ä¼éªä¸å¸§
 * ï¼åå®¹ååºç°å¨è§å£ä¸æ¹åè¢«æåï¼ãè¿éç¨ MutationObserver å¨åä¸å¸§å
 * è§æµ DOM ååå¹¶éåºï¼é¿åéªçã
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
