"use client";

import { useEffect, useId, useLayoutEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Префикс ключей раскрытия; тот же префикс читает инлайн-скрипт в layout. */
const SECTION_KEY = "forma:inspector:";

interface InspectorSectionProps {
  section: string;
  title: string;
  defaultOpen?: boolean;
  visible?: boolean;
  /** Новое значение раскрывает раздел: так таймлайн показывает настройку выбранного свойства. */
  revealToken?: number;
  children: ReactNode;
}

/** Раскрытие — настройка интерфейса, она не входит в проект и историю сцены. */
export function InspectorSection({ section, title, defaultOpen = false, visible = true, revealToken = 0, children }: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const storageKey = `${SECTION_KEY}${section}`;

  // Разметка приходит с раскрытием по умолчанию, а первый кадр уже показывает
  // сохранённое: до гидратации его показывает стиль из layout. Здесь состояние
  // переносится в React до отрисовки, и тот стиль снимается — дальше
  // раскрытием управляет только атрибут hidden.
  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "true" || saved === "false") setOpen(saved === "true");
    } catch { /* При недоступном хранилище раздел работает до закрытия страницы. */ }
    document.getElementById("inspector-open")?.remove();
  }, [storageKey]);

  useEffect(() => {
    if (!revealToken) return;
    setOpen(true);
    try { localStorage.setItem(storageKey, "true"); } catch { /* Раскрытие не зависит от записи в хранилище. */ }
  }, [revealToken, storageKey]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Раскрытие не зависит от записи в хранилище. */ }
  };

  return <section className="inspector-section" data-section={section} hidden={!visible}>
    <h2>
      <button type="button" className="inspector-section-trigger" id={`${id}-trigger`} aria-expanded={open} aria-controls={`${id}-content`} onClick={toggle}>
        <span>{title}</span><ChevronDown size={14} aria-hidden="true" />
      </button>
    </h2>
    <div className="inspector-section-content" id={`${id}-content`} aria-labelledby={`${id}-trigger`} hidden={!open}>
      {children}
    </div>
  </section>;
}
