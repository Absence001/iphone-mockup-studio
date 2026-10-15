import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const next = path.join(root, "node_modules/next/dist/bin/next");
const noOpen = process.argv.includes("--no-open");
if (!existsSync(next)) {
  console.error("Не найдены зависимости. Выполните npm install в папке проекта.");
  process.exit(1);
}

async function inspect(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) });
    const html = await response.text();
    return html.includes('aria-label="Настройки мокапа"') ? "ours" : "busy";
  } catch { return "free"; }
}

function open(url) {
  console.log(`\nОткрыть редактор: ${url}\n`);
  if (noOpen) return;
  if (process.platform === "win32") execFile("rundll32.exe", ["url.dll,FileProtocolHandler", url], { windowsHide: true });
  else if (process.platform === "darwin") execFile("open", [url]);
  else execFile("xdg-open", [url]);
}

let port = 3000;
while (port <= 3010) {
  const state = await inspect(port);
  if (state === "ours") { open(`http://127.0.0.1:${port}`); process.exit(0); }
  if (state === "free") break;
  port++;
}
if (port > 3010) { console.error("Порты 3000–3010 заняты. Освободите один из них и запустите редактор снова."); process.exit(1); }

const mode = existsSync(path.join(root, ".next/BUILD_ID")) ? "start" : "dev";
const child = spawn(process.execPath, [next, mode, "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("error", (error) => { console.error(`Не удалось запустить редактор: ${error.message}`); process.exit(1); });
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => { child.kill(); });
process.on("SIGTERM", () => { child.kill(); });

let launched = false;
for (let attempt = 0; attempt < 150; attempt++) {
  if (await inspect(port) === "ours") { open(`http://127.0.0.1:${port}`); launched = true; break; }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!launched) console.error("Запуск занимает больше времени. Дождитесь сообщения Ready и откройте адрес из консоли.");
