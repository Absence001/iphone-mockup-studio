/**
 * Превращает вставленный текст в ссылку. Адрес без протокола вроде
 * example.com/pricing дополняется https://, остальной текст отбрасывается.
 */
export function normalizeLink(text: string): string | null {
  const value = text.trim();
  if (!value || /\s/.test(value)) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : /^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i.test(value) ? `https://${value}` : null;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

export function isFigmaLink(link: string) {
  try { return /(^|\.)figma\.com$/i.test(new URL(link).hostname); } catch { return false; }
}

async function requestCapture(body: Record<string, unknown>): Promise<Response> {
  let response: Response;
  try {
    response = await fetch("/api/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { throw new Error("Нет связи с сервером. Проверьте подключение и попробуйте ещё раз."); }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Не удалось получить снимок по ссылке.";
    throw new Error(message);
  }
  return response;
}

function captureName(response: Response) {
  return decodeURIComponent(response.headers.get("X-Capture-Name") ?? "") || "Снимок по ссылке";
}

/**
 * Снимок сайта или фрейма Figma ровно в размер экрана модели. Для ноутбука
 * и монитора сайт открывается в настольной вёрстке. scrollY — место на
 * странице в CSS-пикселях, выбранное в предпросмотре.
 */
export async function captureLink(link: string, width: number, height: number, desktop = false, scrollY?: number): Promise<File> {
  const response = await requestCapture({ url: link, width, height, desktop, scrollY });
  return new File([await response.blob()], `${captureName(response)}.png`, { type: "image/png" });
}

export interface PagePreview {
  /** Object URL картинки всей страницы, по 1 px на CSS-пиксель. */
  url: string;
  name: string;
  /** Окно браузера, в котором будет сделан снимок, в CSS-пикселях. */
  viewport: { width: number; height: number };
}

/** Вся страница целиком, чтобы выбрать, какой её экран снять. */
export async function previewLink(link: string, width: number, height: number, desktop = false): Promise<PagePreview> {
  const response = await requestCapture({ url: link, width, height, desktop });
  const viewport = { width: Number(response.headers.get("X-Viewport-Width")), height: Number(response.headers.get("X-Viewport-Height")) };
  if (!viewport.width || !viewport.height) throw new Error("Не удалось получить снимок по ссылке.");
  return { url: URL.createObjectURL(await response.blob()), name: captureName(response), viewport };
}

/** Figma кладёт в буфер свои данные слоя в HTML, а не картинку. */
export function isFigmaClipboard(html: string) {
  return html.includes("(figmeta)") || html.includes("(figma)");
}
