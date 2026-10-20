"use client";

import { Trash, Upload } from "lucide-react";
import { Control } from "./control";
import { type AudioClip } from "@/lib/audio";

export function AudioSection({ clip, duration, onChange, onUpload, onRemove }: { clip: AudioClip; duration: number; onChange: (patch: Partial<AudioClip>, group?: string) => void; onUpload: () => void; onRemove: () => void }) {
  return <div className="audio-settings">
    <p className="audio-file-name" data-clarity-mask="true" title={clip.name}>{clip.name}</p>
    <Control label="Начало на таймлайне" value={clip.offset} min={0} max={Math.max(0, duration - 0.01)} step={0.01} unit="с" onChange={(offset) => onChange({ offset }, "audioOffset")} />
    <Control label="Начало в файле" value={clip.start} min={0} max={clip.end - 0.01} step={0.01} unit="с" onChange={(start) => onChange({ start }, "audioStart")} />
    <Control label="Конец в файле" value={clip.end} min={clip.start + 0.01} max={clip.duration} step={0.01} unit="с" onChange={(end) => onChange({ end }, "audioEnd")} />
    <Control label="Громкость" value={clip.volume} min={0} max={100} unit="%" onChange={(volume) => onChange({ volume }, "audioVolume")} />
    <label className="switch-row"><span><strong>Звук</strong></span><input type="checkbox" checked={!clip.muted} onChange={(event) => onChange({ muted: !event.target.checked })} /><i aria-hidden="true" /></label>
    <div className="button-row"><button type="button" className="small-button" onClick={onUpload}><Upload size={12} /> Заменить файл</button><button type="button" className="small-button" onClick={onRemove}><Trash size={12} /> Удалить аудио</button></div>
  </div>;
}
