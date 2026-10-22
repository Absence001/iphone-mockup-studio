"use client";

import { useState } from "react";
import { ChevronDown, Diamond, Film, Trash } from "lucide-react";
import { Control } from "./control";
import { tip } from "./tooltip-layer";
import { seconds, type Selection } from "./timeline";
import { plural } from "@/lib/plural";
import { EASE_FAMILIES, TIME_STEP, easeId, easePath, findKey, trackInfo, type Animation, type EaseId, type KeyRef, type TrackId } from "@/lib/animation";
import { selectedKeys, selectedSegments, selectionEase, selectionLabel, type SegmentRef } from "@/lib/timeline-selection";

/** Основные кривые видны сразу; остальные — по раскрытию. */
const MAIN_EASES: { id: EaseId; label: string }[] = [
  { id: "linear", label: "Линейно" },
  { id: "inOutCubic", label: "Плавно" },
  { id: "inCubic", label: "Разгон" },
  { id: "outCubic", label: "Торможение" },
  { id: "outBack", label: "С перелётом" },
];
const DIRECTIONS = [{ id: "in", label: "Разгон" }, { id: "out", label: "Торможение" }, { id: "inOut", label: "Плавно" }] as const;

interface AnimationSectionProps {
  animation: Animation; selection: Selection;
  /** Сантиметров в единице сцены у выбранной модели. */
  unit: number;
  /** Длина ролика с экрана, если на экране видео. */
  videoLength: number | null;
  onEase: (segments: SegmentRef[], ease: EaseId) => void;
  onSegmentLength: (tracks: TrackId[], from: number, to: number, length: number) => void;
  onKeyTime: (keys: KeyRef[], delta: number) => void;
  onKeyValue: (ref: KeyRef, value: number) => void;
  onDeleteKeys: (keys: KeyRef[]) => void;
  onSeek: (time: number) => void;
  onReveal: (track: TrackId) => void;
  onBlur: (patch: Partial<Animation["blur"]>, group?: string) => void;
  onFitVideo: () => void;
}

function Curve({ id }: { id: EaseId }) {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path className="ease-diagonal" d="M7 25L25 7" /><path className="ease-curve" d={easePath(id)} /></svg>;
}

export function AnimationSection({ animation, selection, unit, videoLength, onEase, onSegmentLength, onKeyTime, onKeyValue, onDeleteKeys, onSeek, onReveal, onBlur, onFitVideo }: AnimationSectionProps) {
  const [allCurves, setAllCurves] = useState(false);

  const segments = selectedSegments(animation, selection);
  const keys = selectedKeys(animation, selection);
  const key = selection?.kind === "keys" && keys.length > 0;
  const spans = segments.map((segment) => ({ from: findKey(animation, { track: segment.track, id: segment.from })!.time, to: findKey(animation, { track: segment.track, id: segment.to })!.time }));
  const segment = selection?.kind === "segments" && spans.length && spans.every((span) => span.from === spans[0].from && span.to === spans[0].to) ? spans[0] : null;
  const segmentTracks = [...new Set(segments.map((item) => item.track))];
  const current = selectionEase(animation, segments);
  const times = keys.map((ref) => findKey(animation, ref)!.time);
  const firstTime = times.length ? Math.min(...times) : 0;
  const lastTime = times.length ? Math.max(...times) : 0;
  const single = key && keys.length === 1 ? findKey(animation, keys[0]) : undefined;
  const singleInfo = single ? trackInfo(keys[0].track) : null;
  const track = selection?.kind === "track" ? selection.track : null;

  const curveButton = (id: EaseId, label: string) => <button key={id} type="button" className={`ease-option${current === id ? " selected" : ""}`} aria-pressed={current === id} {...tip(label)}
    onClick={() => onEase(segments, id)}><Curve id={id} /><span>{label}</span></button>;

  return <div className="animation-panel">
    {segments.length > 0 && <section className="control-section">
      <div className="section-heading"><h3>{segment ? "Участок" : "Участки"} · {selectionLabel(keys)}</h3><span className="format-badge">{seconds(firstTime)} — {seconds(lastTime)}</span></div>
      {segment && <Control label="Длина участка" value={Number((segment.to - segment.from).toFixed(2))} min={TIME_STEP * 10} max={30} step={0.05} unit="с" onChange={(length) => onSegmentLength(segmentTracks, segment.from, segment.to, length)} />}
      <div className="section-heading ease-heading"><h3>Кривая</h3>{current === "mixed" && <span className="format-badge">Разные</span>}</div>
      <div className="ease-grid" role="group" aria-label="Кривая участка">{MAIN_EASES.map((item) => curveButton(item.id, item.label))}</div>
      <button type="button" className="text-button ease-more" aria-expanded={allCurves} onClick={() => setAllCurves(!allCurves)}><ChevronDown size={14} style={{ transform: allCurves ? "rotate(180deg)" : undefined }} /> {allCurves ? "Свернуть кривые" : "Все кривые"}</button>
      {allCurves && <div className="ease-table" role="group" aria-label="Все кривые">
        <span />{DIRECTIONS.map((direction) => <span key={direction.id} className="ease-column">{direction.label}</span>)}
        {EASE_FAMILIES.map((family) => <div className="ease-family" key={family}>
          <span className="ease-row-label">{family}</span>
          {DIRECTIONS.map((direction) => curveButton(easeId(direction.id, family), `${family} · ${direction.label.toLowerCase()}`))}
        </div>)}
      </div>}
    </section>}

    {key && <section className="control-section">
      <div className="section-heading"><h3>{singleInfo ? `Ключ · ${singleInfo.label}` : `${keys.length} ${plural(keys.length, ["ключ", "ключа", "ключей"])}`}</h3><span className="format-badge">{seconds(firstTime)}</span></div>
      <Control label={firstTime === lastTime ? "Время ключа" : "Начало выделения"} value={Number(firstTime.toFixed(2))} min={0} max={animation.duration - (lastTime - firstTime)} step={0.01} unit="с" onChange={(next) => onKeyTime(keys, next - firstTime)} />
      {single && singleInfo && <Control label="Значение" value={singleInfo.length ? single.value * unit : single.value} min={singleInfo.length ? singleInfo.min * unit : singleInfo.min} max={singleInfo.length ? singleInfo.max * unit : singleInfo.max} step={singleInfo.length ? 0.1 : singleInfo.step} unit={singleInfo.unit}
        onChange={(value) => onKeyValue(keys[0], singleInfo.length ? value / unit : value)} />}
      <div className="button-row">
        <button type="button" className="small-button" onClick={() => onSeek(firstTime)}><Diamond size={12} /> {firstTime === lastTime ? "К ключу" : "К началу"}</button>
        <button type="button" className="small-button" onClick={() => onDeleteKeys(keys)}><Trash size={14} /> Удалить</button>
      </div>
    </section>}

    {track && <section className="control-section">
      <div className="section-heading"><h3>{trackInfo(track).label}</h3><span className="format-badge">{(animation.tracks[track] ?? []).length} {plural((animation.tracks[track] ?? []).length, ["ключ", "ключа", "ключей"])}</span></div>
      <p className="light-description">Выберите участок между ключами, чтобы изменить кривую. Значение в текущем времени меняется в разделе «{trackInfo(track).object === "camera" ? "Камера" : "Положение"}».</p>
      <button type="button" className="small-button" onClick={() => onReveal(track)}>Показать настройку</button>
    </section>}



    {!selection && <section className="control-section">
      <label className="switch-row"><span><strong>Размытие движения</strong><span>Смазывает быстрые повороты и наезды</span></span><input type="checkbox" checked={animation.blur.enabled} onChange={(event) => onBlur({ enabled: event.target.checked })} /><i aria-hidden="true" /></label>
      {animation.blur.enabled && <Control label="Сила размытия" value={animation.blur.amount} min={0} max={100} unit="%" onChange={(amount) => onBlur({ amount }, "blurAmount")} />}
    </section>}

    {!selection && videoLength !== null && Math.abs(videoLength - animation.duration) > TIME_STEP && <button type="button" className="text-button" onClick={onFitVideo}><Film size={14} /> Длина ролика по видео · {seconds(videoLength, 1)}</button>}
  </div>;
}
