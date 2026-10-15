import * as THREE from "three";

interface HSL { h: number; s: number; l: number }

const HUE_RANGE = 0.08;
const MIN_SATURATION = 0.18;

function hsl(hex: string): HSL {
  const target = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(target, THREE.SRGBColorSpace);
  return target;
}

/**
 * Насколько цвет относится к перекрашиваемому оттенку, от 0 до 1. Граница
 * плавная, иначе на переходах тени и блика остаётся ореол старого цвета.
 */
function weight(color: HSL, from: HSL) {
  const distance = Math.abs(((color.h - from.h + 1.5) % 1) - 0.5);
  const hue = 1 - THREE.MathUtils.smoothstep(distance, HUE_RANGE * 0.6, HUE_RANGE);
  const saturation = THREE.MathUtils.smoothstep(color.s, MIN_SATURATION * 0.5, MIN_SATURATION);
  return hue * saturation;
}

/** Переносит цвет на новый оттенок, сохраняя его светлоту и насыщенность относительно исходного. */
function shift(color: HSL, from: HSL, to: HSL): HSL {
  return {
    h: to.h,
    s: THREE.MathUtils.clamp(to.s * color.s / Math.max(from.s, 0.01), 0, 1),
    l: THREE.MathUtils.clamp(color.l * to.l / Math.max(from.l, 0.01), 0, 1),
  };
}

/** HSL пикселя холста; каналы уже в sRGB, поэтому без преобразований three.js. */
function pixelHSL(r: number, g: number, b: number, out: HSL) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  out.l = l;
  if (d === 0) { out.h = 0; out.s = 0; return out; }
  out.s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  out.h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  return out;
}

function channel(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

async function recolorTexture(texture: THREE.Texture, from: HSL, to: HSL) {
  const image = texture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!image?.width || !image.height) return;
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = data.data;
  const current: HSL = { h: 0, s: 0, l: 0 };
  let changed = false;
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index] / 255, g = pixels[index + 1] / 255, b = pixels[index + 2] / 255;
    const amount = weight(pixelHSL(r, g, b, current), from);
    if (amount <= 0) continue;
    const { h, s, l } = shift(current, from, to);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    pixels[index] += (channel(p, q, h + 1 / 3) * 255 - pixels[index]) * amount;
    pixels[index + 1] += (channel(p, q, h) * 255 - pixels[index + 1]) * amount;
    pixels[index + 2] += (channel(p, q, h - 1 / 3) * 255 - pixels[index + 2]) * amount;
    changed = true;
  }
  if (!changed) return;
  context.putImageData(data, 0, 0);
  // Тот же порядок строк, что у исходного ImageBitmap: настройки текстуры не меняются.
  texture.image = await createImageBitmap(canvas);
  texture.needsUpdate = true;
}

/**
 * Перекрашивает корпус в цвет, которого нет отдельным файлом: меняет оттенок
 * `from` на `to` в цвете материалов и в их базовых текстурах.
 */
export async function recolor(root: THREE.Object3D, fromHex: string, toHex: string) {
  const from = hsl(fromHex), to = hsl(toHex);
  const materials = new Set<THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material instanceof THREE.MeshStandardMaterial) materials.add(material);
  });
  const textures = new Set<THREE.Texture>();
  const current: HSL = { h: 0, s: 0, l: 0 };
  for (const material of materials) {
    material.color.getHSL(current, THREE.SRGBColorSpace);
    const amount = weight(current, from);
    if (amount > 0) {
      const next = shift(current, from, to);
      material.color.lerp(new THREE.Color().setHSL(next.h, next.s, next.l, THREE.SRGBColorSpace), amount);
    }
    if (material.map) textures.add(material.map);
  }
  await Promise.all([...textures].map((texture) => recolorTexture(texture, from, to)));
}
