"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { ItemRect } from "@/hooks/use-fluid-hover";
import { clamp } from "@/lib/settings";
import { spring } from "@/lib/springs";

interface ControlProps { label: string; value: number; min: number; max: number; step?: number; unit?: string; disabled?: boolean; onChange: (value: number) => void }

export function Control({ label, value, min, max, step = 1, unit = "", disabled = false, onChange }: ControlProps) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [scrubbing, setScrubbing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editingStart = useRef(value);
  const skipCommit = useRef(false);
  const scrub = useRef<{ x: number; value: number; moved: boolean } | null>(null);
  const display = Number(value.toFixed(step < 1 || !Number.isInteger(value) ? 1 : 0)).toString();
  useEffect(() => { if (!editing) setDraft(display); }, [display, editing]);

  return <div className={`control${disabled ? " is-disabled" : ""}${scrubbing ? " is-scrubbing" : ""}`}>
    <div className="control-heading">
      <label htmlFor={id} className="scrub-label" title="Тяните для изменения · Shift для точной настройки"
        onPointerDown={(event) => { if (disabled || event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); scrub.current = { x: event.clientX, value, moved: false }; }}
        onPointerMove={(event) => { if (!scrub.current) return; const delta = event.clientX - scrub.current.x; if (Math.abs(delta) > 2 && !scrub.current.moved) { scrub.current.moved = true; setScrubbing(true); } if (scrub.current.moved) onChange(clamp(Math.round((scrub.current.value + delta * step * (event.shiftKey ? 0.1 : 1)) * 100) / 100, min, max)); }}
        onPointerUp={(event) => { const current = scrub.current; scrub.current = null; setScrubbing(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (current && !current.moved) inputRef.current?.focus(); }}
        onPointerCancel={() => { scrub.current = null; setScrubbing(false); }}>{label}</label>
      <div className="number-field">
        <input ref={inputRef} id={id} type="number" inputMode="decimal" value={editing ? draft : display} min={min} max={max} step={step} disabled={disabled} aria-label={label}
          onFocus={() => { editingStart.current = value; setDraft(display); setEditing(true); }}
          onChange={(event) => {
            const text = event.target.value; setDraft(text);
            if (text !== "" && Number.isFinite(Number(text)) && Number(text) >= min && Number(text) <= max) onChange(Number(text));
          }}
          onBlur={() => { const number = Number(draft); if (!skipCommit.current && draft !== "" && Number.isFinite(number)) onChange(clamp(number, min, max)); skipCommit.current = false; setEditing(false); }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.stopPropagation(); skipCommit.current = true; onChange(editingStart.current); event.currentTarget.blur(); } }} />
        {unit && <span aria-hidden="true">{unit}</span>}
      </div>
    </div>
    <input className="range" type="range" min={min} max={max} step={step} value={clamp(value, min, max)} disabled={disabled} aria-label={`${label}, ползунок`}
      style={{ "--progress": `${(clamp(value, min, max) - min) / (max - min) * 100}%` } as React.CSSProperties}
      onChange={(event) => onChange(Number(event.target.value))} />
  </div>;
}

interface SegmentedProps<T extends string> {
  label: string; value: T; items: { id: T; label: string }[]; onChange: (id: T) => void;
  /** Класс контейнера: «segmented» в инспекторе, «aspect-options» в экспорте. */
  className?: string;
  disabled?: boolean;
}

/**
 * Группа взаимоисключающих кнопок. Подложка выбранного варианта — один
 * элемент на всю группу: при смене она переезжает пружиной, а не гаснет в
 * одном месте и загорается в другом. Прямоугольник измеряется так же, как в
 * fluid hover, поэтому подложка живёт в системе координат контейнера.
 */
export function Segmented<T extends string>({ label, value, items, onChange, className = "segmented", disabled = false }: SegmentedProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<ItemRect | null>(null);
  const index = items.findIndex((item) => item.id === value);

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const measure = () => {
      const button = container.querySelectorAll<HTMLElement>(":scope > button")[index];
      setRect(button ? { left: button.offsetLeft, top: button.offsetTop, width: button.offsetWidth, height: button.offsetHeight } : null);
    };
    measure();
    // Ширина кнопок зависит от ширины панели, поэтому подложка пересчитывается
    // вместе с контейнером, а не только при смене выбора.
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [index, items.length]);

  // Подложка появляется уже на измеренном месте (initial={false}), поэтому
  // она никогда не остаётся невидимой, если кадры анимации не идут — например
  // во вкладке, которую ещё не открыли.
  return <div ref={ref} className={className} role="group" aria-label={label}>
    {rect && <motion.span className="segment-indicator" aria-hidden="true" initial={false}
      animate={{ x: rect.left, y: rect.top, width: rect.width, height: rect.height }} transition={spring.moderate} />}
    {items.map((item) => <button key={item.id} type="button" disabled={disabled} aria-pressed={value === item.id} className={value === item.id ? "selected" : ""} onClick={() => onChange(item.id)}>
      <span className="segment-label">{item.label}</span>
    </button>)}
  </div>;
}
