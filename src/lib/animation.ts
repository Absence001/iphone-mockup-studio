import { clamp, type CameraSettings, type DeviceTransform, type Settings } from "./settings";

/**
 * Анимация документа: ключи по отдельным свойствам устройства и камеры.
 * Значение между ключами считается по кривой участка; кривая хранится в
 * ключе, с которого участок начинается. До первого ключа и после последнего
 * свойство стоит на крайнем значении. Свойство без ключей берётся из обычных
 * настроек сцены, поэтому статичный мокап — это анимация без ключей.
 */

export type DeviceKey = keyof DeviceTransform;
export type CameraKey = "azimuth" | "elevation" | "roll" | "distance" | "focalLength" | "zoom" | "offsetX" | "offsetY";
export type TrackId = `transform.${DeviceKey}` | `camera.${CameraKey}`;
export type AnimatedObject = "device" | "camera";

export type EaseId =
  | "linear"
  | "inQuad" | "outQuad" | "inOutQuad"
  | "inCubic" | "outCubic" | "inOutCubic"
  | "inQuart" | "outQuart" | "inOutQuart"
  | "inQuint" | "outQuint" | "inOutQuint"
  | "inSine" | "outSine" | "inOutSine"
  | "inExpo" | "outExpo" | "inOutExpo"
  | "inCirc" | "outCirc" | "inOutCirc"
  | "inBack" | "outBack" | "inOutBack";

export interface Keyframe { id: string; time: number; value: number; ease: EaseId }

export interface Animation {
  /** Длительность ролика в секундах. */
  duration: number;
  tracks: Partial<Record<TrackId, Keyframe[]>>;
  /** Размытие движения: сила — доля кадра, в течение которой «открыт затвор». */
  blur: { enabled: boolean; amount: number };
}

export interface TrackInfo {
  id: TrackId; object: AnimatedObject; label: string;
  /** Подпись единицы; «length» — значение в единицах сцены, показывается в сантиметрах модели. */
  unit: string; length: boolean;
  min: number; max: number; step: number;
}

/** Порядок совпадает с панелью: сначала устройство, затем камера. */
export const TRACKS: readonly TrackInfo[] = [
  { id: "transform.x", object: "device", label: "Положение X", unit: "см", length: true, min: -4, max: 4, step: 0.01 },
  { id: "transform.y", object: "device", label: "Положение Y", unit: "см", length: true, min: -4, max: 4, step: 0.01 },
  { id: "transform.z", object: "device", label: "Положение Z", unit: "см", length: true, min: -4, max: 4, step: 0.01 },
  { id: "transform.rotX", object: "device", label: "Поворот X", unit: "°", length: false, min: -360, max: 360, step: 1 },
  { id: "transform.rotY", object: "device", label: "Поворот Y", unit: "°", length: false, min: -360, max: 360, step: 1 },
  { id: "transform.rotZ", object: "device", label: "Поворот Z", unit: "°", length: false, min: -360, max: 360, step: 1 },
  { id: "transform.scale", object: "device", label: "Масштаб", unit: "%", length: false, min: 10, max: 400, step: 1 },
  { id: "camera.azimuth", object: "camera", label: "Поворот", unit: "°", length: false, min: -360, max: 360, step: 1 },
  { id: "camera.elevation", object: "camera", label: "Наклон", unit: "°", length: false, min: -89, max: 89, step: 1 },
  { id: "camera.roll", object: "camera", label: "Крен", unit: "°", length: false, min: -360, max: 360, step: 1 },
  { id: "camera.distance", object: "camera", label: "Расстояние", unit: "см", length: true, min: 1.15, max: 15, step: 0.01 },
  { id: "camera.focalLength", object: "camera", label: "Фокусное расстояние", unit: "мм", length: false, min: 18, max: 120, step: 1 },
  { id: "camera.zoom", object: "camera", label: "Масштаб в кадре", unit: "%", length: false, min: 25, max: 400, step: 1 },
  { id: "camera.offsetX", object: "camera", label: "Кадр по горизонтали", unit: "%", length: false, min: -100, max: 100, step: 1 },
  { id: "camera.offsetY", object: "camera", label: "Кадр по вертикали", unit: "%", length: false, min: -100, max: 100, step: 1 },
];

export const TRACK_IDS: readonly TrackId[] = TRACKS.map((track) => track.id);
export const trackInfo = (id: TrackId): TrackInfo => TRACKS.find((track) => track.id === id)!;

export const MIN_DURATION = 0.5;
export const MAX_DURATION = 60;
/** Ключи ставятся с точностью до сотой секунды: так время читается в полях без хвостов. */
export const TIME_STEP = 0.01;
/** Новый участок по умолчанию: мягкий разгон и торможение. */
export const DEFAULT_EASE: EaseId = "inOutCubic";

export const EMPTY_ANIMATION: Animation = { duration: 3, tracks: {}, blur: { enabled: false, amount: 50 } };

export const roundTime = (time: number) => Math.round(time / TIME_STEP) * TIME_STEP;

/* ---------- Кривые ---------- */

const BACK = 1.70158;
const families = {
  Quad: (t: number) => t * t,
  Cubic: (t: number) => t * t * t,
  Quart: (t: number) => t ** 4,
  Quint: (t: number) => t ** 5,
  Sine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  Expo: (t: number) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  Circ: (t: number) => 1 - Math.sqrt(1 - t * t),
  Back: (t: number) => (BACK + 1) * t ** 3 - BACK * t * t,
} as const;
export type EaseFamily = keyof typeof families;
export const EASE_FAMILIES = Object.keys(families) as EaseFamily[];
export type EaseDirection = "in" | "out" | "inOut";

/** Кривая по имени: in — разгон, out — торможение, inOut — и то и другое. */
export function ease(id: EaseId, t: number): number {
  const p = clamp(t, 0, 1);
  if (id === "linear") return p;
  const match = /^(inOut|in|out)(.+)$/.exec(id);
  const curve = match && families[match[2] as EaseFamily];
  if (!match || !curve) return p;
  if (match[1] === "in") return curve(p);
  if (match[1] === "out") return 1 - curve(1 - p);
  return p < 0.5 ? curve(p * 2) / 2 : 1 - curve((1 - p) * 2) / 2;
}

export const easeId = (direction: EaseDirection, family: EaseFamily) => `${direction}${family}` as EaseId;

/** Путь кривой для миниатюры в квадрате size × size; перелёт Back уходит за поля. */
export function easePath(id: EaseId, size = 32, pad = 7): string {
  const inner = size - pad * 2;
  const points: string[] = [];
  for (let step = 0; step <= 40; step++) {
    const t = step / 40;
    points.push(`${(pad + t * inner).toFixed(2)},${(size - pad - ease(id, t) * inner).toFixed(2)}`);
  }
  return `M${points.join("L")}`;
}

/* ---------- Значения ---------- */

function sorted(keys: Keyframe[] | undefined): Keyframe[] {
  return keys ? [...keys].sort((a, b) => a.time - b.time) : [];
}

/** Значение дорожки в момент time; null — у дорожки нет ключей. */
export function sampleTrack(keys: Keyframe[] | undefined, time: number): number | null {
  const list = sorted(keys);
  if (!list.length) return null;
  if (time <= list[0].time) return list[0].value;
  const last = list[list.length - 1];
  if (time >= last.time) return last.value;
  for (let index = 0; index < list.length - 1; index++) {
    const from = list[index], to = list[index + 1];
    if (time > to.time) continue;
    const span = to.time - from.time;
    const progress = span > 0 ? (time - from.time) / span : 1;
    return from.value + (to.value - from.value) * ease(from.ease, progress);
  }
  return last.value;
}

const groupOf = (id: TrackId) => id.split(".")[0] as "transform" | "camera";
const fieldOf = (id: TrackId) => id.split(".")[1];

/** Значение свойства в настройках без учёта анимации. */
export function baseValue(settings: Settings, id: TrackId): number {
  const group = groupOf(id) === "transform" ? settings.transform : settings.camera;
  return (group as unknown as Record<string, number>)[fieldOf(id)];
}

export function withValue(settings: Settings, id: TrackId, value: number): Settings {
  if (groupOf(id) === "transform") return { ...settings, transform: { ...settings.transform, [fieldOf(id)]: value } };
  return { ...settings, camera: { ...settings.camera, [fieldOf(id)]: value } as CameraSettings };
}

/** Дорожка свойства по его группе и имени: «camera» + «azimuth» → camera.azimuth. */
export const trackOf = (group: "transform" | "camera", field: string): TrackId | null => {
  const id = `${group}.${field}` as TrackId;
  return TRACK_IDS.includes(id) ? id : null;
};

/** Настройки сцены в момент time: анимированные свойства берутся из ключей. */
export function evaluate(settings: Settings, animation: Animation, time: number): Settings {
  let next = settings;
  for (const id of TRACK_IDS) {
    const value = sampleTrack(animation.tracks[id], time);
    if (value !== null) next = withValue(next, id, value);
  }
  return next;
}

export const isAnimated = (animation: Animation, id: TrackId) => Boolean(animation.tracks[id]?.length);
export const hasKeys = (animation: Animation) => TRACK_IDS.some((id) => isAnimated(animation, id));
export const objectTracks = (object: AnimatedObject): TrackId[] => TRACKS.filter((track) => track.object === object).map((track) => track.id);

let counter = 0;
export const keyId = () => `k${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Ключ в момент time: совпадением считается расстояние меньше половины шага. */
export function keyAt(keys: Keyframe[] | undefined, time: number): Keyframe | undefined {
  return keys?.find((key) => Math.abs(key.time - time) < TIME_STEP / 2);
}

/** Ставит или обновляет ключ. Новый ключ наследует кривую участка, в который попал. */
export function setKey(animation: Animation, id: TrackId, time: number, value: number): Animation {
  const at = roundTime(clamp(time, 0, animation.duration));
  const keys = sorted(animation.tracks[id]);
  const existing = keyAt(keys, at);
  const previous = [...keys].reverse().find((key) => key.time < at);
  const next = existing
    ? keys.map((key) => (key === existing ? { ...key, value } : key))
    : [...keys, { id: keyId(), time: at, value, ease: previous?.ease ?? DEFAULT_EASE }].sort((a, b) => a.time - b.time);
  return { ...animation, tracks: { ...animation.tracks, [id]: next } };
}

export interface KeyRef { track: TrackId; id: string }

export function removeKeys(animation: Animation, targets: KeyRef[]): Animation {
  const tracks = { ...animation.tracks };
  for (const { track, id } of targets) {
    const rest = (tracks[track] ?? []).filter((key) => key.id !== id);
    if (rest.length) tracks[track] = rest; else delete tracks[track];
  }
  return { ...animation, tracks };
}

/**
 * Переносит ключи на delta секунд. Ключ, попавший на время другого ключа той
 * же дорожки, заменяет его: два ключа в одной точке ничего не значат.
 */
export function moveKeys(animation: Animation, targets: KeyRef[], delta: number): Animation {
  const times = targets.flatMap((ref) => { const key = findKey(animation, ref); return key ? [key.time] : []; });
  if (!times.length) return animation;
  // Вся группа останавливается у края, расстояния между её ключами сохраняются.
  const boundedDelta = roundTime(clamp(delta, -Math.min(...times), animation.duration - Math.max(...times)));
  const tracks = { ...animation.tracks };
  const byTrack = new Map<TrackId, Set<string>>();
  targets.forEach(({ track, id }) => byTrack.set(track, (byTrack.get(track) ?? new Set()).add(id)));
  byTrack.forEach((ids, track) => {
    const keys = tracks[track] ?? [];
    const moved = keys.filter((key) => ids.has(key.id)).map((key) => ({ ...key, time: roundTime(key.time + boundedDelta) }));
    const kept = keys.filter((key) => !ids.has(key.id) && !moved.some((other) => Math.abs(other.time - key.time) < TIME_STEP / 2));
    tracks[track] = [...kept, ...moved].sort((a, b) => a.time - b.time);
  });
  return { ...animation, tracks };
}

/** Найти ключ по ссылке. */
export function findKey(animation: Animation, ref: KeyRef): Keyframe | undefined {
  return animation.tracks[ref.track]?.find((key) => key.id === ref.id);
}

/** Меняет кривую участков, которые начинаются в from и заканчиваются не позже to. */
export function setEase(animation: Animation, tracks: TrackId[], from: number, to: number, value: EaseId): Animation {
  const next = { ...animation.tracks };
  for (const id of tracks) {
    const keys = sorted(next[id]);
    if (!keys.length) continue;
    next[id] = keys.map((key, index) => {
      const after = keys[index + 1];
      return Math.abs(key.time - from) < TIME_STEP / 2 && after && after.time <= to + TIME_STEP / 2 ? { ...key, ease: value } : key;
    });
  }
  return { ...animation, tracks: next };
}

/** Кривая участка: общая, если у всех его дорожек она одинакова. */
export function segmentEase(animation: Animation, tracks: TrackId[], from: number, to: number): EaseId | "mixed" | null {
  const found = new Set<EaseId>();
  for (const id of tracks) {
    const keys = sorted(animation.tracks[id]);
    keys.forEach((key, index) => {
      const after = keys[index + 1];
      if (Math.abs(key.time - from) < TIME_STEP / 2 && after && after.time <= to + TIME_STEP / 2) found.add(key.ease);
    });
  }
  if (!found.size) return null;
  return found.size === 1 ? [...found][0] : "mixed";
}

/**
 * Меняет длину участка from–to: конечные ключи участка и всё, что после
 * него, сдвигаются на разницу. Ролик удлиняется, если ключи уходят за конец.
 */
export function setSegmentLength(animation: Animation, tracks: TrackId[], from: number, to: number, length: number): Animation {
  const delta = roundTime(Math.max(TIME_STEP, length) - (to - from));
  if (!delta) return animation;
  const lastKey = Math.max(0, ...TRACK_IDS.flatMap((id) => (animation.tracks[id] ?? []).map((key) => key.time)));
  const duration = clamp(Math.max(animation.duration, roundTime(lastKey + delta)), MIN_DURATION, MAX_DURATION);
  const next: Animation["tracks"] = {};
  for (const id of TRACK_IDS) {
    const keys = animation.tracks[id];
    if (!keys?.length) continue;
    next[id] = keys.map((key) => (tracks.includes(id) && key.time >= to - TIME_STEP / 2 ? { ...key, time: roundTime(clamp(key.time + delta, 0, duration)) } : key));
  }
  return { ...animation, duration, tracks: next };
}

/** Новая длительность: ключи за её пределами сдвигаются к концу, а не теряются. */
export function withDuration(animation: Animation, duration: number): Animation {
  const value = roundTime(clamp(duration, MIN_DURATION, MAX_DURATION));
  const tracks: Animation["tracks"] = {};
  for (const id of TRACK_IDS) {
    const keys = animation.tracks[id];
    if (!keys?.length) continue;
    const list: Keyframe[] = [];
    for (const key of sorted(keys)) {
      const time = Math.min(key.time, value);
      const clash = list.findIndex((other) => Math.abs(other.time - time) < TIME_STEP / 2);
      if (clash >= 0) list[clash] = { ...key, time }; else list.push({ ...key, time });
    }
    tracks[id] = list;
  }
  return { ...animation, duration: value, tracks };
}

/** Времена ключей объекта без повторов: по ним рисуется сводная дорожка. */
export function objectKeyTimes(animation: Animation, object: AnimatedObject): number[] {
  const times: number[] = [];
  for (const id of objectTracks(object)) {
    for (const key of animation.tracks[id] ?? []) if (!times.some((time) => Math.abs(time - key.time) < TIME_STEP / 2)) times.push(key.time);
  }
  return times.sort((a, b) => a - b);
}

/** Все ключи объекта в момент time — сводный ключ на верхней дорожке. */
export function objectKeysAt(animation: Animation, object: AnimatedObject, time: number): KeyRef[] {
  return objectTracks(object).flatMap((track) => {
    const key = keyAt(animation.tracks[track], time);
    return key ? [{ track, id: key.id }] : [];
  });
}

/** Все времена ключей подряд: к ним прилипает курсор с Shift. */
export function allKeyTimes(animation: Animation): number[] {
  const times = [...objectKeyTimes(animation, "device"), ...objectKeyTimes(animation, "camera")];
  return times.filter((time, index) => !times.slice(0, index).some((other) => Math.abs(other - time) < TIME_STEP / 2)).sort((a, b) => a - b);
}

/* ---------- Проект ---------- */

const EASES: readonly string[] = ["linear", ...EASE_FAMILIES.flatMap((family) => ["in", "out", "inOut"].map((direction) => `${direction}${family}`))];
export const isEase = (value: unknown): value is EaseId => typeof value === "string" && EASES.includes(value);

/** Для файла проекта: без служебных id ключей. */
export function serializeAnimation(animation: Animation) {
  const tracks: Record<string, { time: number; value: number; ease: EaseId }[]> = {};
  for (const id of TRACK_IDS) {
    const keys = animation.tracks[id];
    if (keys?.length) tracks[id] = sorted(keys).map(({ time, value, ease: curve }) => ({ time, value, ease: curve }));
  }
  return { duration: animation.duration, tracks, blur: animation.blur };
}

/** Разбор анимации из файла проекта; старые проекты приходят без неё. */
export function parseAnimation(raw: unknown): Animation {
  if (raw === undefined || raw === null) return structuredClone(EMPTY_ANIMATION);
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("В проекте неверная анимация.");
  const data = raw as Record<string, unknown>;
  const duration = typeof data.duration === "number" && Number.isFinite(data.duration) ? roundTime(clamp(data.duration, MIN_DURATION, MAX_DURATION)) : EMPTY_ANIMATION.duration;
  const tracks: Animation["tracks"] = {};
  const source = data.tracks && typeof data.tracks === "object" ? data.tracks as Record<string, unknown> : {};
  for (const id of TRACK_IDS) {
    const list = source[id];
    if (!Array.isArray(list)) continue;
    const info = trackInfo(id);
    const keys: Keyframe[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const key = item as Record<string, unknown>;
      if (typeof key.time !== "number" || typeof key.value !== "number" || !Number.isFinite(key.time) || !Number.isFinite(key.value)) continue;
      const time = roundTime(clamp(key.time, 0, duration));
      if (keys.some((other) => Math.abs(other.time - time) < TIME_STEP / 2)) continue;
      keys.push({ id: keyId(), time, value: clamp(key.value, info.min, info.max), ease: isEase(key.ease) ? key.ease : DEFAULT_EASE });
    }
    if (keys.length) tracks[id] = keys.sort((a, b) => a.time - b.time);
  }
  const blur = data.blur && typeof data.blur === "object" ? data.blur as Record<string, unknown> : {};
  return {
    duration, tracks,
    blur: { enabled: blur.enabled === true, amount: typeof blur.amount === "number" && Number.isFinite(blur.amount) ? clamp(blur.amount, 0, 100) : EMPTY_ANIMATION.blur.amount },
  };
}
