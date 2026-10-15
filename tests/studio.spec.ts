import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { historyReducer, INITIAL_HISTORY } from "../src/lib/history";
import { parseProject } from "../src/lib/project";
import { decodePNG, testImage } from "./png";

async function ready(page: Page) { await expect(page.getByRole("button", { name: "Скачать мокап" })).toBeEnabled(); }
async function start(page: Page) { await page.goto("/"); await ready(page); }
async function choose(page: Page, label: string, name: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}
async function preset(page: Page, name: string) { await choose(page, "Ракурс", name); }
async function device(page: Page, id: "iphone15" | "iphone18") { await choose(page, "Модель телефона", id === "iphone15" ? "iPhone 15 Pro Max" : "iPhone 18 Pro Max"); }
async function exportPNG(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать мокап" }).click();
  const file = await download, path = await file.path();
  if (!path) throw new Error("PNG не сохранён");
  await ready(page);
  return readFile(path);
}

test("история объединяет жест и сохраняет ветви отмены, повтора и проекта", () => {
  const change = (focalLength: number) => (current: typeof INITIAL_HISTORY.present) => ({ ...current, settings: { ...current.settings, camera: { ...current.settings.camera, focalLength } } });
  let state = historyReducer(INITIAL_HISTORY, { type: "change", recipe: change(30), group: "lens", time: 1 });
  state = historyReducer(state, { type: "change", recipe: change(40), group: "lens", time: 100 });
  expect(state.past).toHaveLength(1);
  state = historyReducer(state, { type: "undo" });
  expect(state.present.settings.camera.focalLength).toBe(55);
  state = historyReducer(state, { type: "redo" });
  expect(state.present.settings.camera.focalLength).toBe(40);
  state = historyReducer(state, { type: "undo" });
  state = historyReducer(state, { type: "change", recipe: change(60), time: 200 });
  expect(state.future).toHaveLength(0);
  expect(() => parseProject(JSON.stringify({ app: "forma", version: 1, settings: { ...INITIAL_HISTORY.present.settings, camera: { ...INITIAL_HISTORY.present.settings.camera, focalLength: "не число" } }, imageData: null }))).toThrow();
});

test("прямой ракурс по умолчанию, темы без ошибок React и независимый PNG", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(`${message.text()} (${message.location().url})`);
  });
  await start(page);
  await expect(page.locator("html")).toHaveClass("dark");
  await expect(page.getByRole("combobox", { name: "Ракурс", exact: true })).toContainText("Прямо");
  await expect(page.getByRole("button", { name: "Ортография", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Поворот", "Наклон", "Крен"]) await expect(page.getByRole("spinbutton", { name, exact: true })).toHaveValue("0");
  const darkPanel = await page.locator(".inspector").evaluate((node) => getComputedStyle(node).backgroundColor);
  await mkdir("artifacts/previews", { recursive: true });
  await page.screenshot({ path: "artifacts/previews/studio-dark.png" });
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  const darkPNG = await exportPNG(page);
  await page.getByRole("button", { name: "Включить светлую тему", exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass("dark");
  // Палитра перетекает за 160 мс, поэтому цвет панели проверяется с ожиданием.
  await expect.poll(async () => page.locator(".inspector").evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(darkPanel);
  const lightPNG = await exportPNG(page);
  expect(createHash("sha256").update(lightPNG).digest("hex")).toBe(createHash("sha256").update(darkPNG).digest("hex"));
  await page.reload(); await ready(page);
  await expect(page.getByRole("button", { name: "Включить тёмную тему", exact: true })).toBeVisible();
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.getByRole("button", { name: "Включить тёмную тему", exact: true }).click();
  await page.reload(); await ready(page);
  await expect(page.locator("html")).toHaveClass("dark");
  await preset(page, "Студийный");
  await expect(page.getByRole("button", { name: "Перспектива", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Сбросить настройки камеры", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Ракурс", exact: true })).toContainText("Прямо");
  await expect(page.getByRole("button", { name: "Ортография", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("навигация как в редакторе, отмена пресета и независимость экспорта", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  await preset(page, "Прямо");
  const before = await exportPNG(page);
  const board = page.getByTestId("artboard"), workspace = page.getByLabel("Рабочая область", { exact: true });
  const bounds = await board.boundingBox(); if (!bounds) throw new Error("Холст не найден");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  // Шаг колеса мягкий, поэтому заметный наезд набирается несколькими щелчками.
  await page.keyboard.down("Control");
  for (let step = 0; step < 3; step++) { await page.mouse.wheel(0, -80); await page.waitForTimeout(40); }
  await page.keyboard.up("Control");
  await expect.poll(async () => Number(await board.getAttribute("data-view-zoom"))).toBeGreaterThan(1.3);
  await workspace.focus(); await page.keyboard.down("Space"); await expect(workspace).toHaveClass(/hand-mode/);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 90, bounds.y + bounds.height / 2 + 50, { steps: 8 }); await page.mouse.up(); await page.keyboard.up("Space");
  await expect.poll(async () => Number(await board.getAttribute("data-view-x"))).toBeGreaterThan(80);
  const after = await exportPNG(page);
  expect(createHash("sha256").update(after).digest("hex")).toBe(createHash("sha256").update(before).digest("hex"));
  await workspace.focus(); await page.keyboard.press("Shift+1");
  await expect(board).toHaveAttribute("data-view-zoom", "1.000"); await expect(board).toHaveAttribute("data-view-x", "0.0");
  await preset(page, "Перспектива");
  await expect(page.getByRole("spinbutton", { name: "Фокусное расстояние", exact: true })).toHaveValue("22");
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: "Ортография", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByRole("spinbutton", { name: "Фокусное расстояние", exact: true })).toHaveValue("22");
  const lens = page.getByRole("slider", { name: "Фокусное расстояние, ползунок", exact: true });
  await lens.focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("spinbutton", { name: "Фокусное расстояние", exact: true })).toHaveValue("24");
  await page.keyboard.press("Control+z"); await expect(page.getByRole("spinbutton", { name: "Фокусное расстояние", exact: true })).toHaveValue("22");
  await workspace.focus(); await page.keyboard.press("h"); await expect(workspace).toHaveClass(/hand-mode/); await page.keyboard.press("v"); await expect(workspace).not.toHaveClass(/hand-mode/);
  expect(errors).toEqual([]);
});

test("пять моделей, ракурсы, изображение, отмена и сохранение проекта", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "экран.png", mimeType: "image/png", buffer: testImage() });
  await expect(page.getByText("экран.png", { exact: true })).toBeVisible();
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  await preset(page, "Прямо");
  await page.getByRole("tab", { name: "Экран", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Отражения на стекле", exact: true }).fill("0");
  await device(page, "iphone18"); await ready(page);
  for (const finish of ["Glacier", "Burgundy", "Silver", "Black"]) {
    await choose(page, "Цвет корпуса", finish); await ready(page);
    await expect(page.getByRole("combobox", { name: "Цвет корпуса", exact: true })).toContainText(finish);
    await expect(page.getByText("экран.png", { exact: true })).toBeVisible();
    const rendered = decodePNG(await exportPNG(page));
    const center = rendered.pixel(rendered.width / 2, rendered.height / 2);
    expect(center[2], `Экран ${finish} должен показывать загруженную синюю полосу`).toBeGreaterThan(180);
    expect(center[0]).toBeLessThan(50);
  }
  for (const name of ["Прямо", "Перспектива", "Сверху", "Горизонтально", "Сзади", "Студийный"]) {
    await preset(page, name);
    await expect(page.getByRole("combobox", { name: "Ракурс", exact: true })).toContainText(name);
  }
  await choose(page, "Цвет корпуса", "Burgundy"); await ready(page);
  await preset(page, "Сзади");
  await mkdir("artifacts/previews", { recursive: true });
  await page.screenshot({ path: "artifacts/previews/iphone18-burgundy.png" });
  await preset(page, "Студийный");
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Сохранить проект (Ctrl+S)", exact: true }).click();
  const project = await saved, path = await project.path(); if (!path) throw new Error("Нет файла проекта");
  const parsed = parseProject(await readFile(path, "utf8"));
  expect(parsed.settings.finish).toBe("burgundy"); expect(parsed.imageData).toMatch(/^data:image\/png;base64,/);
  await device(page, "iphone15"); await ready(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "проект.forma.json", mimeType: "application/json", buffer: Buffer.from(await readFile(path)) }); await ready(page);
  await expect(page.getByRole("combobox", { name: "Модель телефона", exact: true })).toContainText("iPhone 18 Pro Max");
  await expect(page.getByRole("combobox", { name: "Цвет корпуса", exact: true })).toContainText("Burgundy");
  await page.getByRole("button", { name: "Убрать изображение", exact: true }).click();
  await page.keyboard.press("Control+z"); await expect(page.getByText("экран.png", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("PNG 4K: размеры, альфа-канал, ориентация экрана и все форматы кадра", async ({ page }) => {
  await start(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "orientation.png", mimeType: "image/png", buffer: testImage() });
  await expect(page.getByText("orientation.png", { exact: true })).toBeVisible();
  await preset(page, "Прямо");
  await page.getByRole("tab", { name: "Экран", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Отражения на стекле", exact: true }).fill("0");
  await page.getByRole("tab", { name: "Сцена", exact: true }).click();
  await page.getByRole("button", { name: "Прозрачный", exact: true }).click();
  await page.getByLabel("Разрешение", { exact: true }).selectOption("3840");
  const png = decodePNG(await exportPNG(page));
  expect([png.width, png.height]).toEqual([3840, 2880]);
  expect(png.pixel(0, 0)[3]).toBe(0);
  const top = png.pixel(png.width / 2, png.height * 0.3), middle = png.pixel(png.width / 2, png.height * 0.5), bottom = png.pixel(png.width / 2, png.height * 0.7);
  expect(top[0]).toBeGreaterThan(200); expect(top[1]).toBeLessThan(50);
  expect(middle[2]).toBeGreaterThan(180); expect(middle[0]).toBeLessThan(50); expect(middle[3]).toBe(255);
  expect(bottom[1]).toBeGreaterThan(180); expect(bottom[0]).toBeLessThan(50);
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  for (const [aspect, width, height] of [["16:9", 1200, 675], ["1:1", 1200, 1200], ["4:5", 960, 1200], ["9:16", 675, 1200]] as const) {
    await page.getByRole("button", { name: aspect, exact: true }).click();
    const image = decodePNG(await exportPNG(page)); expect([image.width, image.height]).toEqual([width, height]); expect(image.pixel(0, 0)[3]).toBe(0);
  }
  await page.getByRole("button", { name: "4:3", exact: true }).click();
  await preset(page, "Перспектива");
  const hero = decodePNG(await exportPNG(page));
  let minY = hero.height, maxY = 0;
  for (let y = 0; y < hero.height; y++) for (let x = 0; x < hero.width; x++) {
    if (hero.pixel(x, y)[3] > 32) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  expect(minY, "Телефон не должен обрезаться сверху в готовом ракурсе").toBeGreaterThan(10);
  expect(maxY, "Ближний торец должен полностью попадать в готовый кадр").toBeLessThan(hero.height - 10);
  await page.getByRole("tab", { name: "Экран", exact: true }).click();
  await page.getByRole("checkbox", { name: "Вырез камеры" }).uncheck();
  await preset(page, "Прямо");
  const noIsland = decodePNG(await exportPNG(page));
  expect(noIsland.pixel(noIsland.width / 2, noIsland.height * 0.195)[0], "Отключённый вырез камеры должен заполниться изображением").toBeGreaterThan(200);
});

test("ошибки файлов, клавиатурные вкладки и адаптивный интерфейс", async ({ page }) => {
  await start(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("не изображение") });
  await expect(page.locator('.toast[role="alert"]')).toContainText("Не удалось прочитать изображение");
  await page.getByRole("tab", { name: "Камера", exact: true }).focus(); await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Экран", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Горячие клавиши", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).not.toBeVisible();
  for (const [width, height] of [[1440, 960], [1024, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("button", { name: "Скачать мокап" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("минимальный интерфейс, понятный свет и сохранённая отмена", async ({ page }) => {
  await start(page);
  await expect(page.locator(".app-header, .presets-section, .stage-footer")).toHaveCount(0);
  await expect(page.getByText("Хороший ракурс — в один клик")).toHaveCount(0);
  await expect(page.getByText("Сделано для ваших идей")).toHaveCount(0);
  await page.getByRole("tab", { name: "Сцена", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Яркость", exact: true })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Экспозиция", exact: true })).not.toBeVisible();
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  const soft = await exportPNG(page);
  await page.getByRole("button", { name: "По краям", exact: true }).click();
  await expect(page.getByText("Подсвечивает края на тёмном фоне.")).toBeVisible();
  const rim = await exportPNG(page);
  expect(createHash("sha256").update(rim).digest("hex")).not.toBe(createHash("sha256").update(soft).digest("hex"));
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: "Мягкий", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator(".light-advanced summary").click();
  await expect(page.getByRole("spinbutton", { name: "Экспозиция", exact: true })).toBeVisible();
  await page.locator(".light-advanced summary").click();
  await page.getByLabel("Разрешение", { exact: true }).selectOption("2400");
  await mkdir("artifacts/previews", { recursive: true });
  await page.getByRole("button", { name: "Включить светлую тему", exact: true }).click();
  await page.screenshot({ path: "artifacts/previews/studio-light.png" });
  await page.getByRole("tab", { name: "Камера", exact: true }).click();
  await page.screenshot({ path: "artifacts/previews/studio.png" });
});

test("вставка из буфера обмена и по ссылке на сайт или фрейм Figma", async ({ page }) => {
  const requests: { url: string; width: number; height: number }[] = [];
  let reply: { status: number; body: Buffer | string; contentType: string } = { status: 200, body: testImage(), contentType: "image/png" };
  await page.route("**/api/capture", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: reply.status, contentType: reply.contentType, headers: { "X-Capture-Name": "example.com" }, body: reply.body });
  });
  await start(page);
  const card = page.getByRole("button", { name: "Загрузить изображение на экран", exact: true });
  const field = page.getByRole("textbox", { name: "Ссылка на сайт или фрейм Figma", exact: true });

  // Адрес без протокола дополняется https://, а снимок запрашивается ровно в размер текстуры экрана.
  await field.fill("example.com"); await field.press("Enter");
  await expect(page.locator('.toast[role="status"]')).toContainText("Сайт на экране");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ url: "https://example.com/", width: 1290 });
  expect(requests[0].height).toBeGreaterThan(2700); expect(requests[0].height).toBeLessThan(2900);
  await expect(card).toContainText("example.com.png");
  await expect(field).toHaveValue("");

  const paste = (payload: { image?: number[]; text?: string; html?: string }) => page.evaluate(({ image, text, html }) => {
    const data = new DataTransfer();
    if (image) data.items.add(new File([new Uint8Array(image)], "image.png", { type: "image/png" }));
    if (text) data.setData("text/plain", text);
    if (html) data.setData("text/html", html);
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, payload);

  await paste({ image: [...testImage()] });
  await expect(card).toContainText("Из буфера обмена");
  await page.keyboard.press("Control+z"); await expect(card).toContainText("example.com.png");

  await paste({ html: '<meta charset="utf-8"><span data-metadata="<!--(figmeta)eyJ9(/figmeta)-->"></span>' });
  await expect(page.locator('.toast[role="alert"]')).toContainText("Copy as PNG");

  reply = { status: 400, contentType: "application/json", body: JSON.stringify({ error: "Сайт ответил ошибкой 404." }) };
  await paste({ text: "https://www.figma.com/design/abc/Test?node-id=1-2" });
  await expect(page.locator('.toast[role="alert"]')).toContainText("Сайт ответил ошибкой 404.");
  expect(requests.at(-1)?.url).toBe("https://www.figma.com/design/abc/Test?node-id=1-2");
  await expect(card).toContainText("example.com.png");
});
