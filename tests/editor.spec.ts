import { openSection } from "./inspector";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject } from "../src/lib/project";
import { decodePNG } from "./png";

async function ready(page: Page) { await expect(page.getByRole("button", { name: "Скачать PNG" })).toBeEnabled(); }
async function start(page: Page) { await page.goto("/"); await ready(page); }

const field = (page: Page, section: string, name: string) => page.locator(`[data-section="${section}"]`).getByRole("spinbutton", { name, exact: true });
async function setField(page: Page, section: string, name: string, value: string) {
  const input = field(page, section, name);
  await input.fill(value); await input.press("Enter");
}
async function seek(page: Page, value: string) {
  const time = page.getByLabel("Текущее время", { exact: true });
  await time.fill(value); await time.press("Enter");
}
async function download(page: Page, action: () => Promise<void>) {
  const file = page.waitForEvent("download");
  await action();
  const path = await (await file).path();
  if (!path) throw new Error("Файл не сохранён");
  return readFile(path);
}

test("тень: пресеты, своя форма и цвет попадают в PNG и проект", async ({ page }) => {
  await start(page);
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  await openSection(page, "Фон");
  await page.getByRole("button", { name: "Без фона", exact: true }).click();
  await openSection(page, "Тень");
  await page.getByRole("combobox", { name: "Вид тени", exact: true }).click();
  await page.getByRole("option", { name: "Длинная", exact: true }).click();
  await expect(field(page, "shadow", "Длина тени")).toHaveValue("85");
  // Ручная правка формы делает тень «Своей».
  await setField(page, "shadow", "Плотность тени", "80");
  await expect(page.getByRole("combobox", { name: "Вид тени", exact: true })).toContainText("Своя");
  await page.locator('[data-section="shadow"]').getByRole("button", { name: "Свой", exact: true }).click();
  const hex = page.getByLabel("Цвет тени, HEX", { exact: true });
  await hex.fill("#1E3AD8"); await hex.blur();
  const png = decodePNG(await download(page, () => page.getByRole("button", { name: "Скачать PNG" }).click()));
  // Тень на прозрачном фоне: полупрозрачные пиксели вне устройства синие, а не серые.
  let blue = 0, grey = 0;
  for (let y = 0; y < png.height; y += 6) for (let x = 0; x < png.width; x += 6) {
    const [r, , b, a] = png.pixel(x, y);
    if (a > 20 && a < 200) { if (b > r + 40) blue++; else grey++; }
  }
  expect(blue).toBeGreaterThan(grey);
  const project = parseProject((await download(page, () => page.getByRole("button", { name: "Сохранить проект (Ctrl+S)", exact: true }).click())).toString("utf8"));
  expect(project.settings.shadow).toMatchObject({ preset: "custom", opacity: 80, length: 85, tint: "custom", color: "#1e3ad8" });
  // Цвет и переключатель «Свой» — два отдельных шага отмены.
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Цвет тени, HEX", { exact: true })).toHaveValue("#000000");
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Цвет тени, HEX", { exact: true })).toHaveCount(0);
});

test.describe("буфер обмена", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("Ctrl+Shift+E в изображении копирует прозрачный PNG и не скачивает файл", async ({ page }) => {
    let downloads = 0;
    page.on("download", () => { downloads++; });
    await start(page);
    await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
    await page.getByLabel("Рабочая область", { exact: true }).focus();
    await page.keyboard.press("Control+Shift+E");
    await expect(page.locator(".toast")).toContainText("Мокап скопирован");
    const clip = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      const blob = await item.getType("image/png");
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
      return { types: item.types, size: [bitmap.width, bitmap.height], corner: pixel(4, 4), center: pixel(bitmap.width >> 1, bitmap.height >> 1) };
    });
    expect(clip.types).toContain("image/png");
    expect(clip.size).toEqual([1200, 900]);
    // Фон сцены светлый, но в буфер он не попадает; устройство непрозрачно.
    expect(clip.corner[3]).toBe(0);
    expect(clip.center[3]).toBe(255);
    expect(downloads).toBe(0);
  });
});

test("положение устройства: поля, манипулятор и отмена жеста одним шагом", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await openSection(page, "Положение");
  await setField(page, "position", "Поворот Y", "30");
  await expect(field(page, "position", "Поворот Y")).toHaveValue("30");
  await page.keyboard.press("Control+z");
  await expect(field(page, "position", "Поворот Y")).toHaveValue("0");
  // Перемещение: центральная ручка двигает устройство в плоскости кадра, камера стоит.
  const workspace = page.getByLabel("Рабочая область", { exact: true });
  await workspace.focus(); await page.keyboard.press("w");
  await expect(page.getByRole("button", { name: "Перемещение (W)" })).toHaveAttribute("aria-pressed", "true");
  const board = await page.getByTestId("artboard").boundingBox();
  if (!board) throw new Error("Нет кадра");
  const [cx, cy] = [board.x + board.width / 2, board.y + board.height / 2];
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + 60, cy, { steps: 6 }); await page.mouse.move(cx + 120, cy, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await field(page, "position", "Положение X").inputValue())).toBeGreaterThan(0.3);
  await openSection(page, "Камера");
  await expect(field(page, "camera", "Поворот")).toHaveValue("0");
  await page.keyboard.press("Control+z");
  await openSection(page, "Положение");
  await expect(field(page, "position", "Положение X")).toHaveValue("0");
  const project = parseProject((await download(page, async () => { await page.keyboard.press("Control+Shift+z"); await page.getByRole("button", { name: "Сохранить проект (Ctrl+S)", exact: true }).click(); })).toString("utf8"));
  expect(project.settings.transform.x).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("анимация: автоключи, кривая участка, Shift-привязка курсора и проект", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  const canvas = page.locator(".render-surface canvas");
  await canvas.evaluate((element) => { (element as HTMLCanvasElement & { marker?: number }).marker = 7; });
  await page.getByRole("button", { name: "Анимация", exact: true }).click();
  await expect(page.getByRole("region", { name: "Таймлайн" })).toBeVisible();
  // Смена режима не пересоздаёт 3D-сцену.
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement & { marker?: number }).marker)).toBe(7);
  await openSection(page, "Камера");
  await seek(page, "1");
  await setField(page, "camera", "Поворот", "40");
  // Первое изменение не в начале ролика ставит ключ «было» в нуле и «стало» здесь.
  await expect(page.locator(".timeline-row.object .timeline-key")).toHaveCount(2);
  await seek(page, "0,5");
  await expect(field(page, "camera", "Поворот")).toHaveValue("20");
  await page.locator(".timeline-row.object .timeline-segment").first().click();
  await expect(page.locator(".animation-panel")).toContainText("Участок · поворот");
  await page.getByRole("button", { name: "Линейно", exact: true }).click();
  await openSection(page, "Камера");
  await seek(page, "0,25");
  await expect(field(page, "camera", "Поворот")).toHaveValue("10");
  // Shift при перетаскивании курсора прилипает к ключу.
  const ruler = await page.getByRole("slider", { name: "Курсор времени" }).boundingBox();
  if (!ruler) throw new Error("Нет шкалы");
  const key = await page.locator(".timeline-row.object .timeline-key").nth(1).boundingBox();
  if (!key) throw new Error("Нет ключа");
  await page.mouse.move(ruler.x + 40, ruler.y + ruler.height / 2);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(key.x + key.width / 2 + 5, ruler.y + ruler.height / 2, { steps: 5 });
  await expect(page.locator(".timeline-bubble")).toContainText("1,00");
  await page.mouse.up(); await page.keyboard.up("Shift");
  await expect(page.getByLabel("Текущее время", { exact: true })).toHaveValue("1,00");
  // Space в анимации — пуск и пауза.
  await page.getByLabel("Рабочая область", { exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Пауза" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Воспроизвести" })).toBeVisible();
  const project = parseProject((await download(page, () => page.getByRole("button", { name: "Сохранить проект (Ctrl+S)", exact: true }).click())).toString("utf8"));
  expect(project.animation.tracks["camera.azimuth"]?.map((item) => [item.time, item.value])).toEqual([[0, 0], [1, 40]]);
  expect(project.animation.tracks["camera.azimuth"]?.[0].ease).toBe("linear");
  expect(errors).toEqual([]);
});

test("движение камеры: выбор из списка, смена и отмена одним шагом", async ({ page }) => {
  await start(page);
  await page.getByRole("button", { name: "Анимация", exact: true }).click();
  const moves = page.getByRole("combobox", { name: "Движение камеры", exact: true });
  await expect(moves).toContainText("Без движения");
  await moves.click();
  // Список длиннее окна: последнее движение доступно прокруткой.
  await page.getByRole("option", { name: "Акцент с поворотом", exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole("option", { name: "Отъезд от экрана", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Камера переключена на перспективу");
  await expect(moves).toContainText("Отъезд от экрана");
  await expect(page.locator(".timeline-row.object .timeline-key")).toHaveCount(2);
  await openSection(page, "Камера");
  await expect(page.getByRole("button", { name: "Перспектива", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Другое движение заменяет прежнее, а не добавляется к нему.
  await moves.click();
  await expect(page.getByRole("option", { name: "Отъезд от экрана", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("option", { name: "Акцент на экране", exact: true }).click();
  await expect(moves).toContainText("Акцент на экране");
  await expect(page.locator(".timeline-row.object .timeline-key")).toHaveCount(3);
  await moves.click();
  await page.getByRole("option", { name: "Без движения", exact: true }).click();
  await expect(moves).toContainText("Без движения");
  await expect(page.locator(".timeline-key")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ортография", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+z");
  await expect(moves).toContainText("Акцент на экране");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect(page.locator(".timeline-key")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ортография", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("экспорт анимации: окно по Ctrl+Shift+E и кадры PNG с прозрачностью", async ({ page }) => {
  await start(page);
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  await page.getByRole("button", { name: "Анимация", exact: true }).click();
  const duration = page.getByLabel("Длительность", { exact: true });
  await duration.fill("0,5"); await duration.press("Enter");
  await page.getByLabel("Рабочая область", { exact: true }).focus();
  await page.keyboard.press("Control+Shift+E");
  const dialog = page.getByRole("dialog", { name: "Экспорт анимации" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "MP4", exact: true }).click();
  // MP4 не хранит прозрачность: переключатель недоступен.
  await expect(dialog.getByRole("checkbox", { name: /Прозрачный фон/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "Кадры PNG", exact: true }).click();
  await dialog.locator(".switch-row").click();
  await dialog.getByLabel("Кадров в секунду", { exact: true }).selectOption("24");
  await expect(dialog).toContainText("12 кадров");
  const zip = await download(page, () => dialog.getByRole("button", { name: /Экспортировать/ }).click());
  const frames: Buffer[] = [];
  for (let offset = 0; offset + 30 < zip.length && zip.readUInt32LE(offset) === 0x04034b50;) {
    const size = zip.readUInt32LE(offset + 18), name = zip.readUInt16LE(offset + 26);
    frames.push(zip.subarray(offset + 30 + name, offset + 30 + name + size));
    offset += 30 + name + size;
  }
  expect(frames).toHaveLength(12);
  const first = decodePNG(frames[0]);
  expect([first.width, first.height]).toEqual([1200, 900]);
  expect(first.pixel(4, 4)[3]).toBe(0);
  expect(first.pixel(600, 450)[3]).toBe(255);
  await expect(dialog).toBeHidden();
  await expect(page.locator(".toast")).toContainText("12 PNG");
});

test("кадр не уходит за рабочую область, но увеличенный двигается", async ({ page }) => {
  await start(page);
  const board = page.getByTestId("artboard"), workspace = page.getByLabel("Рабочая область", { exact: true });
  await workspace.focus();
  for (let step = 0; step < 6; step++) await page.keyboard.press("Minus");
  await expect.poll(async () => Number(await board.getAttribute("data-view-zoom"))).toBeGreaterThanOrEqual(0.5);
  // Пока кадр помещается целиком, рука его не сдвигает.
  const bounds = await board.boundingBox(); if (!bounds) throw new Error("Нет кадра");
  await page.keyboard.down("Space");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 200, bounds.y + bounds.height / 2 + 150, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(board).toHaveAttribute("data-view-x", "0.0");
  await expect(page.locator(".frame-label")).toContainText("4:3");
});
