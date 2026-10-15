import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Готовит новый worktree T3 Code: переносит локальные .env из основной папки
 * проекта (например, FIGMA_TOKEN) и ставит зависимости. Запускается из
 * t3.json при создании worktree, но работает и вручную.
 */
const worktree = fileURLToPath(new URL("../", import.meta.url));
const projectRoot = process.env.T3CODE_PROJECT_ROOT;

if (projectRoot && path.resolve(projectRoot) !== path.resolve(worktree)) {
  for (const entry of readdirSync(projectRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(".env") || entry.name === ".env.example" || existsSync(path.join(worktree, entry.name))) continue;
    copyFileSync(path.join(projectRoot, entry.name), path.join(worktree, entry.name));
    console.log(`Скопирован ${entry.name} из ${projectRoot}`);
  }
}

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: worktree, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npm", ["ci"]);
// Снимки по ссылке и тесты на macOS и Linux идут через Chromium из Playwright,
// на Windows — через установленный Edge.
if (process.platform !== "win32") run("npx", ["playwright", "install", "chromium"]);
