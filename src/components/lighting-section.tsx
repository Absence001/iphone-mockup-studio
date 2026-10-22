"use client";

import { useRef } from "react";
import { Sun } from "lucide-react";
import { Control } from "./control";
import { FluidChoice } from "./fluid-choice";
import { tip } from "./tooltip-layer";
import { clamp, type Settings } from "@/lib/settings";

const SCHEMES = [
  { id: "soft", label: "Мягкий", description: "Большие софтбоксы сверху и спереди, ровный свет." },
  { id: "studio", label: "Студийный", description: "Софтбокс сбоку подчёркивает грани и материал." },
  { id: "rim", label: "Контровой", description: "Полосы света сзади рисуют контур на тёмном фоне." },
];

export function LightingSection({ light, onChange }: { light: Settings["light"]; onChange: (patch: Partial<Settings["light"]>, group?: string) => void }) {
  const dragStart = useRef<number | null>(null);
  const setDirection = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    onChange({ rotation: Math.round(clamp((clientX - rect.left - 12) / Math.max(1, rect.width - 24), 0, 1) * 360 - 180) }, "lightRotation");
  };
  return <div className="lighting-settings">
    <FluidChoice label="Схема освещения" value={light.preset} items={SCHEMES} icon={Sun} className="light-choice" onChange={(id) => { const scheme = SCHEMES.find((item) => item.id === id); if (scheme) onChange({ preset: scheme.id as Settings["light"]["preset"] }); }} />
    <div className="light-direction-pad" role="slider" tabIndex={0} aria-label="Направление света на площадке" aria-valuemin={-180} aria-valuemax={180} aria-valuenow={light.rotation} aria-valuetext={`${light.rotation}°`} {...tip("Тяните по горизонтали, чтобы повернуть свет вокруг устройства")}
      onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); dragStart.current = light.rotation; setDirection(event.clientX, event.currentTarget); }}
      onPointerMove={(event) => { if (dragStart.current !== null) setDirection(event.clientX, event.currentTarget); }}
      onPointerUp={(event) => { dragStart.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { if (dragStart.current !== null) onChange({ rotation: dragStart.current }, "lightRotation"); dragStart.current = null; }}
      onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onChange({ rotation: event.key === "Home" ? -180 : event.key === "End" ? 180 : clamp(light.rotation + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 10 : 1), -180, 180) }, "lightRotation"); } }}>
      <span className="light-direction-axis" aria-hidden="true" />
      <span className="light-direction-point" style={{ left: `calc(12px + (100% - 24px) * ${(light.rotation + 180) / 360})` }} aria-hidden="true" />
      <span className="light-direction-value" aria-hidden="true">{light.rotation}°</span>
    </div>
    <div className="light-intensity"><Control label="Яркость" value={light.intensity} min={0} max={200} unit="%" onChange={(intensity) => onChange({ intensity }, "lightIntensity")} /></div>
    <p className="light-description">{SCHEMES.find((item) => item.id === light.preset)?.description}</p>
    <details className="light-advanced"><summary>Дополнительно</summary><Control label="Направление света" value={light.rotation} min={-180} max={180} unit="°" onChange={(rotation) => onChange({ rotation }, "lightRotation")} /><Control label="Экспозиция" value={light.exposure} min={25} max={200} unit="%" onChange={(exposure) => onChange({ exposure }, "exposure")} /></details>
  </div>;
}
