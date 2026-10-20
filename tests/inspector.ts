import { expect, type Page } from "@playwright/test";

export async function openSection(page: Page, name: string) {
  const group = ["Фон", "Свет", "Тень"].includes(name) ? "Сцена" : name === "Камера" ? "Камера" : ["Анимация", "Аудио"].includes(name) ? "Анимация" : "Устройство";
  const navigation = page.getByRole("button", { name: `Раздел: ${group}`, exact: true });
  const switched = await navigation.getAttribute("aria-pressed") !== "true";
  if (switched) await navigation.click();
  const trigger = page.getByRole("button", { name, exact: true });
  // Навигация сама раскрывает целевой раздел; ранний клик по заголовку
  // может тут же закрыть его, если эффект раскрытия ещё не отработал.
  if (switched && ["Устройство", "Камера", "Фон", "Анимация"].includes(name)) await expect(trigger).toHaveAttribute("aria-expanded", "true");
  else if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}
