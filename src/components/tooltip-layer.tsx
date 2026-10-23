"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Side = "top" | "bottom" | "left" | "right";

/**
 * Подсказка у элемента: название и, если есть, клавиша. Разметка остаётся
 * обычной — `<button {...tip("Отменить", "Ctrl+Z")}>`, — а показывает её
 * один слой на всё приложение.
 */
export function tip(label: string, shortcut?: string, side?: Side) {
  return { "data-tooltip": label, ...(shortcut ? { "data-tooltip-shortcut": shortcut } : {}), ...(side ? { "data-tooltip-side": side } : {}) };
}

/** Пауза перед первой подсказкой и окно, в котором соседняя появляется сразу. */
const DELAY_MS = 450;
const SKIP_MS = 400;
const GAP = 6;
const EDGE = 8;

interface Shown { target: HTMLElement; label: string; shortcut: string | null; side: Side; host: Element }

interface Bounds { left: number; top: number; right: number; bottom: number }

/** Сторона и координаты подсказки: с предпочтительной стороны, если там хватает места внутри границ. */
function place(anchor: DOMRect, bubble: DOMRect, preferred: Side, bounds: Bounds) {
  const room: Record<Side, number> = { top: anchor.top - bounds.top, bottom: bounds.bottom - anchor.bottom, left: anchor.left - bounds.left, right: bounds.right - anchor.right };
  const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const need = preferred === "top" || preferred === "bottom" ? bubble.height + GAP + EDGE : bubble.width + GAP + EDGE;
  const side = room[preferred] >= need || room[opposite[preferred]] < need ? preferred : opposite[preferred];
  const clampX = (x: number) => Math.min(Math.max(bounds.left + EDGE, x), bounds.right - bubble.width - EDGE);
  const clampY = (y: number) => Math.min(Math.max(bounds.top + EDGE, y), bounds.bottom - bubble.height - EDGE);
  if (side === "top" || side === "bottom") return { side, x: clampX(anchor.left + anchor.width / 2 - bubble.width / 2), y: side === "top" ? anchor.top - GAP - bubble.height : anchor.bottom + GAP };
  return { side, x: side === "left" ? anchor.left - GAP - bubble.width : anchor.right + GAP, y: clampY(anchor.top + anchor.height / 2 - bubble.height / 2) };
}

/**
 * Один слой подсказок на страницу: слушает наведение и фокус с клавиатуры у
 * элементов с `data-tooltip`. Внутри открытого `<dialog>` подсказка рисуется в
 * нём же, иначе модальное окно перекрыло бы её верхним слоем.
 */
export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number; side: Side } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenAt = useRef(0);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
    const hide = () => {
      clear();
      if (current.current) hiddenAt.current = performance.now();
      current.current = null;
      setShown(null);
    };
    const show = (target: HTMLElement) => {
      const label = target.dataset.tooltip;
      if (!label) return;
      clear();
      const open = () => {
        current.current = target;
        setPosition(null);
        setShown({ target, label, shortcut: target.dataset.tooltipShortcut ?? null, side: (target.dataset.tooltipSide as Side) ?? "top", host: target.closest("dialog[open]") ?? document.body });
      };
      if (current.current || performance.now() - hiddenAt.current < SKIP_MS) open();
      else timer.current = setTimeout(open, DELAY_MS);
    };
    const find = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>("[data-tooltip]") : null;

    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const target = find(event.target);
      if (target === current.current) return;
      if (!target) { hide(); return; }
      if (current.current) hiddenAt.current = performance.now();
      show(target);
    };
    const out = (event: PointerEvent) => { if (!find(event.relatedTarget)) hide(); };
    const focus = (event: FocusEvent) => { const target = find(event.target); if (target && target.matches(":focus-visible")) show(target); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    const press = () => { clear(); current.current = null; setShown(null); hiddenAt.current = 0; };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      clear();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Элемент мог исчезнуть или поменять подпись, пока подсказка видна.
  useEffect(() => {
    if (!shown) return;
    const observer = new MutationObserver(() => {
      if (!shown.target.isConnected || !shown.target.dataset.tooltip) { current.current = null; setShown(null); return; }
      if (shown.target.dataset.tooltip !== shown.label || (shown.target.dataset.tooltipShortcut ?? null) !== shown.shortcut) setShown({ ...shown, label: shown.target.dataset.tooltip, shortcut: shown.target.dataset.tooltipShortcut ?? null });
    });
    observer.observe(shown.target, { attributes: true, attributeFilter: ["data-tooltip", "data-tooltip-shortcut"] });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [shown]);

  useLayoutEffect(() => {
    if (!shown || !bubbleRef.current) return;
    const dialog = shown.host instanceof HTMLDialogElement ? shown.host : null;
    // Окно обрезает содержимое по краям, поэтому внутри него границы — само окно.
    const box = dialog?.getBoundingClientRect();
    const next = place(shown.target.getBoundingClientRect(), bubbleRef.current.getBoundingClientRect(), shown.side, box ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    // Внутри диалога координаты считаются от него: у открытого окна свой блок позиционирования.
    if (!dialog || !box) { setPosition(next); return; }
    setPosition({ ...next, x: next.x - box.left + dialog.scrollLeft, y: next.y - box.top + dialog.scrollTop });
  }, [shown]);

  if (!shown) return null;
  return createPortal(<div ref={bubbleRef} role="tooltip" className="tooltip" data-side={position?.side ?? shown.side}
    style={{ position: shown.host instanceof HTMLDialogElement ? "absolute" : "fixed", left: position?.x ?? 0, top: position?.y ?? 0, visibility: position ? "visible" : "hidden" }}>
    <span>{shown.label}</span>{shown.shortcut && <kbd>{shown.shortcut}</kbd>}
  </div>, shown.host);
}
