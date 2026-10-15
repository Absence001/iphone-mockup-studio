"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "./ui/button";

const THEME_KEY = "mockup-theme";
/** Длительность кросс-фейда палитры при смене темы, см. .theme-transition. */
const THEME_FADE_MS = 240;

export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Класс на <html> уже проставлен инлайн-скриптом в layout до первой
  // отрисовки, поэтому здесь состояние только считывается: так нет ни
  // вспышки светлой темы, ни второго переключения после гидратации.
  useLayoutEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    return () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); };
  }, []);

  const toggle = useCallback(() => {
    const next = !dark;
    const root = document.documentElement;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!calm) {
      // Класс ставится до смены палитры и сбрасывается после неё: иначе
      // первый кадр новой темы успевает отрисоваться без перехода.
      root.classList.add("theme-transition");
      void root.offsetHeight;
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => root.classList.remove("theme-transition"), THEME_FADE_MS + 60);
    }
    root.classList.toggle("dark", next);
    setDark(next);
    try { localStorage.setItem(THEME_KEY, next ? "dark" : "light"); } catch { /* Тема работает и без доступа к хранилищу. */ }
  }, [dark]);

  const label = dark ? "Включить светлую тему" : "Включить тёмную тему";
  const Icon = dark ? Sun : Moon;

  return <Button variant="ghost" size="icon-compact" aria-label={label} title={label} onClick={toggle}>
    <span className="theme-icon" aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.span
          key={dark ? "sun" : "moon"}
          initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
        >
          <Icon />
        </motion.span>
      </AnimatePresence>
    </span>
  </Button>;
}
