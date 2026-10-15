export type Projection = "perspective" | "orthographic";
export type BackgroundMode = "solid" | "gradient" | "transparent";
export type Lighting = "soft" | "contrast" | "rim";
export type ScreenFit = "cover" | "contain";
export type Aspect = "16:9" | "4:3" | "1:1" | "4:5" | "9:16";
export type Device = "iphone15" | "iphone18";
export type Finish = "black" | "glacier" | "burgundy" | "silver";

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

export interface Settings {
  device: Device;
  finish: Finish;
  camera: CameraSettings;
  screen: { fit: ScreenFit; scale: number; x: number; y: number; island: boolean; reflection: number };
  background: { mode: BackgroundMode; color: string; secondary: string; angle: number };
  light: { preset: Lighting; intensity: number; exposure: number; rotation: number };
  aspect: Aspect;
  resolution: number;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
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
  device: "iphone15", finish: "black",
  camera: { ...DEFAULT_CAMERA },
  screen: { fit: "cover", scale: 100, x: 0, y: 0, island: true, reflection: 12 },
  background: { mode: "solid", color: "#f4f4f4", secondary: "#d4d4d4", angle: 135 },
  light: { preset: "soft", intensity: 100, exposure: 100, rotation: 0 },
  aspect: "4:3", resolution: 2400,
};

export const PRESETS: Preset[] = [
  { id: "studio", name: "Студийный", description: "Мягкий ракурс в три четверти", camera: { ...STUDIO_CAMERA }, preview: [14, -24, -8] },
  { id: "front", name: "Прямо", description: "Фронтальный вид без искажений", camera: { ...DEFAULT_CAMERA }, preview: [0, 0, 0] },
  { id: "hero", name: "Перспектива", description: "Крупный ближний торец, как на референсе", camera: { ...STUDIO_CAMERA, azimuth: 0, elevation: -57, roll: 0, focalLength: 22, distance: 1.65, zoom: 115, offsetY: 22 }, preview: [57, 0, 0] },
  { id: "top", name: "Сверху", description: "Плавное сокращение вдаль", camera: { ...STUDIO_CAMERA, azimuth: 24, elevation: 42, roll: -22, focalLength: 40, distance: 3.8 }, preview: [-40, -25, -22] },
  { id: "landscape", name: "Горизонтально", description: "Телефон в альбомной ориентации", camera: { ...STUDIO_CAMERA, azimuth: -12, elevation: 15, roll: 90, focalLength: 55, distance: 4.8 }, preview: [12, -12, 90] },
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
