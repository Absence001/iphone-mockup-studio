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

/**
 * Снимок сайта или фрейма Figma ровно в размер экрана модели. Для ноутбука
 * и монитора сайт открывается в настольной вёрстке.
 */
export async function captureLink(link: string, width: number, height: number, desktop = false): Promise<File> {
  let response: Response;
  try {
    response = await fetch("/api/capture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: link, width, height, desktop }) });
  } catch { throw new Error("Нет связи с сервером. Проверьте подключение и попробуйте ещё раз."); }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Не удалось получить снимок по ссылке.";
    throw new Error(message);
  }
  const name = decodeURIComponent(response.headers.get("X-Capture-Name") ?? "") || "Снимок по ссылке";
  return new File([await response.blob()], `${name}.png`, { type: "image/png" });
}

/** Figma кладёт в буфер свои данные слоя в HTML, а не картинку. */
export function isFigmaClipboard(html: string) {
  return html.includes("(figmeta)") || html.includes("(figma)");
}
