/**
 * Пресеты фонов студии.
 *
 * Каждый пресет — подложка плюс несколько мягких цветовых пятен (mesh-градиент).
 * Пятна рисуются радиальными градиентами на обычном 2D-холсте, без шейдеров:
 * этого достаточно для низкочастотной картинки, а один и тот же код работает и
 * в превью, и в экспорте.
 *
 * Пресеты собраны специально для этого проекта. Идею «библиотеки фонов» мы
 * подсмотрели в Recordly, но ни код, ни обои оттуда не переносились: проект
 * под AGPL-3.0, и такой перенос обязал бы к AGPL всю студию.
 */

export interface BackgroundBlob {
  /** Центр пятна в долях холста. */
  x: number;
  y: number;
  /** Радиус в долях большей стороны. */
  r: number;
  color: string;
  /** Непрозрачность в центре. */
  alpha?: number;
  /** Амплитуда дрейфа в долях холста и период в секундах. */
  drift?: { x: number; y: number; period: number };
}

export interface BackgroundPreset {
  id: string;
  name: string;
  group: string;
  base: string;
  blobs: BackgroundBlob[];
}

/** Дрейф по умолчанию: пятно описывает эллипс за указанный период. */
function drift(x: number, y: number, period: number) {
  return { x, y, period };
}

export const BACKGROUNDS: BackgroundPreset[] = [
  {
    id: "dawn", name: "Рассвет", group: "Тёплые", base: "#ffd9c0",
    blobs: [
      { x: 0.18, y: 0.22, r: 0.62, color: "#ff9e7d", drift: drift(0.07, 0.05, 19) },
      { x: 0.82, y: 0.14, r: 0.5, color: "#ffd98a", drift: drift(-0.06, 0.06, 23) },
      { x: 0.68, y: 0.86, r: 0.66, color: "#f06ba8", alpha: 0.75, drift: drift(0.05, -0.07, 27) },
    ],
  },
  {
    id: "peach", name: "Персик", group: "Тёплые", base: "#fde8dd",
    blobs: [
      { x: 0.26, y: 0.78, r: 0.58, color: "#ffb38a", drift: drift(0.06, -0.05, 21) },
      { x: 0.78, y: 0.3, r: 0.54, color: "#ffd2b0", drift: drift(-0.05, 0.05, 25) },
      { x: 0.5, y: 0.08, r: 0.44, color: "#ff8f6b", alpha: 0.5, drift: drift(0.04, 0.04, 17) },
    ],
  },
  {
    id: "ember", name: "Угли", group: "Тёплые", base: "#2a1410",
    blobs: [
      { x: 0.22, y: 0.76, r: 0.6, color: "#e8552f", alpha: 0.8, drift: drift(0.06, -0.05, 20) },
      { x: 0.8, y: 0.34, r: 0.52, color: "#8f2d4c", alpha: 0.85, drift: drift(-0.05, 0.06, 26) },
      { x: 0.52, y: 0.5, r: 0.38, color: "#f0a04b", alpha: 0.4, drift: drift(0.05, 0.05, 15) },
    ],
  },
  {
    id: "lagoon", name: "Лагуна", group: "Холодные", base: "#cfeef2",
    blobs: [
      { x: 0.2, y: 0.28, r: 0.6, color: "#6fd3e0", drift: drift(0.06, 0.06, 22) },
      { x: 0.84, y: 0.7, r: 0.56, color: "#4b9fe1", drift: drift(-0.06, -0.05, 26) },
      { x: 0.5, y: 0.94, r: 0.46, color: "#a7e8c6", alpha: 0.7, drift: drift(0.05, -0.04, 18) },
    ],
  },
  {
    id: "indigo", name: "Индиго", group: "Холодные", base: "#141a3a",
    blobs: [
      { x: 0.24, y: 0.3, r: 0.64, color: "#3f4fd6", alpha: 0.85, drift: drift(0.07, 0.05, 24) },
      { x: 0.8, y: 0.74, r: 0.58, color: "#7b3fd6", alpha: 0.8, drift: drift(-0.06, -0.06, 29) },
      { x: 0.6, y: 0.12, r: 0.4, color: "#2fb6d6", alpha: 0.45, drift: drift(0.05, 0.05, 16) },
    ],
  },
  {
    id: "mint", name: "Мята", group: "Холодные", base: "#e6f7ef",
    blobs: [
      { x: 0.3, y: 0.24, r: 0.56, color: "#8fe0c0", drift: drift(0.05, 0.06, 20) },
      { x: 0.76, y: 0.68, r: 0.58, color: "#b9e8f0", drift: drift(-0.05, -0.05, 24) },
      { x: 0.5, y: 0.98, r: 0.42, color: "#6fc9a8", alpha: 0.6, drift: drift(0.04, -0.05, 18) },
    ],
  },
  {
    id: "violet", name: "Фиалка", group: "Яркие", base: "#f0e4ff",
    blobs: [
      { x: 0.22, y: 0.2, r: 0.58, color: "#b98cf0", drift: drift(0.06, 0.05, 21) },
      { x: 0.8, y: 0.3, r: 0.5, color: "#f08cc6", drift: drift(-0.05, 0.06, 25) },
      { x: 0.5, y: 0.88, r: 0.62, color: "#8c9ef0", alpha: 0.75, drift: drift(0.05, -0.06, 28) },
    ],
  },
  {
    id: "citrus", name: "Цитрус", group: "Яркие", base: "#fbf4cf",
    blobs: [
      { x: 0.24, y: 0.72, r: 0.56, color: "#ffd84b", drift: drift(0.06, -0.05, 19) },
      { x: 0.78, y: 0.26, r: 0.52, color: "#a8e04b", drift: drift(-0.06, 0.05, 23) },
      { x: 0.5, y: 0.5, r: 0.36, color: "#ff9f43", alpha: 0.45, drift: drift(0.05, 0.05, 15) },
    ],
  },
  {
    id: "graphite", name: "Графит", group: "Нейтральные", base: "#1d1f22",
    blobs: [
      { x: 0.26, y: 0.26, r: 0.62, color: "#3a3f46", drift: drift(0.05, 0.05, 26) },
      { x: 0.78, y: 0.76, r: 0.58, color: "#2a2e34", drift: drift(-0.05, -0.05, 30) },
      { x: 0.62, y: 0.2, r: 0.34, color: "#4d545d", alpha: 0.5, drift: drift(0.04, 0.04, 20) },
    ],
  },
  {
    id: "paper", name: "Бумага", group: "Нейтральные", base: "#f2f0ec",
    blobs: [
      { x: 0.28, y: 0.28, r: 0.6, color: "#ffffff", drift: drift(0.04, 0.04, 28) },
      { x: 0.78, y: 0.74, r: 0.56, color: "#e2ded6", drift: drift(-0.04, -0.04, 32) },
      { x: 0.5, y: 0.5, r: 0.4, color: "#d9d4ca", alpha: 0.4, drift: drift(0.03, 0.03, 22) },
    ],
  },
  {
    id: "midnight", name: "Полночь", group: "Нейтральные", base: "#0c0d10",
    blobs: [
      { x: 0.3, y: 0.32, r: 0.6, color: "#1d2330", drift: drift(0.05, 0.05, 27) },
      { x: 0.76, y: 0.72, r: 0.54, color: "#241d30", drift: drift(-0.05, -0.05, 31) },
      { x: 0.54, y: 0.14, r: 0.34, color: "#2f3a52", alpha: 0.55, drift: drift(0.04, 0.04, 19) },
    ],
  },
  {
    id: "sand", name: "Песок", group: "Нейтральные", base: "#e8dcc8",
    blobs: [
      { x: 0.24, y: 0.74, r: 0.58, color: "#d6c3a2", drift: drift(0.05, -0.04, 24) },
      { x: 0.8, y: 0.28, r: 0.54, color: "#f2e8d6", drift: drift(-0.05, 0.05, 27) },
      { x: 0.52, y: 0.46, r: 0.36, color: "#c2a97f", alpha: 0.4, drift: drift(0.04, 0.04, 20) },
    ],
  },
];

export function backgroundPreset(id: string): BackgroundPreset {
  return BACKGROUNDS.find((item) => item.id === id) ?? BACKGROUNDS[0];
}

/**
 * Рисует пресет на холст. `seconds` сдвигает пятна по их орбитам; для
 * статичного фона передавайте 0. Холст заполняется целиком, поэтому size
 * может быть любым — и 64 пикселя для превью, и 512 для сцены.
 */
export function paintBackground(context: CanvasRenderingContext2D, preset: BackgroundPreset, size: number, seconds = 0) {
  context.fillStyle = preset.base;
  context.fillRect(0, 0, size, size);
  // Пятна кладутся поверх подложки с мягким краем: альфа радиального градиента
  // уходит в ноль, поэтому границы между ними не видно.
  for (const blob of preset.blobs) {
    const phase = blob.drift ? (seconds / blob.drift.period) * Math.PI * 2 : 0;
    const x = (blob.x + (blob.drift ? Math.cos(phase) * blob.drift.x : 0)) * size;
    const y = (blob.y + (blob.drift ? Math.sin(phase) * blob.drift.y : 0)) * size;
    const radius = blob.r * size;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = blob.alpha ?? 0.9;
    gradient.addColorStop(0, withAlpha(blob.color, alpha));
    gradient.addColorStop(0.55, withAlpha(blob.color, alpha * 0.45));
    gradient.addColorStop(1, withAlpha(blob.color, 0));
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
}

/** #rrggbb плюс альфа в формате, который понимает canvas. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Тот же пресет в виде значения CSS background. Нужен миниатюрам в панели:
 * холста там нет, а на сервере его и не может быть — компонент
 * предрисовывается до гидратации.
 */
export function backgroundCss(preset: BackgroundPreset): string {
  const layers = preset.blobs.map((blob) => {
    const alpha = blob.alpha ?? 0.9;
    const x = (blob.x * 100).toFixed(1), y = (blob.y * 100).toFixed(1);
    return `radial-gradient(circle at ${x}% ${y}%, ${withAlpha(blob.color, alpha)} 0%, ${withAlpha(blob.color, alpha * 0.45)} ${(blob.r * 55).toFixed(1)}%, ${withAlpha(blob.color, 0)} ${(blob.r * 100).toFixed(1)}%)`;
  });
  return `${layers.join(", ")}, ${preset.base}`;
}
