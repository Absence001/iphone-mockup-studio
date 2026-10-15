import { INITIAL_DOCUMENT, type DocumentState } from "./history";
import { deviceFinish } from "./models";
import { DEVICE_IDS, FINISH_IDS, FOLDS, type Settings } from "./settings";

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

export function parseProject(text: string): { settings: Settings; imageData: string | null; imageName: string } {
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
    background: { mode: option(bg.mode, ["solid", "gradient", "transparent"]), color: color(bg.color), secondary: color(bg.secondary), angle: number(bg, "angle", 0, 360) },
    light: { preset: option(light.preset, ["soft", "contrast", "rim"]), intensity: number(light, "intensity", 0, 200), exposure: number(light, "exposure", 25, 200), rotation: number(light, "rotation", -180, 180) },
  };
  settings.finish = deviceFinish(settings.device, settings.finish).id;
  const imageData = data.imageData;
  if (imageData !== null && (typeof imageData !== "string" || !/^data:image\/(png|jpeg|webp);base64,/i.test(imageData))) throw new Error("В проекте неподдерживаемое изображение.");
  return { settings, imageData, imageName: typeof data.imageName === "string" ? data.imageName.slice(0, 255) : "Экран из проекта" };
}

export async function serializeProject(document: DocumentState): Promise<string> {
  let imageData: string | null = null;
  if (!document.image.demo) {
    const response = await fetch(document.image.url);
    const blob = await response.blob();
    imageData = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Не удалось сохранить изображение в проекте."));
      reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
      reader.readAsDataURL(blob);
    });
  }
  return JSON.stringify({ app: "forma", version: 1, settings: document.settings, imageData, imageName: document.image.name }, null, 2);
}

export function projectDocument(settings: Settings, image: DocumentState["image"] | null): DocumentState {
  return { settings, image: image ?? INITIAL_DOCUMENT.image };
}
