import type { NextConfig } from "next";

const config: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  // Браузер для снимков сайтов не собирается бандлером: пакет ищет архив
  // Chromium рядом с собой, поэтому его файлы явно кладутся в функцию.
  serverExternalPackages: ["playwright-core", "@sparticuz/chromium"],
  outputFileTracingIncludes: { "/api/capture": ["./node_modules/@sparticuz/chromium/bin/**"] },
};

export default config;
