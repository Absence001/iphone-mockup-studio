"use client";

import { useRef } from "react";
import { ChevronDown, Film, X } from "lucide-react";
import { Control } from "./control";
import { CAMERA_MOVES, type CameraMoveId } from "@/lib/camera-moves";

export interface MovePreview { move: CameraMoveId; duration: number }

export function CameraMovesControls({ preview, disabled, onPreview, onApply, onCancel }: {
  preview: MovePreview | null; disabled: boolean;
  onPreview: (move: CameraMoveId, duration?: number) => void; onApply: () => void; onCancel: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => { if (menu.current) menu.current.open = false; };
  return <details className="camera-moves" ref={menu} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); if (preview) onCancel(); close(); } }}>
    <summary aria-label="Движения камеры" aria-disabled={disabled} onClick={(event) => { if (disabled) event.preventDefault(); }}><Film size={14} /><span>Движение</span><ChevronDown size={12} /></summary>
    <div className="camera-moves-menu">
      <div className="section-heading"><h3>{preview ? "Просмотр движения" : "Движения камеры"}</h3><button type="button" className="quiet-icon" aria-label="Закрыть движения камеры" onClick={close}><X size={13} /></button></div>
      {preview ? <div className="move-preview">
        <div className="move-preview-title"><Film size={14} /><span>{CAMERA_MOVES.find((item) => item.id === preview.move)?.name}</span></div>
        <Control label="Длительность движения" value={preview.duration} min={0.4} max={10} step={0.1} unit="с" onChange={(duration) => onPreview(preview.move, duration)} />
        <div className="button-row"><button type="button" className="small-button primary" onClick={() => { onApply(); close(); }}>Применить</button><button type="button" className="small-button" onClick={() => { onCancel(); close(); }}>Отмена</button></div>
        <p className="light-description">Начало — у курсора времени. Ключи камеры на этом отрезке заменятся.</p>
      </div> : <div className="move-list">{CAMERA_MOVES.map((move) => <button key={move.id} type="button" className="move-card" disabled={disabled} onClick={() => onPreview(move.id)}><strong>{move.name}</strong><span>{move.description}</span></button>)}</div>}
    </div>
  </details>;
}
