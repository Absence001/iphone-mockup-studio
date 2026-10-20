import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { parseProject } from "../src/lib/project";
import { TIME_STEP } from "../src/lib/animation";

async function start(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Скачать PNG", exact: true })).toBeEnabled();
  const frame = (time: number) => ({ time, value: time * 5, ease: "inOutCubic" });
  const project = { app: "forma", version: 1, settings: DEFAULT_SETTINGS, imageData: null, animation: { duration: 6, tracks: { "camera.azimuth": [0.5, 1.5, 3, 4.5].map(frame), "transform.rotY": [1, 2.5].map(frame) } } };
  await page.getByLabel("Файл изображения, видео или проекта", { exact: true }).setInputFiles({ name: "selection.forma.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
  await page.getByRole("button", { name: "Анимация", exact: true }).click();
  await expect(page.locator(".timeline-row.object .timeline-key")).toHaveCount(6);
}

async function saved(page: Page) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Сохранить проект (Ctrl+S)" }).click();
  const path = await (await downloading).path();
  if (!path) throw new Error("Проект не сохранён");
  return parseProject(await readFile(path, "utf8"));
}

test("ключ следует за мышью при масштабе и прокрутке, перенос отменяется одним шагом", async ({ page }) => {
  await start(page);
  const key = page.locator(".timeline-row.object").first().locator(".timeline-key").nth(1);
  for (const zoom of [1, 3]) {
    const range = page.getByRole("slider", { name: "Масштаб шкалы" });
    await range.focus(); await range.press("Home");
    for (let index = 1; index < zoom * 10 - 9; index++) await range.press("ArrowRight");
    await page.locator(".timeline-scroll").evaluate((element, scroll) => { element.scrollLeft = scroll; }, zoom === 1 ? 0 : 100);
    const rect = await key.boundingBox();
    if (!rect) throw new Error("Ключ не виден");
    const first = await page.locator(".timeline-row.object").first().locator(".timeline-key").first().boundingBox();
    // Шаг времени — 0,01 с: допустима половина шага и округление координаты мыши.
    const tolerance = (rect.x - first!.x) * TIME_STEP / 2 + 1;
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (const dx of [20, 40, 65]) {
      await page.mouse.move(x + dx, y, { steps: 3 });
      await expect.poll(async () => { const at = await key.boundingBox(); return Math.abs((at!.x + at!.width / 2) - x - dx); }, { message: `Масштаб ${zoom}, перенос ${dx}px` }).toBeLessThan(tolerance);
    }
    await page.mouse.up();
    expect((await saved(page)).animation.tracks["camera.azimuth"]![1].time).toBeGreaterThan(1.5);
    await page.keyboard.press("Control+z");
    await expect(key).toHaveAttribute("aria-label", "Ключ Камера, 1,50 с");
  }
});

test("рамка, выбор слоя и Shift применяют easing только к выбранным участкам", async ({ page }) => {
  await start(page);
  const camera = page.locator(".timeline-row.object").first();
  const device = page.locator(".timeline-row.object").nth(1);
  const first = await camera.locator(".timeline-key").first().boundingBox();
  const second = await camera.locator(".timeline-key").nth(1).boundingBox();
  const bottom = await device.boundingBox();
  if (!first || !second || !bottom) throw new Error("Дорожки не видны");
  await page.mouse.move(first.x - 8, first.y - 4); await page.mouse.down();
  await page.mouse.move(second.x + second.width + 8, bottom.y + bottom.height - 2, { steps: 6 });
  await expect(page.locator(".timeline-marquee")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".timeline-row.object .timeline-key.selected")).toHaveCount(3);
  await page.getByRole("button", { name: "Линейно", exact: true }).click();
  let document = await saved(page);
  expect(document.animation.tracks["camera.azimuth"]!.map((key) => key.ease)).toEqual(["linear", "inOutCubic", "inOutCubic", "inOutCubic"]);
  expect(document.animation.tracks["transform.rotY"]![0].ease).toBe("inOutCubic");
  await page.keyboard.press("Control+z");

  await page.getByRole("button", { name: "Выбрать все ключи: Камера", exact: true }).click();
  await expect(camera.locator(".timeline-key.selected")).toHaveCount(4);
  await device.locator(".timeline-name").click({ modifiers: ["Shift"] });
  await expect(page.locator(".timeline-row.object .timeline-key.selected")).toHaveCount(6);
  await page.getByRole("button", { name: "Торможение", exact: true }).click();
  document = await saved(page);
  expect(document.animation.tracks["camera.azimuth"]!.slice(0, -1).every((key) => key.ease === "outCubic")).toBe(true);
  expect(document.animation.tracks["transform.rotY"]![0].ease).toBe("outCubic");
  await page.keyboard.press("Control+z");

  await camera.locator(".timeline-segment").first().click();
  await camera.locator(".timeline-segment").nth(2).click({ modifiers: ["Shift"] });
  await expect(camera.locator(".timeline-segment.selected")).toHaveCount(2);
  await page.getByRole("button", { name: "Разгон", exact: true }).click();
  document = await saved(page);
  expect(document.animation.tracks["camera.azimuth"]!.map((key) => key.ease)).toEqual(["inCubic", "inOutCubic", "inCubic", "inOutCubic"]);
  await page.keyboard.press("Control+z");
  await page.getByRole("button", { name: "Выбрать все ключи: Камера", exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(camera.locator(".timeline-key")).toHaveCount(0);
  await expect(device.locator(".timeline-key")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(camera.locator(".timeline-key")).toHaveCount(4);
});
