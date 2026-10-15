"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Camera, Check, ChevronDown, CircleHelp, Film, Image as ImageIcon, ImagePlus, Layers2, Link2, Pause, Play, Redo2, RotateCcw, Save, SlidersHorizontal, Sun, Undo2, Upload, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Button } from "./ui/button";
import { PagePicker } from "./page-picker";
import { TabsSubtle, TabsSubtleItem } from "./ui/tabs-subtle";
import { FluidChoice } from "./fluid-choice";
import { ThemeToggle } from "./theme-toggle";
import { Control, Segmented } from "./control";
import { Viewport, type ModelState, type NavigationCommand } from "./viewport";
import { DEFAULT_CAMERA, DEFAULT_SETTINGS, FOLD_OPEN, FOLD_OUTER_BELOW, LID_MAX, PRESETS, clamp, exportSize, videoEnd, videoLength, type Aspect, type CameraSettings, type Device, type ScreenFit, type ScreenKind, type Settings } from "@/lib/settings";
import { BACKGROUNDS, backgroundCss, backgroundPreset } from "@/lib/backgrounds";
import { DEVICES, activeScreen, deviceFinish, deviceModel } from "@/lib/models";
import { EMPTY_ASSET, INITIAL_DOCUMENT, INITIAL_HISTORY, historyReducer, type DocumentState } from "@/lib/history";
import { parseProject, projectDocument, serializeProject } from "@/lib/project";
import { captureLink, isFigmaClipboard, isFigmaLink, normalizeLink, previewLink, type PagePreview } from "@/lib/capture";
import { spring } from "@/lib/springs";
import { canExportVideo, type StudioScene } from "@/lib/scene";

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
function timecode(seconds: number): string {
  const whole = Math.max(0, seconds);
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
    <input value={draft.toUpperCase()} aria-label={`${label}, HEX`} maxLength={7} spellCheck={false} onChange={(event) => { setDraft(event.target.value); if (/^#[\da-f]{6}$/i.test(event.target.value)) onChange(event.target.value); }} onBlur={() => setDraft(value)} /><span className="color-label">{label}</span></div>;
}

export function Studio() {
  const [history, dispatch] = useReducer(historyReducer, INITIAL_HISTORY);
  const { settings, image, backdrop } = history.present;
  const sceneRef = useRef<StudioScene | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const uploadRequest = useRef(0);
  const objectURLs = useRef(new Set<string>());
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tab, setTab] = useState<"camera" | "screen" | "scene">("camera");
  const [modelState, setModelState] = useState<ModelState>({ status: "loading" });
  /** Активная область экрана, измеренная по модели. */
  const [screenSize, setScreenSize] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [format, setFormat] = useState<"png" | "webm">("png");
  const [fps, setFps] = useState(30);
  const [progress, setProgress] = useState(0);
  const [videoExportReady, setVideoExportReady] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [capturing, setCapturing] = useState<"site" | "figma" | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  /** Предпросмотр страницы, пока пользователь выбирает, какой экран снять. */
  const [pagePick, setPagePick] = useState<PagePreview & { link: string; width: number; height: number; desktop: boolean } | null>(null);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [navigation, setNavigation] = useState<NavigationCommand | null>(null);
  const title = "Мокап";
  const [activePreset, setActivePreset] = useState("front");
  const size = exportSize(settings.aspect, settings.resolution);
  const movieReady = image.kind === "video" && image.duration > 0 && videoExportReady;
  const model = deviceModel(settings.device);
  const distanceUnit = model.unit;
  const presets = PRESETS.filter((preset) => !preset.handheld || model.kind === "phone" || model.kind === "foldable" || model.kind === "tablet");
  const hasCutout = activeScreen(settings.device, settings.fold).cutout.length > 0;
  /** Размер скриншота для экрана: родное разрешение устройства, у вымышленного Duo — измеренный по модели. */
  const nativePixels = activeScreen(settings.device, settings.fold).pixels;
  const shotSize = nativePixels ? { width: nativePixels[0], height: nativePixels[1] } : screenSize;
  const mismatch = !image.demo && shotSize !== null && Math.abs(Math.log(image.width / image.height / (shotSize.width / shotSize.height))) > 0.01;

  const showToast = useCallback((text: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, error });
    toastTimer.current = setTimeout(() => setToast(null), error ? 6000 : 3500);
  }, []);
  const showError = useCallback((text: string) => showToast(text, true), [showToast]);
  const onVideo = useCallback((value: boolean) => setPlaying(value), []);
  const toggleVideo = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene?.hasVideo) return;
    if (scene.videoPlaying) scene.pauseVideo(); else void scene.playVideo();
  }, []);
  // MediaRecorder и captureStream есть не везде, а на сервере их нет вовсе.
  useEffect(() => { setVideoExportReady(canExportVideo()); }, []);
  const mutate = useCallback((recipe: (current: DocumentState) => DocumentState, group?: string) => dispatch({ type: "change", recipe, group, time: Date.now() }), []);
  const change = useCallback(<K extends keyof Settings,>(key: K, value: Settings[K], group?: string) => mutate((current) => ({ ...current, settings: { ...current.settings, [key]: value } }), group), [mutate]);
  const camera = useCallback((patch: Partial<CameraSettings>, group?: string) => {
    setActivePreset("");
    mutate((current) => ({ ...current, settings: { ...current.settings, camera: { ...current.settings.camera, ...patch } } }), group);
  }, [mutate]);
  const onCamera = useCallback((value: CameraSettings) => camera(value, "orbit"), [camera]);
  const resetCamera = useCallback(() => { change("camera", { ...DEFAULT_CAMERA }); setActivePreset("front"); }, [change]);
  const navigate = useCallback((type: NavigationCommand["type"]) => setNavigation({ type, id: Date.now() + Math.random() }), []);

  useEffect(() => () => { objectURLs.current.forEach((url) => URL.revokeObjectURL(url)); if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
  useEffect(() => { if (image.kind !== "video") { setFormat("png"); setPlaying(false); } }, [image.kind]);

  const openFile = useCallback(async (file: File, options?: { name?: string; toast?: (width: number, height: number) => string }) => {
    const request = ++uploadRequest.current;
    setCapturing(null);
    if (file.size > 32 * 1024 * 1024) { showError("Файл больше 32 МБ. Выберите файл меньшего размера."); return; }
    setLoadingImage(true);
    let url: string | null = null;
    let decodedSize: { width: number; height: number } | null = null;
    try {
      let project: ReturnType<typeof parseProject> | null = null;
      if (file.name.toLowerCase().endsWith(".json")) project = parseProject(await file.text());
      else if (![...IMAGE_TYPES, ...VIDEO_TYPES].includes(file.type)) throw new Error("Выберите PNG, JPG, WebP, MP4, WebM или проект .forma.json.");
      if (project && project.imageData === null) {
        if (request === uploadRequest.current) mutate(() => projectDocument(project.settings, null, projectBackdrop(project)));
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
        mutate((current) => project ? projectDocument(project.settings, nextImage, projectBackdrop(project)) : {
          ...current, image: nextImage,
          settings: {
            ...current.settings,
            screen: { ...current.settings.screen, fit: fitForImage(size.width, size.height, activeScreen(current.settings.device, current.settings.fold).aspect), scale: 100, x: 0, y: 0 },
            // Новый файл — новая обрезка: прежние секунды к нему не относятся.
            video: { ...current.settings.video, start: 0, end: 0 },
          },
        });
      }
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

  const exportPNG = useCallback(async () => {
    if (!sceneRef.current || busy || modelState.status !== "ready" || loadingImage) return;
    setBusy(true);
    try {
      const blob = await sceneRef.current.exportPNG(size.width, size.height);
      const filename = title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "mockup";
      download(blob, `${filename}-${size.width}x${size.height}.png`);
      showToast(`PNG сохранён · ${size.width} × ${size.height}`);
    } catch (error) { showError(error instanceof Error ? error.message : "Не удалось сохранить PNG. Попробуйте меньшее разрешение."); }
    finally { setBusy(false); }
  }, [busy, modelState.status, loadingImage, size.width, size.height, title, showToast, showError]);

  const exportMovie = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene || busy || modelState.status !== "ready" || loadingImage || !scene.hasVideo) return;
    setBusy(true); setProgress(0);
    try {
      const blob = await scene.exportVideo(size.width, size.height, fps, setProgress);
      const filename = title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "mockup";
      download(blob, `${filename}-${size.width}x${size.height}.webm`);
      showToast(`Ролик сохранён · ${size.width} × ${size.height}`);
    } catch (error) { showError(error instanceof Error ? error.message : "Не удалось записать ролик. Попробуйте меньшее разрешение."); }
    finally { setBusy(false); setProgress(0); }
  }, [busy, modelState.status, loadingImage, size.width, size.height, fps, title, showToast, showError]);

  const saveProject = useCallback(async () => {
    try {
      const text = await serializeProject(history.present);
      download(new Blob([text], { type: "application/json" }), `${title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-") || "mockup"}.forma.json`);
      showToast("Проект сохранён вместе с изображением");
    } catch { showError("Не удалось сохранить проект. Попробуйте ещё раз."); }
  }, [history.present, title, showToast, showError]);

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
      if (modifier && event.shiftKey && key === "KeyE") { event.preventDefault(); void exportPNG(); return; }
      if (!busy && !textEditing && modifier && (key === "KeyZ" || key === "KeyY")) {
        event.preventDefault(); dispatch({ type: key === "KeyY" || event.shiftKey ? "redo" : "undo" }); setActivePreset(""); return;
      }
      if (input || busy) return;
      if (modifier && key === "KeyZ") { event.preventDefault(); dispatch({ type: event.shiftKey ? "redo" : "undo" }); setActivePreset(""); }
      else if (modifier && key === "KeyY") { event.preventDefault(); dispatch({ type: "redo" }); setActivePreset(""); }
      else if (key === "Equal" || key === "NumpadAdd") { event.preventDefault(); navigate("zoom-in"); }
      else if (key === "Minus" || key === "NumpadSubtract") { event.preventDefault(); navigate("zoom-out"); }
      else if (key === "Digit1" && event.shiftKey || key === "Digit2" && event.shiftKey || key === "KeyF" && !modifier) { event.preventDefault(); navigate("fit"); }
      else if (key === "Digit0") { event.preventDefault(); navigate("actual"); }
      else if (key === "KeyH" && !modifier) navigate("hand");
      else if (key === "KeyV" && !modifier || key === "Escape") navigate("orbit");
      else if (key === "Slash" && event.shiftKey) { event.preventDefault(); helpRef.current?.showModal(); }
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 2;
        camera(key === "ArrowLeft" ? { azimuth: clamp(settings.camera.azimuth - step, -180, 180) } : key === "ArrowRight" ? { azimuth: clamp(settings.camera.azimuth + step, -180, 180) } : key === "ArrowUp" ? { elevation: clamp(settings.camera.elevation + step, -89, 89) } : { elevation: clamp(settings.camera.elevation - step, -89, 89) }, "arrow-camera");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [busy, camera, exportPNG, navigate, saveProject, settings.camera]);

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
  const shadow = (patch: Partial<Settings["shadow"]>, group?: string) => change("shadow", { ...settings.shadow, ...patch }, group);
  const background = (patch: Partial<Settings["background"]>, group?: string) => change("background", { ...settings.background, ...patch }, group);
  const video = (patch: Partial<Settings["video"]>, group?: string) => change("video", { ...settings.video, ...patch }, group);

  return <MotionConfig reducedMotion="user"><main className="studio-shell">
    <div className="editor-layout">
      <section className="stage-column" aria-label="Сцена">
        <Viewport settings={settings} image={image} backdrop={backdrop} sceneRef={sceneRef} onCamera={onCamera} onModel={setModelState} onScreen={setScreenSize} onError={showError} onVideo={onVideo} modelState={modelState} navigation={navigation} onResetCamera={resetCamera} onDropFile={(file) => void openFile(file)} busy={busy}
          topLeft={<FluidChoice label="Ракурс" value={activePreset} placeholder="Свой ракурс" icon={Camera} className="preset-choice" disabled={busy} items={presets.map((preset) => ({ id: preset.id, label: preset.name }))} onChange={(id) => { const preset = presets.find((item) => item.id === id); if (preset) { change("camera", { ...preset.camera }); setActivePreset(id); } }} />}
          topRight={<div className="header-actions"><Button variant="ghost" size="icon-compact" aria-label="Отменить (Ctrl+Z)" title="Отменить · Ctrl+Z" disabled={!history.past.length || busy} onClick={() => { dispatch({ type: "undo" }); setActivePreset(""); }}><Undo2 /></Button><Button variant="ghost" size="icon-compact" aria-label="Повторить (Ctrl+Shift+Z)" title="Повторить · Ctrl+Shift+Z" disabled={!history.future.length || busy} onClick={() => dispatch({ type: "redo" })}><Redo2 /></Button><span className="toolbar-divider" /><Button variant="ghost" size="icon-compact" aria-label="Сохранить проект (Ctrl+S)" title="Сохранить проект · Ctrl+S" onClick={() => void saveProject()}><Save /></Button><ThemeToggle /><Button variant="ghost" size="icon-compact" aria-label="Горячие клавиши" title="Горячие клавиши · ?" onClick={() => helpRef.current?.showModal()}><CircleHelp /></Button></div>} />
      </section>

      <aside className="inspector" aria-label="Настройки мокапа">
        <fieldset className="inspector-fields" disabled={busy}>
          <div className="asset-settings">
            <div className="property-row"><span>Модель</span><FluidChoice label="Модель устройства" value={settings.device} items={DEVICES.map((item) => ({ id: item.id, label: item.name, group: item.group }))} className="device-choice" onChange={(id) => { const selected = DEVICES.find((item) => item.id === id); if (selected) mutate((current) => withScreen(current, selected.id, current.settings.fold)); }} /></div>
            <div className="property-row"><span>Цвет</span><FluidChoice label="Цвет корпуса" value={settings.finish} items={model.finishes.map((item) => ({ id: item.id, label: item.name, color: item.color }))} className="finish-trigger" onChange={(id) => { const selected = model.finishes.find((item) => item.id === id); if (selected) change("finish", selected.id); }} /></div>
            {model.fold && <div className="hinge-control"><Control label="Раскрытие телефона" value={settings.fold} min={0} max={FOLD_OPEN} unit="°" onChange={(fold) => mutate((current) => withScreen(current, current.settings.device, fold), "fold")} /><p>{settings.fold < FOLD_OUTER_BELOW ? "Изображение на внешнем экране" : `На внутреннем экране · ниже ${FOLD_OUTER_BELOW}° — на внешнем`}</p></div>}
            {model.lid && <div className="hinge-control"><Control label="Раскрытие крышки" value={settings.lid} min={0} max={LID_MAX} unit="°" onChange={(lid) => change("lid", lid, "lid")} /></div>}
            <div className="section-heading screen-heading"><h2>Экран</h2><span className="screen-heading-meta">{shotSize && <span className="screen-size" title="Скриншот такого размера или тех же пропорций ляжет на экран без обрезки и полей">{shotSize.width} × {shotSize.height} px</span>}{!image.demo && <button className="quiet-icon" aria-label="Убрать изображение" title="Вернуть демо-экран" onClick={() => mutate((current) => ({ ...current, image: INITIAL_DOCUMENT.image }))}><X size={13} /></button>}</span></div>
            <button className={`upload-card${image.demo ? " demo-upload" : ""}`} disabled={loadingImage} onClick={() => fileRef.current?.click()} aria-label="Загрузить изображение или видео на экран" title="Загрузить изображение, видео или открыть проект · Ctrl+O">
              {image.demo ? <span className="upload-icon"><ImagePlus size={20} /></span> : image.kind === "video" ? <span className="upload-icon"><Film size={20} /></span> : <span className="upload-thumb"><img src={image.url} alt="Загруженное изображение" /></span>}
              <span className="upload-copy"><strong>{capturing === "site" ? "Снимаем сайт…" : capturing === "figma" ? "Загружаем фрейм из Figma…" : loadingImage ? "Загружаем…" : image.demo ? "Загрузить изображение" : image.name}</strong><span>{capturing ? "Обычно несколько секунд" : image.demo ? "PNG, JPG, WebP, MP4 или вставьте · Ctrl+V" : `${image.width} × ${image.height}${image.kind === "video" ? ` · ${timecode(image.duration)}` : ""}${mismatch ? settings.screen.fit === "cover" ? " · края обрежутся" : " · останутся поля" : ""}`}</span></span><Upload size={14} />
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,.json" className="sr-only" tabIndex={-1} aria-label="Файл изображения, видео или проекта" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void openFile(file); }} />
            <form className="link-field" onSubmit={(event) => { event.preventDefault(); void openLink(linkDraft); }}>
              <Link2 size={14} aria-hidden="true" />
              <input type="text" inputMode="url" value={linkDraft} onChange={(event) => setLinkDraft(event.target.value)} placeholder="Ссылка на сайт или фрейм Figma" aria-label="Ссылка на сайт или фрейм Figma" title="Снимок встанет в разрешении экрана телефона" spellCheck={false} autoComplete="off" disabled={loadingImage} />
              <button type="submit" className="quiet-icon" aria-label="Вставить по ссылке" title="Вставить по ссылке · Enter" disabled={!linkDraft.trim() || loadingImage}>{capturing ? <span className="spinner" /> : <ArrowRight size={13} />}</button>
            </form>
          </div>

          <TabsSubtle className="inspector-tabs" size="compact" selectedIndex={["camera", "screen", "scene"].indexOf(tab)} onSelect={(index) => setTab((["camera", "screen", "scene"] as const)[index])} idPrefix="inspector" aria-label="Разделы настроек"><TabsSubtleItem index={0} icon={Camera} label="Камера" /><TabsSubtleItem index={1} icon={SlidersHorizontal} label="Экран" /><TabsSubtleItem index={2} icon={Sun} label="Сцена" /></TabsSubtle>
          <div className="inspector-scroll" role="tabpanel" id={`inspector-panel-${["camera", "screen", "scene"].indexOf(tab)}`} aria-labelledby={`inspector-tab-${["camera", "screen", "scene"].indexOf(tab)}`}>
            <div key={tab} className="inspector-panel">
            {tab === "camera" && <>
              <section className="control-section"><div className="section-heading"><h3>Проекция</h3><button className="quiet-icon" title="Сбросить камеру" aria-label="Сбросить настройки камеры" onClick={resetCamera}><RotateCcw size={13} /></button></div><Segmented label="Проекция камеры" value={settings.camera.projection} items={[{ id: "perspective", label: "Перспектива" }, { id: "orthographic", label: "Ортография" }]} onChange={(projection) => camera({ projection })} />
                <Control label="Фокусное расстояние" value={settings.camera.focalLength} min={18} max={120} unit="мм" disabled={settings.camera.projection === "orthographic"} onChange={(focalLength) => camera({ focalLength }, "focalLength")} />
                <Control label="Расстояние" value={settings.camera.distance * distanceUnit} min={1.15 * distanceUnit} max={15 * distanceUnit} step={0.1} unit="см" disabled={settings.camera.projection === "orthographic"} onChange={(distance) => camera({ distance: distance / distanceUnit }, "distance")} />
                <Control label="Масштаб в кадре" value={settings.camera.zoom} min={25} max={400} unit="%" onChange={(zoom) => camera({ zoom }, "cameraZoom")} />
              </section>
              <section className="control-section"><div className="section-heading"><h3>Ракурс</h3></div><Control label="Поворот" value={settings.camera.azimuth} min={-180} max={180} unit="°" onChange={(azimuth) => camera({ azimuth }, "azimuth")} /><Control label="Наклон" value={settings.camera.elevation} min={-89} max={89} unit="°" onChange={(elevation) => camera({ elevation }, "elevation")} /><Control label="Крен" value={settings.camera.roll} min={-180} max={180} unit="°" onChange={(roll) => camera({ roll }, "roll")} /></section>
              <section className="control-section"><div className="section-heading"><h3>Положение в кадре</h3></div><Control label="По горизонтали" value={settings.camera.offsetX} min={-100} max={100} unit="%" onChange={(offsetX) => camera({ offsetX }, "cameraX")} /><Control label="По вертикали" value={settings.camera.offsetY} min={-100} max={100} unit="%" onChange={(offsetY) => camera({ offsetY }, "cameraY")} /></section>
            </>}
            {tab === "screen" && <><section className="control-section"><div className="section-heading"><h3>Размещение изображения</h3></div><Segmented label="Размещение изображения" value={settings.screen.fit} items={[{ id: "cover", label: "Заполнить" }, { id: "contain", label: "Вписать" }]} onChange={(fit) => screen({ fit })} /><Control label="Масштаб изображения" value={settings.screen.scale} min={25} max={300} unit="%" onChange={(scale) => screen({ scale }, "screenScale")} /><Control label="Сдвиг по горизонтали" value={settings.screen.x} min={-100} max={100} unit="%" onChange={(x) => screen({ x }, "screenX")} /><Control label="Сдвиг по вертикали" value={settings.screen.y} min={-100} max={100} unit="%" onChange={(y) => screen({ y }, "screenY")} /></section><section className="control-section"><div className="section-heading"><h3>Детали экрана</h3></div>{hasCutout && <label className="switch-row"><span><strong>Вырез камеры</strong><span>Выключите, если он уже на скриншоте</span></span><input type="checkbox" checked={settings.screen.island} onChange={(event) => screen({ island: event.target.checked })} /><i aria-hidden="true" /></label>}<Control label="Отражения на стекле" value={settings.screen.reflection} min={0} max={50} unit="%" onChange={(reflection) => screen({ reflection }, "reflection")} /></section>{image.kind === "video" && <section className="control-section"><div className="section-heading"><h3>Видео</h3><span className="format-badge">{timecode(videoLength(settings.video, image.duration))}</span></div>
              <div className="video-transport">
                <button type="button" className="icon-button" onClick={toggleVideo} aria-label={playing ? "Пауза" : "Воспроизвести"} title={playing ? "Пауза" : "Воспроизвести"}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
                <span className="video-range">{timecode(settings.video.start)} — {timecode(videoEnd(settings.video.end, image.duration))}</span>
              </div>
              <label className="switch-row"><span><strong>Зациклить</strong><span>Отрезок повторяется без паузы</span></span><input type="checkbox" checked={settings.video.loop} onChange={(event) => video({ loop: event.target.checked })} /><i aria-hidden="true" /></label>
              <label className="switch-row"><span><strong>Звук</strong><span>В ролик экспорта звук не попадает</span></span><input type="checkbox" checked={!settings.video.muted} onChange={(event) => video({ muted: !event.target.checked })} /><i aria-hidden="true" /></label>
              <Control label="Начало" value={settings.video.start} min={0} max={Math.max(0.1, image.duration - 0.1)} step={0.1} unit="с" onChange={(start) => video({ start: Math.min(start, videoEnd(settings.video.end, image.duration) - 0.1) }, "videoStart")} />
              <Control label="Конец" value={videoEnd(settings.video.end, image.duration)} min={0.1} max={image.duration} step={0.1} unit="с" onChange={(end) => video({ end: Math.max(end, settings.video.start + 0.1) }, "videoEnd")} />
              <Control label="Скорость" value={settings.video.speed} min={25} max={400} unit="%" onChange={(speed) => video({ speed }, "videoSpeed")} />
            </section>}<button className="text-button" onClick={() => change("screen", { ...DEFAULT_SETTINGS.screen })}><RotateCcw size={13} /> Сбросить настройки экрана</button></>}
            {tab === "scene" && <><section className="control-section"><div className="section-heading"><h3>Фон</h3></div><Segmented label="Тип фона" value={settings.background.mode} items={[{ id: "solid", label: "Цвет" }, { id: "gradient", label: "Градиент" }, { id: "preset", label: "Готовые" }, { id: "transparent", label: "Без фона" }]} onChange={(mode) => background({ mode })} />
              {settings.background.mode === "preset" ? <><div className="background-gallery" role="group" aria-label="Готовые фоны">{BACKGROUNDS.map((preset) => <button key={preset.id} type="button" style={{ background: backgroundCss(preset) }} aria-label={`${preset.group} · ${preset.name}`} title={`${preset.group} · ${preset.name}`} aria-pressed={settings.background.preset === preset.id} onClick={() => background({ preset: preset.id })}>{settings.background.preset === preset.id && <Check size={14} />}</button>)}</div>
                <p className="light-description">{backgroundPreset(settings.background.preset).group} · {backgroundPreset(settings.background.preset).name}</p>
                <label className="switch-row"><span><strong>Движение</strong><span>Пятна медленно ходят по кругу</span></span><input type="checkbox" checked={settings.background.animated} onChange={(event) => background({ animated: event.target.checked })} /><i aria-hidden="true" /></label>
                {settings.background.animated && <Control label="Скорость движения" value={settings.background.speed} min={10} max={300} unit="%" onChange={(speed) => background({ speed }, "backgroundSpeed")} />}</>
              : settings.background.mode === "custom" ? null
              : settings.background.mode === "transparent" ? <div className="transparency-note"><span className="checkerboard" /><span>Прозрачный фон</span></div> : <><div className="background-swatches">{["#ffffff", "#f4f4f4", "#e5e5e5", "#a3a3a3", "#737373", "#262626"].map((color) => <button key={color} style={{ background: color }} aria-label={`Фон ${color}`} aria-pressed={settings.background.color === color} onClick={() => background({ color })}>{settings.background.color === color && <Check size={13} style={{ color: color === "#262626" ? "white" : "#292929" }} />}</button>)}</div><ColorField label="Основной цвет" value={settings.background.color} onChange={(color) => background({ color }, "backgroundColor")} />{settings.background.mode === "gradient" && <><ColorField label="Второй цвет" value={settings.background.secondary} onChange={(secondary) => background({ secondary }, "backgroundSecondary")} /><Control label="Направление градиента" value={settings.background.angle} min={0} max={360} unit="°" onChange={(angle) => background({ angle }, "gradientAngle")} /></>}</>}
              {/* Своё фото или видео лежит отдельным блоком и видно при любом
                  типе фона: загрузка сама переключает режим на «Свой», так что
                  искать его в переключателе не нужно. */}
              <div className="backdrop-slot">
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
              </section><section className="control-section"><div className="section-heading"><h3>Свет</h3></div><Segmented label="Схема освещения" value={settings.light.preset} items={[{ id: "soft", label: "Мягкий" }, { id: "studio", label: "Студийный" }, { id: "rim", label: "Контровой" }]} onChange={(preset) => light({ preset })} /><p className="light-description">{settings.light.preset === "soft" ? "Большие софтбоксы сверху и спереди, ровный свет." : settings.light.preset === "studio" ? "Софтбокс сбоку подчёркивает грани и материал." : "Полосы света сзади рисуют контур на тёмном фоне."}</p><Control label="Яркость" value={settings.light.intensity} min={0} max={200} unit="%" onChange={(intensity) => light({ intensity }, "lightIntensity")} /><details className="light-advanced"><summary>Дополнительно</summary><Control label="Направление света" value={settings.light.rotation} min={-180} max={180} unit="°" onChange={(rotation) => light({ rotation }, "lightRotation")} /><Control label="Экспозиция" value={settings.light.exposure} min={25} max={200} unit="%" onChange={(exposure) => light({ exposure }, "exposure")} /></details></section>
              <section className="control-section"><div className="section-heading"><h3>Тень</h3></div><label className="switch-row"><span><strong>Тень на фоне</strong><span>Мягкая тень позади устройства</span></span><input type="checkbox" checked={settings.shadow.enabled} onChange={(event) => shadow({ enabled: event.target.checked })} /><i aria-hidden="true" /></label>
                {settings.shadow.enabled && <><Control label="Плотность тени" value={settings.shadow.opacity} min={0} max={100} unit="%" onChange={(opacity) => shadow({ opacity }, "shadowOpacity")} /><Control label="Мягкость тени" value={settings.shadow.softness} min={0} max={100} unit="%" onChange={(softness) => shadow({ softness }, "shadowSoftness")} /><Control label="Расстояние до фона" value={settings.shadow.distance} min={0} max={100} unit="%" onChange={(distance) => shadow({ distance }, "shadowDistance")} /></>}
              </section></>}
            </div>
          </div>
        </fieldset>
        <div className="export-panel"><div className="section-heading"><h2>Экспорт</h2><span className="format-badge">{format === "webm" ? "WebM" : "PNG"}</span></div>{movieReady && <Segmented className="segmented export-format" label="Что сохранять" value={format} disabled={busy} items={[{ id: "png" as const, label: "Кадр" }, { id: "webm" as const, label: "Ролик" }]} onChange={setFormat} />}<Segmented className="aspect-options" label="Формат кадра" value={settings.aspect} disabled={busy} items={(["16:9", "4:3", "1:1", "4:5", "9:16"] as Aspect[]).map((aspect) => ({ id: aspect, label: aspect }))} onChange={(aspect) => change("aspect", aspect)} /><div className="resolution-row"><label htmlFor="resolution">Разрешение</label><div className="select-wrap"><select id="resolution" value={settings.resolution} disabled={busy} onChange={(event) => change("resolution", Number(event.target.value))}><option value={1200}>1200 px</option><option value={1920}>1920 px</option><option value={2400}>2400 px</option><option value={3840}>4K · 3840 px</option></select><ChevronDown size={12} /></div></div>{format === "webm" && <div className="resolution-row"><label htmlFor="fps">Кадров в секунду</label><div className="select-wrap"><select id="fps" value={fps} disabled={busy} onChange={(event) => setFps(Number(event.target.value))}><option value={24}>24</option><option value={30}>30</option><option value={60}>60</option></select><ChevronDown size={12} /></div></div>}<button className="export-button" disabled={busy || loadingImage || modelState.status !== "ready"} onClick={() => void (format === "webm" ? exportMovie() : exportPNG())}>{busy ? <span className="spinner" /> : format === "webm" ? <Film size={16} /> : <ArrowDownToLine size={16} />}<span>{busy ? (format === "webm" ? `Пишем ролик… ${Math.round(progress * 100)} %` : "Сохраняем PNG…") : format === "webm" ? "Скачать ролик" : "Скачать мокап"}</span><span className="export-shortcut">↗</span></button><div className="export-caption"><span>{size.width} × {size.height}{format === "webm" ? ` · WebM · ${timecode(videoLength(settings.video, image.duration))}` : settings.background.mode === "transparent" ? " · Прозрачный фон" : " · PNG"}</span><span title="Экспорт · Ctrl+Shift+E">Ctrl ⇧ E</span></div></div>
      </aside>
    </div>

    <AnimatePresence mode="wait">
      {toast && <motion.div key={toast.text} className={`toast${toast.error ? " error" : ""}`} role={toast.error ? "alert" : "status"}
        initial={{ opacity: 0, y: 10, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.98, transition: spring.moderate.exit }} transition={spring.moderate}>
        <span className="toast-icon">{toast.error ? <CircleHelp size={16} /> : <Check size={16} />}</span><span>{toast.text}</span><button aria-label="Закрыть уведомление" onClick={() => setToast(null)}><X size={13} /></button></motion.div>}
    </AnimatePresence>
    {pagePick && <PagePicker key={pagePick.url} preview={pagePick} onCancel={() => closePagePick()} onConfirm={(scrollY) => closePagePick(scrollY)} />}
    <dialog ref={helpRef} className="help-dialog"><div className="dialog-heading"><span className="dialog-icon"><Layers2 size={22} /></span><button className="icon-button" aria-label="Закрыть справку" onClick={() => helpRef.current?.close()}><X size={18} /></button></div><h2>Привычные движения.</h2><p>Всё нужное — под рукой.</p><dl className="shortcut-list">{[["Вращать модель", "Перетаскивание / стрелки"], ["Перемещать рабочую область", "Space + drag / средняя кнопка"], ["Масштаб под курсором", "Ctrl + колёсико"], ["Рука / вращение", "H / V"], ["Уместить холст", "Shift + 1 / F"], ["Масштаб 100%", "0"], ["Отменить / повторить", "Ctrl + Z / Ctrl + Shift + Z"], ["Открыть экран или проект", "Ctrl + O"], ["Вставить картинку или ссылку", "Ctrl + V"], ["Сохранить проект", "Ctrl + S"], ["Экспорт PNG", "Ctrl + Shift + E"]].map(([name, shortcut]) => <div key={name}><dt>{name}</dt><dd>{shortcut}</dd></div>)}</dl><p className="help-note">Масштаб рабочей области не влияет на экспорт. На Mac используйте ⌘ вместо Ctrl. Все файлы обрабатываются на вашем компьютере.</p><details className="model-credits"><summary>Авторы 3D-моделей</summary><p>iPhone 15 Pro и 15 Pro Max, Pro Display XDR, Apple Watch Ultra 2 и Series 9 — polyman, CC BY 4.0. iPhone 18 Pro, 18 Pro Max и iPhone Duo — extraakash, Sketchfab Standard. iPhone 17 Pro и 17 Pro Max, iPad Pro 13″ и MacBook Pro 14″ — Apple User, Sketchfab Standard. MacBook Air 13″ и iMac 24″ — valentinomyhero, CC BY 4.0. Galaxy S26 Ultra — gadirovsaid7, CC BY 4.0. Модели взяты с Sketchfab; названия соответствуют метаданным файлов.</p></details><button className="small-button reset-project" onClick={() => { mutate(() => structuredClone(INITIAL_DOCUMENT)); setActivePreset("front"); helpRef.current?.close(); showToast("Сцена сброшена. Изменение можно отменить."); }}><RotateCcw size={14} /> Сбросить всю сцену</button></dialog>
  </main></MotionConfig>;
}
