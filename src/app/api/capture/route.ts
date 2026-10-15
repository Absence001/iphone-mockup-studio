import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { chromium, devices, type Browser, type Page } from "playwright-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Плотность пикселей iPhone Pro Max: 1290 px экрана — это 430 pt вёрстки. */
const PIXEL_RATIO = 3;
/** Retina у MacBook и Pro Display XDR: 3024 px экрана — это 1512 pt. */
const DESKTOP_PIXEL_RATIO = 2;

class CaptureError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function size(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new CaptureError("Неверный размер экрана.");
  return value;
}

function privateAddress(address: string) {
  const ip = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224;
  }
  return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}

/**
 * На сервере в интернете ссылки на внутреннюю сеть закрыты: иначе через
 * снимок можно заглянуть в инфраструктуру хостинга. Локально такие адреса
 * разрешены, чтобы снимать сайт с localhost во время разработки.
 */
async function assertPublicHost(hostname: string) {
  if (!process.env.VERCEL) return;
  const host = hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try { addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address); }
  catch { throw new CaptureError("Сайт не найден. Проверьте адрес."); }
  if (!addresses.length || addresses.some(privateAddress)) throw new CaptureError("Адреса внутренней сети недоступны. Укажите публичный сайт.");
}

async function launch(): Promise<Browser> {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const { default: lambda } = await import("@sparticuz/chromium");
    return chromium.launch({ args: lambda.args, executablePath: await lambda.executablePath(), headless: true });
  }
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH });
  for (const options of [{}, { channel: "chrome" }, { channel: "msedge" }]) {
    try { return await chromium.launch(options); } catch { /* пробуем следующий браузер */ }
  }
  throw new CaptureError("Не найден браузер для снимка сайта. Установите Chrome или Edge либо выполните npx playwright install chromium.", 500);
}

/**
 * Предпросмотр всей страницы для выбора места снимка. Он идёт по 1 px на
 * CSS-пиксель и в JPEG, чтобы длинная страница уложилась в лимит ответа.
 */
const PREVIEW_MAX_HEIGHT = 12000;

/**
 * Пролистывает страницу до конца предпросмотра: так подгружаются ленивые
 * картинки и срабатывают анимации появления. Предпросмотр и итоговый снимок
 * готовят страницу одинаково, чтобы выбранное место совпало.
 */
async function warmUp(page: Page) {
  await page.evaluate(async (max) => {
    const bottom = Math.min(document.documentElement.scrollHeight, max);
    for (let y = window.innerHeight; y < bottom; y += window.innerHeight) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, PREVIEW_MAX_HEIGHT).catch(() => {});
}

/** Догружаем шрифты и картинки, но не ждём бесконечно сайты с постоянными запросами: аналитику, чаты, видео. */
async function settle(page: Page, delay: number) {
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(delay);
}

/**
 * Без scrollY возвращает предпросмотр всей страницы, с ним — снимок экрана
 * в полном разрешении, прокрученного на scrollY CSS-пикселей.
 */
async function captureSite(url: URL, width: number, height: number, desktop: boolean, scrollY: number | null) {
  await assertPublicHost(url.hostname);
  const browser = await launch();
  try {
    const ratio = desktop ? DESKTOP_PIXEL_RATIO : PIXEL_RATIO;
    const viewport = { width: Math.round(width / ratio), height: Math.round(height / ratio) };
    const context = await browser.newContext({
      ...(desktop ? {} : { userAgent: devices["iPhone 15 Pro Max"].userAgent, isMobile: true, hasTouch: true }),
      viewport, deviceScaleFactor: ratio, locale: "ru-RU",
    });
    const page = await context.newPage();
    let response;
    try { response = await page.goto(url.href, { waitUntil: "load", timeout: 25000 }); }
    catch { throw new CaptureError("Сайт не открылся за 25 секунд. Проверьте адрес или попробуйте позже.", 502); }
    if (response && response.status() >= 400) throw new CaptureError(`Сайт ответил ошибкой ${response.status()}.`, 502);
    await settle(page, 0);
    await warmUp(page);
    const name = url.hostname.replace(/^www\./, "");
    if (scrollY === null) {
      await settle(page, 300);
      const pageHeight = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
      const previewHeight = Math.max(viewport.height, Math.min(pageHeight, PREVIEW_MAX_HEIGHT));
      const image = await page.screenshot({ type: "jpeg", quality: 72, scale: "css", fullPage: true, clip: { x: 0, y: 0, width: viewport.width, height: previewHeight } });
      return { image, name, type: "image/jpeg", viewport };
    }
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), scrollY);
    await settle(page, 600);
    const image = await page.screenshot({ type: "png" });
    return { image, name, type: "image/png", viewport };
  } finally { await browser.close(); }
}

/** Ключ файла и узел из ссылки вида figma.com/design/KEY/Name?node-id=1-2. */
function figmaTarget(url: URL) {
  const parts = url.pathname.split("/").filter(Boolean);
  if (!["design", "file", "proto", "board"].includes(parts[0]) || !parts[1]) throw new CaptureError("Не удалось разобрать ссылку Figma. Скопируйте ссылку на фрейм: правый клик → Copy link to selection.");
  const key = parts[2] === "branch" && parts[3] ? parts[3] : parts[1];
  const node = url.searchParams.get("node-id")?.replace(/-/g, ":");
  if (!node || node === "0:1") throw new CaptureError("В ссылке нет фрейма. Выделите фрейм в Figma, нажмите правой кнопкой → Copy link to selection и вставьте ссылку снова.");
  return { key, node };
}

async function figmaJSON(path: string, token: string) {
  const response = await fetch(`https://api.figma.com/v1/${path}`, { headers: { "X-Figma-Token": token }, cache: "no-store" });
  if (response.status === 403) throw new CaptureError("Нет доступа к файлу Figma. Проверьте, что токен FIGMA_TOKEN открывает этот файл.", 403);
  if (response.status === 404) throw new CaptureError("Файл Figma не найден. Проверьте ссылку.", 404);
  if (response.status === 429) throw new CaptureError("Figma ограничила частоту запросов. Попробуйте через минуту.", 429);
  if (!response.ok) throw new CaptureError("Figma не ответила. Попробуйте ещё раз.", 502);
  return response.json() as Promise<Record<string, unknown>>;
}

async function captureFigma(url: URL, width: number) {
  const token = process.env.FIGMA_TOKEN;
  if (!token) throw new CaptureError("Вставка по ссылке Figma не настроена: добавьте FIGMA_TOKEN в переменные окружения. Пока можно выделить фрейм, нажать Shift+⌘+C (Copy as PNG) и вставить его сюда через ⌘V.");
  const { key, node } = figmaTarget(url);
  const nodes = await figmaJSON(`files/${key}/nodes?ids=${encodeURIComponent(node)}&depth=1`, token) as { nodes?: Record<string, { document?: { name?: string; absoluteBoundingBox?: { width?: number } } } | null> };
  const frame = nodes.nodes?.[node]?.document;
  const frameWidth = frame?.absoluteBoundingBox?.width;
  if (!frame || !frameWidth) throw new CaptureError("Фрейм не найден в файле Figma. Скопируйте ссылку на фрейм заново.", 404);
  // Фрейм рендерится сразу в ширину экрана телефона: 430 pt превращаются в
  // 1290 px без растяжения картинки в браузере. Figma ограничивает масштаб 4×.
  const scale = Math.min(4, Math.max(0.01, width / frameWidth));
  const images = await figmaJSON(`images/${key}?ids=${encodeURIComponent(node)}&format=png&scale=${scale.toFixed(4)}`, token) as { images?: Record<string, string | null> };
  const source = images.images?.[node];
  if (!source) throw new CaptureError("Figma не смогла отрисовать фрейм. Проверьте, что он не пустой и не скрыт.", 502);
  const response = await fetch(source, { cache: "no-store" });
  if (!response.ok) throw new CaptureError("Не удалось скачать картинку фрейма из Figma.", 502);
  return { image: Buffer.from(await response.arrayBuffer()), name: frame.name || "Фрейм Figma", type: "image/png", viewport: null };
}

export async function POST(request: Request) {
  try {
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { throw new CaptureError("Неверный запрос."); }
    // Экран ноутбука и монитора шире телефонного: до 2796 px по длинной стороне.
    const width = size(body.width, 200, 3000), height = size(body.height, 200, 4000);
    let url: URL;
    try { url = new URL(String(body.url)); } catch { throw new CaptureError("Это не похоже на ссылку. Вставьте адрес вида https://example.com."); }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new CaptureError("Поддерживаются только ссылки http и https.");
    const figma = /(^|\.)figma\.com$/i.test(url.hostname);
    // Без scrollY сайт возвращается предпросмотром всей страницы.
    const scrollY = body.scrollY === undefined ? null : body.scrollY;
    if (scrollY !== null && (typeof scrollY !== "number" || !Number.isInteger(scrollY) || scrollY < 0 || scrollY > PREVIEW_MAX_HEIGHT)) throw new CaptureError("Неверное место на странице.");
    const { image, name, type, viewport } = figma ? await captureFigma(url, width) : await captureSite(url, width, height, body.desktop === true, scrollY);
    const headers: Record<string, string> = { "Content-Type": type, "Cache-Control": "no-store", "X-Capture-Name": encodeURIComponent(name.slice(0, 120)) };
    if (viewport) { headers["X-Viewport-Width"] = String(viewport.width); headers["X-Viewport-Height"] = String(viewport.height); }
    return new Response(new Uint8Array(image), { headers });
  } catch (error) {
    if (error instanceof CaptureError) return fail(error.message, error.status);
    console.error(error);
    return fail("Не удалось получить снимок по ссылке. Попробуйте ещё раз.", 500);
  }
}
