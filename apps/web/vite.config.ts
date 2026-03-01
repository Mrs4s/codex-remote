import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const packageJson = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"),
) as {
  version: string;
};

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "@app": fileURLToPath(new URL("./src/features/app", import.meta.url)),
  "@settings": fileURLToPath(new URL("./src/features/settings", import.meta.url)),
  "@threads": fileURLToPath(new URL("./src/features/threads", import.meta.url)),
  "@services": fileURLToPath(new URL("./src/services", import.meta.url)),
  "@utils": fileURLToPath(new URL("./src/utils", import.meta.url)),
  "@tauri-apps/api/core": fileURLToPath(new URL("./src/tauri-shim/core.ts", import.meta.url)),
  "@tauri-apps/api/app": fileURLToPath(new URL("./src/tauri-shim/app.ts", import.meta.url)),
  "@tauri-apps/api/event": fileURLToPath(new URL("./src/tauri-shim/event.ts", import.meta.url)),
  "@tauri-apps/api/window": fileURLToPath(new URL("./src/tauri-shim/window.ts", import.meta.url)),
  "@tauri-apps/api/menu": fileURLToPath(new URL("./src/tauri-shim/menu.ts", import.meta.url)),
  "@tauri-apps/api/dpi": fileURLToPath(new URL("./src/tauri-shim/dpi.ts", import.meta.url)),
  "@tauri-apps/api/webview": fileURLToPath(new URL("./src/tauri-shim/webview.ts", import.meta.url)),
  "@tauri-apps/plugin-dialog": fileURLToPath(
    new URL("./src/tauri-shim/plugin-dialog.ts", import.meta.url),
  ),
  "@tauri-apps/plugin-opener": fileURLToPath(
    new URL("./src/tauri-shim/plugin-opener.ts", import.meta.url),
  ),
  "@tauri-apps/plugin-process": fileURLToPath(
    new URL("./src/tauri-shim/plugin-process.ts", import.meta.url),
  ),
  "@tauri-apps/plugin-updater": fileURLToPath(
    new URL("./src/tauri-shim/plugin-updater.ts", import.meta.url),
  ),
  "@tauri-apps/plugin-notification": fileURLToPath(
    new URL("./src/tauri-shim/plugin-notification.ts", import.meta.url),
  ),
  "tauri-plugin-liquid-glass-api": fileURLToPath(
    new URL("./src/tauri-shim/liquid-glass.ts", import.meta.url),
  ),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  worker: {
    format: "es",
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __APP_COMMIT_HASH__: JSON.stringify("unknown"),
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __APP_GIT_BRANCH__: JSON.stringify("web"),
  },
  server: {
    port: 5173,
    strictPort: true,
    allowedHosts: ["localhost"],
  },
});
