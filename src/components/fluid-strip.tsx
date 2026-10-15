"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFluidHover } from "@/hooks/use-fluid-hover";
import { FluidHoverHighlight } from "./fluid-hover-highlight";

interface FluidStripProps {
  /** Направление поиска ближайшего элемента: "x" — ряд, "y" — колонка. */
  axis: "x" | "y";
  className?: string;
  /** Какие потомки участвуют в подсветке. По умолчанию — прямые кнопки. */
  selector?: string;
  children: ReactNode;
  role?: string;
  "aria-label"?: string;
}

/**
 * Панель инструментов с fluid hover: подсветка не мигает между кнопками, а
 * переезжает к ближайшей к курсору, и клик в зазор попадает в подсвеченную
 * кнопку. Кнопки регистрируются по DOM, а не по JSX, чтобы разметка панелей
 * осталась обычной: разделители и порядок меняются без правок здесь.
 */
export function FluidStrip({ axis, className, selector = ":scope > button", children, ...rest }: FluidStripProps) {
  const ref = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(ref, {
    axis,
    isItemDisabled: (element) => (element as HTMLButtonElement).disabled,
    // Зазор между кнопками — 1–3px, поэтому маршрутизация клика ограничена
    // ближайшей окрестностью: промах по разделителю попадает в кнопку, а
    // случайный клик по дальнему краю панели — нет.
    gapClick: { maxDistance: 14 },
  });
  const { registerItem } = hover;

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let registered: HTMLElement[] = [];
    const sync = () => {
      const next = [...container.querySelectorAll<HTMLElement>(selector)];
      if (next.length === registered.length && next.every((element, index) => element === registered[index])) return;
      registered.forEach((_, index) => registerItem(index, null));
      next.forEach((element, index) => registerItem(index, element));
      registered = next;
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      registered.forEach((_, index) => registerItem(index, null));
    };
  }, [registerItem, selector]);

  return <div ref={ref} className={className} {...rest} {...hover.handlers}>
    <FluidHoverHighlight hover={hover} className="strip-highlight" />
    {children}
  </div>;
}
