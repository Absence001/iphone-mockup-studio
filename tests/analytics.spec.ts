import { test, expect } from "@playwright/test";

test("DAU отмечает взаимодействие и новый день, экспорт считается после успеха, блокировка аналитики безопасна", async ({ page }) => {
  const events: string[] = [], errors: string[] = [], tagRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.text().startsWith("analytics-test:")) events.push(message.text().slice("analytics-test:".length));
  });
  await page.route("https://www.clarity.ms/**", async (route) => { tagRequests.push(route.request().url()); await route.abort(); });
  await page.clock.setFixedTime(new Date("2026-10-15T10:00:00Z"));
  await page.addInitScript(() => { window.clarity = (_command, event) => console.info(`analytics-test:${event}`); });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Скачать мокап", exact: true });
  await expect(button).toBeEnabled();
  expect(events).toEqual([]);
  await page.getByRole("tab", { name: "Сцена", exact: true }).click();
  await page.getByRole("tab", { name: "Камера", exact: true }).click();
  await expect.poll(() => events.filter((event) => event === "editor_active").length).toBe(1);
  await page.getByLabel("Разрешение", { exact: true }).selectOption("1200");
  const exported = page.waitForEvent("download");
  await button.click(); await exported;
  await expect.poll(() => events.filter((event) => event === "mockup_export_png").length).toBe(1);
  await expect(button).toBeEnabled();

  await page.clock.setFixedTime(new Date("2026-10-16T10:00:00Z"));
  await page.evaluate(() => document.querySelector(".studio-shell")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  expect(events.filter((event) => event === "editor_active")).toHaveLength(1);
  await page.getByRole("tab", { name: "Экран", exact: true }).click();
  await expect.poll(() => events.filter((event) => event === "editor_active").length).toBe(2);

  const original = await page.evaluateHandle(() => HTMLCanvasElement.prototype.toBlob);
  await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); }; });
  await button.click();
  await expect(page.locator('.toast[role="alert"]')).toBeVisible();
  expect(events.filter((event) => event === "mockup_export_png")).toHaveLength(1);
  await page.evaluate((toBlob) => { HTMLCanvasElement.prototype.toBlob = toBlob; }, original);
  await original.dispose();

  await page.evaluate(() => { window.clarity = () => { throw new Error("Аналитика заблокирована"); }; });
  const withoutAnalytics = page.waitForEvent("download");
  await button.click(); await withoutAnalytics;
  await expect(button).toBeEnabled();
  expect(errors).toEqual([]);
  expect(tagRequests, "Локальные проверки не должны загружать настоящий Clarity").toEqual([]);
});
