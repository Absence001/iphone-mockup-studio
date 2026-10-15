import type { NextConfig } from "next";

const config: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  // Браузер для снимков сайтов не собирается бандлером: пакет ищет архив
  // Chromium рядом с собой, поэтому его файлы явно кладутся в функцию.
  // Playwright читает browsers.json по вычисляемому пути, который трассировка
  // не видит: без явного включения функция на Vercel падает при импорте.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: { "/api/capture": ["./node_modules/@sparticuz/chromium/bin/**", "./node_modules/playwright-core/**"] },
};

export default config;
