"use client";

import { forwardRef } from "react";
import { ChevronDown, Film, X } from "lucide-react";
import { Segmented } from "./control";
import { seconds } from "./timeline";
import type { ExportFormat } from "@/lib/scene";
import type { Aspect } from "@/lib/settings";
import { plural } from "@/lib/plural";

export interface ExportOptions { format: ExportFormat; transparent: boolean; fps: number }

interface ExportDialogProps {
  options: ExportOptions;
  onOptions: (options: ExportOptions) => void;
  aspect: Aspect; resolution: number; size: { width: number; height: number };
  onAspect: (aspect: Aspect) => void; onResolution: (resolution: number) => void;
  duration: number; blur: { enabled: boolean; amount: number };
  audio: boolean;
  supported: Record<"webm" | "mp4", boolean>;
  /** Доля готового ролика во время экспорта; null — экспорт не идёт. */
  progress: number | null;
  onExport: () => void; onCancel: () => void; onClose: () => void;
}

const FORMAT_NOTES: Record<ExportFormat, string> = {
  webm: "Для сайтов и презентаций в Chrome, Edge и Firefox. Сохраняет прозрачность.",
  mp4: "Открывается почти везде. Прозрачность не сохраняется.",
  png: "Кадры PNG в ZIP-архиве для монтажных программ. Сохраняют прозрачность.",
};

/** Окно «Экспорт анимации»: параметры ролика выбираются здесь, запись начинается только по кнопке. */
export const ExportDialog = forwardRef<HTMLDialogElement, ExportDialogProps>(function ExportDialog({ options, onOptions, aspect, resolution, size, onAspect, onResolution, duration, blur, audio, supported, progress, onExport, onCancel, onClose }, ref) {
  const busy = progress !== null;
  const frames = Math.max(1, Math.round(duration * options.fps));
  const transparencyAllowed = options.format !== "mp4";
  const formatAvailable = options.format === "png" || supported[options.format];
  const set = (patch: Partial<ExportOptions>) => onOptions({ ...options, ...patch });
  return <dialog ref={ref} className="export-dialog" aria-labelledby="export-dialog-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}>
    <div className="dialog-heading"><h2 id="export-dialog-title">Экспорт анимации</h2><button className="icon-button" aria-label="Закрыть" disabled={busy} onClick={onClose}><X size={18} /></button></div>
    <fieldset disabled={busy} className="export-fields">
      <div className="export-field">
        <span className="export-field-label">Формат</span>
        <Segmented label="Формат ролика" value={options.format} items={[{ id: "webm", label: "WebM" }, { id: "mp4", label: "MP4" }, { id: "png", label: "Кадры PNG" }]}
          onChange={(format) => set({ format, transparent: format === "mp4" ? false : options.transparent })} />
        <p className="export-note">{formatAvailable ? FORMAT_NOTES[options.format] : "Этот браузер не умеет записывать такой формат. Выберите другой."}</p>
      </div>
      <label className={`switch-row${transparencyAllowed ? "" : " is-disabled"}`}><span><strong>Прозрачный фон</strong><span>{transparencyAllowed ? "Фон сцены не попадёт в ролик, тень останется" : "Доступно для WebM и кадров PNG"}</span></span><input type="checkbox" checked={options.transparent && transparencyAllowed} disabled={!transparencyAllowed} onChange={(event) => set({ transparent: event.target.checked })} /><i aria-hidden="true" /></label>
      <div className="export-field">
        <span className="export-field-label">Формат кадра</span>
        <Segmented className="aspect-options" label="Формат кадра ролика" value={aspect} items={(["16:9", "4:3", "1:1", "4:5", "9:16"] as Aspect[]).map((item) => ({ id: item, label: item }))} onChange={onAspect} />
      </div>
      <div className="resolution-row"><label htmlFor="export-resolution">Разрешение ролика</label><div className="select-wrap"><select id="export-resolution" value={resolution} onChange={(event) => onResolution(Number(event.target.value))}><option value={1200}>1200 px</option><option value={1920}>1920 px</option><option value={2400}>2400 px</option><option value={3840}>4K · 3840 px</option></select><ChevronDown size={12} /></div></div>
      <div className="resolution-row"><label htmlFor="export-fps">Кадров в секунду</label><div className="select-wrap"><select id="export-fps" value={options.fps} onChange={(event) => set({ fps: Number(event.target.value) })}><option value={24}>24</option><option value={30}>30</option><option value={60}>60</option></select><ChevronDown size={12} /></div></div>
      <dl className="export-summary">
        <div><dt>Размер</dt><dd>{size.width} × {size.height}</dd></div>
        <div><dt>Длительность</dt><dd>{seconds(duration)} · {frames} {plural(frames, ["кадр", "кадра", "кадров"])}</dd></div>
        <div><dt>Размытие движения</dt><dd>{blur.enabled ? `${Math.round(blur.amount)} %` : "Выключено"}</dd></div>
        <div><dt>Аудио</dt><dd>{audio ? options.format === "png" ? "PNG сохраняются без звука" : "Включено" : "Без звука"}</dd></div>
      </dl>
      {options.format !== "png" && <p className="export-note">Ролик пишется в реальном времени: не переключайтесь на другую вкладку, пока идёт запись.</p>}
    </fieldset>
    {busy && <div className="export-progress" role="progressbar" aria-label="Экспорт" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><span style={{ transform: `scaleX(${progress})` }} /></div>}
    <div className="dialog-actions">
      {busy ? <button type="button" className="small-button" onClick={onCancel}>Остановить</button> : <button type="button" className="small-button" onClick={onClose}>Отмена</button>}
      <button type="button" className="small-button primary" disabled={busy || !formatAvailable} onClick={onExport} autoFocus>{busy ? <><span className="spinner" /> {Math.round(progress * 100)} %</> : <><Film size={14} /> Экспортировать</>}</button>
    </div>
  </dialog>;
});
