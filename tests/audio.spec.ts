import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { audioWindow, normalizeAudio, type AudioClip } from "../src/lib/audio";
import { parseProject } from "../src/lib/project";

function tone() {
  const rate = 16000, count = rate * 2, bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * 2 * Math.PI * 440) * 14000), 44 + i * 2);
  return bytes;
}
async function save(page: Page, button: string) {
  const download = page.waitForEvent("download");
  const scope = button === "Экспортировать" ? page.getByRole("dialog", { name: "Экспорт анимации" }) : page;
  await scope.getByRole("button", { name: button, exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error("Нет файла");
  return readFile(path);
}

test("аудио: обрезка, положение и конец сцены задают один интервал звучания", () => {
  const clip: AudioClip = { url: "", name: "", duration: 12, offset: 2, start: 3, end: 9, volume: 75, muted: false };
  expect(audioWindow(clip, 0, 5)).toEqual({ delay: 2, offset: 3, length: 3 });
  expect(audioWindow(clip, 3, 10)).toEqual({ delay: 0, offset: 4, length: 5 });
  expect(audioWindow(clip, 9, 10).length).toBe(0);
  expect(normalizeAudio({ ...clip, volume: 200, offset: -1, end: 100 })).toMatchObject({ volume: 100, offset: 0, end: 12 });
});

test("аудио: дорожка, правки, проект и настоящий звук в экспортированном WebM", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Скачать PNG" })).toBeEnabled();
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  await page.getByRole("button", { name: "Анимация", exact: true }).click();
  await expect(page.getByRole("button", { name: "Добавить аудио" })).toBeVisible();
  await page.getByLabel("Файл аудио", { exact: true }).setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: tone() });
  await expect(page.getByRole("button", { name: "Аудиоклип: tone.wav", exact: true })).toBeVisible();
  await expect(page.locator(".audio-clip svg path")).toHaveCount(100);
  const set = async (label: string, value: string) => {
    const input = page.getByRole("spinbutton", { name: label, exact: true });
    await input.fill(value); await input.press("Enter");
  };
  await set("Начало на таймлайне", "0.3"); await set("Начало в файле", "0.2"); await set("Конец в файле", "1.2"); await set("Громкость", "50");
  const duration = page.getByLabel("Длительность", { exact: true });
  await duration.fill("1.5"); await duration.press("Enter");
  const project = await save(page, "Сохранить проект (Ctrl+S)");
  expect(parseProject(project.toString("utf8")).audio).toMatchObject({ offset: 0.3, start: 0.2, end: 1.2, volume: 50, muted: false, duration: 2 });
  expect(parseProject(project.toString("utf8")).audio?.url).toMatch(/^data:audio\/wav;base64,/);
  await page.getByRole("button", { name: "Удалить аудио", exact: true }).click();
  await expect(page.locator(".audio-clip")).toHaveCount(0);
  await page.keyboard.press("Control+z"); await expect(page.locator(".audio-clip")).toHaveCount(1);
  await page.getByLabel("Файл изображения, видео или проекта", { exact: true }).setInputFiles({ name: "audio.forma.json", mimeType: "application/json", buffer: project });
  await expect(page.locator(".audio-clip svg path")).toHaveCount(100);
  await page.getByLabel("Рабочая область", { exact: true }).focus(); await page.keyboard.press("Control+Shift+E");
  const dialog = page.getByRole("dialog", { name: "Экспорт анимации" });
  await expect(dialog).toContainText("Включено");
  const webm = await save(page, "Экспортировать");
  expect(webm.includes(Buffer.from("A_OPUS"))).toBe(true);
  const signal = await page.evaluate(async (base64) => {
    const context = new AudioContext();
    try {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const buffer = await context.decodeAudioData(bytes.buffer);
      const data = buffer.getChannelData(0);
      const rms = (from: number, to: number) => {
        let sum = 0, count = 0;
        for (let i = Math.floor(from * buffer.sampleRate); i < Math.min(data.length, to * buffer.sampleRate); i++) { sum += data[i] ** 2; count++; }
        return Math.sqrt(sum / Math.max(1, count));
      };
      return { duration: buffer.duration, before: rms(0.03, 0.15), during: rms(0.6, 0.9) };
    } finally { await context.close(); }
  }, webm.toString("base64"));
  expect(signal.duration).toBeGreaterThan(1.3);
  expect(signal.before).toBeLessThan(0.005);
  expect(signal.during).toBeGreaterThan(0.05);
  expect(signal.during).toBeLessThan(0.25);
  expect(errors).toEqual([]);
});
