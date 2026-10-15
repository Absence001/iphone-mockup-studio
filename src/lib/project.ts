import { INITIAL_DOCUMENT, type DocumentState } from "./history";
import { deviceFinish } from "./models";
import { backgroundPreset } from "./backgrounds";
import { BACKGROUND_MODES, DEFAULT_SETTINGS, DEVICE_IDS, FINISH_IDS, FOLDS, type ScreenKind, type Settings } from "./settings";

/** Допустимые вложения проекта: картинка или видео в виде data:-строки. */
const ASSET_DATA = /^data:(image\/(png|jpeg|webp)|video\/(mp4|webm|quicktime));base64,/i;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Не удалось открыть проект: неверный формат файла.");
  return value as Record<string, unknown>;
}

function number(object: Record<string, unknown>, key: string, min: number, max: number) {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`В проекте неверное значение: ${key}.`);
  return value;
}

function option<T extends string>(value: unknown, choices: readonly T[]): T {
  const choice = choices.find((candidate) => candidate === value);
  if (!choice) throw new Error("В проекте есть неподдерживаемая настройка.");
  return choice;
}

function color(value: unknown) {
  if (typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) throw new Error("В проекте неверный цвет фона.");
  return value;
}

export function parseProject(text: string): {
  settings: Settings;
  imageData: string | null; imageKind: ScreenKind; imageName: string;
  backdropData: string | null; backdropKind: ScreenKind; backdropName: string;
} {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("Не удалось прочитать проект. Выберите корректный файл .forma.json."); }
  const data = record(raw);
  if (data.version !== 1 || data.app !== "forma") throw new Error("Выберите проект Forma с расширением .forma.json.");
  const s = record(data.settings), c = record(s.camera), screen = record(s.screen), bg = record(s.background), light = record(s.light);
  if (typeof screen.island !== "boolean") throw new Error("В проекте неверная настройка выреза камеры.");
  const settings: Settings = {
    device: option(s.device, DEVICE_IDS), finish: option(s.finish, FINISH_IDS),
    // Проекты до появления Duo сохранялись без положения шарнира.
    fold: s.fold === undefined ? "open" : option(s.fold, FOLDS),
    aspect: option(s.aspect, ["16:9", "4:3", "1:1", "4:5", "9:16"]), resolution: number(s, "resolution", 256, 3840),
    camera: {
      projection: option(c.projection, ["perspective", "orthographic"]), azimuth: number(c, "azimuth", -360, 360), elevation: number(c, "elevation", -89, 89),
      roll: number(c, "roll", -180, 180), focalLength: number(c, "focalLength", 18, 120), distance: number(c, "distance", 1.15, 15), zoom: number(c, "zoom", 25, 400), offsetX: number(c, "offsetX", -100, 100), offsetY: number(c, "offsetY", -100, 100),
    },
    screen: { fit: option(screen.fit, ["cover", "contain"]), scale: number(screen, "scale", 25, 300), x: number(screen, "x", -100, 100), y: number(screen, "y", -100, 100), island: screen.island, reflection: number(screen, "reflection", 0, 50) },
    // Проекты до библиотеки фонов сохранялись без пресета и анимации.
    background: {
      mode: option(bg.mode, BACKGROUND_MODES), color: color(bg.color), secondary: color(bg.secondary), angle: number(bg, "angle", 0, 360),
      preset: typeof bg.preset === "string" ? backgroundPreset(bg.preset).id : DEFAULT_SETTINGS.background.preset,
      animated: typeof bg.animated === "boolean" ? bg.animated : DEFAULT_SETTINGS.background.animated,
      speed: bg.speed === undefined ? DEFAULT_SETTINGS.background.speed : number(bg, "speed", 10, 300),
    },
    // Схема «contrast» до студийного света стала «studio».
    light: { preset: option(light.preset === "contrast" ? "studio" : light.preset, ["soft", "studio", "rim"]), intensity: number(light, "intensity", 0, 200), exposure: number(light, "exposure", 25, 200), rotation: number(light, "rotation", -180, 180) },
    // Проекты до появления тени сохранялись без этого блока.
    shadow: s.shadow === undefined ? { ...DEFAULT_SETTINGS.shadow } : (() => {
      const shadow = record(s.shadow);
      if (typeof shadow.enabled !== "boolean") throw new Error("В проекте неверная настройка тени.");
      return { enabled: shadow.enabled, opacity: number(shadow, "opacity", 0, 100), softness: number(shadow, "softness", 0, 100), distance: number(shadow, "distance", 0, 100) };
    })(),
    // Проекты до появления видео сохранялись без этого блока.
    video: s.video === undefined ? { ...DEFAULT_SETTINGS.video } : (() => {
      const v = record(s.video);
      return {
        loop: typeof v.loop === "boolean" ? v.loop : true,
        muted: typeof v.muted === "boolean" ? v.muted : true,
        speed: number(v, "speed", 25, 400),
        start: number(v, "start", 0, 36000),
        end: number(v, "end", 0, 36000),
      };
    })(),
  };
  settings.finish = deviceFinish(settings.device, settings.finish).id;
  const imageData = data.imageData;
  if (imageData !== null && (typeof imageData !== "string" || !ASSET_DATA.test(imageData))) throw new Error("В проекте неподдерживаемое вложение.");
  const imageKind: ScreenKind = typeof imageData === "string" && imageData.startsWith("data:video/") ? "video" : "image";
  // Проекты до появления своего фона сохранялись без этих полей.
  const backdropData = data.backdropData === undefined ? null : data.backdropData;
  if (backdropData !== null && (typeof backdropData !== "string" || !ASSET_DATA.test(backdropData))) throw new Error("В проекте неподдерживаемый фон.");
  const backdropKind: ScreenKind = typeof backdropData === "string" && backdropData.startsWith("data:video/") ? "video" : "image";
  return {
    settings, imageData, imageKind, imageName: typeof data.imageName === "string" ? data.imageName.slice(0, 255) : "Экран из проекта",
    backdropData, backdropKind, backdropName: typeof data.backdropName === "string" ? data.backdropName.slice(0, 255) : "Фон из проекта",
  };
}

/** Файл по ссылке в виде data:-строки, чтобы проект был самодостаточным. */
async function embed(asset: DocumentState["image"]): Promise<string | null> {
  if (asset.demo || !asset.url) return null;
  const response = await fetch(asset.url);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Не удалось сохранить вложение в проекте."));
    reader.onerror = () => reject(new Error("Не удалось прочитать вложение."));
    reader.readAsDataURL(blob);
  });
}

export async function serializeProject(document: DocumentState): Promise<string> {
  const [imageData, backdropData] = await Promise.all([embed(document.image), embed(document.backdrop)]);
  return JSON.stringify({
    app: "forma", version: 1, settings: document.settings,
    imageData, imageName: document.image.name,
    backdropData, backdropName: document.backdrop.name,
  }, null, 2);
}

export function projectDocument(settings: Settings, image: DocumentState["image"] | null, backdrop?: DocumentState["backdrop"] | null): DocumentState {
  return { settings, image: image ?? INITIAL_DOCUMENT.image, backdrop: backdrop ?? INITIAL_DOCUMENT.backdrop };
}
