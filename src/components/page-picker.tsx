"use client";

import { Camera, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PagePreview } from "@/lib/capture";
import { tip } from "./tooltip-layer";

/**
 * Окно в форме экрана модели поверх предпросмотра всей страницы. Страницу
 * прокручивают как в браузере, и снимается ровно тот экран, что виден в окне.
 */
export function PagePicker({ preview, onCancel, onConfirm }: { preview: PagePreview; onCancel: () => void; onConfirm: (scrollY: number) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const [pageHeight, setPageHeight] = useState(preview.viewport.height);
  const [scrollY, setScrollY] = useState(0);
  const [box, setBox] = useState(() => fitBox(preview.viewport));

  useLayoutEffect(() => {
    dialogRef.current?.showModal();
    windowRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const resize = () => setBox(fitBox(preview.viewport));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [preview.viewport]);

  // При смене размера окна страница остаётся на том же месте.
  const scrollRef = useRef(0);
  scrollRef.current = scrollY;
  useLayoutEffect(() => { if (windowRef.current) windowRef.current.scrollTop = scrollRef.current * box.scale; }, [box.scale]);

  const maxScroll = Math.max(0, pageHeight - preview.viewport.height);
  const position = Math.min(scrollY, maxScroll);

  return <dialog ref={dialogRef} className="help-dialog page-picker" data-clarity-mask="true" aria-labelledby="page-picker-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}
    onKeyDown={(event) => { if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); onConfirm(position); } }}>
    <div className="dialog-heading"><span className="dialog-icon"><Camera size={22} /></span><button className="icon-button" aria-label="Закрыть" {...tip("Закрыть", "Esc")} onClick={onCancel}><X size={16} /></button></div>
    <h2 id="page-picker-title">Какой экран снять?</h2>
    <p>Прокрутите {preview.name} до нужного места. В мокап попадёт то, что видно в окне.</p>
    <div ref={windowRef} className="page-window" tabIndex={0} role="region" aria-label="Страница сайта" style={{ width: box.width, height: box.height }}
      onScroll={(event) => setScrollY(Math.round(event.currentTarget.scrollTop / box.scale))}>
      <img src={preview.url} alt="" draggable={false} style={{ width: box.width }} onLoad={(event) => setPageHeight(Math.round(event.currentTarget.naturalHeight))} />
    </div>
    <div className="page-picker-footer">
      <span>{!maxScroll ? "Страница помещается в один экран" : position ? `Прокручено на ${position} px` : "Начало страницы"}</span>
      <button className="small-button" onClick={onCancel}>Отмена</button>
      <button className="small-button primary" onClick={() => onConfirm(position)}>Снять этот экран</button>
    </div>
  </dialog>;
}

/** Окно вписывается в диалог и в высоту окна браузера, сохраняя пропорции экрана. */
function fitBox(viewport: PagePreview["viewport"]) {
  const maxWidth = Math.min(560, window.innerWidth - 80), maxHeight = Math.max(220, Math.min(620, window.innerHeight - 300));
  const scale = Math.min(maxWidth / viewport.width, maxHeight / viewport.height);
  return { width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale), scale };
}
