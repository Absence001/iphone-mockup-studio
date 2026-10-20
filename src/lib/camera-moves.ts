import { clamp, type CameraSettings } from "./settings";
import { MAX_DURATION, TIME_STEP, objectTracks, roundTime, setKey, withDuration, type Animation, type EaseId, type TrackId } from "./animation";

/**
 * Готовые движения камеры. Начало и конец заданы относительно активного
 * экрана выбранного устройства: расстояние подбирается по габаритам модели и
 * пропорциям кадра, а сдвиг кадра держит центр экрана в центре. Применение
 * ставит обычные ключи камеры, их можно править и отменить одним шагом.
 */

export type CameraMoveId = "pullBack" | "riseUp" | "pushIn" | "linearRotation" | "smoothRotation" | "zoomIn" | "zoomOut" | "zoomInRotation" | "zoomOutRotation" | "entryLeft" | "entryRight" | "entryLeftRotation" | "entryRightRotation" | "slideLeft" | "slideRight" | "emphasis" | "emphasisRotation";

export interface CameraMove {
  id: CameraMoveId; name: string; description: string;
  duration: number; ease: EaseId;
  from: Shot; to: Shot;
  via?: Shot;
}

/** Ракурс в долях: «wide» — устройство целиком, «close» — центр экрана крупно. */
interface Shot { azimuth: number; elevation: number; framing: "wide" | "close"; offsetX?: number; roll?: number }

export const CAMERA_MOVES: readonly CameraMove[] = [
  {
    id: "pullBack", name: "Отъезд от экрана", description: "От крупного плана к прямому виду",
    duration: 2.4, ease: "inOutCubic",
    from: { azimuth: -16, elevation: 9, framing: "close" }, to: { azimuth: 0, elevation: 0, framing: "wide" },
  },
  {
    id: "riseUp", name: "Из нижнего ракурса", description: "От перспективы снизу к прямому виду",
    duration: 2.2, ease: "outCubic",
    from: { azimuth: 0, elevation: -38, framing: "wide" }, to: { azimuth: 0, elevation: 0, framing: "wide" },
  },
  {
    id: "pushIn", name: "Наезд на экран", description: "От прямого вида к крупному плану",
    duration: 2.4, ease: "inOutCubic",
    from: { azimuth: 0, elevation: 0, framing: "wide" }, to: { azimuth: 14, elevation: 7, framing: "close" },
  },
  { id: "linearRotation", name: "Ровный оборот", description: "Полный оборот с постоянной скоростью", duration: 4, ease: "linear", from: { azimuth: 0, elevation: 8, framing: "wide" }, to: { azimuth: 360, elevation: 8, framing: "wide" } },
  { id: "smoothRotation", name: "Плавный оборот", description: "Полный оборот с разгоном и торможением", duration: 4, ease: "inOutCubic", from: { azimuth: 0, elevation: 8, framing: "wide" }, to: { azimuth: 360, elevation: 8, framing: "wide" } },
  { id: "zoomIn", name: "Прямой наезд", description: "Приближение к экрану без поворота", duration: 2.4, ease: "inOutCubic", from: { azimuth: 0, elevation: 0, framing: "wide" }, to: { azimuth: 0, elevation: 0, framing: "close" } },
  { id: "zoomOut", name: "Прямой отъезд", description: "От экрана к устройству целиком", duration: 2.4, ease: "inOutCubic", from: { azimuth: 0, elevation: 0, framing: "close" }, to: { azimuth: 0, elevation: 0, framing: "wide" } },
  { id: "zoomInRotation", name: "Наезд с поворотом", description: "Приближение и смена угла обзора", duration: 2.8, ease: "inOutCubic", from: { azimuth: -28, elevation: -8, framing: "wide" }, to: { azimuth: 18, elevation: 8, framing: "close" } },
  { id: "zoomOutRotation", name: "Отъезд с поворотом", description: "От детали к общему виду под углом", duration: 2.8, ease: "inOutCubic", from: { azimuth: 18, elevation: 8, framing: "close" }, to: { azimuth: -28, elevation: -8, framing: "wide" } },
  { id: "entryLeft", name: "Появление слева", description: "Устройство входит в кадр слева", duration: 1.8, ease: "outCubic", from: { azimuth: 0, elevation: 0, framing: "wide", offsetX: -100 }, to: { azimuth: 0, elevation: 0, framing: "wide" } },
  { id: "entryRight", name: "Появление справа", description: "Устройство входит в кадр справа", duration: 1.8, ease: "outCubic", from: { azimuth: 0, elevation: 0, framing: "wide", offsetX: 100 }, to: { azimuth: 0, elevation: 0, framing: "wide" } },
  { id: "entryLeftRotation", name: "Слева с поворотом", description: "Вход слева с разворотом к экрану", duration: 2.2, ease: "outCubic", from: { azimuth: -70, elevation: 12, framing: "wide", offsetX: -100 }, to: { azimuth: 0, elevation: 0, framing: "wide" } },
  { id: "entryRightRotation", name: "Справа с поворотом", description: "Вход справа с разворотом к экрану", duration: 2.2, ease: "outCubic", from: { azimuth: 70, elevation: 12, framing: "wide", offsetX: 100 }, to: { azimuth: 0, elevation: 0, framing: "wide" } },
  { id: "slideLeft", name: "Проезд влево", description: "Плавное движение через кадр влево", duration: 3, ease: "inOutCubic", from: { azimuth: -12, elevation: 5, framing: "wide", offsetX: 35 }, to: { azimuth: -12, elevation: 5, framing: "wide", offsetX: -35 } },
  { id: "slideRight", name: "Проезд вправо", description: "Плавное движение через кадр вправо", duration: 3, ease: "inOutCubic", from: { azimuth: 12, elevation: 5, framing: "wide", offsetX: -35 }, to: { azimuth: 12, elevation: 5, framing: "wide", offsetX: 35 } },
  { id: "emphasis", name: "Акцент на экране", description: "Приближение и возврат к общему виду", duration: 3.2, ease: "inOutCubic", from: { azimuth: 0, elevation: 0, framing: "wide" }, via: { azimuth: 0, elevation: 0, framing: "close" }, to: { azimuth: 0, elevation: 0, framing: "wide" } },
  { id: "emphasisRotation", name: "Акцент с поворотом", description: "Деталь под углом и возврат к началу", duration: 3.2, ease: "inOutCubic", from: { azimuth: 0, elevation: 0, framing: "wide" }, via: { azimuth: -20, elevation: 10, framing: "close", roll: -4 }, to: { azimuth: 0, elevation: 0, framing: "wide" } },
];

/** Габариты устройства и центр его активного экрана в координатах сцены. */
export interface SceneLayout {
  size: [number, number, number];
  center: [number, number, number];
  screen: [number, number, number];
  /** Высота активного экрана в единицах сцены. */
  screenHeight: number;
}

const FOCAL = 55;
/** Запас вокруг устройства в общем плане и доля высоты экрана в крупном. */
const WIDE_MARGIN = 1.22;
const CLOSE_PART = 0.55;

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Vec): Vec => { const length = Math.hypot(...a) || 1; return [a[0] / length, a[1] / length, a[2] / length]; };

/** Тангенсы половин углов обзора, как их считает PerspectiveCamera при той же плёнке 35 мм. */
function slopes(aspect: number, focal: number, zoom: number) {
  const vertical = 17.5 / Math.max(aspect, 1) / focal / zoom;
  return { vertical, horizontal: vertical * aspect };
}

/** Камера на сфере вокруг начала координат: базис взгляда. */
function basis(azimuth: number, elevation: number, distance: number) {
  const phi = (90 - elevation) * Math.PI / 180, theta = azimuth * Math.PI / 180;
  const position: Vec = [distance * Math.sin(phi) * Math.sin(theta), distance * Math.cos(phi), distance * Math.sin(phi) * Math.cos(theta)];
  const forward = norm([-position[0], -position[1], -position[2]]);
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { position, forward, right, up };
}

/**
 * Сдвиг кадра в процентах, при котором точка оказывается в центре. Знак
 * совпадает с полями «Положение в кадре»: плюс уводит изображение вправо и вниз.
 */
export function focusOffset(camera: Pick<CameraSettings, "azimuth" | "elevation" | "distance" | "focalLength" | "zoom">, point: Vec, aspect: number) {
  const { position, forward, right, up } = basis(camera.azimuth, camera.elevation, camera.distance);
  const relative = sub(point, position);
  const depth = Math.max(0.05, dot(relative, forward));
  const { vertical, horizontal } = slopes(aspect, camera.focalLength, camera.zoom / 100);
  const x = dot(relative, right) / depth / horizontal, y = dot(relative, up) / depth / vertical;
  // «|| 0» убирает минус у нуля: в полях он выглядел бы как «-0».
  return { offsetX: clamp(Math.round(-x * 50), -100, 100) || 0, offsetY: clamp(Math.round(y * 50), -100, 100) || 0 };
}

/** Расстояние, на котором в кадр помещается нужная высота и ширина. */
function distanceFor(height: number, width: number, aspect: number) {
  const { vertical, horizontal } = slopes(aspect, FOCAL, 1);
  return Math.max(height / 2 / vertical, width / 2 / horizontal);
}

export function shotCamera(shot: Shot, layout: SceneLayout, aspect: number): CameraSettings {
  const [width, height, depth] = layout.size;
  const target = shot.framing === "close" ? layout.screen : layout.center;
  const distance = shot.framing === "close"
    ? distanceFor(layout.screenHeight * CLOSE_PART, layout.screenHeight * CLOSE_PART * 0.6, aspect)
    // Ширина в общем плане учитывает глубину: под углом виден и торец.
    : distanceFor(height * WIDE_MARGIN, Math.max(width, depth * 0.5) * WIDE_MARGIN, aspect) + depth / 2;
  const camera = { azimuth: shot.azimuth, elevation: shot.elevation, distance: clamp(distance, 1.15, 15), focalLength: FOCAL, zoom: 100 };
  const focused = focusOffset(camera, target, aspect);
  return { projection: "perspective", roll: shot.roll ?? 0, ...camera, ...focused, offsetX: clamp(focused.offsetX + (shot.offsetX ?? 0), -100, 100) };
}

const CAMERA_FIELDS = ["azimuth", "elevation", "roll", "distance", "focalLength", "zoom", "offsetX", "offsetY"] as const;

/**
 * Ставит движение в момент start: ключи начала и конца по всем свойствам
 * камеры. Ключи камеры внутри отрезка заменяются, ролик удлиняется, если
 * движение в него не помещается.
 */
export function applyCameraMove(animation: Animation, move: CameraMove, layout: SceneLayout, aspect: number, start: number, length = move.duration): Animation {
  const from = shotCamera(move.from, layout, aspect), to = shotCamera(move.to, layout, aspect);
  const begin = roundTime(clamp(start, 0, MAX_DURATION - TIME_STEP));
  const end = roundTime(Math.min(MAX_DURATION, begin + Math.max(0.2, length)));
  let next = end > animation.duration ? withDuration(animation, end) : animation;
  const tracks = { ...next.tracks };
  for (const id of objectTracks("camera")) {
    const kept = (tracks[id] ?? []).filter((key) => key.time < begin - TIME_STEP / 2 || key.time > end + TIME_STEP / 2);
    if (kept.length) tracks[id] = kept; else delete tracks[id];
  }
  next = { ...next, tracks };
  for (const field of CAMERA_FIELDS) {
    const id = `camera.${field}` as TrackId;
    next = setKey(next, id, begin, from[field]);
    next = setKey(next, id, end, to[field]);
    if (move.via) next = setKey(next, id, roundTime((begin + end) / 2), shotCamera(move.via, layout, aspect)[field]);
    next = { ...next, tracks: { ...next.tracks, [id]: next.tracks[id]!.map((key) => key.time >= begin - TIME_STEP / 2 && key.time < end - TIME_STEP / 2 ? { ...key, ease: move.ease } : key) } };
  }
  return next;
}
