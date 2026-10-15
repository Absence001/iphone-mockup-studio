import { defineConfig } from "@playwright/test";

const windows = process.platform === "win32";

export default defineConfig({
  testDir: "./tests",
  timeout: 90000,
  expect: { timeout: 20000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    // На Windows тесты идут в установленном Edge, на macOS и Linux — в Chromium из Playwright.
    channel: windows ? "msedge" : undefined,
    viewport: { width: 1440, height: 960 },
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
    screenshot: "only-on-failure",
  },
  webServer: { command: windows ? "npm.cmd run dev" : "npm run dev", url: "http://127.0.0.1:3000", reuseExistingServer: true, timeout: 60000 },
});
