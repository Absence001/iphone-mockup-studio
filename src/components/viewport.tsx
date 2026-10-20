"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Hand, Minus, Move, Orbit, Plus, Rotate3d, Scaling, Scan, RotateCcw } from "lucide-react";
import { FluidStrip } from "./fluid-strip";
import { StudioScene } from "@/lib/scene";
import { aspectRatio, clamp, exportSize, type CameraSettings, type DeviceTransform, type Settings } from "@/lib/settings";
import type { ScreenImage } from "@/lib/history";

export interface ModelState { status: "loading" | "ready" | "error"; message?: string }
/** Инструмент рабочей области: камера, рука или один из манипуляторов устройства. */
export type Tool = "orbit" | "hand" | "translate" | "rotate" | "scale";
export type NavigationCommand = { id: number; type: "fit" | "zoom-in" | "zoom-out" | "actual" | Tool };

interface ViewportProps {
  settings: Settings; image: ScreenImage; backdrop: ScreenImage; sceneRef: RefObject<StudioScene | null>;
  onCamera: (camera: CameraSettings) => void; onModel: (state: ModelState) => void;
  onScreen: (size: { width: number; height: number }) => void;
  /** Манипулятор устройства: начало, ход и конец жеста. */
  onTransform: (value: DeviceTransform, phase: "start" | "change" | "end") => void;
  onError: (message: string) => void; modelState: ModelState; navigation: NavigationCommand | null;
  /** Видео на экране пошло или встало. */
  onVideo: (playing: boolean) => void;
  /** Короткое нажатие Space без перетаскивания: в анимации это пуск и пауза. */
  onSpaceTap?: () => void;
  onResetCamera: () => void; onDropFile: (file: File) => void; busy: boolean;
  topLeft: ReactNode; topCenter?: ReactNode; topRight: ReactNode;
}

interface View { x: number; y: number; zoom: number }

const HOME: View = { x: 0, y: 0, zoom: 1 };
/** Меньше половины кадр не уменьшается: в точку его уводить незачем. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
/** Постоянная времени догона цели, мс. Чем больше, тем мягче ход. */
const GLIDE_MS = 90;
/** Шаг колеса: при обычном щелчке (deltaY 100) масштаб меняется примерно в
 *  1,16 раза — заметно, но без скачка через половину диапазона. */
const WHEEL_ZOOM = 0.0015;
/** Шаг кнопок «плюс» и «минус», он же шаг клавиш + и −. */
const BUTTON_ZOOM = 1.25;
/**
 * Поля вокруг кадра: слева и справа — под панель инструментов, сверху и
 * снизу — под верхнюю строку и масштаб. Кадр в целом виде не заходит под них.
 */
const SIDE = 76;
/** Сверху ещё и место под подпись кадра, чтобы она не заходила под верхнюю строку. */
const TOP = 84;
const BOTTOM = 64;
/** Насколько увеличенный кадр можно увести за край рабочей области. */
const OVERSCROLL = 48;
/** Сколько длится нажатие Space, которое ещё считается коротким. */
const TAP_MS = 260;

const TOOLS: { id: Tool; label: string; key: string; icon: typeof Orbit }[] = [
  { id: "orbit", label: "Камера", key: "V", icon: Orbit },
  { id: "translate", label: "Перемещение", key: "W", icon: Move },
  { id: "rotate", label: "Вращение", key: "E", icon: Rotate3d },
  { id: "scale", label: "Масштаб", key: "R", icon: Scaling },
  { id: "hand", label: "Рука", key: "H", icon: Hand },
];

export function Viewport({ settings, image, backdrop, sceneRef, onCamera, onModel, onScreen, onTransform, onError, onVideo, onSpaceTap, modelState, navigation, onResetCamera, onDropFile, busy, topLeft, topCenter, topRight }: ViewportProps) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const initial = useRef(settings);
  const [generation, setGeneration] = useState(0);
  const [available, setAvailable] = useState({ width: 900, height: 650 });
  const availableRef = useRef(available);
  const [view, setView] = useState<View>(HOME);
  const viewRef = useRef(view);
  // Куда рабочая область едет. Колесо и кнопки двигают цель, а кадры догоняют
  // её по экспоненте — отсюда ощущение непрерывного наезда вместо ступенек.
  const targetRef = useRef(view);
  const glideRef = useRef<number | null>(null);
  const glideStampRef = useRef(0);
  const calmRef = useRef(false);
  const [tool, setTool] = useState<Tool>("orbit");
  const [space, setSpace] = useState(false);
  const spaceRef = useRef<{ at: number; panned: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const panRef = useRef<{ pointer: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const dragDepth = useRef(0);
  const ratio = aspectRatio(settings.aspect);
  const width = Math.min(Math.max(160, available.width - SIDE * 2), Math.max(160, available.height - TOP - BOTTOM) * ratio);
  const height = width / ratio;
  const frameSize = useRef({ width, height });
  frameSize.current = { width, height };
  const output = exportSize(settings.aspect, settings.resolution);
  const hand = tool === "hand";
  // Превью рисуется в CSS-масштабе рабочей области, поэтому при наезде холст
  // просто растягивался бы. Плотность пикселей идёт за масштабом ступенями по
  // 0,5, чтобы буфер не пересоздавался на каждом кадре наезда.
  const renderScale = Math.min(MAX_ZOOM, Math.max(1, Math.round(view.zoom * 2) / 2));

  /**
   * Кадр не уходит за рабочую область: пока он помещается целиком, он стоит
   * по центру, а увеличенный двигается только до своих краёв с небольшим запасом.
   */
  const bound = useCallback((next: View): View => {
    const { width: frameWidth, height: frameHeight } = frameSize.current;
    const area = availableRef.current;
    const limitX = Math.max(0, (frameWidth * next.zoom - (area.width - SIDE * 2)) / 2 + OVERSCROLL);
    const limitY = Math.max(0, (frameHeight * next.zoom - (area.height - TOP - BOTTOM)) / 2 + OVERSCROLL);
    const fits = frameWidth * next.zoom <= area.width - SIDE * 2 + 1 && frameHeight * next.zoom <= area.height - TOP - BOTTOM + 1;
    return { zoom: next.zoom, x: fits ? 0 : clamp(next.x, -limitX, limitX), y: fits ? 0 : clamp(next.y, -limitY, limitY) };
  }, []);

  useEffect(() => { calmRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches; }, []);
  useEffect(() => () => { if (glideRef.current !== null) cancelAnimationFrame(glideRef.current); }, []);

  const stopGlide = useCallback(() => {
    if (glideRef.current === null) return;
    cancelAnimationFrame(glideRef.current);
    glideRef.current = null;
  }, []);

  const glide = useCallback(() => {
    if (glideRef.current !== null) return;
    glideStampRef.current = performance.now();
    const step = (now: number) => {
      const target = targetRef.current, current = viewRef.current;
      const elapsed = Math.min(now - glideStampRef.current, 64);
      glideStampRef.current = now;
      // Доля пути за кадр считается от прошедшего времени, поэтому ход
      // одинаковый и на 60, и на 120 кадрах в секунду.
      const portion = 1 - Math.exp(-elapsed / GLIDE_MS);
      const next = {
        zoom: current.zoom + (target.zoom - current.zoom) * portion,
        x: current.x + (target.x - current.x) * portion,
        y: current.y + (target.y - current.y) * portion,
      };
      const settled = Math.abs(next.zoom - target.zoom) < 0.0005 && Math.abs(next.x - target.x) < 0.2 && Math.abs(next.y - target.y) < 0.2;
      viewRef.current = settled ? target : next;
      setView(viewRef.current);
      glideRef.current = settled ? null : requestAnimationFrame(step);
    };
    glideRef.current = requestAnimationFrame(step);
  }, []);

  /** Мгновенный сдвиг: перетаскивание должно держаться за курсор. */
  const setViewNow = useCallback((next: View) => {
    stopGlide();
    const bounded = bound(next);
    targetRef.current = bounded;
    viewRef.current = bounded;
    setView(bounded);
  }, [bound, stopGlide]);

  /** Плавный переход к новой цели. Цель считается от предыдущей цели, а не от
   *  текущего кадра, иначе быстрые щелчки колеса съедали бы друг друга. */
  const setViewSoon = useCallback((recipe: (target: View) => View) => {
    const next = bound(recipe(targetRef.current));
    targetRef.current = next;
    if (calmRef.current) { viewRef.current = next; setView(next); return; }
    glide();
  }, [bound, glide]);

  const zoomBy = useCallback((factor: number, anchorX = 0, anchorY = 0) => {
    setViewSoon((target) => {
      const zoom = clamp(target.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const change = zoom / target.zoom;
      return { zoom, x: anchorX - (anchorX - target.x) * change, y: anchorY - (anchorY - target.y) * change };
    });
  }, [setViewSoon]);

  const fit = useCallback(() => setViewSoon(() => HOME), [setViewSoon]);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    const host = canvasRef.current;
    if (!host) return;
    let scene: StudioScene | null = null;
    try { scene = new StudioScene(host, initial.current, { camera: onCamera, model: onModel, screen: onScreen, video: onVideo, transform: onTransform }); sceneRef.current = scene; }
    catch { onModel({ status: "error", message: "Не удалось запустить 3D. Включите аппаратное ускорение в браузере и нажмите «Повторить»." }); }
    return () => { scene?.dispose(); sceneRef.current = null; };
  }, [generation, sceneRef, onCamera, onModel, onScreen, onVideo, onTransform]);
  useEffect(() => { sceneRef.current?.update(settings); }, [settings, generation, sceneRef]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!image.url) { scene.clearImage(); return; }
    const video = image.kind === "video";
    (video ? scene.setVideo(image.url) : scene.setImage(image.url))
      .catch(() => onError(video ? "Не удалось прочитать видео. Выберите MP4 или WebM." : "Не удалось прочитать изображение. Попробуйте другой PNG, JPG или WebP."));
  }, [image.url, image.kind, generation, sceneRef, onError]);
  useEffect(() => { sceneRef.current?.setViewScale(renderScale); }, [renderScale, generation, sceneRef]);
  useEffect(() => {
    sceneRef.current?.setBackdrop(backdrop.url, backdrop.kind).catch(() => onError("Не удалось прочитать файл фона. Выберите PNG, JPG, WebP, MP4 или WebM."));
  }, [backdrop.url, backdrop.kind, generation, sceneRef, onError]);
  useEffect(() => { sceneRef.current?.setInteractionEnabled(!hand && !space && !busy); }, [hand, space, busy, generation, sceneRef]);
  useEffect(() => { sceneRef.current?.setGizmo(tool === "translate" || tool === "rotate" || tool === "scale" ? tool : "none"); }, [tool, generation, sceneRef]);
  useEffect(() => {
    const host = workspaceRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      availableRef.current = { width: host.clientWidth, height: host.clientHeight };
      setAvailable(availableRef.current);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  // Окно или нижняя панель поменяли место под кадр: сдвиг пересчитывается
  // под новые границы, а сам ракурс и экспорт не меняются.
  useEffect(() => { setViewNow(viewRef.current); }, [available, width, height, setViewNow]);

  useEffect(() => {
    const host = workspaceRef.current;
    if (!host) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      // Firefox и часть мышей присылают строки и страницы вместо пикселей.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      if (event.ctrlKey || event.metaKey) {
        const bounds = host.getBoundingClientRect();
        const delta = clamp(event.deltaY * unit, -120, 120);
        zoomBy(Math.exp(-delta * WHEEL_ZOOM), event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2);
      } else {
        const stepX = (event.shiftKey ? event.deltaY : event.deltaX) * unit;
        const stepY = (event.shiftKey ? 0 : event.deltaY) * unit;
        setViewSoon((target) => ({ ...target, x: target.x - stepX, y: target.y - stepY }));
      }
    };
    host.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => host.removeEventListener("wheel", wheel, { capture: true });
  }, [zoomBy, setViewSoon]);

  const spaceTap = useRef(onSpaceTap);
  spaceTap.current = onSpaceTap;
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Shift") sceneRef.current?.setSnap(true);
      if (event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.target instanceof HTMLElement && (event.target.closest('[role="combobox"], [role="listbox"], [role="option"], [role="tablist"], dialog') || event.target.closest('button, a') && event.target.matches(':focus-visible'))) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat && !spaceRef.current) spaceRef.current = { at: event.timeStamp, panned: false };
        setSpace(true);
      }
    };
    const release = (event: KeyboardEvent) => {
      if (event.key === "Shift") sceneRef.current?.setSnap(false);
      if (event.code !== "Space") return;
      const press = spaceRef.current;
      spaceRef.current = null;
      setSpace(false);
      // Время событий отражает само нажатие: тяжёлый кадр WebGL между
      // keydown и keyup не должен превращать короткий Space в удержание.
      if (press && !press.panned && event.timeStamp - press.at < TAP_MS) spaceTap.current?.();
    };
    const blur = () => { setSpace(false); spaceRef.current = null; panRef.current = null; setPanning(false); sceneRef.current?.setSnap(false); };
    window.addEventListener("keydown", keydown); window.addEventListener("keyup", release); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", release); window.removeEventListener("blur", blur); };
  }, [sceneRef]);

  useEffect(() => {
    if (!navigation) return;
    if (navigation.type === "fit") fit();
    else if (navigation.type === "actual") setViewSoon((target) => ({ ...target, zoom: 1 }));
    else if (navigation.type === "zoom-in" || navigation.type === "zoom-out") zoomBy(navigation.type === "zoom-in" ? BUTTON_ZOOM : 1 / BUTTON_ZOOM);
    else setTool(navigation.type);
  }, [navigation, fit, zoomBy, setViewSoon]);

  // Подпись кадра стоит над его левым верхним углом и едет вместе с ним.
  const frameLeft = available.width / 2 + view.x - width * view.zoom / 2;
  const frameTop = available.height / 2 + view.y - height * view.zoom / 2;

  return <div className={`workspace${hand || space ? " hand-mode" : ""}${panning ? " panning" : ""}`} ref={workspaceRef} aria-label="Рабочая область" tabIndex={0}
    onContextMenu={(event) => event.preventDefault()}
    onPointerDownCapture={(event) => {
      // Иконка внутри кнопки — это SVGElement, а не HTMLElement: проверка по
      // HTMLElement пропускала клик по иконке в панорамирование, и в режиме
      // руки кнопки панелей переставали нажиматься.
      if (event.target instanceof Element && event.target.closest("button, input, select, textarea, summary, a, [contenteditable=true], [role='combobox']")) return;
      // Возвращаем фокус с последнего поля/кнопки на сцену: Space после
      // вращения холста должен управлять воспроизведением.
      workspaceRef.current?.focus({ preventScroll: true });
      if (event.button !== 1 && !(event.button === 0 && (hand || space))) return;
      event.preventDefault(); event.stopPropagation();
      stopGlide();
      if (spaceRef.current) spaceRef.current.panned = true;
      workspaceRef.current?.setPointerCapture(event.pointerId);
      panRef.current = { pointer: event.pointerId, x: viewRef.current.x, y: viewRef.current.y, startX: event.clientX, startY: event.clientY };
      setPanning(true);
    }}
    onPointerMove={(event) => { const pan = panRef.current; if (pan?.pointer === event.pointerId) setViewNow({ ...viewRef.current, x: pan.x + event.clientX - pan.startX, y: pan.y + event.clientY - pan.startY }); }}
    onPointerUp={(event) => { if (panRef.current?.pointer === event.pointerId) { panRef.current = null; setPanning(false); workspaceRef.current?.releasePointerCapture(event.pointerId); } }}
    onPointerCancel={() => { panRef.current = null; setPanning(false); }}
    onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDraggingFile(true); } }}
    onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
    onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) { dragDepth.current = 0; setDraggingFile(false); } }}
    onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDraggingFile(false); const file = event.dataTransfer.files[0]; if (file) onDropFile(file); }}>
    <div className="workspace-topline"><div>{topLeft}</div>{topCenter && <div className="workspace-center">{topCenter}</div>}<div>{topRight}</div></div>
    <FluidStrip axis="y" className="tool-rail" role="toolbar" aria-label="Инструменты рабочей области">
      {TOOLS.map(({ id, label, key, icon: Icon }) => <button key={id} className={tool === id ? "active" : ""} aria-label={`${label} (${key})`} aria-pressed={tool === id} title={`${label} · ${key}${id === "hand" ? " / Space" : ""}`} onClick={() => setTool(id)}><Icon size={18} /></button>)}
    </FluidStrip>
    <div className="frame-label" aria-hidden="true" style={{ transform: `translate(${Math.round(frameLeft)}px, ${Math.round(frameTop - 22)}px)` }}>
      <span>{settings.aspect}</span><span>{output.width} × {output.height}</span>
    </div>
    <div className="artboard" data-clarity-mask="true" data-testid="artboard" data-view-zoom={view.zoom.toFixed(3)} data-view-x={view.x.toFixed(1)} data-view-y={view.y.toFixed(1)}
      style={{ width, height, transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
      <div className={`render-surface${settings.background.mode === "transparent" ? " checkerboard" : ""}`} ref={canvasRef} />
      {modelState.status !== "ready" && <div className="scene-status" role="status">
        {modelState.status === "loading" ? <><span className="spinner" /><span>Загружаем модель…</span></> : <><span>{modelState.message}</span><button className="small-button" onClick={() => setGeneration((value) => value + 1)}><RotateCcw size={14} /> Повторить</button></>}
      </div>}
    </div>
    {draggingFile && <div className="drop-overlay"><span><Plus size={32} /> Отпустите, чтобы заменить экран</span></div>}
    <div className="workspace-bottom">
      <FluidStrip axis="x" className="zoom-toolbar"><button aria-label="Уменьшить рабочую область" title="Уменьшить · −" onClick={() => zoomBy(1 / BUTTON_ZOOM)}><Minus size={15} /></button><button className="zoom-value" onClick={fit} title="Уместить кадр · Shift+1">{Math.round(view.zoom * 100)}%</button><button aria-label="Увеличить рабочую область" title="Увеличить · +" onClick={() => zoomBy(BUTTON_ZOOM)}><Plus size={15} /></button><span /><button aria-label="Уместить холст" title="Уместить кадр · Shift+1" onClick={fit}><Scan size={16} /></button></FluidStrip>
      <button className="reset-view icon-button" onClick={onResetCamera} aria-label="Сбросить камеру" title="Сбросить камеру"><RotateCcw size={16} /></button>
    </div>
  </div>;
}
