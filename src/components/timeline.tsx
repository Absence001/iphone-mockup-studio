"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronRight, Diamond, Music2, Pause, Play, Repeat, SkipBack } from "lucide-react";
import { AudioTrack, type AudioChangePhase } from "./audio-track";
import type { AudioClip } from "@/lib/audio";
import type { Clock } from "@/lib/clock";
import { MAX_DURATION, MIN_DURATION, TIME_STEP, TRACKS, allKeyTimes, findKey, isAnimated, keyAt, objectKeyTimes, objectKeysAt, objectTracks, roundTime, type AnimatedObject, type Animation, type KeyRef, type TrackId } from "@/lib/animation";
import { objectKeys, sameKey, sameSegment, selectedKeys, selectedSegments, uniqueKeys, type SegmentRef, type Selection } from "@/lib/timeline-selection";
import { clamp } from "@/lib/settings";
import { tip } from "./tooltip-layer";

export type { Selection } from "@/lib/timeline-selection";

interface TimelineProps {
  animation: Animation; clock: Clock; selection: Selection; deviceName: string;
  onSelect: (selection: Selection) => void;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onLoop: (loop: boolean) => void;
  /** Перенос ключей: start и end ограничивают один шаг отмены. */
  onMoveKeys: (keys: KeyRef[], delta: number, phase: "start" | "change" | "end") => void;
  onToggleKey: (track: TrackId) => void;
  onObjectKey: (object: AnimatedObject) => void;
  onDuration: (seconds: number) => void;
  audio: AudioClip | null; audioBuffer: AudioBuffer | null;
  onAddAudio: () => void;
  onAudioChange: (clip: AudioClip, phase: AudioChangePhase) => void;
}

const LABEL = 224;
/** Поле слева от нуля и справа от конца: крайние ключи и курсор видны целиком. */
const PAD = 12;
/** Справа места больше: подпись последней отметки шкалы стоит правее неё. */
const END_PAD = 36;
/** Насколько близко к ключу должен подойти курсор, чтобы прилипнуть с Shift. */
const SNAP_PX = 10;
const TICKS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];

/** «1,25 с»: десятичная запятая и единица через неразрывный пробел. */
export function seconds(value: number, digits = 2) {
  return `${value.toFixed(digits).replace(".", ",")} с`;
}

/** Подпись деления шкалы: без лишних нулей — «0,25 с», «0,5 с», «2 с». */
function tickLabel(value: number) {
  return `${Number(value.toFixed(2)).toString().replace(".", ",")} с`;
}

function useClock(clock: Clock) {
  const snapshot = useSyncExternalStore(clock.subscribe, clock.snapshot, () => "0:0");
  const [running, time] = snapshot.split(":");
  return { playing: running === "1", time: Number(time) };
}

export function Timeline({ animation, clock, selection, deviceName, onSelect, onSeek, onTogglePlay, onLoop, onMoveKeys, onToggleKey, onObjectKey, onDuration, audio, audioBuffer, onAddAudio, onAudioChange }: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [open, setOpen] = useState<Record<AnimatedObject, boolean>>({ device: false, camera: false });
  const [loop, setLoop] = useState(clock.loop);
  const [scrub, setScrub] = useState<{ x: number; y: number; time: number; snapped: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const { playing, time } = useClock(clock);
  const duration = animation.duration;
  const fit = Math.max(40, (visible - LABEL - PAD - END_PAD - 4) / duration);
  const pps = fit * zoom;
  const width = LABEL + duration * pps + PAD + END_PAD;
  const step = TICKS.find((tick) => tick * pps >= 64) ?? 10;
  const keyTimes = allKeyTimes(animation);
  const chosenKeys = selectedKeys(animation, selection);
  const chosenSegments = selectedSegments(animation, selection);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const observer = new ResizeObserver(() => setVisible(scroll.clientWidth));
    observer.observe(scroll);
    return () => observer.disconnect();
  }, []);

  // Во время воспроизведения курсор не уходит за правый край: шкала едет за ним.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !playing) return;
    const x = LABEL + PAD + time * pps;
    if (x > scroll.scrollLeft + scroll.clientWidth - 32) scroll.scrollLeft = x - LABEL - 32;
    else if (x < scroll.scrollLeft + LABEL) scroll.scrollLeft = Math.max(0, x - LABEL - 32);
  }, [time, playing, pps]);

  /** Время под курсором мыши. */
  const timeAt = useCallback((clientX: number) => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return clamp((clientX - rect.left - LABEL - PAD) / pps, 0, duration);
  }, [pps, duration]);

  /** С Shift курсор прилипает к ближайшему ключу, если тот ближе SNAP_PX. */
  const snap = useCallback((value: number, shift: boolean) => {
    if (!shift) return { time: value, snapped: false };
    const nearest = keyTimes.reduce<number | null>((best, key) => best === null || Math.abs(key - value) < Math.abs(best - value) ? key : best, null);
    return nearest !== null && Math.abs(nearest - value) * pps <= SNAP_PX ? { time: nearest, snapped: true } : { time: value, snapped: false };
  }, [keyTimes, pps]);

  const startScrub = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (clientX: number, clientY: number, shift: boolean) => {
      const { time: next, snapped } = snap(timeAt(clientX), shift);
      onSeek(next);
      setScrub({ x: clientX, y: clientY, time: next, snapped });
    };
    move(event.clientX, event.clientY, event.shiftKey);
    const target = event.currentTarget as HTMLElement;
    const onMove = (moveEvent: PointerEvent) => move(moveEvent.clientX, moveEvent.clientY, moveEvent.shiftKey);
    const onUp = () => { setScrub(null); target.removeEventListener("pointermove", onMove); target.removeEventListener("pointerup", onUp); target.removeEventListener("pointercancel", onUp); };
    target.addEventListener("pointermove", onMove); target.addEventListener("pointerup", onUp); target.addEventListener("pointercancel", onUp);
  };

  const chooseKeys = (keys: KeyRef[], additive: boolean) => {
    const allChosen = keys.every((key) => chosenKeys.some((other) => sameKey(key, other)));
    const next = additive ? allChosen ? chosenKeys.filter((key) => !keys.some((other) => sameKey(key, other))) : uniqueKeys([...chosenKeys, ...keys]) : keys;
    onSelect(next.length ? { kind: "keys", keys: next } : null);
    return next;
  };

  /** Ключи рисуются из документа: абсолютный сдвиг жеста применяется только там. */
  const startKey = (event: ReactPointerEvent, keyTime: number, refs: KeyRef[]) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const alreadyChosen = refs.every((key) => chosenKeys.some((other) => sameKey(key, other)));
    const keys = alreadyChosen && !event.shiftKey ? chosenKeys : chooseKeys(refs, event.shiftKey);
    if (!keys.length) return;
    const target = contentRef.current!;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startScroll = scrollRef.current?.scrollLeft ?? 0;
    const times = keys.map((ref) => findKey(animation, ref)!.time);
    const minDelta = -Math.min(...times), maxDelta = duration - Math.max(...times);
    let moved = false, delta = 0;
    const others = [...keyTimes.filter((other) => !times.some((at) => Math.abs(at - other) < TIME_STEP / 2)), clock.time];
    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX + (scrollRef.current?.scrollLeft ?? 0) - startScroll;
      if (!moved && Math.abs(dx) < 3) return;
      if (!moved) { moved = true; onMoveKeys(keys, 0, "start"); }
      let next = roundTime(keyTime + clamp(dx / pps, minDelta, maxDelta));
      if (moveEvent.shiftKey) {
        const nearest = others.reduce((best, other) => Math.abs(other - next) < Math.abs(best - next) ? other : best, Number.POSITIVE_INFINITY);
        if (Math.abs(nearest - next) * pps <= SNAP_PX) next = roundTime(nearest);
      }
      delta = roundTime(clamp(next - keyTime, minDelta, maxDelta));
      onMoveKeys(keys, delta, "change");
    };
    const cleanup = () => {
      target.removeEventListener("pointermove", onMove); target.removeEventListener("pointerup", onUp); target.removeEventListener("pointercancel", onCancel);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      cleanupRef.current = null;
    };
    const onUp = () => {
      cleanup();
      if (moved) onMoveKeys(keys, delta, "end");
    };
    const onCancel = () => { cleanup(); if (moved) onMoveKeys(keys, 0, "end"); };
    cleanupRef.current?.(); cleanupRef.current = cleanup;
    target.addEventListener("pointermove", onMove); target.addEventListener("pointerup", onUp); target.addEventListener("pointercancel", onCancel);
  };

  const chooseSegments = (segments: SegmentRef[], additive: boolean) => {
    const allChosen = segments.every((item) => chosenSegments.some((other) => sameSegment(item, other)));
    const next = additive ? allChosen ? chosenSegments.filter((item) => !segments.some((other) => sameSegment(item, other))) : [...chosenSegments, ...segments.filter((item) => !chosenSegments.some((other) => sameSegment(item, other)))] : segments;
    onSelect(next.length ? { kind: "segments", segments: next } : null);
  };

  const startMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest("button, .timeline-ruler, .timeline-label, .timeline-playhead")) return;
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    const start = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (start.x < LABEL) return;
    event.preventDefault();
    target.focus({ preventScroll: true }); target.setPointerCapture(event.pointerId);
    const initial = event.shiftKey ? chosenKeys : [];
    const allRefs = [...objectKeys(animation, "camera"), ...objectKeys(animation, "device")];
    if (!event.shiftKey) onSelect(null);
    const onMove = (moveEvent: PointerEvent) => {
      const bounds = target.getBoundingClientRect();
      const end = { x: Math.max(LABEL, moveEvent.clientX - bounds.left), y: moveEvent.clientY - bounds.top };
      const box = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
      setMarquee(box);
      const ids = new Set<string>();
      target.querySelectorAll<HTMLElement>(".timeline-key").forEach((element) => {
        const key = element.getBoundingClientRect();
        const x = key.x + key.width / 2 - bounds.left, y = key.y + key.height / 2 - bounds.top;
        if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) element.dataset.keyIds?.split(",").forEach((id) => ids.add(id));
      });
      const keys = uniqueKeys([...initial, ...allRefs.filter((ref) => ids.has(ref.id))]);
      onSelect(keys.length ? { kind: "keys", keys } : null);
    };
    const cleanup = () => {
      target.removeEventListener("pointermove", onMove); target.removeEventListener("pointerup", onUp); target.removeEventListener("pointercancel", onCancel);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      cleanupRef.current = null; setMarquee(null);
    };
    const onUp = () => cleanup();
    const onCancel = () => { cleanup(); onSelect(selection); };
    cleanupRef.current?.(); cleanupRef.current = cleanup;
    target.addEventListener("pointermove", onMove); target.addEventListener("pointerup", onUp); target.addEventListener("pointercancel", onCancel);
  };

  /** Дорожка с ключами и участками между ними. */
  const lane = (scope: AnimatedObject | TrackId, times: { time: number; keys: KeyRef[] }[], label: string) => {
    const list = times;
    return <div className="timeline-lane">
      {list.slice(0, -1).map((item, index) => {
        const next = list[index + 1];
        const tracks = scope === "camera" || scope === "device" ? objectTracks(scope) : [scope];
        const segments = tracks.flatMap((track) => {
          const keys = animation.tracks[track] ?? [];
          return keys.slice(0, -1).flatMap((key, at) => key.time <= item.time + TIME_STEP / 2 && keys[at + 1].time >= next.time - TIME_STEP / 2 ? [{ track, from: key.id, to: keys[at + 1].id }] : []);
        });
        const selected = segments.length > 0 && segments.every((segment) => chosenSegments.some((other) => sameSegment(segment, other)));
        return <button key={`s${item.keys.map((ref) => ref.id).join()}`} type="button" className={`timeline-segment${selected ? " selected" : ""}`} aria-pressed={selected}
          style={{ left: PAD + item.time * pps, width: Math.max(2, (next.time - item.time) * pps) }}
          aria-label={`Участок ${label} ${seconds(item.time)} — ${seconds(next.time)}`}
          onClick={(event) => chooseSegments(segments, event.shiftKey)} />;
      })}
      {list.map((item) => <button key={`k${item.keys.map((ref) => ref.id).join()}`} data-key-ids={item.keys.map((ref) => ref.id).join()} type="button" className={`timeline-key${item.keys.some((key) => chosenKeys.some((other) => sameKey(key, other))) ? " selected" : ""}${Math.abs(item.time - time) < TIME_STEP / 2 ? " current" : ""}`} aria-pressed={item.keys.every((key) => chosenKeys.some((other) => sameKey(key, other)))}
        style={{ left: PAD + item.time * pps }} aria-label={`Ключ ${label}, ${seconds(item.time)}`} {...tip(seconds(item.time))}
        onPointerDown={(event) => startKey(event, item.time, item.keys)} onClick={(event) => { if (event.detail === 0) chooseKeys(item.keys, event.shiftKey); }} />)}
    </div>;
  };

  const objectRow = (object: AnimatedObject, label: string) => {
    const tracks = objectTracks(object).filter((id) => isAnimated(animation, id));
    const times = objectKeyTimes(animation, object).map((keyTime) => ({ time: keyTime, keys: objectKeysAt(animation, object, keyTime) }));
    const atCursor = objectKeysAt(animation, object, time).length > 0;
    return <Fragment key={object}>
      <div className="timeline-row object">
        <div className="timeline-label">
          <button type="button" className="timeline-expand" aria-expanded={open[object]} aria-label={open[object] ? `Свернуть ${label}` : `Развернуть ${label}`} {...tip(!tracks.length ? "Нет анимированных свойств" : open[object] ? "Свернуть свойства" : "Показать свойства")} disabled={!tracks.length} onClick={() => setOpen((current) => ({ ...current, [object]: !current[object] }))}><ChevronRight size={14} /></button>
          <button type="button" className="timeline-name" aria-label={`Выбрать все ключи: ${label}`} aria-pressed={times.length > 0 && objectKeys(animation, object).every((key) => chosenKeys.some((other) => sameKey(key, other)))} onClick={(event) => chooseKeys(objectKeys(animation, object), event.shiftKey)}>{label}</button>
          <button type="button" className={`timeline-keybutton${atCursor ? " active" : ""}`} aria-label={`Записать ключ: ${label}`} {...tip(`Записать текущее положение: ${label}`)} onClick={() => onObjectKey(object)}><Diamond size={12} /></button>
        </div>
        {lane(object, times, label)}
      </div>
      {open[object] && tracks.map((id) => {
        const info = TRACKS.find((track) => track.id === id)!;
        const keys = (animation.tracks[id] ?? []).map((key) => ({ time: key.time, keys: [{ track: id, id: key.id }] }));
        const selected = selection?.kind === "track" && selection.track === id;
        return <div className={`timeline-row track${selected ? " selected" : ""}`} key={id}>
          <div className="timeline-label">
            <button type="button" className="timeline-track-name" onClick={() => onSelect({ kind: "track", track: id })} {...tip("Показать настройку")}>{info.label}</button>
            <button type="button" className={`timeline-keybutton${keyAt(animation.tracks[id], time) ? " active" : ""}`} aria-label={`${keyAt(animation.tracks[id], time) ? "Убрать" : "Поставить"} ключ: ${info.label}`} {...tip(`${keyAt(animation.tracks[id], time) ? "Убрать" : "Поставить"} ключ в этом времени`)} onClick={() => onToggleKey(id)}><Diamond size={12} /></button>
          </div>
          {lane(id, keys, info.label)}
        </div>;
      })}
    </Fragment>;
  };

  const ticks: number[] = [];
  for (let tick = 0; tick <= duration + 1e-6; tick += step) ticks.push(roundTime(tick));
  const empty = !keyTimes.length;

  return <section className="timeline" aria-label="Таймлайн">
    <div className="timeline-bar">
      <div className="timeline-transport">
        <button type="button" className="icon-button" onClick={onTogglePlay} aria-label={playing ? "Пауза" : "Воспроизвести"} {...tip(playing ? "Пауза" : "Воспроизвести", "Space")}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button type="button" className="icon-button" onClick={() => onSeek(0)} aria-label="В начало" {...tip("В начало", "Home")}><SkipBack size={16} /></button>
        <button type="button" className={`icon-button${loop ? " active" : ""}`} aria-pressed={loop} aria-label="Повтор" {...tip(loop ? "Выключить повтор" : "Повторять по кругу")} onClick={() => { setLoop(!loop); onLoop(!loop); }}><Repeat size={14} /></button>
      </div>
      <TimeField label="Текущее время" value={time} max={duration} onCommit={onSeek} />
      <span className="timeline-of">из</span>
      <TimeField label="Длительность" value={duration} min={MIN_DURATION} max={MAX_DURATION} onCommit={onDuration} />
      {!audio && <button type="button" className="small-button timeline-add-audio" onClick={onAddAudio}><Music2 size={14} /> Добавить аудио</button>}
      <label className="timeline-zoom"><span>Масштаб шкалы</span><input type="range" aria-label="Масштаб шкалы" min={1} max={12} step={0.1} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
    </div>
    <div className="timeline-scroll" ref={scrollRef} onWheel={(event) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); setZoom((value) => clamp(value * Math.exp(-event.deltaY * 0.002), 1, 12)); }}>
      <div className="timeline-content" ref={contentRef} style={{ width }} tabIndex={-1} onPointerDown={startMarquee}>
        <div className="timeline-row ruler-row">
          <div className="timeline-label timeline-corner" />
          <div className="timeline-ruler" onPointerDown={startScrub} role="slider" aria-label="Курсор времени" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Number(time.toFixed(2))} aria-valuetext={seconds(time)} tabIndex={0}
            onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onSeek(roundTime(time + (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 0.1 : TIME_STEP * 4))); } }}>
            {ticks.map((tick) => <span key={tick} className="timeline-tick" style={{ left: PAD + tick * pps }}>{tickLabel(tick)}</span>)}
          </div>
        </div>
        {objectRow("camera", "Камера")}
        {objectRow("device", deviceName)}
        {audio && <AudioTrack clip={audio} buffer={audioBuffer} duration={duration} pps={pps} selected={selection?.kind === "audio"} onSelect={() => onSelect({ kind: "audio" })} onChange={onAudioChange} />}
        {marquee && <div className="timeline-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} aria-hidden="true" />}
        {empty && !audio && <p className="timeline-hint">Поставьте курсор времени и поверните камеру или устройство — ключи появятся сами. Готовые движения — рядом с ракурсами над холстом.</p>}
        <div className={`timeline-playhead${scrub ? " dragging" : ""}`} style={{ left: LABEL + PAD + time * pps }} aria-hidden="true"><span className="timeline-playhead-head" onPointerDown={startScrub} /></div>
      </div>
    </div>
    {scrub && <div className={`timeline-bubble${scrub.snapped ? " snapped" : ""}`} style={{ left: clamp(scrub.x, (scrollRef.current?.getBoundingClientRect().left ?? 0) + LABEL + 30, (scrollRef.current?.getBoundingClientRect().right ?? 9999) - 30), top: (scrollRef.current?.getBoundingClientRect().top ?? 0) - 6 }} role="status">{scrub.snapped ? "◆ " : ""}{seconds(scrub.time)}</div>}
  </section>;
}

/** Поле времени в секундах: правка применяется по Enter или при уходе из поля. */
function TimeField({ label, value, min = 0, max, onCommit }: { label: string; value: number; min?: number; max: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft.replace(",", ".").replace(/[^\d.]/g, ""));
    if (draft.trim() && Number.isFinite(parsed)) onCommit(roundTime(clamp(parsed, min, max)));
    setDraft(null);
  };
  return <label className="timeline-time" {...tip(label)}>
    <span className="sr-only">{label}</span>
    <input value={draft ?? value.toFixed(2).replace(".", ",")} inputMode="decimal" aria-label={label} spellCheck={false}
      onFocus={(event) => { setDraft(value.toFixed(2).replace(".", ",")); event.currentTarget.select(); }}
      onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(null); event.currentTarget.blur(); } }} />
    <span aria-hidden="true">с</span>
  </label>;
}
