export type Projection = "perspective" | "orthographic";
export type BackgroundMode = "solid" | "gradient" | "preset" | "custom" | "transparent";
export type Lighting = "soft" | "studio" | "rim";
export type ScreenFit = "cover" | "contain";
export type Aspect = "16:9" | "4:3" | "1:1" | "4:5" | "9:16";
export type Device = "iphone15Pro" | "iphone15" | "iphone17Pro" | "iphone17" | "iphone18Pro" | "iphone18" | "iphoneDuo" | "galaxyS26Ultra" | "ipadPro13" | "macbookAir13" | "macbookPro14" | "imac24" | "proDisplayXdr" | "watchUltra2" | "watchSeries9";
export type Finish = "black" | "white" | "blue" | "natural" | "glacier" | "burgundy" | "silver" | "starWhite" | "violet" | "spaceBlack" | "cosmicOrange" | "deepBlue" | "skyBlue" | "starlight";

export const DEVICE_IDS: readonly Device[] = ["iphone15Pro", "iphone15", "iphone17Pro", "iphone17", "iphone18Pro", "iphone18", "iphoneDuo", "galaxyS26Ultra", "ipadPro13", "macbookAir13", "macbookPro14", "imac24", "proDisplayXdr", "watchUltra2", "watchSeries9"];
export const FINISH_IDS: readonly Finish[] = ["black", "white", "blue", "natural", "glacier", "burgundy", "silver", "starWhite", "violet", "spaceBlack", "cosmicOrange", "deepBlue", "skyBlue", "starlight"];
/** Угол между половинами складного телефона: 180° — раскрыт, 0° — сложен. */
export const FOLD_OPEN = 180;
/** Ниже прямого угла изображение переходит на внешний экран. */
export const FOLD_OUTER_BELOW = 90;
/** Крышка открывается до упора примерно на 135°; в файлах моделей она стоит около 110°. */
export const LID_DEFAULT = 110;
export const LID_MAX = 135;
export const BACKGROUND_MODES: readonly BackgroundMode[] = ["solid", "gradient", "preset", "custom", "transparent"];

/** Готовые варианты тени; «custom» — значения, изменённые вручную. */
export type ShadowPreset = "soft" | "contact" | "floating" | "long" | "hard" | "custom";
export const SHADOW_PRESETS: readonly ShadowPreset[] = ["soft", "contact", "floating", "long", "hard", "custom"];
/** Откуда берётся цвет тени: тёмный оттенок фона или свой цвет. */
export type ShadowTint = "background" | "custom";

/** Что лежит на экране устройства. */
export type ScreenKind = "image" | "video";

export interface CameraSettings {
  projection: Projection;
  azimuth: number;
  elevation: number;
  roll: number;
  focalLength: number;
  distance: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Положение устройства в сцене: сдвиг в единицах сцены от центра, поворот
 * в градусах вокруг собственного центра и равномерный масштаб в процентах.
 * Крен камеры применяется поверх и остаётся настройкой камеры.
 */
export interface DeviceTransform { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number; scale: number }

export const DEFAULT_TRANSFORM: DeviceTransform = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 100 };

/** Тень без включения и пресета: то, что меняют ползунки. */
export type ShadowShape = { opacity: number; softness: number; distance: number; length: number };

/** Значения готовых теней. «Мягкая» совпадает с тенью до появления пресетов. */
export const SHADOW_VALUES: Record<Exclude<ShadowPreset, "custom">, ShadowShape> = {
  soft: { opacity: 35, softness: 50, distance: 30, length: 35 },
  contact: { opacity: 55, softness: 22, distance: 4, length: 18 },
  floating: { opacity: 24, softness: 85, distance: 75, length: 30 },
  long: { opacity: 30, softness: 60, distance: 45, length: 85 },
  hard: { opacity: 45, softness: 6, distance: 22, length: 40 },
};

export interface Settings {
  device: Device;
  finish: Finish;
  /** Угол между половинами складного телефона в градусах; у остальных моделей не используется. */
  fold: number;
  /** Раскрытие крышки ноутбука в градусах: 0 — закрыт. */
  lid: number;
  camera: CameraSettings;
  screen: { fit: ScreenFit; scale: number; x: number; y: number; island: boolean; reflection: number };
  background: {
    mode: BackgroundMode; color: string; secondary: string; angle: number;
    /** Пресет из BACKGROUNDS, используется в режиме «preset». */
    preset: string;
    /** Пятна пресета медленно ходят по орбитам. */
    animated: boolean;
    /** Скорость движения в процентах от базовой. */
    speed: number;
  };
  /** Воспроизведение видео на экране; к изображениям не применяется. */
  video: { loop: boolean; speed: number; start: number; end: number; muted: boolean };
  light: { preset: Lighting; intensity: number; exposure: number; rotation: number };
  /**
   * Тень на фоне позади устройства; величины в процентах. Длина — насколько
   * свет отклонён от оси камеры: чем больше, тем дальше тень уходит вбок.
   */
  shadow: ShadowShape & { enabled: boolean; preset: ShadowPreset; tint: ShadowTint; color: string };
  transform: DeviceTransform;
  aspect: Aspect;
  resolution: number;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  /** Только для телефонов и планшетов: альбомный ракурс у ноутбука, монитора и часов бессмыслен. */
  handheld?: boolean;
  camera: CameraSettings;
  preview: [number, number, number];
}

const STUDIO_CAMERA: CameraSettings = {
  projection: "perspective", azimuth: -22, elevation: 16, roll: -8,
  focalLength: 55, distance: 4.8, zoom: 100, offsetX: 0, offsetY: 0,
};

export const DEFAULT_CAMERA: CameraSettings = {
  ...STUDIO_CAMERA, projection: "orthographic", azimuth: 0, elevation: 0, roll: 0,
};

export const DEFAULT_SETTINGS: Settings = {
  device: "iphone15", finish: "black", fold: FOLD_OPEN, lid: LID_DEFAULT,
  camera: { ...DEFAULT_CAMERA },
  screen: { fit: "cover", scale: 100, x: 0, y: 0, island: true, reflection: 12 },
  background: { mode: "solid", color: "#f4f4f4", secondary: "#d4d4d4", angle: 135, preset: "dawn", animated: true, speed: 100 },
  // end: 0 означает «до конца файла» — настоящая длительность известна только
  // после загрузки.
  video: { loop: true, speed: 100, start: 0, end: 0, muted: true },
  light: { preset: "soft", intensity: 100, exposure: 100, rotation: 0 },
  shadow: { enabled: true, preset: "soft", ...SHADOW_VALUES.soft, tint: "background", color: "#000000" },
  transform: { ...DEFAULT_TRANSFORM },
  aspect: "4:3", resolution: 2400,
};

export const PRESETS: Preset[] = [
  { id: "studio", name: "Студийный", description: "Мягкий ракурс в три четверти", camera: { ...STUDIO_CAMERA }, preview: [14, -24, -8] },
  { id: "front", name: "Прямо", description: "Фронтальный вид без искажений", camera: { ...DEFAULT_CAMERA }, preview: [0, 0, 0] },
  { id: "hero", name: "Перспектива", description: "Крупный ближний торец, как на референсе", camera: { ...STUDIO_CAMERA, azimuth: 0, elevation: -57, roll: 0, focalLength: 22, distance: 1.65, zoom: 115, offsetY: 22 }, preview: [57, 0, 0] },
  { id: "top", name: "Сверху", description: "Плавное сокращение вдаль", camera: { ...STUDIO_CAMERA, azimuth: 24, elevation: 42, roll: -22, focalLength: 40, distance: 3.8 }, preview: [-40, -25, -22] },
  { id: "landscape", name: "Горизонтально", description: "Телефон или планшет в альбомной ориентации", handheld: true, camera: { ...STUDIO_CAMERA, azimuth: -12, elevation: 15, roll: 90, focalLength: 55, distance: 4.8 }, preview: [12, -12, 90] },
  { id: "back", name: "Сзади", description: "Корпус и блок камер", camera: { ...STUDIO_CAMERA, azimuth: 155, elevation: 12, roll: 10 }, preview: [10, 150, 10] },
];

export function aspectRatio(aspect: Aspect): number {
  const [width, height] = aspect.split(":").map(Number);
  return width / height;
}

export function exportSize(aspect: Aspect, longest: number): { width: number; height: number } {
  const ratio = aspectRatio(aspect);
  return ratio >= 1 ? { width: longest, height: Math.round(longest / ratio) } : { width: Math.round(longest * ratio), height: longest };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Конец отрезка воспроизведения: 0 и выходы за длительность читаются как конец файла. */
export function videoEnd(end: number, duration: number): number {
  return end > 0 && end <= duration ? end : duration;
}

/** Длительность готового ролика с учётом обрезки и скорости, в секундах. */
export function videoLength(video: Settings["video"], duration: number): number {
  const span = Math.max(0, videoEnd(video.end, duration) - clamp(video.start, 0, duration));
  return span / Math.max(0.1, video.speed / 100);
}
