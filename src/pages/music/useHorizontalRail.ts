import { useCallback, useEffect, useState } from "react";

export function useHorizontalRail<T extends HTMLElement>() {
  // 用 state 持有节点（而非 useRef）——当容器是条件渲染、异步挂载时，
  // 回调 ref 会触发 setNode，下方 effect 才能在节点真正挂上后重新绑定监听，
  // 否则箭头永远不会出现（节点首次渲染时还不存在）。
  const [node, setNode] = useState<T | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const ref = useCallback((el: T | null) => setNode(el), []);

  const update = useCallback(() => {
    if (!node) {
      setCanLeft(false);
      setCanRight(false);
      return;
    }
    const max = node.scrollWidth - node.clientWidth;
    setCanLeft(node.scrollLeft > 2);
    setCanRight(max > 2 && node.scrollLeft < max - 2);
  }, [node]);

  useEffect(() => {
    if (!node) return;
    update();
    const onScroll = () => update();
    node.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    const raf = window.requestAnimationFrame(update);
    // 内容异步加载后 scrollWidth 变化，需要重新计算箭头显隐
    const observer = new ResizeObserver(() => update());
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [node, update]);

  const slide = useCallback(
    (dir: -1 | 1) => {
      if (!node) return;
      node.scrollBy({ left: dir * Math.round(node.clientWidth * 0.82), behavior: "smooth" });
    },
    [node]
  );

  return { ref, canLeft, canRight, update, slide };
}
