import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { historyReducer, INITIAL_HISTORY } from "../src/lib/history";
import { parseProject } from "../src/lib/project";
import { QUAD, decodePNG, quadImage, testImage } from "./png";

async function ready(page: Page) { await expect(page.getByRole("button", { name: "Скачать мокап" })).toBeEnabled(); }
async function start(page: Page) { await page.goto("/"); await ready(page); }
async function choose(page: Page, label: string, name: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}
async function preset(page: Page, name: string) { await choose(page, "Ракурс", name); }
async function device(page: Page, name: string) { await choose(page, "Модель устройства", name); }
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
  // Проект до появления Duo: без сгиба, цвет чужой модели заменяется доступным.
  const { fold: _fold, ...legacy } = INITIAL_HISTORY.present.settings;
  const old = parseProject(JSON.stringify({ app: "forma", version: 1, settings: { ...legacy, device: "iphone15", finish: "glacier" }, imageData: null }));
  expect(old.settings.fold).toBe("open"); expect(old.settings.finish).toBe("black");
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

test("модели iPhone, ракурсы, изображение, отмена и сохранение проекта", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await expect(page.locator(".screen-size")).toHaveText("1290 × 2796 px");
  await page.locator('input[type="file"]').setInputFiles({ name: "экран.png", mimeType: "image/png", buffer: testImage() });
  await expect(page.getByText("экран.png", { exact: true })).toBeVisible();
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  await preset(page, "Прямо");
  await page.getByRole("tab", { name: "Экран", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Отражения на стекле", exact: true }).fill("0");
  await device(page, "iPhone 18 Pro Max"); await ready(page);
  await expect(page.locator(".screen-size")).toHaveText("1320 × 2868 px");
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
  await device(page, "iPhone 15 Pro Max"); await ready(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "проект.forma.json", mimeType: "application/json", buffer: Buffer.from(await readFile(path)) }); await ready(page);
  await expect(page.getByRole("combobox", { name: "Модель устройства", exact: true })).toContainText("iPhone 18 Pro Max");
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

/** Средние координаты пикселей каждого цвета квадранта на кадре. */
function quadrants(png: ReturnType<typeof decodePNG>) {
  const sums = Object.fromEntries(Object.keys(QUAD).map((name) => [name, { x: 0, y: 0, count: 0 }])) as Record<keyof typeof QUAD, { x: number; y: number; count: number }>;
  for (let y = 0; y < png.height; y += 2) for (let x = 0; x < png.width; x += 2) {
    const [r, g, b] = png.pixel(x, y);
    for (const [name, color] of Object.entries(QUAD) as [keyof typeof QUAD, readonly number[]][]) {
      if (Math.abs(r - color[0]) + Math.abs(g - color[1]) + Math.abs(b - color[2]) < 40) { sums[name].x += x; sums[name].y += y; sums[name].count++; }
    }
  }
  return Object.fromEntries(Object.entries(sums).map(([name, sum]) => [name, { x: sum.x / sum.count, y: sum.y / sum.count, count: sum.count }])) as Record<keyof typeof QUAD, { x: number; y: number; count: number }>;
}

test("Android, Duo, MacBook и монитор: экран без зеркала, сгиб и проект", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await page.locator('input[type="file"]').setInputFiles({ name: "quad.png", mimeType: "image/png", buffer: quadImage() });
  await expect(page.getByText("quad.png", { exact: true })).toBeVisible();
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  await page.getByRole("tab", { name: "Экран", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Отражения на стекле", exact: true }).fill("0");
  const check = async (label: string) => {
    const quad = quadrants(decodePNG(await exportPNG(page)));
    for (const [name, value] of Object.entries(quad)) expect(value.count, `${label}: на экране нет цвета ${name}`).toBeGreaterThan(200);
    expect(quad.red.x, `${label}: красный должен быть слева`).toBeLessThan(quad.green.x);
    expect(quad.blue.x, `${label}: синий должен быть слева`).toBeLessThan(quad.yellow.x);
    expect(quad.red.y, `${label}: красный должен быть сверху`).toBeLessThan(quad.blue.y);
  };
  // Подсказка размера скриншота — родное разрешение устройства.
  const shotSize = { "Galaxy S26 Ultra": "1440 × 3120 px", "MacBook Pro 14″": "3024 × 1964 px", "Pro Display XDR": "6016 × 3384 px" };
  for (const [name, size] of Object.entries(shotSize)) {
    await device(page, name); await ready(page);
    await expect(page.getByText("quad.png", { exact: true })).toBeVisible();
    await expect(page.locator(".screen-size")).toHaveText(size);
    await preset(page, "Прямо");
    await check(name);
  }
  await expect(page.getByRole("checkbox", { name: "Вырез камеры" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Ракурс", exact: true }).click();
  await expect(page.getByRole("option", { name: "Сзади", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "Горизонтально", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(page.getByRole("listbox")).toHaveCount(0);
  await device(page, "iPhone Duo"); await ready(page);
  await expect(page.getByRole("checkbox", { name: "Вырез камеры" })).toHaveCount(0);
  for (const fold of ["Раскрыт", "Книжкой", "Сложен"]) {
    await page.getByRole("button", { name: fold, exact: true }).click(); await ready(page);
    await check(`iPhone Duo, ${fold}`);
  }
  // У вымышленного Duo нет родного разрешения: размер измеряется по экрану модели.
  await expect(page.locator(".screen-size")).toHaveText("1290 × 1865 px");
  // У сложенного Duo изображение на внешнем экране с вырезом камеры.
  await expect(page.getByRole("checkbox", { name: "Вырез камеры" })).toBeVisible();
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Сохранить проект (Ctrl+S)", exact: true }).click();
  const project = await saved, path = await project.path(); if (!path) throw new Error("Нет файла проекта");
  const parsed = parseProject(await readFile(path, "utf8"));
  expect(parsed.settings.device).toBe("iphoneDuo"); expect(parsed.settings.fold).toBe("closed"); expect(parsed.settings.finish).toBe("starWhite");
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: "Книжкой", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
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
  const requests: { url: string; width: number; height: number; desktop: boolean; scrollY?: number }[] = [];
  let reply: { status: number; body: Buffer | string; contentType: string } = { status: 200, body: testImage(), contentType: "image/png" };
  await page.route("**/api/capture", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    // Сайт без scrollY отвечает предпросмотром: страница 129 × 279 — это три окна 129 × 93.
    const preview = reply.status === 200 && body.scrollY === undefined && !body.url.includes("figma.com");
    await route.fulfill({ status: reply.status, contentType: reply.contentType, headers: { "X-Capture-Name": "example.com", ...preview ? { "X-Viewport-Width": "129", "X-Viewport-Height": "93" } : {} }, body: reply.body });
  });
  const picker = page.getByRole("dialog", { name: "Какой экран снять?" });
  await start(page);
  const card = page.getByRole("button", { name: "Загрузить изображение на экран", exact: true });
  const field = page.getByRole("textbox", { name: "Ссылка на сайт или фрейм Figma", exact: true });

  // Адрес без протокола дополняется https://, а снимок запрашивается ровно в размер текстуры экрана.
  await field.fill("example.com"); await field.press("Enter");
  await expect(picker).toBeVisible();
  await expect(picker).toContainText("Начало страницы");
  // Отмена ничего не снимает, ссылка остаётся в поле.
  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(field).toHaveValue("example.com");
  expect(requests).toHaveLength(1);

  // Место на странице выбирается прокруткой окна и уходит в запрос снимка.
  await field.press("Enter");
  await expect(picker).toBeVisible();
  await picker.getByRole("region", { name: "Страница сайта" }).evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(picker).toContainText("Прокручено на 186 px");
  await picker.getByRole("button", { name: "Снять этот экран" }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText("Сайт на экране");
  expect(requests).toHaveLength(3);
  expect(requests[0]).toMatchObject({ url: "https://example.com/", width: 1290 });
  expect(requests[0].scrollY).toBeUndefined();
  expect(requests[2]).toMatchObject({ url: "https://example.com/", width: 1290, scrollY: 186 });
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

  // MacBook снимает сайт в настольной вёрстке и в ширину своего экрана.
  reply = { status: 200, body: testImage(), contentType: "image/png" };
  expect(requests[0].desktop).toBe(false);
  await device(page, "MacBook Pro 14″"); await ready(page);
  await field.fill("example.com"); await field.press("Enter");
  await picker.getByRole("button", { name: "Снять этот экран" }).click();
  await expect(page.locator('.toast[role="status"]')).toContainText("Сайт на экране");
  expect(requests.at(-1)).toMatchObject({ width: 2796, desktop: true, scrollY: 0 });
  expect(requests.at(-1)!.height).toBeGreaterThan(1750); expect(requests.at(-1)!.height).toBeLessThan(1900);
});
