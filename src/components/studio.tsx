"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownToLine, ArrowRight, Camera, Check, ChevronDown, CircleHelp, Copy, Film, Image as ImageIcon, ImagePlus, Layers2, Link2, Pause, Play, Redo2, RotateCcw, Save, Smartphone, Sun, Undo2, Upload, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Button } from "./ui/button";
import { PagePicker } from "./page-picker";
import { InspectorSection } from "./inspector-section";
import { FluidChoice } from "./fluid-choice";
import { ThemeToggle } from "./theme-toggle";
import { Control, Segmented } from "./control";
import { Viewport, type ModelState, type NavigationCommand } from "./viewport";
import { Timeline, seconds, type Selection } from "./timeline";
import { selectedKeys, setSelectionEase, validSegment } from "@/lib/timeline-selection";
import { AnimationSection } from "./animation-section";
import { AudioSection } from "./audio-section";
import { LightingSection } from "./lighting-section";
import { TimelineAudio, normalizeAudio, type AudioClip, type ExportAudio } from "@/lib/audio";
import type { AudioChangePhase } from "./audio-track";
import { ExportDialog, type ExportOptions } from "./export-dialog";
import { DEFAULT_CAMERA, DEFAULT_SETTINGS, DEFAULT_TRANSFORM, FOLD_OPEN, FOLD_OUTER_BELOW, LID_MAX, PRESETS, SHADOW_VALUES, aspectRatio, clamp, exportSize, videoEnd, videoLength, type Aspect, type CameraSettings, type Device, type DeviceTransform, type ScreenFit, type ScreenKind, type Settings, type ShadowPreset } from "@/lib/settings";
import { BACKGROUNDS, backgroundCss, backgroundPreset } from "@/lib/backgrounds";
import { DEVICES, activeScreen, deviceFinish, deviceModel } from "@/lib/models";
import { EMPTY_ASSET, INITIAL_DOCUMENT, INITIAL_HISTORY, historyReducer, type DocumentState } from "@/lib/history";
import { parseProject, projectDocument, serializeProject } from "@/lib/project";
import { captureLink, isFigmaClipboard, isFigmaLink, normalizeLink, previewLink, type PagePreview } from "@/lib/capture";
import { spring } from "@/lib/springs";
import { videoFormats, type StudioScene } from "@/lib/scene";
import { Clock } from "@/lib/clock";
import { CAMERA_MOVES, applyCameraMove, type CameraMoveId } from "@/lib/camera-moves";
import {
  TIME_STEP, baseValue, evaluate, findKey, hasKeys, isAnimated, keyAt, moveKeys, objectTracks, removeKeys, roundTime, setEase, setKey, setSegmentLength, trackInfo, trackOf, withDuration, withValue,
  type AnimatedObject, type Animation, type EaseId, type KeyRef, type TrackId,
} from "@/lib/animation";
import { trackAnalyticsEvent } from "@/lib/analytics";

/**
 * Снимок близкой к экрану пропорции заполняет экран целиком, всё остальное
 * вписывается. Иначе от широкого кадра остаётся узкая центральная полоса, и
 * выглядит это так, будто изображение вообще не загрузилось.
 */
function fitForImage(width: number, height: number, screenRatio: number): ScreenFit {
  if (!width || !height) return "cover";
  return Math.abs(Math.log(width / height / screenRatio)) < 0.35 ? "cover" : "contain";
}

/** Смена модели или сгиба меняет экран: вписывание пересчитывается под него. */
function withScreen(current: DocumentState, device: Device, fold: number): DocumentState {
  const settings = { ...current.settings, device, fold, finish: deviceFinish(device, current.settings.finish).id };
  if (current.image.demo) return { ...current, settings };
  return { ...current, settings: { ...settings, screen: { ...settings.screen, fit: fitForImage(current.image.width, current.image.height, activeScreen(device, fold).aspect) } } };
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

/** Читает размеры и длительность видео, не выводя его на страницу. */
function probeVideo(url: string): Promise<{ width: number; height: number; duration: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight, duration: Number.isFinite(video.duration) ? video.duration : 0 });
    video.onerror = () => reject(new Error("Не удалось прочитать видео. Выберите MP4, WebM или MOV."));
    video.src = url;
  });
}

/** Секунды в виде 0:07,4 — длительности здесь короткие. */
function timecode(value: number): string {
  const whole = Math.max(0, value);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${(whole - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

/** Вложение фона из открытого проекта, если оно там было. */
function projectBackdrop(project: ReturnType<typeof parseProject>): DocumentState["backdrop"] | null {
  if (!project.backdropData) return null;
  return { url: project.backdropData, name: project.backdropName, width: 0, height: 0, demo: false, kind: project.backdropKind, duration: 0 };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return <div className="color-field"><label className="color-swatch"><input type="color" value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} /><span style={{ background: value }} /></label>
    <input value={draft.toUpperCase()} aria-label={`${label}, HEX`} maxLength={7} spellCheck={false} onChange={(event) => { setDraft(event.target.value); if (/^#[\da-f]{6}$/i.test(event.target.value)) onChange(event.target.value.toLowerCase()); }} onBlur={() => setDraft(value)} /><span className="color-label">{label}</span></div>;
}

/** Режим работы: статичный мокап или ролик. Результат и Ctrl+Shift+E зависят от режима. */
type Mode = "image" | "animation";

const SHADOW_NAMES: Record<ShadowPreset, string> = { soft: "Мягкая", contact: "Контактная", floating: "Парящая", long: "Длинная", hard: "Резкая", custom: "Своя" };
/** Подписи настроек, которые в панели называются короче, чем дорожки. */
const CONTROL_LABEL: Partial<Record<TrackId, string>> = { "camera.offsetX": "По горизонтали", "camera.offsetY": "По вертикали" };

/** Системное уведомление о копировании, если пользователь его разрешил. Возвращает, показано ли оно. */
function notify(text: string): boolean {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") {
    try { new Notification("iPhono-odevator", { body: text, icon: "/favicon.png", silent: true }); return true; } catch { return false; }
  }
  // Разрешение спрашивается один раз, при первом копировании: в ответ на действие человека.
  if (Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
  return false;
}

export function Studio() {
  const [history, dispatch] = useReducer(historyReducer, INITIAL_HISTORY);
  const { settings, image, backdrop } = history.present;
  const sceneRef = useRef<StudioScene | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const exportRef = useRef<HTMLDialogElement>(null);
  const uploadRequest = useRef(0);
  const objectURLs = useRef(new Set<string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modelState, setModelState] = useState<ModelState>({ status: "loading" });
  /** Активная область экрана, измеренная по модели. */
  const [screenSize, setScreenSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [capturing, setCapturing] = useState<"site" | "figma" | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  /** Предпросмотр страницы, пока пользователь выбирает, какой экран снять. */
  const [pagePick, setPagePick] = useState<PagePreview & { link: string; width: number; height: number; desktop: boolean } | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [navigation, setNavigation] = useState<NavigationCommand | null>(null);
  const title = "Мокап";
  const [activePreset, setActivePreset] = useState("front");
  const [mode, setMode] = useState<Mode>("image");
  const [clock] = useState(() => new Clock());
  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<"device" | "camera" | "scene" | "animation">("device");
  const [audioEngine] = useState(() => new TimelineAudio());
  const audio = history.present.audio;
  const audioInput = useRef<HTMLInputElement>(null);
  const audioRequest = useRef(0);
  const [audioLoading, setAudioLoading] = useState(false);
  const [decodedAudio, setDecodedAudio] = useState<{ url: string; buffer: AudioBuffer } | null>(null);
  const audioBuffer = decodedAudio?.url === audio?.url ? decodedAudio?.buffer ?? null : null;
  /** Выбранные готовые движения и документ до каждого: по ним список узнаёт движение и после отмены или повтора. */
  const [appliedMoves, setAppliedMoves] = useState<{ id: CameraMoveId; start: number; before: Animation; projection: CameraSettings["projection"]; after: Animation }[]>([]);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({ format: "webm", transparent: false, fps: 30 });
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [formats, setFormats] = useState<Record<"webm" | "mp4", boolean>>({ webm: false, mp4: false });
  const [reveal, setReveal] = useState<{ section: string; token: number }>({ section: "", token: 0 });
  const abortRef = useRef<AbortController | null>(null);
  const gestureRef = useRef<{ id: number; animation: Animation } | null>(null);
  const gestureCounter = useRef(0);

  const clockSnapshot = useSyncExternalStore(clock.subscribe, clock.snapshot, () => "0:0");
  const clockPlaying = clockSnapshot.startsWith("1");
  const time = Number(clockSnapshot.split(":")[1]);
  const animation = history.present.animation;
  const animated = hasKeys(animation);
  /** Что показывает сцена: настройки с ключами анимации в текущем времени. */
  const effective = useMemo(() => animated ? evaluate(settings, animation, time) : settings, [animated, settings, animation, time]);

  const size = exportSize(settings.aspect, settings.resolution);
  const model = deviceModel(settings.device);
  const distanceUnit = model.unit;
  const presets = PRESETS.filter((preset) => !preset.handheld || model.kind === "phone" || model.kind === "foldable" || model.kind === "tablet");
  const hasCutout = activeScreen(settings.device, settings.fold).cutout.length > 0;
  /** Размер скриншота для экрана: родное разрешение устройства, у вымышленного Duo — измеренный по модели. */
  const nativePixels = activeScreen(settings.device, settings.fold).pixels;
  const shotSize = nativePixels ? { width: nativePixels[0], height: nativePixels[1] } : screenSize;
  const mismatch = !image.demo && shotSize !== null && Math.abs(Math.log(image.width / image.height / (shotSize.width / shotSize.height))) > 0.01;
  const screenVideoLength = image.kind === "video" && image.duration > 0 ? videoLength(settings.video, image.duration) : null;

  const showToast = useCallback((text: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = setTimeout(() => setToast(null), error ? 6000 : 3500);
  }, []);
  const showError = useCallback((text: string) => showToast(text, true), [showToast]);
  useEffect(() => () => audioEngine.dispose(), [audioEngine]);
  useEffect(() => {
    let active = true;
    if (!audio?.url) { setDecodedAudio(null); return; }
    audioEngine.load(audio.url).then((buffer) => { if (active) setDecodedAudio({ url: audio.url, buffer }); }).catch(() => { if (active) showError("Не удалось прочитать аудио. Загрузите другой файл."); });
    return () => { active = false; };
  }, [audio?.url, audioEngine, showError]);
  useEffect(() => { audioEngine.sync(audio, audioBuffer, time, mode === "animation" && clockPlaying && !busy, animation.duration); }, [audio, audioBuffer, time, mode, clockPlaying, busy, animation.duration, audioEngine]);
  const onVideo = useCallback((value: boolean) => setPlaying(value), []);
  const toggleVideo = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene?.hasVideo) return;
    if (scene.videoPlaying) scene.pauseVideo(); else void scene.playVideo();
  }, []);
  // MediaRecorder и captureStream есть не везде, а на сервере их нет вовсе.
  useEffect(() => { setFormats(videoFormats()); }, []);
  useEffect(() => () => clock.dispose(), [clock]);
  const mutate = useCallback((recipe: (current: DocumentState) => DocumentState, group?: string) => dispatch({ type: "change", recipe, group, time: Date.now() }), []);
  const change = useCallback(<K extends keyof Settings,>(key: K, value: Settings[K], group?: string) => mutate((current) => ({ ...current, settings: { ...current.settings, [key]: value } }), group), [mutate]);
  const navigate = useCallback((type: NavigationCommand["type"]) => setNavigation({ type, id: Date.now() + Math.random() }), []);

  // Длина ролика задаёт границу часов; курсор не остаётся за концом.
  useEffect(() => { clock.duration = animation.duration; if (clock.time > animation.duration) clock.seek(animation.duration); }, [clock, animation.duration]);

  /**
   * Правка камеры или положения устройства. Анимированное свойство получает
   * ключ в текущем времени. В режиме анимации первое изменение свойства не в
   * начале ролика ставит два ключа: прежнее значение в начале и новое здесь —
   * так «поза A → поза B» получается без лишних кнопок.
   */
  // Режим читается через ref: правка не должна менять ссылку при переключении
  // режима, иначе обработчики камеры поменяются и вьюпорт пересоздаст 3D-сцену.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const edit = useCallback((group: "camera" | "transform", patch: Record<string, number | string>, historyGroup?: string) => {
    const at = clock.time;
    const animating = modeRef.current === "animation";
    mutate((current) => {
      let { settings: nextSettings, animation: nextAnimation } = current;
      const now = evaluate(nextSettings, nextAnimation, at);
      for (const [field, value] of Object.entries(patch)) {
        const track = typeof value === "number" ? trackOf(group, field) : null;
        if (!track || typeof value !== "number") {
          nextSettings = { ...nextSettings, [group]: { ...nextSettings[group], [field]: value } };
          continue;
        }
        const before = baseValue(now, track);
        if (isAnimated(nextAnimation, track)) nextAnimation = setKey(nextAnimation, track, at, value);
        else if (animating && at > TIME_STEP / 2 && Math.abs(before - value) > 1e-6) nextAnimation = setKey(setKey(nextAnimation, track, 0, before), track, at, value);
        else nextSettings = withValue(nextSettings, track, value);
      }
      return { ...current, settings: nextSettings, animation: nextAnimation };
    }, historyGroup);
  }, [clock, mutate]);

  const camera = useCallback((patch: Partial<CameraSettings>, group?: string) => {
    setActivePreset("");
    edit("camera", patch as Record<string, number | string>, group);
  }, [edit]);
  const transform = useCallback((patch: Partial<DeviceTransform>, group?: string) => edit("transform", patch as Record<string, number>, group), [edit]);

  /** Камеру вращают мышью: в документ попадают только изменившиеся свойства. */
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;
  const onCamera = useCallback((value: CameraSettings) => {
    if (clock.playing) return;
    const current = effectiveRef.current.camera;
    const patch = Object.fromEntries(Object.entries(value).filter(([field, next]) => typeof next === "number" ? Math.abs(next - (current[field as keyof CameraSettings] as number)) > 1e-4 : next !== current[field as keyof CameraSettings]));
    if (Object.keys(patch).length) camera(patch, "orbit");
  }, [camera, clock]);

  /** Манипулятор: один жест — один шаг отмены. */
  const onTransform = useCallback((value: DeviceTransform, phase: "start" | "change" | "end") => {
    if (phase === "start") { gestureCounter.current++; clock.pause(); return; }
    const current = effectiveRef.current.transform;
    const patch = Object.fromEntries(Object.entries(value).filter(([field, next]) => Math.abs(next - current[field as keyof DeviceTransform]) > 1e-4));
    if (Object.keys(patch).length) transform(patch, `gesture:transform-${gestureCounter.current}`);
    if (phase === "end") dispatch({ type: "end-group" });
  }, [clock, transform]);

  const resetCamera = useCallback(() => { camera({ ...DEFAULT_CAMERA }); setActivePreset("front"); }, [camera]);

  useEffect(() => () => { objectURLs.current.forEach((url) => URL.revokeObjectURL(url)); if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => { if (image.kind !== "video") setPlaying(false); }, [image.kind]);

  /* ---------- Время и ключи ---------- */

  const seek = useCallback((value: number) => { clock.pause(); clock.seek(roundTime(value)); }, [clock]);
  const togglePlay = useCallback(() => { if (!clock.playing && audio) void audioEngine.resume().catch(() => showError("Не удалось включить звук. Попробуйте ещё раз.")); clock.toggle(); }, [clock, audio, audioEngine, showError]);

  const switchMode = useCallback((next: Mode) => {
    clock.pause();
    if (next === "image") setSelection(null);
    setMode(next);
  }, [clock]);

  const toggleKey = useCallback((track: TrackId) => {
    const at = clock.time;
    mutate((current) => {
      const existing = keyAt(current.animation.tracks[track], at);
      if (existing) return { ...current, animation: removeKeys(current.animation, [{ track, id: existing.id }]) };
      const value = baseValue(evaluate(current.settings, current.animation, at), track);
      return { ...current, animation: setKey(current.animation, track, at, value) };
    });
  }, [clock, mutate]);

  /** Ключ объекта: текущее положение всех свойств камеры или устройства. */
  const objectKey = useCallback((object: AnimatedObject) => {
    const at = clock.time;
    mutate((current) => {
      const now = evaluate(current.settings, current.animation, at);
      return { ...current, animation: objectTracks(object).reduce((next, track) => setKey(next, track, at, baseValue(now, track)), current.animation) };
    });
  }, [clock, mutate]);

  const moveSelectedKeys = useCallback((keys: KeyRef[], delta: number, phase: "start" | "change" | "end") => {
    if (phase === "start") { clock.pause(); gestureCounter.current++; gestureRef.current = { id: gestureCounter.current, animation: history.present.animation }; return; }
    const gesture = gestureRef.current;
    if (!gesture) return;
    mutate((current) => ({ ...current, animation: moveKeys(gesture.animation, keys, delta) }), `gesture:keys-${gesture.id}`);
    if (phase === "end") { dispatch({ type: "end-group" }); gestureRef.current = null; }
  }, [clock, history.present.animation, mutate]);

  const deleteKeys = useCallback((keys: KeyRef[]) => {
    mutate((current) => ({ ...current, animation: removeKeys(current.animation, keys) }));
    setSelection(null);
  }, [mutate]);

  const updateAnimation = useCallback((recipe: (current: Animation) => Animation, group?: string) => mutate((current) => ({ ...current, animation: recipe(current.animation) }), group), [mutate]);

  /** Показать настройку свойства в панели: раскрыть раздел и подсветить поле. */
  const revealTrack = useCallback((track: TrackId) => {
    const section = trackInfo(track).object === "camera" ? "camera" : "position";
    setReveal({ section, token: Date.now() });
    const label = CONTROL_LABEL[track] ?? trackInfo(track).label;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const element = document.querySelector(`[data-section="${section}"] [data-control="${label}"]`);
      if (!(element instanceof HTMLElement)) return;
      element.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      element.classList.remove("is-revealed"); void element.offsetWidth; element.classList.add("is-revealed");
    }));
  }, []);

  const select = useCallback((next: Selection) => {
    clock.pause();
    setSelection(next);
    if (next?.kind === "track") revealTrack(next.track);
    else if (next) setReveal({ section: next.kind === "audio" ? "audio" : "animation", token: Date.now() });
  }, [clock, revealTrack]);

  /** Выделение, которое после отмены или удаления указывает на пустоту, считается пустым. */
  const activeSelection: Selection = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "audio") return audio ? selection : null;
    if (selection.kind === "keys") { const keys = selectedKeys(animation, selection); return keys.length ? { ...selection, keys } : null; }
    if (selection.kind === "track") return isAnimated(animation, selection.track) ? selection : null;
    const segments = selection.segments.filter((segment) => validSegment(animation, segment));
    return segments.length ? { ...selection, segments } : null;
  }, [selection, animation, audio]);
  const inspectorPanel = activeSelection?.kind === "track" ? trackInfo(activeSelection.track).object === "camera" ? "camera" : "device"
    : activeSelection ? "animation" : mode === "image" && panel === "animation" ? "device" : panel;
  const choosePanel = (next: typeof panel) => {
    setSelection(null); setPanel(next);
    setReveal({ section: next === "scene" ? "background" : next === "animation" ? "animation" : next, token: Date.now() });
  };

  /**
   * Готовое движение камеры применяется сразу при выборе. Смена движения
   * пересчитывает его от документа до прошлого выбора, «Без движения» убирает
   * ключи камеры. После ручной правки ключей список показывает «Своё движение».
   */
  const currentMove = appliedMoves.findLast((item) => item.after === animation) ?? null;
  const moveValue = currentMove ? currentMove.id : objectTracks("camera").some((track) => isAnimated(animation, track)) ? "" : "none";
  const chooseMove = useCallback((id: string) => {
    const base = currentMove?.before ?? animation;
    const projection = currentMove?.projection ?? settings.camera.projection;
    setSelection(null);
    if (id === "none") {
      const tracks = { ...base.tracks };
      for (const track of objectTracks("camera")) delete tracks[track];
      mutate((current) => ({ ...current, settings: { ...current.settings, camera: { ...current.settings.camera, projection } }, animation: { ...base, tracks } }));
      clock.pause();
      return;
    }
    const layout = sceneRef.current?.layout();
    const move = CAMERA_MOVES.find((item) => item.id === id);
    if (!move) return;
    if (!layout) { showError("Модель ещё загружается. Попробуйте через пару секунд."); return; }
    const start = currentMove?.start ?? (clock.time >= animation.duration - TIME_STEP ? 0 : clock.time);
    const next = applyCameraMove(base, move, layout, aspectRatio(settings.aspect), start);
    mutate((current) => ({ ...current, settings: { ...current.settings, camera: { ...current.settings.camera, projection: "perspective" } }, animation: next }));
    setAppliedMoves((list) => [...list.slice(-79), { id: move.id, start, before: base, projection, after: next }]);
    setActivePreset("");
    if (projection !== "perspective") showToast("Камера переключена на перспективу");
    clock.duration = next.duration;
    clock.seek(start);
    clock.play();
  }, [animation, clock, currentMove, mutate, settings.aspect, settings.camera.projection, showError, showToast]);

  // Сцена узнаёт время, воспроизведение и источник подкадров для размытия.
  useEffect(() => {
    const blur = animation.blur.enabled ? animation.blur.amount / 100 : 0;
    sceneRef.current?.setMotion({ timeline: mode === "animation", time, playing: clockPlaying, sample: blur > 0 ? (at) => evaluate(settings, animation, at) : null, blur, fps: exportOptions.fps });
  }, [mode, time, clockPlaying, settings, animation, exportOptions.fps, modelState.status]);

  /* ---------- Файлы ---------- */

  const changeAudio = useCallback((patch: Partial<AudioClip>, group?: string) => mutate((current) => current.audio ? { ...current, audio: normalizeAudio({ ...current.audio, ...patch }) } : current, group), [mutate]);
  const moveAudio = useCallback((clip: AudioClip, phase: AudioChangePhase) => {
    if (phase === "start") { clock.pause(); gestureCounter.current++; return; }
    changeAudio(clip, `gesture:audio-${gestureCounter.current}`);
    if (phase === "end") dispatch({ type: "end-group" });
  }, [changeAudio, clock]);
  const openAudio = useCallback(async (file: File) => {
    const request = ++audioRequest.current;
    if (file.size > 32 * 1024 * 1024) { showError("Аудиофайл больше 32 МБ. Выберите файл меньшего размера."); return; }
    if (!/\.(mp3|wav|m4a|ogg|aac|flac|webm)$/i.test(file.name)) { showError("Выберите MP3, WAV, M4A, OGG, AAC, FLAC или WebM со звуком."); return; }
    const mimeByExtension: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac", webm: "audio/webm" };
    const url = URL.createObjectURL(new Blob([file], { type: mimeByExtension[file.name.split(".").at(-1)!.toLowerCase()] }));
    setAudioLoading(true);
    try {
      const buffer = await audioEngine.load(url);
      if (request !== audioRequest.current) { URL.revokeObjectURL(url); return; }
      if (buffer.duration < 0.01 || buffer.duration > 36000) throw new Error("Не удалось определить длительность аудио.");
      objectURLs.current.add(url);
      clock.pause();
      mutate((current) => ({ ...current, audio: { url, name: file.name, duration: buffer.duration, offset: 0, start: 0, end: buffer.duration, volume: 100, muted: false } }));
      setDecodedAudio({ url, buffer }); setSelection({ kind: "audio" }); setMode("animation");
      showToast("Аудио добавлено");
    } catch { URL.revokeObjectURL(url); if (request === audioRequest.current) showError("Не удалось прочитать аудио. Выберите другой файл."); }
    finally { if (request === audioRequest.current) setAudioLoading(false); }
  }, [audioEngine, clock, mutate, showError, showToast]);

  const openFile = useCallback(async (file: File, options?: { name?: string; toast?: (width: number, height: number) => string }) => {
    const request = ++uploadRequest.current;
    setCapturing(null);
    const limit = file.name.toLowerCase().endsWith(".json") ? 128 : 32;
    if (file.size > limit * 1024 * 1024) { showError(`Файл больше ${limit} МБ. Выберите файл меньшего размера.`); return; }
    setLoadingImage(true);
    let url: string | null = null;
    let decodedSize: { width: number; height: number } | null = null;
    try {
      let project: ReturnType<typeof parseProject> | null = null;
      if (file.name.toLowerCase().endsWith(".json")) project = parseProject(await file.text());
      else if (![...IMAGE_TYPES, ...VIDEO_TYPES].includes(file.type)) throw new Error("Выберите PNG, JPG, WebP, MP4, WebM или проект .forma.json.");
      if (project && project.imageData === null) {
        if (request === uploadRequest.current) mutate(() => projectDocument(project.settings, null, projectBackdrop(project), project.animation, project.audio));
      } else {
        url = project?.imageData ?? URL.createObjectURL(file);
        const kind: ScreenKind = project ? project.imageKind : VIDEO_TYPES.includes(file.type) ? "video" : "image";
        let duration = 0;
        if (kind === "video") {
          const probed = await probeVideo(url);
          if (!probed.width || !probed.height) throw new Error("В файле нет видеодорожки. Выберите MP4 или WebM.");
          decodedSize = { width: probed.width, height: probed.height };
          duration = probed.duration;
        } else {
          const decoded = new Image(); decoded.src = url;
          try { await decoded.decode(); } catch { throw new Error("Не удалось прочитать изображение. Выберите другой PNG, JPG или WebP."); }
          if (decoded.naturalWidth > 20000 || decoded.naturalHeight > 20000) throw new Error("Изображение слишком большое. Уменьшите его до 20 000 пикселей по стороне.");
          decodedSize = { width: decoded.naturalWidth, height: decoded.naturalHeight };
        }
        if (request !== uploadRequest.current) { if (url.startsWith("blob:")) URL.revokeObjectURL(url); return; }
        if (url.startsWith("blob:")) objectURLs.current.add(url);
        const size = decodedSize;
        const nextImage = { url, name: project?.imageName ?? options?.name ?? file.name, width: size.width, height: size.height, demo: false, kind, duration };
        mutate((current) => project ? projectDocument(project.settings, nextImage, projectBackdrop(project), project.animation, project.audio) : {
          ...current, image: nextImage,
          settings: {
            ...current.settings,
            screen: { ...current.settings.screen, fit: fitForImage(size.width, size.height, activeScreen(current.settings.device, current.settings.fold).aspect), scale: 100, x: 0, y: 0 },
            // Новый файл — новая обрезка: прежние секунды к нему не относятся.
            video: { ...current.settings.video, start: 0, end: 0 },
          },
          // Ролик без ключей подстраивается под длину видео: так экспорт сразу даёт всё видео целиком.
          animation: kind === "video" && duration > 0 && !hasKeys(current.animation) ? withDuration(current.animation, duration / Math.max(0.25, current.settings.video.speed / 100)) : current.animation,
        });
        if (project && (hasKeys(project.animation) || project.audio)) setMode("animation");
      }
      if (project && project.imageData === null && (hasKeys(project.animation) || project.audio)) setMode("animation");
      if (request === uploadRequest.current) showToast(project ? "Проект открыт" : options?.toast && decodedSize ? options.toast(decodedSize.width, decodedSize.height) : "Экран обновлён");
    } catch (error) {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
      if (request === uploadRequest.current) showError(error instanceof Error ? error.message : "Не удалось открыть файл.");
    } finally { if (request === uploadRequest.current) setLoadingImage(false); }
  }, [mutate, showError, showToast]);

  /**
   * Своё фото или видео позади устройства. Файл не попадает в слот экрана:
   * это отдельное вложение документа со своей отменой и сохранением.
   */
  const openBackdrop = useCallback(async (file: File) => {
    if (file.size > 48 * 1024 * 1024) { showError("Файл фона больше 48 МБ. Выберите файл меньшего размера."); return; }
    if (![...IMAGE_TYPES, ...VIDEO_TYPES].includes(file.type)) { showError("Для фона выберите PNG, JPG, WebP, MP4 или WebM."); return; }
    const url = URL.createObjectURL(file);
    objectURLs.current.add(url);
    const kind: ScreenKind = VIDEO_TYPES.includes(file.type) ? "video" : "image";
    mutate((current) => ({
      ...current,
      backdrop: { url, name: file.name, width: 0, height: 0, demo: false, kind, duration: 0 },
      settings: { ...current.settings, background: { ...current.settings.background, mode: "custom" } },
    }));
    showToast(kind === "video" ? "Видеофон обновлён" : "Фон обновлён");
  }, [mutate, showError, showToast]);

  /** Снимает сайт или фрейм Figma в размер текстуры экрана текущей модели. */
  const shootLink = useCallback(async (link: string, width: number, height: number, desktop: boolean, scrollY?: number) => {
    const request = ++uploadRequest.current;
    const kind = isFigmaLink(link) ? "figma" : "site";
    setLoadingImage(true); setCapturing(kind);
    try {
      const file = await captureLink(link, width, height, desktop, scrollY);
      if (request !== uploadRequest.current) return;
      setLinkDraft("");
      await openFile(file, { toast: (w, h) => `${kind === "figma" ? "Фрейм Figma" : "Сайт"} на экране · ${w} × ${h}` });
    } catch (error) {
      if (request === uploadRequest.current) { setLoadingImage(false); showError(error instanceof Error ? error.message : "Не удалось получить снимок по ссылке."); }
    } finally { if (request === uploadRequest.current) setCapturing(null); }
  }, [openFile, showError]);

  /** Сайт сначала открывается предпросмотром всей страницы, чтобы выбрать, какой экран снять. */
  const openLink = useCallback(async (text: string) => {
    const link = normalizeLink(text);
    if (!link) { showError("Это не похоже на ссылку. Вставьте адрес вида https://example.com."); return; }
    const { width, height } = sceneRef.current?.screenSize ?? { width: 1290, height: 2796 };
    // Safari на iPad по умолчанию запрашивает настольную версию сайта.
    const desktop = model.kind === "laptop" || model.kind === "display" || model.kind === "tablet";
    if (isFigmaLink(link)) { await shootLink(link, width, height, desktop); return; }
    const request = ++uploadRequest.current;
    setLoadingImage(true); setCapturing("site");
    try {
      const preview = await previewLink(link, width, height, desktop);
      if (request !== uploadRequest.current) { URL.revokeObjectURL(preview.url); return; }
      setPagePick({ ...preview, link, width, height, desktop });
    } catch (error) {
      if (request === uploadRequest.current) showError(error instanceof Error ? error.message : "Не удалось получить снимок по ссылке.");
    } finally { if (request === uploadRequest.current) { setLoadingImage(false); setCapturing(null); } }
  }, [model.kind, shootLink, showError]);

  const closePagePick = useCallback((scrollY?: number) => {
    if (!pagePick) return;
    URL.revokeObjectURL(pagePick.url); setPagePick(null);
    if (scrollY !== undefined) void shootLink(pagePick.link, pagePick.width, pagePick.height, pagePick.desktop, scrollY);
  }, [pagePick, shootLink]);

  /* ---------- Экспорт ---------- */

  const fileName = title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "mockup";
  const ready = Boolean(sceneRef.current) && !busy && modelState.status === "ready" && !loadingImage;

  const exportPNG = useCallback(async () => {
    if (!sceneRef.current || busy || modelState.status !== "ready" || loadingImage) return;
    setBusy(true); clock.pause();
    try {
      const blob = await sceneRef.current.exportPNG(size.width, size.height);
      download(blob, `${fileName}-${size.width}x${size.height}.png`);
      trackAnalyticsEvent("mockup_export_png");
      showToast(`PNG сохранён · ${size.width} × ${size.height}`);
    } catch (error) { showError(error instanceof Error ? error.message : "Не удалось сохранить PNG. Попробуйте меньшее разрешение."); }
    finally { setBusy(false); }
  }, [busy, clock, modelState.status, loadingImage, size.width, size.height, fileName, showToast, showError]);

  /**
   * Копирование PNG без фона в буфер обмена. Картинка передаётся в
   * ClipboardItem обещанием сразу, ещё в обработчике нажатия: иначе браузер
   * посчитает запись не связанной с действием человека. Файл не скачивается.
   */
  const copyPNG = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene || busy || modelState.status !== "ready" || loadingImage) return;
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) { showError("Браузер не даёт записать картинку в буфер обмена. Сохраните PNG кнопкой «Скачать PNG»."); return; }
    setBusy(true); clock.pause();
    try {
      const blob = scene.exportPNG(size.width, size.height, { transparent: true });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      trackAnalyticsEvent("mockup_copy_png");
      if (!notify("PNG с прозрачным фоном — в буфере обмена")) showToast("Мокап скопирован");
    } catch { showError("Не удалось скопировать PNG. Попробуйте снова"); }
    finally { setBusy(false); }
  }, [busy, clock, modelState.status, loadingImage, size.width, size.height, showToast, showError]);

  const openExport = useCallback(() => {
    if (busy || modelState.status !== "ready") return;
    clock.pause();
    setExportOptions((current) => ({ ...current, transparent: current.transparent || settings.background.mode === "transparent" }));
    exportRef.current?.showModal();
  }, [busy, clock, modelState.status, settings.background.mode]);

  const exportAnimation = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true); setExportProgress(0); clock.pause();
    const { format, transparent, fps } = exportOptions;
    let soundtrack: ExportAudio | undefined;
    try {
      if (audio && !audio.muted && format !== "png") {
        if (!audioBuffer) throw new Error("Аудио ещё загружается. Попробуйте экспорт через пару секунд.");
        soundtrack = await audioEngine.forExport(audio, audioBuffer, animation.duration);
      }
      const blob = await scene.exportAnimation({
        width: size.width, height: size.height, fps, duration: animation.duration, transparent: transparent && format !== "mp4", format,
        sample: (at) => evaluate(settings, animation, at), blur: animation.blur.enabled ? animation.blur.amount / 100 : 0,
        onProgress: setExportProgress, signal: controller.signal, soundtrack,
      });
      download(blob, `${fileName}-${size.width}x${size.height}.${format === "png" ? "zip" : format}`);
      trackAnalyticsEvent("mockup_export_video");
      exportRef.current?.close();
      showToast(format === "png" ? `Кадры сохранены · ${Math.round(animation.duration * fps)} PNG в архиве` : `Ролик сохранён · ${size.width} × ${size.height}`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") showToast("Экспорт остановлен");
      else showError(error instanceof Error ? error.message : "Не удалось записать ролик. Попробуйте меньшее разрешение.");
    } finally { soundtrack?.dispose(); setBusy(false); setExportProgress(null); abortRef.current = null; }
  }, [audio, audioBuffer, audioEngine, busy, clock, animation, exportOptions, fileName, settings, showError, showToast, size.height, size.width]);

  const saveProject = useCallback(async () => {
    try {
      const text = await serializeProject(history.present);
      download(new Blob([text], { type: "application/json" }), `${fileName}.forma.json`);
      showToast("Проект сохранён вместе с изображением");
    } catch { showError("Не удалось сохранить проект. Попробуйте ещё раз."); }
  }, [history.present, fileName, showToast, showError]);

  /** Ctrl+Shift+E: в изображении — копирование PNG, в анимации — окно экспорта. */
  const primaryExport = useCallback(() => { if (mode === "animation") openExport(); else void copyPNG(); }, [mode, openExport, copyPNG]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.target instanceof HTMLElement && event.target.closest('[role="listbox"], [role="option"], [role="tablist"]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.code;
      const input = event.target instanceof HTMLElement && Boolean(event.target.closest("input, textarea, select, [contenteditable=true]"));
      const textEditing = event.target instanceof HTMLElement && Boolean(event.target.closest('input:not([type="range"]):not([type="checkbox"]):not([type="file"]):not([type="color"]), textarea, [contenteditable=true]'));
      if (document.querySelector("dialog[open]")) return;
      if (modifier && key === "KeyS") { event.preventDefault(); void saveProject(); return; }
      if (modifier && key === "KeyO") { event.preventDefault(); fileRef.current?.click(); return; }
      if (modifier && event.shiftKey && key === "KeyE") { event.preventDefault(); primaryExport(); return; }
      if (!busy && !textEditing && modifier && (key === "KeyZ" || key === "KeyY")) {
        event.preventDefault(); dispatch({ type: key === "KeyY" || event.shiftKey ? "redo" : "undo" }); setActivePreset(""); return;
      }
      if (input || busy) return;
      if (key === "Escape") {
        if (sceneRef.current?.cancelGesture()) { event.preventDefault(); return; }
        if (activeSelection) { setSelection(null); return; }
        navigate("orbit"); return;
      }
      if (mode === "animation" && (key === "Delete" || key === "Backspace") && activeSelection?.kind === "keys") { event.preventDefault(); deleteKeys(activeSelection.keys); return; }
      if (mode === "animation" && key === "Home") { event.preventDefault(); seek(0); return; }
      if (mode === "animation" && key === "End") { event.preventDefault(); seek(animation.duration); return; }
      if (modifier) return;
      if (key === "Equal" || key === "NumpadAdd") { event.preventDefault(); navigate("zoom-in"); }
      else if (key === "Minus" || key === "NumpadSubtract") { event.preventDefault(); navigate("zoom-out"); }
      else if (key === "Digit1" && event.shiftKey || key === "Digit2" && event.shiftKey || key === "KeyF") { event.preventDefault(); navigate("fit"); }
      else if (key === "Digit0") { event.preventDefault(); navigate("actual"); }
      else if (key === "KeyH") navigate("hand");
      else if (key === "KeyV") navigate("orbit");
      else if (key === "KeyW") navigate("translate");
      else if (key === "KeyE") navigate("rotate");
      else if (key === "KeyR") navigate("scale");
      else if (key === "Slash" && event.shiftKey) { event.preventDefault(); helpRef.current?.showModal(); }
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 2;
        const current = effective.camera;
        camera(key === "ArrowLeft" ? { azimuth: clamp(current.azimuth - step, -180, 180) } : key === "ArrowRight" ? { azimuth: clamp(current.azimuth + step, -180, 180) } : key === "ArrowUp" ? { elevation: clamp(current.elevation + step, -89, 89) } : { elevation: clamp(current.elevation - step, -89, 89) }, "arrow-camera");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeSelection, animation.duration, busy, camera, deleteKeys, effective.camera, mode, navigate, primaryExport, saveProject, seek]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data || busy || document.querySelector("dialog[open]")) return;
      const image = Array.from(data.files).find((file) => ["image/png", "image/jpeg", "image/webp"].includes(file.type));
      if (image) { event.preventDefault(); void openFile(image, { name: image.name === "image.png" ? "Из буфера обмена" : image.name }); return; }
      // В текстовых полях вставка работает как обычно.
      if (event.target instanceof HTMLElement && event.target.closest('input:not([type="range"]):not([type="checkbox"]):not([type="file"]):not([type="color"]), textarea, [contenteditable=true]')) return;
      const link = normalizeLink(data.getData("text/plain"));
      if (link) { event.preventDefault(); void openLink(link); return; }
      if (isFigmaClipboard(data.getData("text/html"))) {
        event.preventDefault();
        showError("Figma скопировала фрейм как слой, а не как картинку. Выделите фрейм, нажмите Shift+⌘+C (Copy as PNG) и вставьте снова — или вставьте ссылку на фрейм.");
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [busy, openFile, openLink, showError]);

  const screen = (patch: Partial<Settings["screen"]>, group?: string) => change("screen", { ...settings.screen, ...patch }, group);
  const light = (patch: Partial<Settings["light"]>, group?: string) => change("light", { ...settings.light, ...patch }, group);
  const background = (patch: Partial<Settings["background"]>, group?: string) => change("background", { ...settings.background, ...patch }, group);
  const video = (patch: Partial<Settings["video"]>, group?: string) => change("video", { ...settings.video, ...patch }, group);
  /** Ручная правка формы тени делает её «Своей»; цвет и включение пресет не трогают. */
  const shadow = (patch: Partial<Settings["shadow"]>, group?: string) => {
    const shape = "opacity" in patch || "softness" in patch || "distance" in patch || "length" in patch;
    change("shadow", { ...settings.shadow, ...patch, ...(shape ? { preset: "custom" as const } : {}) }, group);
  };
  const shadowPreset = (preset: ShadowPreset) => change("shadow", { ...settings.shadow, preset, ...(preset === "custom" ? {} : SHADOW_VALUES[preset]) });

  /** Ромб ключа у поля: в анимации — показать и переключить ключ свойства в текущем времени. */
  const keyProps = (track: TrackId) => mode !== "animation" ? {} : {
    keyState: keyAt(animation.tracks[track], time) ? "key" as const : isAnimated(animation, track) ? "animated" as const : "none" as const,
    onKey: () => toggleKey(track),
  };
  const view = effective;
  const lengthUnit = distanceUnit;

  return <MotionConfig reducedMotion="user"><main className={`studio-shell mode-${mode}`}>
    <div className="editor-layout">
      <section className="stage-column" aria-label="Сцена">
        <Viewport settings={effective} image={image} backdrop={backdrop} sceneRef={sceneRef} onCamera={onCamera} onTransform={onTransform} onModel={setModelState} onScreen={setScreenSize} onError={showError} onVideo={onVideo} modelState={modelState} navigation={navigation} onResetCamera={resetCamera} onDropFile={(file) => void openFile(file)} busy={busy}
          onSpaceTap={mode === "animation" ? togglePlay : undefined}
          topLeft={<div className="canvas-choices"><FluidChoice label="Ракурс" value={activePreset} placeholder="Свой ракурс" icon={Camera} className="preset-choice" disabled={busy} items={presets.map((preset) => ({ id: preset.id, label: preset.name }))} onChange={(id) => { const preset = presets.find((item) => item.id === id); if (preset) { camera({ ...preset.camera }); setActivePreset(id); } }} />{mode === "animation" && <FluidChoice label="Движение камеры" value={moveValue} placeholder="Своё движение" icon={Film} className="preset-choice" disabled={busy} items={[{ id: "none", label: "Без движения" }, ...CAMERA_MOVES.map((move) => ({ id: move.id, label: move.name, hint: move.description }))]} onChange={chooseMove} />}</div>}
          topCenter={<Segmented className="segmented mode-switch" label="Режим" value={mode} disabled={busy} items={[{ id: "image", label: "Изображение" }, { id: "animation", label: "Анимация" }]} onChange={switchMode} />}
          topRight={<div className="header-actions"><Button variant="ghost" size="icon-compact" aria-label="Отменить (Ctrl+Z)" title="Отменить · Ctrl+Z" disabled={!history.past.length || busy} onClick={() => { dispatch({ type: "undo" }); setActivePreset(""); }}><Undo2 /></Button><Button variant="ghost" size="icon-compact" aria-label="Повторить (Ctrl+Shift+Z)" title="Повторить · Ctrl+Shift+Z" disabled={!history.future.length || busy} onClick={() => { dispatch({ type: "redo" }); }}><Redo2 /></Button><span className="toolbar-divider" /><Button variant="ghost" size="icon-compact" aria-label="Сохранить проект (Ctrl+S)" title="Сохранить проект · Ctrl+S" onClick={() => void saveProject()}><Save /></Button><ThemeToggle /><Button variant="ghost" size="icon-compact" aria-label="Горячие клавиши" title="Горячие клавиши · ?" onClick={() => helpRef.current?.showModal()}><CircleHelp /></Button></div>} />
        {mode === "animation" && <Timeline animation={animation} clock={clock} selection={activeSelection} deviceName={model.name}
          audio={audio} audioBuffer={audioBuffer} onAddAudio={() => audioInput.current?.click()} onAudioChange={moveAudio}
          onSelect={select} onSeek={seek} onTogglePlay={togglePlay} onLoop={(loop) => { clock.loop = loop; }}
          onMoveKeys={moveSelectedKeys} onToggleKey={toggleKey} onObjectKey={objectKey}
          onDuration={(duration) => updateAnimation((current) => withDuration(current, duration))} />}
      </section>

      <aside className="inspector" aria-label="Настройки мокапа" data-panel={inspectorPanel}>
        <input ref={audioInput} type="file" className="sr-only" tabIndex={-1} aria-label="Файл аудио" accept=".mp3,.wav,.m4a,.ogg,.aac,.flac,.webm" disabled={busy || audioLoading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void openAudio(file); event.target.value = ""; }} />
        <nav className="inspector-nav" aria-label="Разделы настроек">
          {([{ id: "device", label: "Устройство", Icon: Smartphone }, { id: "camera", label: "Камера", Icon: Camera }, { id: "scene", label: "Сцена", Icon: Sun }, ...(mode === "animation" ? [{ id: "animation" as const, label: "Анимация", Icon: Film }] : [])] as const).map(({ id, label, Icon }) => <button key={id} type="button" aria-label={`Раздел: ${label}`} aria-pressed={inspectorPanel === id} title={label} disabled={busy} onClick={() => choosePanel(id)}><Icon size={17} aria-hidden="true" /><span>{label}</span></button>)}
        </nav>
        <div className="inspector-main">
        <fieldset className="inspector-fields" disabled={busy}>
          <div className="inspector-scroll">
            {mode === "animation" && audio && <InspectorSection section="audio" title="Аудио" visible={inspectorPanel === "animation" && (!activeSelection || activeSelection.kind === "audio")} defaultOpen revealToken={reveal.section === "audio" ? reveal.token : 0}>
              <AudioSection clip={audio} duration={animation.duration} onChange={changeAudio} onUpload={() => audioInput.current?.click()} onRemove={() => { mutate((current) => ({ ...current, audio: null })); setSelection(null); }} />
            </InspectorSection>}
            {mode === "animation" && <InspectorSection section="animation" title="Анимация" visible={inspectorPanel === "animation" && activeSelection?.kind !== "audio"} defaultOpen revealToken={reveal.section === "animation" ? reveal.token : 0}>
              <AnimationSection animation={animation} selection={activeSelection} unit={lengthUnit} videoLength={screenVideoLength}
                onEase={(segments, value: EaseId) => updateAnimation((current) => setSelectionEase(current, segments, value))}
                onSegmentLength={(tracks, from, to, length) => updateAnimation((current) => setSegmentLength(current, tracks, from, to, length), "segmentLength")}
                onKeyTime={(keys, delta) => updateAnimation((current) => moveKeys(current, keys, delta), "keyTime")}
                onKeyValue={(ref, value) => updateAnimation((current) => { const key = findKey(current, ref); return key ? setKey(current, ref.track, key.time, value) : current; }, "keyValue")}
                onDeleteKeys={deleteKeys} onSeek={seek} onReveal={revealTrack}
                onBlur={(patch, group) => updateAnimation((current) => ({ ...current, blur: { ...current.blur, ...patch } }), group)}
                onFitVideo={() => screenVideoLength && updateAnimation((current) => withDuration(current, screenVideoLength))} />
            </InspectorSection>}
            <InspectorSection section="device" title="Устройство" visible={inspectorPanel === "device"} defaultOpen revealToken={reveal.section === "device" ? reveal.token : 0}>
              <div className="property-row"><span>Модель</span><FluidChoice label="Модель устройства" value={settings.device} items={DEVICES.map((item) => ({ id: item.id, label: item.name, group: item.group }))} className="device-choice" onChange={(id) => { const selected = DEVICES.find((item) => item.id === id); if (selected) mutate((current) => withScreen(current, selected.id, current.settings.fold)); }} /></div>
              <div className="property-row"><span>Цвет</span><FluidChoice label="Цвет корпуса" value={settings.finish} items={model.finishes.map((item) => ({ id: item.id, label: item.name, color: item.color }))} className="finish-trigger" onChange={(id) => { const selected = model.finishes.find((item) => item.id === id); if (selected) change("finish", selected.id); }} /></div>
              {model.fold && <div className="hinge-control"><Control label="Раскрытие телефона" value={settings.fold} min={0} max={FOLD_OPEN} unit="°" onChange={(fold) => mutate((current) => withScreen(current, current.settings.device, fold), "fold")} /><p>{settings.fold < FOLD_OUTER_BELOW ? "Изображение на внешнем экране" : `На внутреннем экране · ниже ${FOLD_OUTER_BELOW}° — на внешнем`}</p></div>}
              {model.lid && <div className="hinge-control"><Control label="Раскрытие крышки" value={settings.lid} min={0} max={LID_MAX} unit="°" onChange={(lid) => change("lid", lid, "lid")} /></div>}
            </InspectorSection>
            <InspectorSection section="screen" title="Экран" visible={inspectorPanel === "device" && activeSelection?.kind !== "track"} defaultOpen>
              <div className="screen-source" data-clarity-mask="true"><div className="section-heading screen-heading"><h3>Изображение</h3><span className="screen-heading-meta">{shotSize && <span className="screen-size" title="Скриншот такого размера или тех же пропорций ляжет на экран без обрезки и полей">{shotSize.width} × {shotSize.height} px</span>}{!image.demo && <button className="quiet-icon" aria-label="Убрать изображение" title="Вернуть демо-экран" onClick={() => mutate((current) => ({ ...current, image: INITIAL_DOCUMENT.image }))}><X size={13} /></button>}</span></div>
                <button className={`upload-card${image.demo ? " demo-upload" : ""}`} disabled={loadingImage} onClick={() => fileRef.current?.click()} aria-label="Загрузить изображение или видео на экран" title="Загрузить изображение, видео или открыть проект · Ctrl+O">
                  {image.demo ? <span className="upload-icon"><ImagePlus size={20} /></span> : image.kind === "video" ? <span className="upload-icon"><Film size={20} /></span> : <span className="upload-thumb"><img src={image.url} alt="Загруженное изображение" /></span>}
                  <span className="upload-copy"><strong>{capturing === "site" ? "Снимаем сайт…" : capturing === "figma" ? "Загружаем фрейм из Figma…" : loadingImage ? "Загружаем…" : image.demo ? "Загрузить изображение" : image.name}</strong><span>{capturing ? "Обычно несколько секунд" : image.demo ? "PNG, JPG, WebP, MP4 или вставьте · Ctrl+V" : `${image.width} × ${image.height}${image.kind === "video" ? ` · ${timecode(image.duration)}` : ""}${mismatch ? settings.screen.fit === "cover" ? " · края обрежутся" : " · останутся поля" : ""}`}</span></span><Upload size={14} />
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,.json" className="sr-only" tabIndex={-1} aria-label="Файл изображения, видео или проекта" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void openFile(file); }} />
                <form className="link-field" onSubmit={(event) => { event.preventDefault(); void openLink(linkDraft); }}>
                  <Link2 size={14} aria-hidden="true" />
                  <input type="text" inputMode="url" value={linkDraft} onChange={(event) => setLinkDraft(event.target.value)} placeholder="Ссылка на сайт или фрейм Figma" aria-label="Ссылка на сайт или фрейм Figma" title="Снимок встанет в разрешении экрана телефона" spellCheck={false} autoComplete="off" disabled={loadingImage} />
                  <button type="submit" className="quiet-icon" aria-label="Вставить по ссылке" title="Вставить по ссылке · Enter" disabled={!linkDraft.trim() || loadingImage}>{capturing ? <span className="spinner" /> : <ArrowRight size={13} />}</button>
                </form></div>
              <section className="control-section"><div className="section-heading"><h3>Размещение изображения</h3></div><Segmented label="Размещение изображения" value={settings.screen.fit} items={[{ id: "cover", label: "Заполнить" }, { id: "contain", label: "Вписать" }]} onChange={(fit) => screen({ fit })} /><Control label="Масштаб изображения" value={settings.screen.scale} min={25} max={300} unit="%" onChange={(scale) => screen({ scale }, "screenScale")} /><Control label="Сдвиг по горизонтали" value={settings.screen.x} min={-100} max={100} unit="%" onChange={(x) => screen({ x }, "screenX")} /><Control label="Сдвиг по вертикали" value={settings.screen.y} min={-100} max={100} unit="%" onChange={(y) => screen({ y }, "screenY")} /></section>
              <section className="control-section"><div className="section-heading"><h3>Детали экрана</h3></div>{hasCutout && <label className="switch-row"><span><strong>Вырез камеры</strong><span>Выключите, если он уже на скриншоте</span></span><input type="checkbox" checked={settings.screen.island} onChange={(event) => screen({ island: event.target.checked })} /><i aria-hidden="true" /></label>}<Control label="Отражения на стекле" value={settings.screen.reflection} min={0} max={50} unit="%" onChange={(reflection) => screen({ reflection }, "reflection")} /></section>
              {image.kind === "video" && <section className="control-section"><div className="section-heading"><h3>Видео</h3><span className="format-badge">{timecode(videoLength(settings.video, image.duration))}</span></div>
                {mode === "animation" ? <p className="light-description">В анимации видео идёт по таймлайну и в ролике совпадает с превью.</p> : <div className="video-transport">
                  <button type="button" className="icon-button" onClick={toggleVideo} aria-label={playing ? "Пауза" : "Воспроизвести"} title={playing ? "Пауза" : "Воспроизвести"}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
                  <span className="video-range">{timecode(settings.video.start)} — {timecode(videoEnd(settings.video.end, image.duration))}</span>
                </div>}
                <label className="switch-row"><span><strong>Зациклить</strong><span>Отрезок повторяется без паузы</span></span><input type="checkbox" checked={settings.video.loop} onChange={(event) => video({ loop: event.target.checked })} /><i aria-hidden="true" /></label>
                <label className="switch-row"><span><strong>Звук</strong><span>В ролик экспорта звук не попадает</span></span><input type="checkbox" checked={!settings.video.muted} onChange={(event) => video({ muted: !event.target.checked })} /><i aria-hidden="true" /></label>
                <Control label="Начало" value={settings.video.start} min={0} max={Math.max(0.1, image.duration - 0.1)} step={0.1} unit="с" onChange={(start) => video({ start: Math.min(start, videoEnd(settings.video.end, image.duration) - 0.1) }, "videoStart")} />
                <Control label="Конец" value={videoEnd(settings.video.end, image.duration)} min={0.1} max={image.duration} step={0.1} unit="с" onChange={(end) => video({ end: Math.max(end, settings.video.start + 0.1) }, "videoEnd")} />
                <Control label="Скорость" value={settings.video.speed} min={25} max={400} unit="%" onChange={(speed) => video({ speed }, "videoSpeed")} />
              </section>}
              <button className="text-button" onClick={() => change("screen", { ...DEFAULT_SETTINGS.screen })}><RotateCcw size={13} /> Сбросить настройки экрана</button>
            </InspectorSection>
            <InspectorSection section="position" title="Положение" visible={inspectorPanel === "device"} revealToken={reveal.section === "position" ? reveal.token : 0}>
              <p className="section-hint">На сцене: W — перемещение, E — вращение кольцами, R — масштаб. Shift — с шагом.</p>
              <section className="control-section"><div className="section-heading"><h3>Сдвиг</h3></div>
                {(["x", "y", "z"] as const).map((axis) => <Control key={axis} label={`Положение ${axis.toUpperCase()}`} value={Number((view.transform[axis] * lengthUnit).toFixed(1))} min={-4 * lengthUnit} max={4 * lengthUnit} step={0.1} unit="см" onChange={(value) => transform({ [axis]: value / lengthUnit }, `transform-${axis}`)} {...keyProps(`transform.${axis}`)} />)}
              </section>
              <section className="control-section"><div className="section-heading"><h3>Поворот</h3></div>
                {(["rotX", "rotY", "rotZ"] as const).map((axis) => <Control key={axis} label={`Поворот ${axis.slice(3)}`} value={Number(view.transform[axis].toFixed(1))} min={-360} max={360} unit="°" onChange={(value) => transform({ [axis]: value }, `transform-${axis}`)} {...keyProps(`transform.${axis}`)} />)}
              </section>
              <section className="control-section"><Control label="Масштаб" value={Number(view.transform.scale.toFixed(1))} min={10} max={400} unit="%" onChange={(scale) => transform({ scale }, "transform-scale")} {...keyProps("transform.scale")} /></section>
              <button className="text-button" onClick={() => transform({ ...DEFAULT_TRANSFORM })}><RotateCcw size={13} /> Сбросить положение</button>
            </InspectorSection>
            <InspectorSection section="camera" title="Камера" visible={inspectorPanel === "camera"} revealToken={reveal.section === "camera" ? reveal.token : 0}>
              <section className="control-section"><div className="section-heading"><h3>Проекция</h3><button className="quiet-icon" title="Сбросить камеру" aria-label="Сбросить настройки камеры" onClick={resetCamera}><RotateCcw size={13} /></button></div><Segmented label="Проекция камеры" value={view.camera.projection} items={[{ id: "perspective", label: "Перспектива" }, { id: "orthographic", label: "Ортография" }]} onChange={(projection) => camera({ projection })} />
                <Control label="Фокусное расстояние" value={view.camera.focalLength} min={18} max={120} unit="мм" disabled={view.camera.projection === "orthographic"} onChange={(focalLength) => camera({ focalLength }, "focalLength")} {...keyProps("camera.focalLength")} />
                <Control label="Расстояние" value={view.camera.distance * distanceUnit} min={1.15 * distanceUnit} max={15 * distanceUnit} step={0.1} unit="см" disabled={view.camera.projection === "orthographic"} onChange={(distance) => camera({ distance: distance / distanceUnit }, "distance")} {...keyProps("camera.distance")} />
                <Control label="Масштаб в кадре" value={view.camera.zoom} min={25} max={400} unit="%" onChange={(zoom) => camera({ zoom }, "cameraZoom")} {...keyProps("camera.zoom")} />
              </section>
              <section className="control-section"><div className="section-heading"><h3>Ракурс</h3></div><Control label="Поворот" value={Number(view.camera.azimuth.toFixed(1))} min={-180} max={180} unit="°" onChange={(azimuth) => camera({ azimuth }, "azimuth")} {...keyProps("camera.azimuth")} /><Control label="Наклон" value={Number(view.camera.elevation.toFixed(1))} min={-89} max={89} unit="°" onChange={(elevation) => camera({ elevation }, "elevation")} {...keyProps("camera.elevation")} /><Control label="Крен" value={Number(view.camera.roll.toFixed(1))} min={-180} max={180} unit="°" onChange={(roll) => camera({ roll }, "roll")} {...keyProps("camera.roll")} /></section>
              <section className="control-section"><div className="section-heading"><h3>Положение в кадре</h3></div><Control label="По горизонтали" value={Number(view.camera.offsetX.toFixed(1))} min={-100} max={100} unit="%" onChange={(offsetX) => camera({ offsetX }, "cameraX")} {...keyProps("camera.offsetX")} /><Control label="По вертикали" value={Number(view.camera.offsetY.toFixed(1))} min={-100} max={100} unit="%" onChange={(offsetY) => camera({ offsetY }, "cameraY")} {...keyProps("camera.offsetY")} /></section>
            </InspectorSection>
            <InspectorSection section="background" title="Фон" visible={inspectorPanel === "scene"} revealToken={reveal.section === "background" ? reveal.token : 0}>
              <Segmented label="Тип фона" value={settings.background.mode} items={[{ id: "solid", label: "Цвет" }, { id: "gradient", label: "Градиент" }, { id: "preset", label: "Готовые" }, { id: "transparent", label: "Без фона" }]} onChange={(mode) => background({ mode })} />
              {settings.background.mode === "preset" ? <><div className="background-gallery" role="group" aria-label="Готовые фоны">{BACKGROUNDS.map((preset) => <button key={preset.id} type="button" style={{ background: backgroundCss(preset) }} aria-label={`${preset.group} · ${preset.name}`} title={`${preset.group} · ${preset.name}`} aria-pressed={settings.background.preset === preset.id} onClick={() => background({ preset: preset.id })}>{settings.background.preset === preset.id && <Check size={14} />}</button>)}</div>
                <p className="light-description">{backgroundPreset(settings.background.preset).group} · {backgroundPreset(settings.background.preset).name}</p>
                <label className="switch-row"><span><strong>Движение</strong><span>Пятна медленно ходят по кругу</span></span><input type="checkbox" checked={settings.background.animated} onChange={(event) => background({ animated: event.target.checked })} /><i aria-hidden="true" /></label>
                {settings.background.animated && <Control label="Скорость движения" value={settings.background.speed} min={10} max={300} unit="%" onChange={(speed) => background({ speed }, "backgroundSpeed")} />}</>
              : settings.background.mode === "custom" ? null
              : settings.background.mode === "transparent" ? <div className="transparency-note"><span className="checkerboard" /><span>Прозрачный фон</span></div> : <><div className="background-swatches">{["#ffffff", "#f4f4f4", "#e5e5e5", "#a3a3a3", "#737373", "#262626"].map((color) => <button key={color} style={{ background: color }} aria-label={`Фон ${color}`} aria-pressed={settings.background.color === color} onClick={() => background({ color })}>{settings.background.color === color && <Check size={13} style={{ color: color === "#262626" ? "white" : "#292929" }} />}</button>)}</div><ColorField label="Основной цвет" value={settings.background.color} onChange={(color) => background({ color }, "backgroundColor")} />{settings.background.mode === "gradient" && <><ColorField label="Второй цвет" value={settings.background.secondary} onChange={(secondary) => background({ secondary }, "backgroundSecondary")} /><Control label="Направление градиента" value={settings.background.angle} min={0} max={360} unit="°" onChange={(angle) => background({ angle }, "gradientAngle")} /></>}</>}
              {/* Своё фото или видео лежит отдельным блоком и видно при любом
                  типе фона: загрузка сама переключает режим на «Свой», так что
                  искать его в переключателе не нужно. */}
              <div className="backdrop-slot" data-clarity-mask="true">
                <button type="button" className={`upload-card${backdrop.demo ? " demo-upload" : ""}`} onClick={() => backdropRef.current?.click()} aria-label="Загрузить свой фон" title="Фото или видео позади устройства">
                  <span className="upload-icon">{backdrop.demo ? <ImagePlus size={20} /> : backdrop.kind === "video" ? <Film size={20} /> : <ImageIcon size={20} />}</span>
                  <span className="upload-copy"><strong>{backdrop.demo ? "Загрузить свой фон" : backdrop.name}</strong><span>{backdrop.demo ? "PNG, JPG, WebP, MP4 или WebM" : backdrop.kind === "video" ? "Видео · зациклено и без звука" : "Изображение по заполнению"}</span></span><Upload size={14} />
                </button>
                <input ref={backdropRef} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime" className="sr-only" tabIndex={-1} aria-label="Файл фона" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void openBackdrop(file); }} />
                {/* Файл уже загружен, но показан другой тип фона — вернуть его
                    одной кнопкой, не возвращаясь к переключателю. */}
                {!backdrop.demo && settings.background.mode !== "custom" && <button className="text-button" onClick={() => background({ mode: "custom" })}><ImageIcon size={13} /> Показать свой фон</button>}
                {!backdrop.demo && settings.background.mode === "custom" && <button className="text-button" onClick={() => mutate((current) => ({ ...current, backdrop: EMPTY_ASSET, settings: { ...current.settings, background: { ...current.settings.background, mode: "solid" } } }))}><X size={13} /> Убрать свой фон</button>}
              </div>
            </InspectorSection>
            <InspectorSection section="light" title="Свет" visible={inspectorPanel === "scene"}>
              <LightingSection light={settings.light} onChange={light} />
            </InspectorSection>
            <InspectorSection section="shadow" title="Тень" visible={inspectorPanel === "scene"}>
              <label className="switch-row"><span><strong>Тень на фоне</strong><span>Тень позади устройства</span></span><input type="checkbox" checked={settings.shadow.enabled} onChange={(event) => shadow({ enabled: event.target.checked })} /><i aria-hidden="true" /></label>
              {settings.shadow.enabled && <>
                <div className="property-row"><span>Вид</span><FluidChoice label="Вид тени" value={settings.shadow.preset} items={(Object.keys(SHADOW_NAMES) as ShadowPreset[]).map((id) => ({ id, label: SHADOW_NAMES[id] }))} className="shadow-choice" onChange={(id) => shadowPreset(id as ShadowPreset)} /></div>
                <Control label="Плотность тени" value={settings.shadow.opacity} min={0} max={100} unit="%" onChange={(opacity) => shadow({ opacity }, "shadowOpacity")} />
                <Control label="Мягкость тени" value={settings.shadow.softness} min={0} max={100} unit="%" onChange={(softness) => shadow({ softness }, "shadowSoftness")} />
                <Control label="Расстояние до фона" value={settings.shadow.distance} min={0} max={100} unit="%" onChange={(distance) => shadow({ distance }, "shadowDistance")} />
                <Control label="Длина тени" value={settings.shadow.length} min={0} max={100} unit="%" onChange={(length) => shadow({ length }, "shadowLength")} />
                <div className="section-heading shadow-color-heading"><h3>Цвет тени</h3></div>
                <Segmented label="Цвет тени" value={settings.shadow.tint} items={[{ id: "background", label: "От фона" }, { id: "custom", label: "Свой" }]} onChange={(tint) => shadow({ tint })} />
                {settings.shadow.tint === "custom" && <ColorField label="Цвет тени" value={settings.shadow.color} onChange={(color) => shadow({ color }, "shadowColor")} />}
              </>}
            </InspectorSection>
          </div>
        </fieldset>
        <div className="export-panel">
          <div className="section-heading"><h2>Экспорт</h2><span className="format-badge">{mode === "animation" ? seconds(animation.duration) : "PNG"}</span></div>
          <Segmented className="aspect-options" label="Формат кадра" value={settings.aspect} disabled={busy} items={(["16:9", "4:3", "1:1", "4:5", "9:16"] as Aspect[]).map((aspect) => ({ id: aspect, label: aspect }))} onChange={(aspect) => change("aspect", aspect)} />
          <div className="resolution-row"><label htmlFor="resolution">Разрешение</label><div className="select-wrap"><select id="resolution" value={settings.resolution} disabled={busy} onChange={(event) => change("resolution", Number(event.target.value))}><option value={1200}>1200 px</option><option value={1920}>1920 px</option><option value={2400}>2400 px</option><option value={3840}>4K · 3840 px</option></select><ChevronDown size={12} /></div></div>
          {mode === "animation"
            ? <button className="export-button" disabled={!ready} onClick={openExport} title="Экспорт анимации · Ctrl+Shift+E">{exportProgress !== null ? <span className="spinner" /> : <Film size={16} />}<span>{exportProgress !== null ? `Экспорт… ${Math.round(exportProgress * 100)} %` : "Экспортировать"}</span><span className="export-shortcut">↗</span></button>
            : <><button className="export-button" disabled={!ready} onClick={() => void copyPNG()} title="PNG с прозрачным фоном · Ctrl+Shift+E">{busy ? <span className="spinner" /> : <Copy size={16} />}<span>{busy ? "Готовим PNG…" : "Скопировать PNG"}</span><span className="export-shortcut">↗</span></button>
              <button className="text-button download-button" disabled={!ready} onClick={() => void exportPNG()}><ArrowDownToLine size={13} /> Скачать PNG</button></>}
          <div className="export-caption"><span>{size.width} × {size.height}{mode === "animation" ? ` · ${seconds(animation.duration)}` : " · без фона"}</span><span title={mode === "animation" ? "Экспорт анимации · Ctrl+Shift+E" : "Скопировать PNG · Ctrl+Shift+E"}>Ctrl ⇧ E</span></div>
        </div>
        </div>
      </aside>
    </div>

    <AnimatePresence mode="wait">
      {toast && <motion.div key={toast.text} className={`toast${toast.error ? " error" : ""}`} role={toast.error ? "alert" : "status"}
        initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.98, transition: spring.moderate.exit }} transition={spring.moderate}>
        <span className="toast-icon">{toast.error ? <CircleHelp size={16} /> : <Check size={16} />}</span><span>{toast.text}</span><button aria-label="Закрыть уведомление" onClick={() => setToast(null)}><X size={13} /></button></motion.div>}
    </AnimatePresence>
    {pagePick && <PagePicker key={pagePick.url} preview={pagePick} onCancel={() => closePagePick()} onConfirm={(scrollY) => closePagePick(scrollY)} />}
    <ExportDialog ref={exportRef} options={exportOptions} onOptions={setExportOptions} aspect={settings.aspect} resolution={settings.resolution} size={size} audio={Boolean(audio && !audio.muted)}
      onAspect={(aspect) => change("aspect", aspect)} onResolution={(resolution) => change("resolution", resolution)}
      duration={animation.duration} blur={animation.blur} supported={formats} progress={exportProgress}
      onExport={() => void exportAnimation()} onCancel={() => abortRef.current?.abort()} onClose={() => exportRef.current?.close()} />
    <dialog ref={helpRef} className="help-dialog"><div className="dialog-heading"><span className="dialog-icon"><Layers2 size={22} /></span><button className="icon-button" aria-label="Закрыть справку" onClick={() => helpRef.current?.close()}><X size={18} /></button></div><h2>Привычные движения.</h2><p>Всё нужное — под рукой.</p><dl className="shortcut-list">{[["Вращать камеру", "Перетаскивание / стрелки"], ["Перемещение, вращение, масштаб устройства", "W / E / R"], ["Камера / рука", "V / H"], ["Перемещать рабочую область", "Space + drag / средняя кнопка"], ["Масштаб под курсором", "Ctrl + колёсико"], ["Уместить кадр", "Shift + 1 / F"], ["Масштаб 100%", "0"], ["Отменить / повторить", "Ctrl + Z / Ctrl + Shift + Z"], ["Открыть экран или проект", "Ctrl + O"], ["Вставить картинку или ссылку", "Ctrl + V"], ["Сохранить проект", "Ctrl + S"], ["Скопировать PNG / экспорт анимации", "Ctrl + Shift + E"], ["Пуск и пауза анимации", "Space"], ["Курсор к ключу", "Shift при перетаскивании"], ["Удалить ключ", "Delete"]].map(([name, shortcut]) => <div key={name}><dt>{name}</dt><dd>{shortcut}</dd></div>)}</dl><p className="help-note">Масштаб рабочей области не влияет на экспорт. На Mac используйте ⌘ вместо Ctrl. Все файлы обрабатываются на вашем компьютере.</p><details className="model-credits"><summary>Авторы 3D-моделей</summary><p>iPhone 15 Pro и 15 Pro Max, Pro Display XDR, Apple Watch Ultra 2 и Series 9 — polyman, CC BY 4.0. iPhone 18 Pro, 18 Pro Max и iPhone Duo — extraakash, Sketchfab Standard. iPhone 17 Pro и 17 Pro Max, iPad Pro 13″ и MacBook Pro 14″ — Apple User, Sketchfab Standard. MacBook Air 13″ и iMac 24″ — valentinomyhero, CC BY 4.0. Galaxy S26 Ultra — gadirovsaid7, CC BY 4.0. Модели взяты с Sketchfab; названия соответствуют метаданным файлов.</p></details><button className="small-button reset-project" onClick={() => { mutate(() => structuredClone(INITIAL_DOCUMENT)); setActivePreset("front"); helpRef.current?.close(); showToast("Сцена сброшена. Изменение можно отменить."); }}><RotateCcw size={14} /> Сбросить всю сцену</button></dialog>
  </main></MotionConfig>;
}
