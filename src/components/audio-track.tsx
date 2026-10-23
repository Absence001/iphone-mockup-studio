"use client";

import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Music2, Volume2, VolumeX } from "lucide-react";
import { audioLength, normalizeAudio, type AudioClip } from "@/lib/audio";
import { clamp } from "@/lib/settings";
import { roundTime } from "@/lib/animation";
import { tip } from "./tooltip-layer";

export type AudioChangePhase = "start" | "change" | "end";
interface AudioTrackProps {
  clip: AudioClip; buffer: AudioBuffer | null; pps: number; duration: number; selected: boolean;
  onSelect: () => void;
  onChange: (clip: AudioClip, phase: AudioChangePhase) => void;
}

export function AudioTrack({ clip, buffer, pps, duration, selected, onSelect, onChange }: AudioTrackProps) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const peaks = useMemo(() => {
    if (!buffer) return [];
    const samples = buffer.getChannelData(0), start = Math.floor(clip.start * buffer.sampleRate), count = Math.floor(audioLength(clip) * buffer.sampleRate);
    return Array.from({ length: 100 }, (_, index) => {
      let peak = 0;
      const from = start + Math.floor(count * index / 100), to = Math.min(samples.length, start + Math.floor(count * (index + 1) / 100));
      for (let sample = from; sample < to; sample += Math.max(1, Math.floor((to - from) / 60))) peak = Math.max(peak, Math.abs(samples[sample]));
      return peak;
    });
  }, [buffer, clip.start, clip.end]);

  const drag = (event: ReactPointerEvent, action: "move" | "start" | "end") => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); onSelect();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const scroll = target.closest(".timeline-scroll");
    const scrollLeft = scroll?.scrollLeft ?? 0;
    let next = clip, moved = false;
    const move = (pointer: PointerEvent) => {
      const delta = (pointer.clientX - startX + (scroll?.scrollLeft ?? 0) - scrollLeft) / pps;
      if (!moved && Math.abs(pointer.clientX - startX) < 3) return;
      if (!moved) { moved = true; onChange(clip, "start"); }
      if (action === "move") next = { ...clip, offset: roundTime(clamp(clip.offset + delta, 0, Math.max(0, duration - 0.01))) };
      else if (action === "end") next = { ...clip, end: roundTime(clamp(clip.end + delta, clip.start + 0.01, Math.min(clip.duration, clip.start + duration - clip.offset))) };
      else {
        const shift = clamp(delta, Math.max(-clip.start, -clip.offset), audioLength(clip) - 0.01);
        next = { ...clip, start: roundTime(clip.start + shift), offset: roundTime(clip.offset + shift) };
      }
      onChange(normalizeAudio(next), "change");
    };
    const detach = () => {
      target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", cancel);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      cleanup.current = null;
    };
    const up = () => { detach(); if (moved) onChange(normalizeAudio(next), "end"); };
    const cancel = () => { detach(); if (moved) onChange(clip, "end"); };
    cleanup.current?.(); cleanup.current = detach;
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); target.addEventListener("pointercancel", cancel);
  };

  return <div className="timeline-row audio">
    <div className="timeline-label">
      <Music2 size={14} aria-hidden="true" />
      <button type="button" className="timeline-name" aria-pressed={selected} onClick={onSelect}>Аудио</button>
      <button type="button" className="timeline-keybutton" aria-label={clip.muted ? "Включить аудио" : "Выключить аудио"} {...tip(clip.muted ? "Включить звук" : "Выключить звук")} onClick={() => { onChange(clip, "start"); onChange({ ...clip, muted: !clip.muted }, "end"); }}>{clip.muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
    </div>
    <div className="timeline-lane">
      <div className={`audio-clip${selected ? " selected" : ""}${clip.muted ? " muted" : ""}`} style={{ left: 12 + clip.offset * pps, width: Math.max(12, Math.min(audioLength(clip), Math.max(0, duration - clip.offset)) * pps) }}>
        <button type="button" className="audio-clip-body" aria-label={`Аудиоклип: ${clip.name}`} onClick={onSelect} onPointerDown={(event) => drag(event, "move")} data-clarity-mask="true">
          <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">{peaks.map((peak, index) => <path key={index} d={`M${index} ${12 - peak * 10}v${Math.max(1, peak * 20)}`} />)}</svg>
          <span>{clip.name}</span>
        </button>
        <button type="button" className="audio-trim start" aria-label="Обрезать начало аудио" {...tip("Тяните, чтобы обрезать начало")} onClick={onSelect} onPointerDown={(event) => drag(event, "start")} />
        <button type="button" className="audio-trim end" aria-label="Обрезать конец аудио" {...tip("Тяните, чтобы обрезать конец")} onClick={onSelect} onPointerDown={(event) => drag(event, "end")} />
      </div>
    </div>
  </div>;
}
